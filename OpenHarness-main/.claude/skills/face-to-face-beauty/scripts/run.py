#!/usr/bin/env python3
"""
Run Face-to-Face Beauty workflow via ComfyUI API.

Usage:
  python run.py --image input/photo.png
  python run.py --image photo.png --preset natural
  python run.py --image photo.png --prefix my_face --param slim_face=0.3
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent
COMFY_ROOT = PKG_ROOT.parent
MANIFEST = json.loads((PKG_ROOT / "manifest.json").read_text())
WORKFLOW_PATH = PKG_ROOT / MANIFEST["workflow"]["api"]
DEFAULTS_PATH = PKG_ROOT / MANIFEST["workflow"]["defaults"]

SERVER = MANIFEST["server"]
SCHEME = SERVER.get("scheme", "https")
HOST = os.environ.get("COMFYUI_HOST", SERVER["host"])
PORT = int(os.environ.get("COMFYUI_PORT", SERVER["port"]))
BASE = f"{SCHEME}://{HOST}:{PORT}"


def _ssl_ctx() -> ssl.SSLContext | None:
    if SCHEME != "https":
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def api_get(path: str) -> dict:
    req = urllib.request.Request(BASE + path)
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=30) as r:
        return json.loads(r.read())


def api_post(path: str, data: dict) -> dict:
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        BASE + path, data=body, headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=120) as r:
        return json.loads(r.read())


def health_check() -> bool:
    try:
        api_get("/object_info/FaceToFaceBeauty")
        return True
    except Exception:
        return False


def load_params(preset: str | None, overrides: dict) -> dict:
    cfg = json.loads(DEFAULTS_PATH.read_text())
    params = {k: v for k, v in cfg.items() if k != "presets"}
    if preset:
        presets = cfg.get("presets", {})
        if preset not in presets:
            raise SystemExit(f"Unknown preset: {preset}. Available: {', '.join(presets)}")
        params.update(presets[preset])
    params.update(overrides)
    return params


def parse_param_overrides(items: list[str]) -> dict:
    out = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"Invalid --param format: {item} (use key=value)")
        k, v = item.split("=", 1)
        try:
            if "." in v:
                out[k] = float(v)
            else:
                out[k] = int(v)
        except ValueError:
            out[k] = v
    return out


def resolve_image(image_arg: str) -> tuple[str, Path]:
    p = Path(image_arg)
    input_dir = COMFY_ROOT / MANIFEST["inputs"]["image_dir"]
    if p.is_file():
        if p.parent.resolve() != input_dir.resolve():
            dest = input_dir / p.name
            import shutil
            shutil.copy2(p, dest)
        return p.name, input_dir / p.name
    candidate = input_dir / image_arg
    if candidate.is_file():
        return image_arg, candidate
    raise SystemExit(f"Image not found: {image_arg} (place files in {input_dir})")


def run_workflow(
    image_name: str,
    prefix: str,
    params: dict,
    timeout_sec: int = 180,
) -> dict:
    prompt = json.loads(WORKFLOW_PATH.read_text())
    prompt["1"]["inputs"]["image"] = image_name
    prompt["5"]["inputs"]["filename_prefix"] = prefix
    for k, v in params.items():
        if k in prompt["4"]["inputs"]:
            prompt["4"]["inputs"][k] = v

    resp = api_post("/prompt", {"prompt": prompt, "client_id": str(uuid.uuid4())})
    if resp.get("node_errors"):
        raise RuntimeError(json.dumps(resp["node_errors"], ensure_ascii=False))

    prompt_id = resp["prompt_id"]
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(1.5)
        hist = api_get(f"/history/{prompt_id}")
        if prompt_id not in hist:
            continue
        entry = hist[prompt_id]
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(str(status.get("messages")))
        if status.get("completed"):
            outputs = []
            out_dir = COMFY_ROOT / MANIFEST["inputs"]["output_dir"]
            for node_out in entry.get("outputs", {}).values():
                for img in node_out.get("images", []):
                    if img.get("type") == "output":
                        path = out_dir / img["filename"]
                        outputs.append({
                            "filename": img["filename"],
                            "path": str(path),
                            "size": path.stat().st_size if path.is_file() else 0,
                        })
            return {"prompt_id": prompt_id, "outputs": outputs}
    raise TimeoutError(f"Workflow timed out after {timeout_sec}s")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Face-to-Face Beauty workflow")
    parser.add_argument("--image", "-i", default=None, help="Image path or filename in input/")
    parser.add_argument("--prefix", "-p", default="face_to_face", help="Output filename prefix")
    parser.add_argument("--preset", choices=["natural", "glam", "skin_only"], default=None)
    parser.add_argument("--param", action="append", default=[], metavar="KEY=VAL")
    parser.add_argument("--json", action="store_true", help="Print result as JSON")
    parser.add_argument("--check", action="store_true", help="Health check only")
    args = parser.parse_args()

    if args.check:
        ok = health_check()
        print(json.dumps({"healthy": ok, "server": BASE}))
        return 0 if ok else 1

    if not args.image:
        parser.error("--image/-i is required unless using --check")

    if not health_check():
        print(
            f"ComfyUI not reachable at {BASE}. Start with: bash {COMFY_ROOT}/start_remote.sh",
            file=sys.stderr,
        )
        return 1

    image_name, image_path = resolve_image(args.image)
    params = load_params(args.preset, parse_param_overrides(args.param))
    result = run_workflow(image_name, args.prefix, params)

    result["input"] = str(image_path)
    result["params"] = params
    result["server"] = BASE

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for o in result["outputs"]:
            print(o["path"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
