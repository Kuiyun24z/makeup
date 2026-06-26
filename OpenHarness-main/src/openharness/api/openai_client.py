"""OpenAI-compatible API client for providers like Alibaba DashScope, GitHub Models, etc."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncIterator
from urllib.parse import urlsplit, urlunsplit

from openai import AsyncOpenAI

from openharness.api.client import (
    ApiMessageCompleteEvent,
    ApiMessageRequest,
    ApiRetryEvent,
    ApiStreamEvent,
    ApiTextDeltaEvent,
)
from openharness.api.errors import (
    AuthenticationFailure,
    OpenHarnessApiError,
    RateLimitFailure,
    RequestFailure,
)
from openharness.api.usage import UsageSnapshot
from openharness.engine.messages import (
    ConversationMessage,
    ContentBlock,
    ImageBlock,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
)

log = logging.getLogger(__name__)

MAX_RETRIES = 3
BASE_DELAY = 1.0
MAX_DELAY = 30.0
_MAX_COMPLETION_TOKEN_MODEL_PREFIXES = ("gpt-5", "o1", "o3", "o4")


def _token_limit_param_for_model(model: str, max_tokens: int) -> dict[str, int]:
    """Return the correct token limit field for the target OpenAI model.

    GPT-5 and the current reasoning-model families reject ``max_tokens`` and
    require ``max_completion_tokens`` instead.
    """
    normalized = model.strip().lower()
    if "/" in normalized:
        normalized = normalized.rsplit("/", 1)[-1]
    if normalized.startswith(_MAX_COMPLETION_TOKEN_MODEL_PREFIXES):
        return {"max_completion_tokens": max_tokens}
    return {"max_tokens": max_tokens}


def _convert_tools_to_openai(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert Anthropic tool schemas to OpenAI function-calling format.

    Anthropic format:
        {"name": "...", "description": "...", "input_schema": {...}}
    OpenAI format:
        {"type": "function", "function": {"name": "...", "description": "...", "parameters": {...}}}
    """
    result = []
    for tool in tools:
        result.append({
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema", {}),
            },
        })
    return result


def _convert_messages_to_openai(
    messages: list[ConversationMessage],
    system_prompt: str | None,
) -> list[dict[str, Any]]:
    """Convert Anthropic-style messages to OpenAI chat format.

    Key differences:
    - Anthropic: system prompt is a separate parameter
    - OpenAI: system prompt is a message with role="system"
    - Anthropic: tool_use / tool_result are content blocks
    - OpenAI: tool_calls on assistant message, tool results are separate messages
    """
    openai_messages: list[dict[str, Any]] = []

    if system_prompt:
        openai_messages.append({"role": "system", "content": system_prompt})

    for msg in messages:
        if msg.role == "assistant":
            openai_msg = _convert_assistant_message(msg)
            openai_messages.append(openai_msg)
        elif msg.role == "user":
            # User messages may contain text or tool_result blocks
            tool_results = [b for b in msg.content if isinstance(b, ToolResultBlock)]
            user_blocks = [b for b in msg.content if isinstance(b, (TextBlock, ImageBlock))]

            if tool_results:
                # Each tool result becomes a separate message with role="tool"
                for tr in tool_results:
                    openai_messages.append({
                        "role": "tool",
                        "tool_call_id": tr.tool_use_id,
                        "content": tr.content,
                    })
            if user_blocks:
                content = _convert_user_content_to_openai(user_blocks)
                if isinstance(content, str):
                    if content.strip():
                        openai_messages.append({"role": "user", "content": content})
                elif content:
                    openai_messages.append({"role": "user", "content": content})
            if not tool_results and not user_blocks:
                # Empty user message (shouldn't happen, but handle gracefully)
                openai_messages.append({"role": "user", "content": ""})

    return openai_messages


def _convert_user_content_to_openai(blocks: list[ContentBlock]) -> str | list[dict[str, Any]]:
    """Convert user text/image blocks into OpenAI chat content."""
    has_image = any(isinstance(block, ImageBlock) for block in blocks)
    if not has_image:
        return "".join(block.text for block in blocks if isinstance(block, TextBlock))

    content: list[dict[str, Any]] = []
    for block in blocks:
        if isinstance(block, TextBlock) and block.text:
            content.append({"type": "text", "text": block.text})
        elif isinstance(block, ImageBlock):
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{block.media_type};base64,{block.data}",
                },
            })
    return content


_EMPTY_REASONING_ENV = "OPENHARNESS_REQUIRE_EMPTY_REASONING_CONTENT"


def _empty_reasoning_required() -> bool:
    """True when the operator's provider requires an empty
    ``reasoning_content`` field on tool-using assistant messages
    (Kimi-on-Anthropic style). Default off — strict-OpenAI providers
    reject the field outright.
    """
    raw = os.environ.get(_EMPTY_REASONING_ENV, "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _convert_assistant_message(msg: ConversationMessage) -> dict[str, Any]:
    """Convert an assistant ConversationMessage to OpenAI format.

    ``reasoning_content`` is a non-standard field used by thinking models
    (e.g. Kimi k2.5) to carry the model's internal chain-of-thought across
    turns. Some thinking-model providers require it on every assistant
    message with tool calls — even when empty — or they reject the request.
    Other OpenAI-compatible providers (Cerebras, OpenAI's own
    endpoint, etc.) reject the field outright with a 400
    ``wrong_api_format`` error.

    Behaviour:

    - When the streaming parser captured non-empty reasoning on
      ``msg._reasoning``, we always replay it. Models that emit reasoning
      tokens are by definition thinking models that round-trip them.
    - When there is no captured reasoning but the message has tool calls,
      we emit ``reasoning_content: ""`` only if the operator opts in via
      ``OPENHARNESS_REQUIRE_EMPTY_REASONING_CONTENT=1``. The default is
      omit, which matches strict-OpenAI providers.

    The opt-in default keeps strict-OpenAI providers (Cerebras, NVIDIA NIM,
    OpenAI direct, etc.) working out-of-the-box; Kimi-on-Anthropic users
    set the env var in their dotfiles or settings.
    """
    text_parts = [b.text for b in msg.content if isinstance(b, TextBlock)]
    tool_uses = [b for b in msg.content if isinstance(b, ToolUseBlock)]

    openai_msg: dict[str, Any] = {"role": "assistant"}

    content = "".join(text_parts)
    openai_msg["content"] = content if content else None

    # Replay reasoning_content for thinking models (stored by streaming parser)
    reasoning = getattr(msg, "_reasoning", None)
    if reasoning:
        openai_msg["reasoning_content"] = reasoning
    elif tool_uses and _empty_reasoning_required():
        # Kimi-style providers reject tool_use messages without this field
        # even when there's nothing to put in it. Opt-in via env var.
        openai_msg["reasoning_content"] = ""

    if tool_uses:
        openai_msg["tool_calls"] = [
            {
                "id": tu.id,
                "type": "function",
                "function": {
                    "name": tu.name,
                    "arguments": json.dumps(tu.input),
                },
            }
            for tu in tool_uses
        ]

    return openai_msg


def _parse_assistant_response(response: Any) -> ConversationMessage:
    """Parse an OpenAI ChatCompletion response into a ConversationMessage."""
    choice = response.choices[0]
    message = choice.message
    content: list[ContentBlock] = []

    if message.content:
        content.append(TextBlock(text=message.content))

    if message.tool_calls:
        for tc in message.tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except (json.JSONDecodeError, TypeError):
                args = {}
            content.append(ToolUseBlock(
                id=tc.id,
                name=tc.function.name,
                input=args,
            ))

    return ConversationMessage(role="assistant", content=content)


def _normalize_openai_base_url(base_url: str | None) -> str | None:
    """Normalize custom OpenAI-compatible base URLs without dropping API path segments."""
    if not base_url:
        return None
    trimmed = base_url.strip()
    if not trimmed:
        return None
    parts = urlsplit(trimmed)
    if not parts.scheme or not parts.netloc:
        return trimmed.rstrip("/")
    path = parts.path.rstrip("/")
    if not path:
        path = "/v1"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


class OpenAICompatibleClient:
    """Client for OpenAI-compatible APIs (DashScope, GitHub Models, etc.).

    Implements the same SupportsStreamingMessages protocol as AnthropicApiClient
    so it can be used as a drop-in replacement in the agent loop.
    """

    def __init__(self, api_key: str, *, base_url: str | None = None, timeout: float | None = None) -> None:
        kwargs: dict[str, Any] = {
            "api_key": api_key,
            "default_headers": {"Authorization": f"Bearer {api_key}"},
        }
        normalized_base_url = _normalize_openai_base_url(base_url)
        if normalized_base_url:
            kwargs["base_url"] = normalized_base_url
        if timeout is not None:
            kwargs["timeout"] = timeout
        self._client = AsyncOpenAI(**kwargs)

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.close()

    async def stream_message(self, request: ApiMessageRequest) -> AsyncIterator[ApiStreamEvent]:
        """Yield text deltas and the final message, matching the Anthropic client interface."""
        last_error: Exception | None = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                async for event in self._stream_once(request):
                    yield event
                return
            except OpenHarnessApiError:
                raise
            except Exception as exc:
                last_error = exc
                if attempt >= MAX_RETRIES or not self._is_retryable(exc):
                    raise self._translate_error(exc) from exc

                delay = min(BASE_DELAY * (2 ** attempt), MAX_DELAY)
                log.warning(
                    "OpenAI API request failed (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1, MAX_RETRIES + 1, delay, exc,
                )
                yield ApiRetryEvent(
                    message=str(exc),
                    attempt=attempt + 1,
                    max_attempts=MAX_RETRIES + 1,
                    delay_seconds=delay,
                )
                await asyncio.sleep(delay)

        if last_error is not None:
            raise self._translate_error(last_error) from last_error

    async def _stream_once(self, request: ApiMessageRequest) -> AsyncIterator[ApiStreamEvent]:
        """Single attempt: stream an OpenAI chat completion."""
        openai_messages = _convert_messages_to_openai(request.messages, request.system_prompt)
        openai_tools = _convert_tools_to_openai(request.tools) if request.tools else None

        params: dict[str, Any] = {
            "model": request.model,
            "messages": openai_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        params.update(_token_limit_param_for_model(request.model, request.max_tokens))
        if openai_tools:
            params["tools"] = openai_tools
            # Some providers (Kimi) error on empty reasoning_content in
            # tool-call follow-ups.  Omit the entire stream_options key if
            # tools are present – avoids triggering model-side thinking mode
            # that requires reasoning_content on every assistant message.
            params.pop("stream_options", None)

        # Collect full response while streaming text deltas
        collected_content = ""
        collected_reasoning = ""
        collected_tool_calls: dict[int, dict[str, Any]] = {}
        inline_tool_calls: list[dict[str, Any]] = []
        finish_reason: str | None = None
        usage_data: dict[str, int] = {}
        # Buffer to strip inline <think>…</think> blocks across streaming chunks.
        _think_buf = ""
        # Some Ark/Doubao models encode tool calls in text using PLHD markers
        # instead of standard delta.tool_calls. Hold partial markers here.
        _inline_tool_buf = ""

        stream = await self._client.chat.completions.create(**params)
        async for chunk in stream:
            if not chunk.choices:
                # Usage-only chunk (some providers send this at the end)
                if chunk.usage:
                    usage_data = {
                        "input_tokens": chunk.usage.prompt_tokens or 0,
                        "output_tokens": chunk.usage.completion_tokens or 0,
                    }
                continue

            delta = chunk.choices[0].delta
            chunk_finish = chunk.choices[0].finish_reason

            if chunk_finish:
                finish_reason = chunk_finish

            # Accumulate reasoning_content from thinking models (not shown to user)
            reasoning_piece = getattr(delta, "reasoning_content", None) or ""
            if reasoning_piece:
                collected_reasoning += reasoning_piece

            # Stream text content to user, stripping inline <think> blocks
            if delta.content:
                _inline_tool_buf += delta.content
                visible_content, _inline_tool_buf, parsed_inline_calls = (
                    _consume_inline_tool_blocks(_inline_tool_buf)
                )
                inline_tool_calls.extend(parsed_inline_calls)
                _think_buf += visible_content
                visible, _think_buf = _strip_think_blocks(_think_buf)
                if visible:
                    collected_content += visible
                    yield ApiTextDeltaEvent(text=visible)

            # Accumulate tool calls
            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in collected_tool_calls:
                        collected_tool_calls[idx] = {
                            "id": tc_delta.id or "",
                            "name": "",
                            "arguments": "",
                        }
                    entry = collected_tool_calls[idx]
                    if tc_delta.id:
                        entry["id"] = tc_delta.id
                    if tc_delta.function:
                        if tc_delta.function.name:
                            entry["name"] = tc_delta.function.name
                        if tc_delta.function.arguments:
                            entry["arguments"] += tc_delta.function.arguments

            # Usage in chunk (if provider sends it)
            if chunk.usage:
                usage_data = {
                    "input_tokens": chunk.usage.prompt_tokens or 0,
                    "output_tokens": chunk.usage.completion_tokens or 0,
                }

        trailing_content, _inline_tool_buf, parsed_inline_calls = _consume_inline_tool_blocks(
            _inline_tool_buf,
            final=True,
        )
        inline_tool_calls.extend(parsed_inline_calls)
        if trailing_content:
            _think_buf += trailing_content
            visible, _think_buf = _strip_think_blocks(_think_buf)
            if visible:
                collected_content += visible
                yield ApiTextDeltaEvent(text=visible)

        # Build the final ConversationMessage
        content: list[ContentBlock] = []
        if collected_content:
            content.append(TextBlock(text=collected_content))

        for _idx in sorted(collected_tool_calls.keys()):
            tc = collected_tool_calls[_idx]
            # Skip phantom/empty tool calls that some providers send
            if not tc["name"]:
                continue
            try:
                args = json.loads(tc["arguments"])
            except (json.JSONDecodeError, TypeError):
                args = {}
            content.append(ToolUseBlock(
                id=tc["id"],
                name=tc["name"],
                input=args,
            ))

        for inline_call in inline_tool_calls:
            content.append(
                ToolUseBlock(
                    id=inline_call["id"],
                    name=inline_call["name"],
                    input=inline_call["input"],
                )
            )
        if inline_tool_calls:
            finish_reason = "tool_use"

        final_message = ConversationMessage(role="assistant", content=content)

        # Stash reasoning for thinking models so _convert_assistant_message
        # can replay it when the message is sent back to the API
        if collected_reasoning:
            final_message._reasoning = collected_reasoning  # type: ignore[attr-defined]

        yield ApiMessageCompleteEvent(
            message=final_message,
            usage=UsageSnapshot(
                input_tokens=usage_data.get("input_tokens", 0),
                output_tokens=usage_data.get("output_tokens", 0),
            ),
            stop_reason=finish_reason,
        )

    @staticmethod
    def _is_retryable(exc: Exception) -> bool:
        status = getattr(exc, "status_code", None)
        if status and status in {429, 500, 502, 503}:
            return True
        if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
            return True
        return False

    @staticmethod
    def _translate_error(exc: Exception) -> OpenHarnessApiError:
        status = getattr(exc, "status_code", None)
        msg = str(exc)
        if status == 401 or status == 403:
            return AuthenticationFailure(msg)
        if status == 429:
            return RateLimitFailure(msg)
        return RequestFailure(msg)


# Matches complete <think>…</think> blocks (DOTALL so newlines are included).
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_OPEN_TAG = "<think>"
_PLHD_TOOL_OPEN_RE = re.compile(r"<\[PLHD20_never_used_([A-Za-z0-9]+)\]>")
_PLHD_TOOL_OPEN_PREFIX = "<[PLHD20_never_used_"
_FUNCTION_CALL_END = "<|FunctionCallEnd|>"


def _tool_call_from_payload(
    payload: Any,
    *,
    id_prefix: str,
) -> list[dict[str, Any]]:
    items = [payload] if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []

    tool_calls: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        arguments = item.get("parameters", item.get("arguments", {}))
        if not name or not isinstance(arguments, dict):
            continue
        tool_calls.append(
            {
                "id": f"{id_prefix}_{index}",
                "name": name,
                "input": arguments,
            }
        )
    return tool_calls


def _consume_inline_tool_blocks(
    buf: str,
    *,
    final: bool = False,
) -> tuple[str, str, list[dict[str, Any]]]:
    """Extract provider-specific inline tool calls without leaking them."""
    marker_index = buf.find(_FUNCTION_CALL_END)
    if marker_index != -1:
        raw_payload = buf[:marker_index].strip()
        try:
            parsed_payload = json.loads(raw_payload)
        except (json.JSONDecodeError, TypeError):
            log.warning("discarding malformed FunctionCallEnd tool-call payload")
            parsed_payload = None

        calls = _tool_call_from_payload(
            parsed_payload,
            id_prefix=f"function_call_{abs(hash(raw_payload))}",
        )
        trailing = buf[marker_index + len(_FUNCTION_CALL_END):]
        trailing_visible, trailing_leftover, trailing_calls = _consume_inline_tool_blocks(
            trailing,
            final=final,
        )
        return trailing_visible, trailing_leftover, calls + trailing_calls

    stripped = buf.lstrip()
    if not final and stripped.startswith(("{", "[")):
        return "", buf, []

    return _consume_plhd_tool_blocks(buf, final=final)


def _consume_plhd_tool_blocks(
    buf: str,
    *,
    final: bool = False,
) -> tuple[str, str, list[dict[str, Any]]]:
    """Extract Ark/Doubao inline PLHD tool calls from streamed text.

    Some Ark-compatible models emit a JSON tool-call list between paired
    ``PLHD20`` / ``PLHD21`` markers in ``delta.content`` instead of using
    OpenAI's standard ``delta.tool_calls`` field. Internal protocol text must
    never be shown to the user.
    """
    visible_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    cursor = 0

    while cursor < len(buf):
        match = _PLHD_TOOL_OPEN_RE.search(buf, cursor)
        if match is None:
            remainder = buf[cursor:]
            if final:
                visible_parts.append(remainder)
                return "".join(visible_parts), "", tool_calls

            incomplete_open_index = remainder.find(_PLHD_TOOL_OPEN_PREFIX)
            if incomplete_open_index != -1:
                visible_parts.append(remainder[:incomplete_open_index])
                return (
                    "".join(visible_parts),
                    remainder[incomplete_open_index:],
                    tool_calls,
                )

            max_prefix = min(len(remainder), len(_PLHD_TOOL_OPEN_PREFIX) - 1)
            for prefix_len in range(max_prefix, 0, -1):
                if _PLHD_TOOL_OPEN_PREFIX.startswith(remainder[-prefix_len:]):
                    visible_parts.append(remainder[:-prefix_len])
                    return (
                        "".join(visible_parts),
                        remainder[-prefix_len:],
                        tool_calls,
                    )
            visible_parts.append(remainder)
            return "".join(visible_parts), "", tool_calls

        visible_parts.append(buf[cursor:match.start()])
        marker_id = match.group(1)
        close_marker = f"<[PLHD21_never_used_{marker_id}]>"
        close_index = buf.find(close_marker, match.end())
        if close_index == -1:
            if final:
                # A provider protocol fragment is internal even when malformed.
                log.warning("discarding incomplete PLHD tool-call block")
                return "".join(visible_parts), "", tool_calls
            return "".join(visible_parts), buf[match.start():], tool_calls

        raw_payload = buf[match.end():close_index]
        try:
            parsed_payload = json.loads(raw_payload)
        except (json.JSONDecodeError, TypeError):
            log.warning("discarding malformed PLHD tool-call payload")
            parsed_payload = []

        tool_calls.extend(
            _tool_call_from_payload(
                parsed_payload,
                id_prefix=f"plhd_{marker_id}",
            )
        )

        cursor = close_index + len(close_marker)

    return "".join(visible_parts), "", tool_calls


def _strip_think_blocks(buf: str) -> tuple[str, str]:
    """Strip complete ``<think>…</think>`` blocks and return ``(visible_text, leftover)``.

    Complete pairs are removed via regex.  An unclosed ``<think>`` is held in
    *leftover* so it can be re-evaluated once the closing tag arrives in the
    next streaming chunk.
    """
    # Remove fully-closed blocks.
    cleaned = _THINK_RE.sub("", buf)

    # Hold back any unclosed <think> for the next chunk.
    open_idx = cleaned.find(_THINK_OPEN_TAG)
    if open_idx != -1:
        return cleaned[:open_idx], cleaned[open_idx:]

    # Streaming providers may split the opening tag itself across chunk
    # boundaries (e.g. ``"<thi"`` then ``"nk>..."``). Hold back the longest
    # suffix that could still become ``<think>`` on the next chunk.
    max_prefix = min(len(cleaned), len(_THINK_OPEN_TAG) - 1)
    for prefix_len in range(max_prefix, 0, -1):
        if _THINK_OPEN_TAG.startswith(cleaned[-prefix_len:]):
            return cleaned[:-prefix_len], cleaned[-prefix_len:]

    return cleaned, ""
