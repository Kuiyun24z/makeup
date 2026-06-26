from __future__ import annotations

import sys
import unittest
from pathlib import Path


WEB_DEMO = Path(__file__).resolve().parents[1]
if str(WEB_DEMO) not in sys.path:
    sys.path.insert(0, str(WEB_DEMO))

import agent_tools  # noqa: E402


def face_state() -> dict:
    return {
        "faceDetected": True,
        "lighting": "normal",
        "clarity": "normal",
        "framing": "centered",
        "stable": True,
        "frameImage": "data:image/jpeg;base64,secret",
        "featureSummary": {
            "gated": False,
            "colors": {
                "confidence": "normal",
                "skin": {"undertone": "warm", "depth": "light"},
                "lip": {"family": "natural", "depth": "medium"},
            },
            "face": {"label": "balanced"},
            "eyes": {"spacing": "balanced", "browEyeSpace": "balanced"},
            "lips": {"label": "balanced"},
        },
    }


class AgentToolsTest(unittest.TestCase):
    def test_route_keeps_simple_advice_on_existing_path(self):
        route = agent_tools.route_request("我现在适合什么日常妆？")
        self.assertEqual("advice", route["mode"])

    def test_route_sends_open_ended_request_to_agent(self):
        route = agent_tools.route_request("下周参加婚礼，帮我挑一支显气色的口红，先让我看看效果")
        self.assertEqual("agent", route["mode"])
        self.assertIn("婚礼", route["matched"])

    def test_sanitize_removes_image_like_fields(self):
        cleaned = agent_tools.get_face_state(
            {
                "analysis": {
                    **face_state(),
                    "nested": {"base64Preview": "abc", "ok": True},
                    "snapshots": [{"dataUrl": "data:image/png;base64,abc", "score": 1}],
                }
            }
        )
        self.assertNotIn("frameImage", cleaned)
        self.assertNotIn("base64Preview", cleaned["nested"])
        self.assertNotIn("snapshots", cleaned)
        self.assertTrue(cleaned["nested"]["ok"])

    def test_search_cosmetics_can_find_lip_candidate(self):
        results = agent_tools.search_cosmetics("枫叶", category="lip")
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual("lip-maple", results[0]["id"])

    def test_mock_agent_event_sequence(self):
        events = list(
            agent_tools.mock_agent_events(
                {
                    "question": "下周参加婚礼，帮我挑一支显气色的口红，先让我看看效果",
                    "analysis": face_state(),
                }
            )
        )
        event_types = [event["type"] for event in events]
        tool_names = [event["name"] for event in events if event["type"] == "tool"]

        self.assertIn("status", event_types)
        self.assertEqual(["get_face_state", "recommend_makeup", "search_cosmetics"], tool_names)
        self.assertEqual("action", events[-3]["type"])
        self.assertEqual("apply_makeup", events[-3]["action"])
        self.assertEqual("done", events[-1]["type"])
        self.assertEqual("stage7a-mock-agent", events[-1]["model"])


if __name__ == "__main__":
    unittest.main()
