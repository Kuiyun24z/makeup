"""Rule engine for turning FaceState into a structured makeup draft."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


SCHEMA_VERSION = 1

FATAL_ISSUE_HINTS = {
    "no_face": "暂时没有稳定检测到面部。请正对镜头，让脸部完整进入画面后再生成建议。",
    "pose_gated": "当前头部姿态偏转，脸型和眉眼比例暂不判定。请先正对镜头再分析。",
    "too_far": "脸部距离镜头偏远。请稍微靠近一点，让面部占画面更多区域。",
    "too_close": "脸部距离镜头偏近。请稍微后退一点，让五官和脸部轮廓完整入镜。",
    "blurry": "当前画面清晰度偏低。请保持稳定并让镜头完成对焦后再分析。",
}

LIGHTING_HINTS = {
    "lighting_dark": "当前光线偏暗，色彩判断不稳定。建议补一点正面柔光后再看底妆和唇色。",
    "lighting_bright": "当前画面偏亮，色彩可能被过曝影响。建议避开强光后再看底妆和唇色。",
}

BASE_RULES = {
    "warm_light": {
        "tone": "偏黄暖调底妆",
        "recommend": ["珊瑚", "蜜桃", "砖红", "豆沙", "暖橘"],
        "avoid": ["冷紫调粉", "蓝调玫红"],
    },
    "warm_deep": {
        "tone": "暖调加深一阶底妆",
        "recommend": ["砖红", "陶土", "深豆沙"],
        "avoid": ["浅粉荧光", "香芋紫"],
    },
    "cool_light": {
        "tone": "偏粉冷调底妆",
        "recommend": ["蓝粉", "玫红", "浆果", "蓝调正红"],
        "avoid": ["橘调", "暖棕"],
    },
    "cool_deep": {
        "tone": "冷调加深一阶底妆",
        "recommend": ["浆果", "酒红", "冷玫瑰"],
        "avoid": ["橘调", "橘红", "珊瑚"],
    },
    "neutral": {
        "tone": "中性自然调底妆",
        "recommend": ["豆沙", "玫瑰豆沙", "MLBB", "奶茶"],
        "avoid": ["极端冷暖色需谨慎"],
    },
}


def generate_draft(face_state: dict[str, Any] | None) -> dict[str, Any]:
    """Generate a deterministic makeup draft from a FaceState-like payload."""

    state = face_state if isinstance(face_state, dict) else {}
    issues = _quality_issues(state)
    fatal = [issue for issue in issues if issue in FATAL_ISSUE_HINTS]

    if fatal:
        return _draft(
            quality_ok=False,
            issues=issues,
            retake_hint=FATAL_ISSUE_HINTS[fatal[0]],
            confidence={"colors": "low", "geometry": "low"},
        )

    feature = _dict(state.get("featureSummary"))
    colors = _dict(feature.get("colors"))
    color_confidence = _color_confidence(colors, issues)
    geometry_confidence = "normal"

    base = _base_rules(colors, issues, color_confidence)
    lips = _lip_rules(colors, base, issues, color_confidence)
    eyes_brows, eye_focus = _eyes_brows_rules(feature)
    contour, contour_focus = _contour_rules(feature)

    focus = _dedupe([*contour_focus, *eye_focus, *_lip_focus(feature, lips)])
    if not focus:
        focus = ["自然均衡妆"]

    return _draft(
        quality_ok=True,
        issues=issues,
        retake_hint=None,
        confidence={"colors": color_confidence, "geometry": geometry_confidence},
        base=base,
        lips=lips,
        eyes_brows=eyes_brows,
        contour=contour,
        focus=focus,
    )


def render_draft_text(draft: dict[str, Any]) -> str:
    """Render a draft as simple Chinese fallback text without using an LLM."""

    safe = draft if isinstance(draft, dict) else generate_draft({})
    quality = _dict(safe.get("quality"))
    if not quality.get("ok"):
        return str(quality.get("retakeHint") or "当前画面质量不足，请调整后再生成建议。")

    base = _dict(safe.get("base"))
    lips = _dict(safe.get("lips"))
    eyes = _dict(safe.get("eyesBrows"))
    contour = _dict(safe.get("contour"))
    focus = safe.get("focus") if isinstance(safe.get("focus"), list) else []

    parts = [
        "当前画面可以用于基础美妆建议。",
        f"底妆建议：{base.get('tone', '自然调底妆')}；可优先看{_join(base.get('recommendFamilies'))}。",
        f"唇妆建议：可选{_join(lips.get('recommendFamilies'))}，饱和度从{lips.get('saturation', 'medium')}开始。",
        f"眉眼建议：{eyes.get('browHint', '保持自然眉峰')}，技巧重点是{_join(eyes.get('techniques'))}。",
        f"修容腮红：{contour.get('blushPlacement', '自然扫腮红')}；{contour.get('contourHint', '轻修容即可')}。",
    ]
    if focus:
        parts.append(f"下一步重点：{_join(focus)}。")
    if base.get("note"):
        parts.append(str(base["note"]))
    if lips.get("prep"):
        parts.append(str(lips["prep"]))
    return "\n".join(parts)


def _draft(
    *,
    quality_ok: bool,
    issues: list[str],
    retake_hint: str | None,
    confidence: dict[str, str],
    base: dict[str, Any] | None = None,
    lips: dict[str, Any] | None = None,
    eyes_brows: dict[str, Any] | None = None,
    contour: dict[str, Any] | None = None,
    focus: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "quality": {
            "ok": quality_ok,
            "issues": list(issues),
            "retakeHint": retake_hint,
        },
        "confidence": deepcopy(confidence),
        "base": deepcopy(base) if quality_ok else None,
        "lips": deepcopy(lips) if quality_ok else None,
        "eyesBrows": deepcopy(eyes_brows) if quality_ok else None,
        "contour": deepcopy(contour) if quality_ok else None,
        "focus": list(focus or []) if quality_ok else [],
        "safetyNotes": [],
    }


def _quality_issues(state: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if not state.get("faceDetected"):
        issues.append("no_face")

    feature = _dict(state.get("featureSummary"))
    if feature.get("gated") is True:
        issues.append("pose_gated")

    lighting = state.get("lighting")
    if lighting == "dark":
        issues.append("lighting_dark")
    elif lighting == "bright":
        issues.append("lighting_bright")

    framing = state.get("framing")
    if framing == "too_far":
        issues.append("too_far")
    elif framing == "too_close":
        issues.append("too_close")

    if state.get("clarity") == "soft":
        issues.append("blurry")

    return _dedupe(issues)


def _color_confidence(colors: dict[str, Any], issues: list[str]) -> str:
    if not colors:
        return "low"
    if colors.get("confidence") == "low":
        return "low"
    if "lighting_dark" in issues or "lighting_bright" in issues:
        return "low"
    return "normal"


def _base_rules(colors: dict[str, Any], issues: list[str], confidence: str) -> dict[str, Any] | None:
    if "lighting_dark" in issues or "lighting_bright" in issues:
        return None

    skin = _dict(colors.get("skin"))
    undertone = str(skin.get("undertone") or "neutral")
    depth = str(skin.get("depth") or "")

    if undertone == "warm":
        key = "warm_deep" if _is_deep(depth) else "warm_light"
    elif undertone == "cool":
        key = "cool_deep" if _is_deep(depth) else "cool_light"
    else:
        key = "neutral"

    rule = BASE_RULES[key]
    note = None
    if confidence == "low":
        note = "当前色彩置信度偏低，底妆和色系建议仅供参考，建议在自然光下重新确认。"

    return {
        "undertone": undertone,
        "tone": rule["tone"],
        "recommendFamilies": list(rule["recommend"]),
        "avoidFamilies": list(rule["avoid"]),
        "note": note,
    }


def _lip_rules(
    colors: dict[str, Any],
    base: dict[str, Any] | None,
    issues: list[str],
    confidence: str,
) -> dict[str, Any] | None:
    if "lighting_dark" in issues or "lighting_bright" in issues:
        return None

    lip = _dict(colors.get("lip"))
    base_recs = list(_dict(base).get("recommendFamilies") or ["豆沙", "奶茶"])
    depth = str(lip.get("depth") or "")
    family = str(lip.get("family") or "")

    saturation = "medium"
    prep = None
    recommend = base_recs[:2] if base_recs else ["豆沙", "奶茶"]

    if "偏深" in depth:
        saturation = "high"
        prep = "唇色较深，浅色系需要先做唇部打底，顺色深色系会更稳。"
    elif "偏浅" in depth:
        saturation = "medium"

    undertone = _dict(base).get("undertone")
    if "浆果" in family and "浆果" not in recommend and undertone != "warm":
        recommend.append("浆果")
    if (
        "橘" in family
        and undertone != "cool"
        and not any("橘" in item or "珊瑚" in item for item in recommend)
    ):
        recommend.append("暖橘")

    if undertone == "cool" and ("橘" in family or "珊瑚" in family):
        prep = "当前唇色偏暖，冷调底妆下建议降低橘调面积，优先按肤色规则选蓝粉或浆果系。"
    if undertone == "warm" and ("蓝" in family or "冷" in family):
        prep = "当前唇色偏冷，暖调底妆下建议避开过强蓝调，优先按肤色规则选珊瑚、蜜桃或豆沙。"

    if confidence == "low":
        low_note = "当前光线或角度会影响唇色判断，建议重测后再定最终色系。"
        prep = f"{prep} {low_note}".strip() if prep else low_note

    return {
        "recommendFamilies": _dedupe(recommend),
        "saturation": saturation,
        "prep": prep,
    }


def _eyes_brows_rules(feature: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    eyes = _dict(feature.get("eyes"))
    spacing = str(eyes.get("spacing") or eyes.get("label") or "")
    brow_space = str(eyes.get("browEyeSpace") or "")
    techniques: list[str] = []

    if "偏开" in spacing:
        techniques.append("内眼角提亮")
    elif "偏近" in spacing:
        techniques.append("眼尾拉长")

    if "偏近" in brow_space:
        techniques.append("浅色眼影减压")
    elif "偏开" in brow_space:
        techniques.append("眉下阴影衔接")

    if not techniques:
        techniques.append("保持眼尾自然延展")

    return {
        "browHint": "保持自然眉峰",
        "techniques": _dedupe(techniques),
    }, techniques


def _contour_rules(feature: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    face = _dict(feature.get("face"))
    lips = _dict(feature.get("lips"))
    face_label = str(face.get("label") or "")
    lip_label = str(lips.get("label") or "")
    focus: list[str] = []

    blush = "自然斜扫腮红"
    contour = "轻修容即可"

    if "偏长" in face_label:
        blush = "横向打腮红"
        contour = "弱化纵向拉长感"
        focus.append("横向腮红")
    elif "偏短" in face_label or "圆润" in face_label:
        blush = "斜向上提腮红"
        contour = "轻修容拉长"
        focus.append("轻修容拉长")
    elif "下颌" in face_label:
        blush = "靠中上位置轻扫"
        contour = "下颌柔化"
        focus.append("下颌柔化")

    if "偏薄" in lip_label or "线条" in lip_label:
        focus.append("唇峰和中部提亮")

    return {
        "blushPlacement": blush,
        "contourHint": contour,
    }, focus


def _lip_focus(feature: dict[str, Any], lips: dict[str, Any] | None) -> list[str]:
    focus = []
    if _dict(lips).get("saturation") == "high":
        focus.append("提高唇妆饱和度")
    lip_label = str(_dict(feature.get("lips")).get("label") or "")
    if "偏薄" in lip_label or "线条" in lip_label:
        focus.append("唇峰和中部提亮")
    return focus


def _is_deep(depth: str) -> bool:
    return any(token in depth for token in ("小麦", "偏深", "深"))


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _join(values: Any) -> str:
    if isinstance(values, list) and values:
        return "、".join(str(item) for item in values)
    return "自然色系"
