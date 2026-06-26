from __future__ import annotations

import json
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

mimetypes.add_type("text/javascript; charset=utf-8", ".mjs")
mimetypes.add_type("text/javascript; charset=utf-8", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("image/bmp", ".bmp")

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = Path(__file__).resolve().parent
BIN_DIR = ROOT / "build" / "windows-nmake" / "out" / "bin"
FRAME_PATH = BIN_DIR / "mediapipe_bridge_frame.bmp"
FRAME_META_PATH = BIN_DIR / "mediapipe_bridge_frame_meta.json"
LANDMARKS_PATH = BIN_DIR / "mediapipe_live_landmarks.txt"
MP468_PATH = BIN_DIR / "mediapipe_live_468.txt"
META_PATH = BIN_DIR / "mediapipe_live_meta.json"


def find_mediapipe_root() -> Path:
    candidates = [
        ROOT / "web_demo_mp468_video" / "vendor" / "mediapipe",
        ROOT / "web_demo_mp468" / "vendor" / "mediapipe",
        ROOT / "web_demo" / "vendor" / "mediapipe",
    ]
    desktop = Path.home() / "Desktop"
    if desktop.exists():
        for child in desktop.iterdir():
            candidates.append(child / "web_demo" / "vendor" / "mediapipe")

    for candidate in candidates:
        if (candidate / "models" / "face_landmarker.task").exists():
            return candidate
    return candidates[0]


MEDIAPIPE_ROOT = find_mediapipe_root()


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def now_ms() -> float:
    return time.time() * 1000.0


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/":
            self.send_file(WEB_ROOT / "index.html")
            return
        if path == "/bridge.js":
            self.send_file(WEB_ROOT / "bridge.js")
            return
        if path == "/frame.bmp":
            self.send_file(FRAME_PATH)
            return
        if path == "/api/frame-info":
            if FRAME_PATH.exists():
                stat = FRAME_PATH.stat()
                meta = read_json(FRAME_META_PATH)
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "seq": str(stat.st_mtime_ns),
                        "serverNowMs": now_ms(),
                        "frameMtimeMs": stat.st_mtime_ns / 1_000_000.0,
                        "frameMeta": meta,
                    },
                )
            else:
                self.send_json(200, {"ok": True, "seq": "", "serverNowMs": now_ms()})
            return
        if path.startswith("/vendor/mediapipe/"):
            rel = path[len("/vendor/mediapipe/") :]
            self.send_file(MEDIAPIPE_ROOT / rel)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/api/landmarks":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        server_receive_ms = now_ms()
        landmarks_text = str(payload.get("landmarksText", "")).strip()
        mediapipe_text = str(payload.get("mediapipeLandmarksText", "")).strip()
        if landmarks_text:
            write_atomic(LANDMARKS_PATH, landmarks_text)
        if mediapipe_text:
            write_atomic(MP468_PATH, mediapipe_text)
        server_write_ms = now_ms()
        diagnostics = dict(payload.get("diagnostics", {}) or {})
        diagnostics.update(
            {
                "serverReceiveMs": server_receive_ms,
                "serverWriteMs": server_write_ms,
                "serverWriteCostMs": server_write_ms - server_receive_ms,
            }
        )
        write_atomic(META_PATH, json.dumps(diagnostics, ensure_ascii=True))
        self.send_json(200, {"ok": True})


def main() -> int:
    port = int(os.environ.get("GPUPIXEL_MEDIAPIPE_BRIDGE_PORT", "8790"))
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Serving MediaPipe bridge at http://127.0.0.1:{port}")
    print(f"MediaPipe root: {MEDIAPIPE_ROOT}")
    print(f"Frame input: {FRAME_PATH}")
    print(f"Landmarks output: {LANDMARKS_PATH}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
