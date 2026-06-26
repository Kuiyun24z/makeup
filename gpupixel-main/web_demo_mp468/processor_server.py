from __future__ import annotations

import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
import uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

mimetypes.add_type("text/javascript; charset=utf-8", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = Path(__file__).resolve().parent
BIN_DIR = ROOT / "build" / "windows-nmake" / "out" / "bin"
PROCESSOR_EXE = BIN_DIR / "gpupixel_processor_mp468.exe"
WORK_DIR = WEB_ROOT / ".work"
LOCAL_MEDIAPIPE_ROOT = WEB_ROOT / "vendor" / "mediapipe"
LEGACY_MEDIAPIPE_ROOT = Path.home() / "Desktop" / "美妆" / "web_demo" / "vendor" / "mediapipe"


def mediapipe_root() -> Path:
    if LOCAL_MEDIAPIPE_ROOT.exists():
        return LOCAL_MEDIAPIPE_ROOT
    return LEGACY_MEDIAPIPE_ROOT


def decode_data_url(value: str) -> tuple[bytes, str]:
    if "," not in value:
        raise ValueError("Invalid data URL")
    header, payload = value.split(",", 1)
    extension = ".png"
    if "image/jpeg" in header:
        extension = ".jpg"
    elif "image/webp" in header:
        extension = ".webp"
    return base64.b64decode(payload), extension


def safe_float(params: dict, name: str, min_value: float = 0.0, max_value: float = 10.0) -> float:
    value = params.get(name, 0)
    try:
        return max(min_value, min(max_value, float(value)))
    except (TypeError, ValueError):
        return 0.0


class Handler(BaseHTTPRequestHandler):
    server_version = "GPUPixelMP468WebDemo/0.1"

    def log_message(self, format: str, *args) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        if path.suffix == ".mjs":
            content_type = "text/javascript; charset=utf-8"
        elif path.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif path.suffix == ".wasm":
            content_type = "application/wasm"
        elif path.suffix == ".task":
            content_type = "application/octet-stream"
        else:
            content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        raw_path = unquote(self.path.split("?", 1)[0])
        if raw_path == "/":
            raw_path = "/index.html"

        if raw_path.startswith("/vendor/mediapipe/"):
            rel = raw_path.removeprefix("/vendor/mediapipe/")
            self.send_file((mediapipe_root() / rel).resolve())
            return

        target = (WEB_ROOT / raw_path.lstrip("/")).resolve()
        if not str(target).startswith(str(WEB_ROOT.resolve())):
            self.send_error(403)
            return
        self.send_file(target)

    def do_POST(self) -> None:
        if self.path != "/api/process":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            image_bytes, image_ext = decode_data_url(payload["imageData"])
            landmarks_text = str(payload.get("landmarksText", "")).strip()
            mediapipe_landmarks_text = str(payload.get("mediapipeLandmarksText", "")).strip()
            params = payload.get("params", {})

            if not PROCESSOR_EXE.exists():
                raise FileNotFoundError(f"Missing processor: {PROCESSOR_EXE}")

            job_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
            job_dir = WORK_DIR / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            image_path = job_dir / f"input{image_ext}"
            landmarks_path = job_dir / "landmarks.txt"
            mediapipe_landmarks_path = job_dir / "mediapipe_468.txt"
            output_path = job_dir / "result.png"
            image_path.write_bytes(image_bytes)
            if landmarks_text:
                landmarks_path.write_text(landmarks_text, encoding="utf-8")
            if mediapipe_landmarks_text:
                mediapipe_landmarks_path.write_text(mediapipe_landmarks_text, encoding="utf-8")

            command = [
                str(PROCESSOR_EXE),
                "--image",
                str(image_path),
                "--output",
                str(output_path),
                "--smoothing",
                str(safe_float(params, "smoothing")),
                "--whitening",
                str(safe_float(params, "whitening")),
                "--slim",
                str(safe_float(params, "slim")),
                "--eye",
                str(safe_float(params, "eye")),
                "--lipstick",
                str(safe_float(params, "lipstick")),
                "--blusher",
                str(safe_float(params, "blusher")),
                "--acne",
                str(safe_float(params, "acne")),
                "--eye-bag",
                str(safe_float(params, "eyeBag")),
                "--nasolabial",
                str(safe_float(params, "nasolabial")),
                "--redness",
                str(safe_float(params, "redness")),
                "--dullness",
                str(safe_float(params, "dullness")),
                "--pores",
                str(safe_float(params, "pores")),
                "--nose",
                str(safe_float(params, "nose")),
                "--eyelid",
                str(safe_float(params, "eyelid")),
                "--brow",
                str(safe_float(params, "brow")),
                "--mouth",
                str(safe_float(params, "mouth", -10.0, 10.0)),
                "--double-chin",
                str(safe_float(params, "doubleChin")),
                "--neck",
                str(safe_float(params, "neck")),
            ]
            if landmarks_text:
                command.extend(["--landmarks", str(landmarks_path)])
            if mediapipe_landmarks_text:
                command.extend(["--mediapipe-landmarks", str(mediapipe_landmarks_path)])

            completed = subprocess.run(
                command,
                cwd=str(ROOT),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=60,
            )
            if completed.returncode != 0:
                self.send_json(
                    500,
                    {
                        "ok": False,
                        "error": "GPUPixel processing failed",
                        "log": completed.stdout,
                    },
                )
                return

            result_data = base64.b64encode(output_path.read_bytes()).decode("ascii")
            self.send_json(
                200,
                {
                    "ok": True,
                    "imageData": f"data:image/png;base64,{result_data}",
                    "log": completed.stdout,
                },
            )
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


def main() -> int:
    port = int(os.environ.get("GPUPIXEL_WEB_PORT", "8788"))
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Serving GPUPixel web demo at http://127.0.0.1:{port}")
    print(f"Using processor: {PROCESSOR_EXE}")
    print(f"Using MediaPipe root: {mediapipe_root()}")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
