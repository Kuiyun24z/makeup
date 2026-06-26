# Beauty Agent Web Demo

This is a local camera-first demo for the beauty agent project.

## What It Does

- Opens the user's webcam in the browser.
- Loads MediaPipe Face Landmarker in the browser and draws facial landmarks.
- Keeps the camera view clean by default; landmarks are used for analysis but are not drawn over the user's face.
- Falls back to the browser `FaceDetector` API when MediaPipe cannot load.
- Estimates frame brightness, sharpness, face size, framing, and stability.
- Converts landmarks into beauty-oriented features:
  - face proportion,
  - eye spacing and brow-eye distance,
  - lip fullness,
  - makeup focus hints.
- Adds a real-time mirror makeup preview:
  - lightweight skin smoothing / brightening,
  - landmark-aligned lipstick,
  - landmark-aligned blush,
  - adjustable daily / commute / sweet presets.
- Shows local PixelFreeEffects engine readiness:
  - SDK resource checks,
  - CMake/MSVC build-tool checks,
  - native Windows demo build status.
- Sends the current camera frame to the native PixelFree demo through `PixelFree 快照`.
- Sends the structured real-time analysis to the local Ollama model.
- Returns Chinese beauty advice from `gemma3:4b`.

## Requirements

- Ollama running at `http://127.0.0.1:11434`
- Pulled Ollama model: `gemma3:4b`
- Python virtual environment at `../.venv-openharness`
- Local MediaPipe browser assets in `web_demo/vendor/mediapipe/`
- Optional PixelFree native engine requirements:
  - `PixelFreeEffects-master/SMBeautyEngine_windows/`
  - CMake
  - Visual Studio Build Tools with C++ / MSVC

Important: keep Ollama models in an ASCII-only path. On this machine, Ollama failed to load `gemma3:4b` from the project path because the parent folder contains Chinese characters. The working path is:

```text
C:\Users\huaweiuser\.ollama\models
```

## Start

From the project root:

```powershell
.\web_demo\start_demo.cmd
```

This opens a minimized Python server window. Keep that window open while using the demo.

Open:

```text
http://127.0.0.1:8765
```

## Stop

From the project root:

```powershell
.\web_demo\stop_demo.cmd
```

You can also close the minimized Python server window.

If you prefer PowerShell directly, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\web_demo\start_demo.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\web_demo\stop_demo.ps1
```

## Notes

- Browser camera access works on localhost / 127.0.0.1.
- Add `?debug=1` to the URL to show the face box, landmark points, and guide lines for development checks.
- The landmarker path tries vendored MediaPipe browser assets in `web_demo/vendor/mediapipe/` first.
- If local assets are missing, it temporarily falls back to CDN so the demo remains usable while offline setup is incomplete.
- If MediaPipe cannot load, the demo falls back to `FaceDetector` when available.
- To refresh the vendored assets, run `.\web_demo\vendor\mediapipe\download_mediapipe_assets.cmd`.
- To confirm true offline readiness, run `.\web_demo\vendor\mediapipe\check_mediapipe_assets.cmd`; it must report that all assets are present.
- The next backend-analysis step is to move frame/landmark processing behind a local API so the browser only handles camera capture and display.
- The local `人脸关键点` folder is a MediaPipe source tree. This demo uses MediaPipe Tasks in the browser first, because compiling that full source tree is much heavier than the first website demo needs.
- The local `美颜` folder is a GPUPixel native beauty SDK. The current web demo implements a lightweight browser preview inspired by its beauty, lipstick, and blusher filters; a later step can replace this with a compiled GPUPixel/WebAssembly pipeline.
- The local `PixelFreeEffects-master` folder is the preferred near-term native Windows beauty engine. The `PixelFree 快照` button sends one current camera frame to the already-built native PixelFree demo. See `../PIXELFREE_INTEGRATION.md`.
- This demo does not identify the user and does not diagnose skin conditions.
