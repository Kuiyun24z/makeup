from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


WEB_DEMO = Path(__file__).resolve().parents[1]
if str(WEB_DEMO) not in sys.path:
    sys.path.insert(0, str(WEB_DEMO))

import server  # noqa: E402


def face_state() -> dict:
    return {
        "faceDetected": True,
        "lighting": "normal",
        "clarity": "normal",
        "framing": "centered",
        "stable": True,
        "imageData": "data:image/jpeg;base64,secret",
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


def start_http(handler_cls):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def post_json(url: str, payload: dict) -> dict:
    raw = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def post_ndjson(url: str, payload: dict) -> list[dict]:
    raw = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8")
    return [json.loads(line) for line in body.splitlines() if line.strip()]


class AgentStreamTest(unittest.TestCase):
    def test_agent_route_endpoint_preserves_simple_path(self):
        app = start_http(server.DemoHandler)
        try:
            body = post_json(
                f"http://127.0.0.1:{app.server_port}/api/agent/route",
                {"question": "我现在适合什么日常妆？"},
            )
        finally:
            app.shutdown()
            app.server_close()

        self.assertTrue(body["ok"])
        self.assertEqual("advice", body["route"]["mode"])

    def test_agent_stream_emits_tool_sequence_and_action_without_images(self):
        app = start_http(server.DemoHandler)
        try:
            events = post_ndjson(
                f"http://127.0.0.1:{app.server_port}/api/agent/stream",
                {
                    "question": "下周参加婚礼，帮我挑一支显气色的口红，先让我看看效果",
                    "analysis": face_state(),
                },
            )
        finally:
            app.shutdown()
            app.server_close()

        tool_names = [event["name"] for event in events if event["type"] == "tool"]
        actions = [event for event in events if event["type"] == "action"]
        face_tool = next(event for event in events if event.get("name") == "get_face_state")

        self.assertEqual(["get_face_state", "recommend_makeup", "search_cosmetics"], tool_names)
        self.assertEqual(1, len(actions))
        self.assertEqual("apply_makeup", actions[0]["action"])
        self.assertNotIn("imageData", face_tool["result"])
        self.assertEqual("done", events[-1]["type"])


if __name__ == "__main__":
    unittest.main()
