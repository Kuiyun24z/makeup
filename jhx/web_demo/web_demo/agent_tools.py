"""Local agent routing and mock tool loop for Stage 7A."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable

import rules


ROOT = Path(__file__).resolve().parent
CATALOG_PATH = ROOT / "cosmetics.json"

IMAGE_KEY_RE = re.compile(r"(image|frame|base64|dataurl|data_url|canvas|snapshot)", re.I)

EXPLICIT_AGENT_MARKERS = (
    "帮我参谋",
    "深度咨询",
    "顾问模式",
    "agent",
)

COMPLEX_MARKERS = (
    "预算",
    "对比",
    "比较",
    "哪个",
    "哪一个",
    "挑",
    "选择",
    "整套",
    "全套",
    "搭配",
    "婚礼",
    "约会",
    "面试",
    "通勤",
    "解释",
    "为什么",
    "方案",
    "先试",
    "换个",
    "显气色",
)

CATEGORY_WORDS = {
    "lip": ("口红", "唇", "唇妆", "唇釉"),
    "blush": ("腮红", "修容"),
    "brow": ("眉", "眉毛", "眉色"),
    "eyeshadow": ("眼影", "眼妆"),
}

QUERY_HINTS = (
    ("枫叶", "枫叶"),
    ("豆沙", "豆沙"),
    ("奶茶", "奶茶"),
    ("蜜桃", "蜜桃"),
    ("珊瑚", "珊瑚"),
    ("砖红", "砖红"),
    ("玫瑰", "玫瑰"),
    ("浆果", "浆果"),
    ("正红", "正红"),
    ("大地", "大地"),
    ("自然黑", "自然黑"),
    ("深棕", "深棕"),
)


def route_request(question: str, *, force_agent: bool = False) -> dict[str, Any]:
    """Decide whether a user question should use the agent path."""

    text = _normalize_text(question)
    if force_agent:
        return {"mode": "agent", "reason": "forced", "matched": ["force_agent"]}
    if not text:
        return {"mode": "advice", "reason": "empty", "matched": []}

    explicit = [marker for marker in EXPLICIT_AGENT_MARKERS if marker.lower() in text]
    if explicit:
        return {"mode": "agent", "reason": "explicit", "matched": explicit}

    matched = [marker for marker in COMPLEX_MARKERS if marker.lower() in text]
    if matched:
        return {"mode": "agent", "reason": "complex_marker", "matched": matched}

    if len(text) >= 34 and any(token in text for token in ("，", ",", "。", "；", ";", "并", "然后")):
        return {"mode": "agent", "reason": "long_multistep", "matched": ["long_multistep"]}

    return {"mode": "advice", "reason": "simple", "matched": []}


def get_face_state(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return sanitized structured face analysis from the request payload."""

    source = payload.get("analysis", {}) if isinstance(payload, dict) else {}
    if not isinstance(source, dict):
        return {}
    return sanitize_for_agent(source)


def sanitize_for_agent(value: Any) -> Any:
    """Remove image-like fields before any agent/model processing."""

    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if IMAGE_KEY_RE.search(str(key)):
                continue
            cleaned[str(key)] = sanitize_for_agent(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize_for_agent(item) for item in value]
    if isinstance(value, str) and value[:40].lower().startswith(("data:image/", "data:application/")):
        return "[removed-local-media]"
    return value


def recommend_makeup(face_state: dict[str, Any]) -> dict[str, Any]:
    return rules.generate_draft(face_state if isinstance(face_state, dict) else {})


def load_cosmetics_catalog() -> list[dict[str, Any]]:
    with CATALOG_PATH.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    return [item for item in catalog if isinstance(item, dict)]


def search_cosmetics(
    query: str | None = None,
    *,
    category: str | None = None,
    finish: str | None = None,
    limit: int = 5,
    catalog: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Small deterministic catalog search used by the Stage 7A mock agent."""

    items = catalog if catalog is not None else load_cosmetics_catalog()
    needle = _normalize_text(query)
    category = _normalize_text(category) or None
    finish = _normalize_text(finish) or None
    scored: list[tuple[int, int, dict[str, Any]]] = []

    for index, item in enumerate(items):
        if category and _normalize_text(item.get("category")) != category:
            continue
        if finish and _normalize_text(item.get("finish")) != finish:
            continue

        haystack_parts = [
            item.get("id"),
            item.get("name"),
            item.get("category"),
            item.get("finish"),
            *(item.get("aliases") or []),
        ]
        haystack = " ".join(_normalize_text(part) for part in haystack_parts if part)
        score = 1 if not needle else 0
        if needle:
            if _normalize_text(item.get("id")) == needle or _normalize_text(item.get("name")) == needle:
                score += 80
            if needle in haystack:
                score += 40
            score += sum(12 for token in needle.split() if token and token in haystack)
        if category:
            score += 8
        if finish:
            score += 4
        if score:
            scored.append((score, -index, deepcopy(item)))

    scored.sort(reverse=True)
    return [item for _, _, item in scored[: max(1, limit)]]


def apply_makeup(item_id: str, intensity: float | None = None, catalog: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    items = catalog if catalog is not None else load_cosmetics_catalog()
    item = next((entry for entry in items if entry.get("id") == item_id), None)
    event: dict[str, Any] = {
        "type": "action",
        "action": "apply_makeup",
        "itemId": item_id,
        "intensity": _clamp_intensity(intensity),
    }
    if item:
        event["item"] = deepcopy(item)
        event["message"] = f"Applied {item.get('name') or item_id}."
    else:
        event["message"] = f"Item {item_id} was not found."
    return event


def adjust_makeup(target: str, delta: int) -> dict[str, Any]:
    return {
        "type": "action",
        "action": "adjust_makeup",
        "target": target,
        "delta": int(delta),
        "message": f"Adjusted {target} by {int(delta)}.",
    }


def clear_makeup() -> dict[str, Any]:
    return {"type": "action", "action": "clear_makeup", "message": "Cleared current makeup."}


def mock_agent_events(payload: dict[str, Any] | None) -> Iterable[dict[str, Any]]:
    """Deterministic offline agent loop: face_state -> recommend -> search -> apply."""

    safe_payload = payload if isinstance(payload, dict) else {}
    question = str(safe_payload.get("question") or "")
    route = route_request(
        question,
        force_agent=bool(safe_payload.get("agent") or safe_payload.get("mode") == "agent"),
    )

    yield {"type": "status", "stage": "route", "route": route, "message": "Agent route selected."}

    face_state = get_face_state(safe_payload)
    yield {"type": "status", "stage": "face_state", "message": "Reading current face state."}
    yield {"type": "tool", "name": "get_face_state", "result": face_state}

    draft = recommend_makeup(face_state)
    yield {"type": "status", "stage": "recommend", "message": "Generating rule draft."}
    yield {"type": "tool", "name": "recommend_makeup", "result": draft}

    catalog = load_cosmetics_catalog()
    search_plan = _search_plan(question, draft)
    candidates = search_cosmetics(
        search_plan.get("query"),
        category=search_plan.get("category"),
        finish=search_plan.get("finish"),
        limit=5,
        catalog=catalog,
    )
    yield {
        "type": "status",
        "stage": "search",
        "message": "Searching local cosmetics catalog.",
    }
    yield {"type": "tool", "name": "search_cosmetics", "arguments": search_plan, "result": candidates}

    if candidates:
        picked = _pick_candidate(question, candidates)
        intensity = float(picked.get("defaultIntensity") or 0.58)
        yield apply_makeup(str(picked["id"]), intensity=intensity, catalog=catalog)
        yield {
            "type": "delta",
            "text": _agent_summary(question, draft, picked),
        }
        yield {
            "type": "done",
            "advice": _agent_done_text(picked),
            "model": "stage7a-mock-agent",
            "route": route,
        }
        return

    yield {
        "type": "delta",
        "text": "I could read the face state and generate a draft, but no catalog item matched this request.",
    }
    yield {"type": "done", "advice": "No matching catalog item found.", "model": "stage7a-mock-agent", "route": route}


def _search_plan(question: str, draft: dict[str, Any]) -> dict[str, str]:
    text = _normalize_text(question)
    category = _detect_category(text)
    query = _detect_query_hint(text)

    if not category:
        category = "lip"
    if not query and "婚礼" in text:
        query = "枫叶"
    if not query and ("通勤" in text or "日常" in text):
        query = "豆沙"
    if not query:
        query = _first_draft_family(draft) or ""

    return {"query": query, "category": category}


def _detect_category(text: str) -> str | None:
    for category, words in CATEGORY_WORDS.items():
        if any(word in text for word in words):
            return category
    return None


def _detect_query_hint(text: str) -> str:
    for marker, query in QUERY_HINTS:
        if marker in text:
            return query
    return ""


def _first_draft_family(draft: dict[str, Any]) -> str:
    for section in ("lips", "base"):
        values = ((draft.get(section) or {}).get("recommendFamilies") or []) if isinstance(draft, dict) else []
        if values:
            return str(values[0])
    return ""


def _pick_candidate(question: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    text = _normalize_text(question)
    if "浅" in text or "淡" in text:
        return min(candidates, key=lambda item: float(item.get("defaultIntensity") or 0.55))
    if "深" in text or "浓" in text:
        return max(candidates, key=lambda item: float(item.get("defaultIntensity") or 0.55))
    return candidates[0]


def _agent_summary(question: str, draft: dict[str, Any], item: dict[str, Any]) -> str:
    name = str(item.get("name") or item.get("id") or "this item")
    category = str(item.get("category") or "makeup")
    focus = draft.get("focus") if isinstance(draft, dict) else None
    focus_text = " ".join(str(part) for part in focus[:2]) if isinstance(focus, list) else ""
    if "婚礼" in question:
        return f"我先为你试上{name}。婚礼场景需要镜头里有气色但不过分抢妆，{name}会比裸色更稳，当前可以从默认强度开始。"
    return f"我先为你试上{name}（{category}）。{focus_text}".strip()


def _agent_done_text(item: dict[str, Any]) -> str:
    name = str(item.get("name") or item.get("id") or "selected item")
    return f"已完成一次本地 mock agent 工具链，并把{name}发送给前端试妆。"


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _clamp_intensity(value: float | None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.55
    return max(0.0, min(1.0, round(number, 3)))
