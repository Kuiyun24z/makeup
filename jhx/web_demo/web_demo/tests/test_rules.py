from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


WEB_DEMO = Path(__file__).resolve().parents[1]
if str(WEB_DEMO) not in sys.path:
    sys.path.insert(0, str(WEB_DEMO))

import rules  # noqa: E402


def face_state(
    *,
    undertone: str = "warm",
    skin_depth: str = "偏浅",
    lip_depth: str = "中等",
    lip_family: str = "自然唇色",
    color_confidence: str = "normal",
    face_label: str = "均衡脸型",
    eye_spacing: str = "眼距均衡",
    brow_eye: str = "眉眼距离适中",
    lip_label: str = "唇部比例自然",
    **overrides,
) -> dict:
    state = {
        "faceDetected": True,
        "lighting": "normal",
        "clarity": "normal",
        "framing": "centered",
        "stable": True,
        "pose": {"ok": True, "label": "正脸", "yaw": 0, "rollDeg": 0, "pitchRatio": 0.44},
        "featureSummary": {
            "gated": False,
            "colors": {
                "confidence": color_confidence,
                "skin": {
                    "undertone": undertone,
                    "depth": skin_depth,
                    "warmth": 0.45,
                    "luma": 170,
                    "hex": "#d6aa8d",
                },
                "lip": {
                    "family": lip_family,
                    "depth": lip_depth,
                    "hue": 8,
                    "saturation": 0.44,
                    "value": 0.6,
                    "hex": "#aa6670",
                },
            },
            "face": {"label": face_label},
            "eyes": {
                "label": f"{eye_spacing}，眼部轮廓较清晰",
                "spacing": eye_spacing,
                "browEyeSpace": brow_eye,
            },
            "lips": {"label": lip_label},
        },
    }
    state.update(overrides)
    return state


class RulesTest(unittest.TestCase):
    def test_warm_light_recommends_warm_families(self):
        draft = rules.generate_draft(face_state(undertone="warm", skin_depth="偏浅"))

        self.assertTrue(draft["quality"]["ok"])
        self.assertIn("珊瑚", draft["base"]["recommendFamilies"])
        self.assertIn("豆沙", draft["base"]["recommendFamilies"])
        self.assertIn("冷紫调粉", draft["base"]["avoidFamilies"])
        self.assertNotIn("蓝调玫红", draft["base"]["recommendFamilies"])

    def test_cool_deep_recommends_cool_families(self):
        draft = rules.generate_draft(face_state(undertone="cool", skin_depth="偏深"))

        self.assertIn("浆果", draft["base"]["recommendFamilies"])
        self.assertIn("酒红", draft["base"]["recommendFamilies"])
        self.assertIn("橘调", draft["base"]["avoidFamilies"])
        self.assertNotIn("珊瑚", draft["base"]["recommendFamilies"])

    def test_neutral_recommends_mlbb(self):
        draft = rules.generate_draft(face_state(undertone="neutral"))

        self.assertIn("豆沙", draft["base"]["recommendFamilies"])
        self.assertIn("MLBB", draft["base"]["recommendFamilies"])
        self.assertTrue(draft["base"]["avoidFamilies"])

    def test_pose_gated_blocks_conclusions(self):
        state = face_state()
        state["featureSummary"]["gated"] = True
        draft = rules.generate_draft(state)

        self.assertFalse(draft["quality"]["ok"])
        self.assertIn("pose_gated", draft["quality"]["issues"])
        self.assertIsNone(draft["base"])
        self.assertIsNone(draft["lips"])
        self.assertIsNone(draft["eyesBrows"])
        self.assertIsNone(draft["contour"])

    def test_dark_lighting_nulls_color_advice_but_keeps_geometry(self):
        draft = rules.generate_draft(face_state(lighting="dark", eye_spacing="眼距偏开"))

        self.assertTrue(draft["quality"]["ok"])
        self.assertIn("lighting_dark", draft["quality"]["issues"])
        self.assertIsNone(draft["base"])
        self.assertIsNone(draft["lips"])
        self.assertIsNotNone(draft["eyesBrows"])
        self.assertIn("内眼角提亮", draft["eyesBrows"]["techniques"])

    def test_no_face_returns_retake_hint_only(self):
        draft = rules.generate_draft(face_state(faceDetected=False))

        self.assertFalse(draft["quality"]["ok"])
        self.assertIn("no_face", draft["quality"]["issues"])
        self.assertIsNotNone(draft["quality"]["retakeHint"])
        self.assertIsNone(draft["base"])
        self.assertEqual(draft["focus"], [])

    def test_deep_lip_uses_high_saturation_and_prep(self):
        draft = rules.generate_draft(face_state(lip_depth="偏深"))

        self.assertEqual("high", draft["lips"]["saturation"])
        self.assertIsNotNone(draft["lips"]["prep"])

    def test_low_color_confidence_adds_notes(self):
        draft = rules.generate_draft(face_state(color_confidence="low"))

        self.assertEqual("low", draft["confidence"]["colors"])
        self.assertIsNotNone(draft["base"]["note"])
        self.assertIsNotNone(draft["lips"]["prep"])

    def test_missing_fields_do_not_raise(self):
        draft = rules.generate_draft({})

        self.assertEqual(1, draft["schemaVersion"])
        self.assertFalse(draft["quality"]["ok"])
        self.assertIn("no_face", draft["quality"]["issues"])

    def test_deterministic_output(self):
        state = face_state(face_label="偏长椭圆", eye_spacing="眼距偏近", lip_label="唇部线条偏薄")

        first = rules.generate_draft(copy.deepcopy(state))
        second = rules.generate_draft(copy.deepcopy(state))

        self.assertEqual(first, second)

    def test_cool_skin_orange_lip_keeps_cool_whitelist(self):
        draft = rules.generate_draft(
            face_state(undertone="cool", skin_depth="偏深", lip_family="橘调")
        )

        recs = draft["lips"]["recommendFamilies"]
        self.assertFalse(any("橘" in item or "珊瑚" in item for item in recs))
        self.assertIsNotNone(draft["lips"]["prep"])

    def test_warm_skin_berry_lip_keeps_warm_whitelist(self):
        draft = rules.generate_draft(face_state(undertone="warm", lip_family="浆果调"))

        self.assertNotIn("浆果", draft["lips"]["recommendFamilies"])



if __name__ == "__main__":
    unittest.main()
