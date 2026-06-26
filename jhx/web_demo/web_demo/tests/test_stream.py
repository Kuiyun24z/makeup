from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
        "featureSummary": {
            "gated": False,
            "colors": {
                "confidence": "normal",
                "skin": {"undertone": "warm", "depth": "light"},
                "lip": {"family": "natural", "depth": "medium"},
            },
            "face": {"label": "balanced"},
            "eyes": {
                "spacing": "balanced",
                "browEyeSpace": "balanced",
            },
            "lips": {"label": "balanced"},
        },
    }


def start_http(handler_cls):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


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


class MockOllamaHandler(BaseHTTPRequestHandler):
    chunks = ["base ", "lip ", "done"]

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/api/generate":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        if body.get("stream") is not True:
            self.send_error(400)
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        for chunk in self.chunks:
            event = {"model": "mock-model", "response": chunk, "done": False}
            self.wfile.write(server.ndjson_event_line(event))
            self.wfile.flush()
        self.wfile.write(server.ndjson_event_line({"model": "mock-model", "response": "", "done": True}))
        self.wfile.flush()


class StreamTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_ollama_url = server.OLLAMA_URL
        self.original_ollama_model = server.OLLAMA_MODEL

    def tearDown(self) -> None:
        server.OLLAMA_URL = self.original_ollama_url
        server.OLLAMA_MODEL = self.original_ollama_model

    def test_parse_ollama_line(self):
        self.assertEqual({"response": "hi"}, server.parse_ollama_line(b'{"response":"hi"}\n'))
        self.assertEqual({"done": True}, server.parse_ollama_line(b'{"done":true}'))
        self.assertIsNone(server.parse_ollama_line(b"\n"))
        self.assertIsNone(server.parse_ollama_line(b"not-json"))
        self.assertIsNone(server.parse_ollama_line(b"[1,2,3]"))

    def test_ndjson_event_line_is_single_json_line(self):
        raw = server.ndjson_event_line({"type": "delta", "text": "a\nb"})
        self.assertTrue(raw.endswith(b"\n"))
        self.assertEqual(1, len(raw.splitlines()))
        self.assertEqual({"type": "delta", "text": "a\nb"}, json.loads(raw))

    def test_advice_stream_relays_draft_delta_done(self):
        mock = start_http(MockOllamaHandler)
        app = start_http(server.DemoHandler)
        try:
            server.OLLAMA_URL = f"http://127.0.0.1:{mock.server_port}"
            server.OLLAMA_MODEL = "mock-model"
            events = post_ndjson(
                f"http://127.0.0.1:{app.server_port}/api/advice/stream",
                {"question": "demo", "analysis": face_state()},
            )
        finally:
            app.shutdown()
            mock.shutdown()
            app.server_close()
            mock.server_close()

        self.assertEqual("draft", events[0]["type"])
        self.assertEqual(["delta", "delta", "delta"], [event["type"] for event in events[1:4]])
        self.assertEqual("done", events[-1]["type"])
        self.assertEqual("base lip done", "".join(event["text"] for event in events if event["type"] == "delta"))
        self.assertEqual("base lip done", events[-1]["advice"])
        self.assertEqual(1, events[0]["draft"]["schemaVersion"])

    def test_advice_stream_returns_draft_and_error_when_ollama_unavailable(self):
        app = start_http(server.DemoHandler)
        try:
            server.OLLAMA_URL = "http://127.0.0.1:9"
            events = post_ndjson(
                f"http://127.0.0.1:{app.server_port}/api/advice/stream",
                {"question": "demo", "analysis": face_state()},
            )
        finally:
            app.shutdown()
            app.server_close()

        self.assertEqual("draft", events[0]["type"])
        self.assertEqual("error", events[-1]["type"])
        self.assertTrue(events[-1]["fallback"])


if __name__ == "__main__":
    unittest.main()
