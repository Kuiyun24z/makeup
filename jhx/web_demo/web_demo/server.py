"""Local server for the camera-first beauty agent demo."""

from __future__ import annotations

import json
import os
import base64
import socket
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
PIXELFREE_ROOT = PROJECT_ROOT / "PixelFreeEffects-master" / "SMBeautyEngine_windows"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")
PIXELFREE_SNAPSHOT_INPUT_NAMES = ("IMG_2406.png", "snapshot_input.png")
PIXELFREE_SNAPSHOT_CLEANUP_DELAY = 10.0

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agent_tools
import rules

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


class DemoHandler(SimpleHTTPRequestHandler):
    server_version = "BeautyAgentDemo/0.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        if self.path.startswith("/vendor/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        if sys.stderr:
            super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._write_json(self._health())
            return
        if self.path == "/api/pixelfree/status":
            self._write_json(pixelfree_status())
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/agent/stream":
            self._handle_agent_stream()
            return
        if self.path == "/api/agent/route":
            self._handle_agent_route()
            return
        if self.path == "/api/advice/stream":
            self._handle_advice_stream()
            return
        if self.path == "/api/advice":
            self._handle_advice()
            return
        if self.path == "/api/draft":
            self._handle_draft()
            return
        if self.path == "/api/pixelfree/snapshot":
            self._handle_pixelfree_snapshot()
            return
        self.send_error(404, "Not found")

    def _handle_advice(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            self.send_error(400, "Invalid JSON")
            return

        analysis = payload.get("analysis", {}) if isinstance(payload, dict) else {}
        draft = rules.generate_draft(analysis)
        prompt = build_prompt(payload, draft)
        body = {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.4,
                "num_predict": 420,
            },
        }

        try:
            response = post_json(f"{OLLAMA_URL}/api/generate", body, timeout=120)
        except urllib.error.URLError as exc:
            self._write_json(
                {
                    "ok": False,
                    "error": f"Ollama request failed: {exc}",
                    "draft": draft,
                    "advice": fallback_advice(payload, draft),
                }
            )
            return

        advice = str(response.get("response") or "").strip()
        self._write_json(
            {
                "ok": True,
                "model": response.get("model", OLLAMA_MODEL),
                "draft": draft,
                "promptIncludesDraft": True,
                "advice": advice or fallback_advice(payload, draft),
            }
        )

    def _handle_draft(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            self.send_error(400, "Invalid JSON")
            return

        analysis = payload.get("analysis", payload) if isinstance(payload, dict) else {}
        draft = rules.generate_draft(analysis if isinstance(analysis, dict) else {})
        self._write_json({"ok": True, "draft": draft})

    def _handle_advice_stream(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            self.send_error(400, "Invalid JSON")
            return

        analysis = payload.get("analysis", {}) if isinstance(payload, dict) else {}
        draft = rules.generate_draft(analysis if isinstance(analysis, dict) else {})
        prompt = build_prompt(payload, draft)

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        if not self._write_ndjson({"type": "draft", "draft": draft}):
            return

        full_text = []
        response = None
        try:
            response = open_ollama_stream(prompt, timeout=120)
            for raw_line in response:
                event = parse_ollama_line(raw_line)
                if event is None:
                    continue
                delta = str(event.get("response") or "")
                if delta:
                    full_text.append(delta)
                    if not self._write_ndjson({"type": "delta", "text": delta}):
                        return
                if event.get("done") is True:
                    self._write_ndjson(
                        {
                            "type": "done",
                            "advice": "".join(full_text),
                            "model": str(event.get("model") or OLLAMA_MODEL),
                        }
                    )
                    return
            self._write_ndjson({"type": "done", "advice": "".join(full_text), "model": OLLAMA_MODEL})
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
            self._write_ndjson(
                {
                    "type": "error",
                    "error": f"Ollama stream failed: {exc}",
                    "fallback": fallback_advice(payload, draft),
                }
            )
        finally:
            if response is not None:
                response.close()

    def _handle_agent_route(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            self.send_error(400, "Invalid JSON")
            return

        route = agent_tools.route_request(
            str(payload.get("question") or ""),
            force_agent=bool(payload.get("agent") or payload.get("mode") == "agent"),
        )
        self._write_json({"ok": True, "route": route})

    def _handle_agent_stream(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            self.send_error(400, "Invalid JSON")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            for event in agent_tools.mock_agent_events(payload):
                if not self._write_ndjson(event):
                    return
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return
        except Exception as exc:  # pragma: no cover - last-resort stream guard
            self._write_ndjson({"type": "error", "error": f"Agent stream failed: {exc}"})

    def _handle_pixelfree_snapshot(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            image_data = str(payload.get("image") or "")
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return

        try:
            result = launch_pixelfree_snapshot(image_data)
        except ValueError as exc:
            self._write_json({"ok": False, "error": str(exc)}, status=400)
            return
        except OSError as exc:
            self._write_json({"ok": False, "error": f"PixelFree launch failed: {exc}"}, status=500)
            return

        self._write_json({"ok": True, **result})

    def _read_json_body(self) -> dict[str, object] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _health(self) -> dict[str, object]:
        try:
            tags = post_get_json(f"{OLLAMA_URL}/api/tags", timeout=10)
            models = [item.get("name") for item in tags.get("models", [])]
            return {
                "ok": True,
                "ollama": OLLAMA_URL,
                "model": OLLAMA_MODEL,
                "models": models,
                "features": ["advice_stream", "draft", "agent_stream", "agent_mock"],
            }
        except urllib.error.URLError as exc:
            return {
                "ok": False,
                "ollama": OLLAMA_URL,
                "model": OLLAMA_MODEL,
                "error": str(exc),
                "features": ["advice_stream", "draft", "agent_stream", "agent_mock"],
            }

    def _write_json(self, data: dict[str, object], status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _write_ndjson(self, event: dict[str, object]) -> bool:
        try:
            self.wfile.write(ndjson_event_line(event))
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return False


def post_get_json(url: str, timeout: int) -> dict[str, object]:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict[str, object], timeout: int) -> dict[str, object]:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def open_ollama_stream(prompt: str, timeout: int):
    body = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": 0.4,
            "num_predict": 420,
        },
    }
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    return urllib.request.urlopen(request, timeout=timeout)


def parse_ollama_line(line: bytes) -> dict[str, object] | None:
    text = line.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def ndjson_event_line(event: dict[str, object]) -> bytes:
    return (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def cleanup_snapshot_files(directory: Path | str) -> list[str]:
    root = Path(directory)
    deleted: list[str] = []
    for name in PIXELFREE_SNAPSHOT_INPUT_NAMES:
        path = root / name
        if not path.is_file():
            continue
        try:
            path.unlink()
            deleted.append(str(path))
        except OSError:
            continue
    return deleted


def schedule_snapshot_cleanup(path: Path, delay: float = PIXELFREE_SNAPSHOT_CLEANUP_DELAY) -> None:
    timer = threading.Timer(delay, delete_snapshot_file, args=(path,))
    timer.daemon = True
    timer.start()


def delete_snapshot_file(path: Path) -> bool:
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def cleanup_pixel_free_snapshot_inputs() -> list[str]:
    deleted: list[str] = []
    for path in pixelfree_exe_candidates():
        deleted.extend(cleanup_snapshot_files(path.parent))
    return deleted


def pixelfree_exe_candidates() -> list[Path]:
    return [
        PIXELFREE_ROOT / "build" / "bin" / "Debug" / "SMBeautyEngine_windows.exe",
        PIXELFREE_ROOT / "build" / "bin" / "Release" / "SMBeautyEngine_windows.exe",
        PIXELFREE_ROOT / "build" / "bin" / "SMBeautyEngine_windows.exe",
    ]


def pixelfree_status() -> dict[str, object]:
    resources = {
        "root": PIXELFREE_ROOT,
        "auth": PIXELFREE_ROOT / "Res" / "pixelfreeAuth.lic",
        "filter": PIXELFREE_ROOT / "Res" / "filter_model.bundle",
        "library": PIXELFREE_ROOT / "pixelfreeLib" / "PixelFree.lib",
        "sampleImage": PIXELFREE_ROOT / "IMG_2406.png",
        "cmakeFile": PIXELFREE_ROOT / "CMakeLists.txt",
    }
    missing = [name for name, path in resources.items() if not path.exists()]
    tools = {
        "cmake": shutil.which("cmake"),
        "cl": shutil.which("cl"),
        "msbuild": shutil.which("msbuild"),
    }
    build_exe_candidates = pixelfree_exe_candidates()
    build_exe = next((path for path in build_exe_candidates if path.exists()), build_exe_candidates[0])
    return {
        "ok": not missing,
        "root": str(PIXELFREE_ROOT),
        "missing": missing,
        "tools": {name: bool(value) for name, value in tools.items()},
        "toolPaths": {name: value for name, value in tools.items() if value},
        "buildReady": not missing and bool(tools["cmake"]) and (bool(tools["cl"]) or bool(tools["msbuild"])),
        "demoBuilt": build_exe.exists(),
        "demoExe": str(build_exe),
        "snapshotReady": not missing and build_exe.exists(),
        "mode": "native-windows-sdk",
        "note": "PixelFree status only; realtime frame processing bridge is the next integration step.",
    }


def launch_pixelfree_snapshot(image_data: str) -> dict[str, object]:
    status = pixelfree_status()
    if not status["snapshotReady"]:
        raise ValueError("PixelFree native demo is not ready. Check /api/pixelfree/status first.")
    allowed_prefixes = ("data:image/jpeg;base64,", "data:image/png;base64,")
    if not image_data.startswith(allowed_prefixes):
        raise ValueError("Expected a JPEG or PNG data URL captured from the camera.")

    raw = base64.b64decode(image_data.split(",", 1)[1], validate=True)
    is_jpeg = raw.startswith(b"\xff\xd8\xff")
    is_png = raw.startswith(b"\x89PNG\r\n\x1a\n")
    if not (is_jpeg or is_png):
        raise ValueError("Captured image is not a valid JPEG or PNG.")

    demo_exe = Path(str(status["demoExe"]))
    input_image = demo_exe.parent / "IMG_2406.png"
    input_image.write_bytes(raw)

    try:
        subprocess.Popen(
            [str(demo_exe)],
            cwd=str(demo_exe.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
    except OSError:
        delete_snapshot_file(input_image)
        raise

    schedule_snapshot_cleanup(input_image)
    return {
        "mode": "native-pixelfree-snapshot",
        "demoExe": str(demo_exe),
        "inputImage": str(input_image),
        "message": "PixelFree native window launched with the current camera snapshot.",
    }


def build_prompt(payload: dict[str, object], draft: dict[str, object]) -> str:
    analysis = payload.get("analysis", {})
    question = str(payload.get("question") or "给我一个适合当前面部状态的日常美妆建议。").strip()
    return (
        "你是中文美妆顾问。下面的 draft JSON 是规则引擎生成的唯一结论来源，"
        "你只能把它润色成自然、友好、具体的中文建议，不得新增、删除、推翻或改写其中的色系判断、质量门控和妆容重点。"
        "如果 draft.quality.ok 为 false，只能提示用户按 retakeHint 调整拍摄，不要补充底妆、唇妆、脸型或眉眼结论。"
        "如果 draft.base 或 draft.lips 为 null，说明色彩条件不可靠，不要自行猜测肤色、底妆或口红色系。"
        "不要做身份识别，不要评价颜值，不要诊断皮肤疾病，不要推断年龄、性别或敏感属性。"
        "输出结构固定为：1. 当前状态；2. 底妆；3. 眉眼；4. 唇妆；5. 下一步。\n\n"
        f"用户问题：{question}\n\n"
        "规则引擎 draft JSON：\n"
        f"{json.dumps(draft, ensure_ascii=False, indent=2)}\n\n"
        "原始 FaceState（仅用于理解上下文，不得覆盖 draft 结论）：\n"
        f"{json.dumps(analysis, ensure_ascii=False, indent=2)}\n"
    )


def fallback_advice(payload: dict[str, object], draft: dict[str, object] | None = None) -> str:
    if draft is None:
        analysis = payload.get("analysis", {}) if isinstance(payload, dict) else {}
        draft = rules.generate_draft(analysis if isinstance(analysis, dict) else {})
    return rules.render_draft_text(draft)


def main() -> None:
    port = int(os.environ.get("PORT", "8765"))
    cleanup_pixel_free_snapshot_inputs()
    server = ThreadingHTTPServer(("127.0.0.1", port), DemoHandler)
    if sys.stdout:
        print(f"Beauty Agent demo running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
