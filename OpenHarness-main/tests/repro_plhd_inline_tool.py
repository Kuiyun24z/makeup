import asyncio
from types import SimpleNamespace

from openharness.api.client import (
    ApiMessageCompleteEvent,
    ApiMessageRequest,
    ApiTextDeltaEvent,
)
from openharness.api.openai_client import OpenAICompatibleClient
from openharness.engine.messages import ConversationMessage


async def verify_inline_tool(raw, expected_name, expected_input):
    class InlineToolCompletions:
        async def create(self, **_kwargs):
            async def stream():
                for piece in [raw[:9], raw[9:41], raw[41:79], raw[79:]]:
                    yield SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                delta=SimpleNamespace(
                                    content=piece,
                                    reasoning_content=None,
                                    tool_calls=None,
                                ),
                                finish_reason=None,
                            )
                        ],
                        usage=None,
                    )
                yield SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            delta=SimpleNamespace(
                                content=None,
                                reasoning_content=None,
                                tool_calls=None,
                            ),
                            finish_reason="stop",
                        )
                    ],
                    usage=None,
                )

            return stream()

    client = OpenAICompatibleClient(api_key="test-key")
    client._client = SimpleNamespace(
        chat=SimpleNamespace(completions=InlineToolCompletions())
    )
    request = ApiMessageRequest(
        model="doubao-seed-1-6-vision-250815",
        messages=[ConversationMessage.from_user_text("看看我的脸型")],
        tools=[
            {
                "name": "inspect_current_beauty_frame",
                "description": "Inspect current frame",
                "input_schema": {"type": "object"},
            }
        ],
    )

    events = [event async for event in client.stream_message(request)]
    text_events = [event for event in events if isinstance(event, ApiTextDeltaEvent)]
    complete = next(
        event for event in events if isinstance(event, ApiMessageCompleteEvent)
    )
    assert not text_events, f"PLHD leaked as text: {[event.text for event in text_events]}"
    assert complete.stop_reason == "tool_use", complete.stop_reason
    assert len(complete.message.tool_uses) == 1, complete.message
    tool = complete.message.tool_uses[0]
    assert tool.name == expected_name, tool
    assert tool.input == expected_input, tool.input


async def main():
    marker = "51bce0c785ca2f68081bfa7d91973934"
    await verify_inline_tool(
        (
            f"<[PLHD20_never_used_{marker}]>"
            '[{"name":"inspect_current_beauty_frame",'
            '"parameters":{"request_id":"vision-1"}}]'
            f"<[PLHD21_never_used_{marker}]>"
        ),
        "inspect_current_beauty_frame",
        {"request_id": "vision-1"},
    )
    await verify_inline_tool(
        '{"name":"skill","parameters":{"name":"face-to-face-beauty"}}'
        "<|FunctionCallEnd|>",
        "skill",
        {"name": "face-to-face-beauty"},
    )


if __name__ == "__main__":
    asyncio.run(main())
