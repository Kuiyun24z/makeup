from __future__ import annotations

import atexit
import base64
import json
import mimetypes
import os
import subprocess
import sys
import threading
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
DAEMON_EXE = BIN_DIR / "gpupixel_processor_mp468_daemon.exe"
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


def processor_values(params: dict) -> list[float]:
    return [
        safe_float(params, "smoothing"),
        safe_float(params, "whitening"),
        safe_float(params, "slim"),
        safe_float(params, "eye"),
        safe_float(params, "lipstick"),
        safe_float(params, "blusher"),
        safe_float(params, "acne"),
        safe_float(params, "eyeBag"),
        safe_float(params, "nasolabial"),
        safe_float(params, "redness"),
        safe_float(params, "dullness"),
        safe_float(params, "pores"),
        safe_float(params, "nose"),
        safe_float(params, "eyelid"),
        safe_float(params, "brow"),
        safe_float(params, "mouth", -10.0, 10.0),
        safe_float(params, "doubleChin"),
        safe_float(params, "neck"),
    ]


def run_once_processor(
    image_path: Path,
    output_path: Path,
    landmarks_path: Path | None,
    mediapipe_landmarks_path: Path | None,
    params: dict,
) -> tuple[bool, str]:
    if not PROCESSOR_EXE.exists():
        raise FileNotFoundError(f"Missing processor: {PROCESSOR_EXE}")

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
    if landmarks_path:
        command.extend(["--landmarks", str(landmarks_path)])
    if mediapipe_landmarks_path:
        command.extend(["--mediapipe-landmarks", str(mediapipe_landmarks_path)])

    completed = subprocess.run(
        command,
        cwd=str(ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=60,
    )
    return completed.returncode == 0, completed.stdout


class ProcessorDaemon:
    def __init__(self, exe_path: Path) -> None:
        self.exe_path = exe_path
        self.process: subprocess.Popen[str] | None = None
        self.lock = threading.Lock()

    def available(self) -> bool:
        return self.exe_path.exists()

    def stop(self) -> None:
        process = self.process
        self.process = None
        if not process:
            return
        try:
            if process.stdin:
                process.stdin.write("QUIT\n")
                process.stdin.flush()
            process.wait(timeout=2)
        except Exception:
            process.kill()

    def _start_locked(self) -> list[str]:
        self.stop()
        process = subprocess.Popen(
            [str(self.exe_path)],
            cwd=str(ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.process = process
        log: list[str] = []
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            line = process.stdout.readline() if process.stdout else ""
            if not line:
                if process.poll() is not None:
                    raise RuntimeError("GPUPixel daemon exited during startup")
                continue
            text = line.rstrip()
            log.append(text)
            if text == "__GPUPIXEL_READY__":
                return log
        raise TimeoutError("Timed out waiting for GPUPixel daemon startup")

    def _ensure_started_locked(self) -> list[str]:
        if not self.process or self.process.poll() is not None:
            return self._start_locked()
        return []

    def process_frame(
        self,
        image_path: Path,
        output_path: Path,
        landmarks_path: Path | None,
        mediapipe_landmarks_path: Path | None,
        params: dict,
    ) -> tuple[bool, str]:
        if not self.available():
            return run_once_processor(
                image_path,
                output_path,
                landmarks_path,
                mediapipe_landmarks_path,
                params,
            )

        with self.lock:
            log = self._ensure_started_locked()
            fields = [
                "PROCESS",
                str(image_path),
                str(output_path),
                str(landmarks_path or ""),
                str(mediapipe_landmarks_path or ""),
                *[f"{value:.6f}" for value in processor_values(params)],
            ]
            line = "\t".join(fields) + "\n"
            try:
                assert self.process is not None
                assert self.process.stdin is not None
                assert self.process.stdout is not None
                self.process.stdin.write(line)
                self.process.stdin.flush()
            except Exception:
                log.extend(self._start_locked())
                assert self.process is not None
                assert self.process.stdin is not None
                assert self.process.stdout is not None
                self.process.stdin.write(line)
                self.process.stdin.flush()

            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                assert self.process is not None
                assert self.process.stdout is not None
                response = self.process.stdout.readline()
                if not response:
                    if self.process.poll() is not None:
                        self.stop()
                        return False, "\n".join(log + ["GPUPixel daemon exited"])
                    continue
                text = response.rstrip()
                if text.startswith("__GPUPIXEL_DONE__"):
                    parts = text.split("\t", 2)
                    ok = len(parts) >= 2 and parts[1] == "1"
                    if len(parts) == 3 and parts[2]:
                        log.append(parts[2])
                    return ok, "\n".join(log)
                log.append(text)

            self.stop()
            return False, "\n".join(log + ["Timed out waiting for GPUPixel daemon"])


DAEMON = ProcessorDaemon(DAEMON_EXE)
atexit.register(DAEMON.stop)


class Handler(BaseHTTPRequestHandler):
    server_version = "GPUPixelMP468VideoWebDemo/0.1"

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

            ok, log = DAEMON.process_frame(
                image_path,
                output_path,
                landmarks_path if landmarks_text else None,
                mediapipe_landmarks_path if mediapipe_landmarks_text else None,
                params,
            )
            if not ok:
                self.send_json(
                    500,
                    {
                        "ok": False,
                        "error": "GPUPixel processing failed",
                        "log": log,
                    },
                )
                return

            result_data = base64.b64encode(output_path.read_bytes()).decode("ascii")
            self.send_json(
                200,
                {
                    "ok": True,
                    "imageData": f"data:image/png;base64,{result_data}",
                    "log": log,
                },
            )
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


def main() -> int:
    port = int(os.environ.get("GPUPIXEL_WEB_PORT", "8789"))
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Serving GPUPixel web demo at http://127.0.0.1:{port}")
    print(f"Using daemon: {DAEMON_EXE}")
    print(f"Using processor: {PROCESSOR_EXE}")
    print(f"Using MediaPipe root: {mediapipe_root()}")
    if DAEMON.available():
        try:
            with DAEMON.lock:
                DAEMON._ensure_started_locked()
            print("GPUPixel daemon warmed up")
        except Exception as exc:
            DAEMON.stop()
            print(f"GPUPixel daemon warmup failed: {exc}")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
