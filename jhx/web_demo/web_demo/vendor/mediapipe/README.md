# Local MediaPipe Assets

This folder stores the browser-side MediaPipe files used by the web demo.

Expected files:

```text
web_demo/vendor/mediapipe/
  tasks-vision/
    vision_bundle.mjs
    wasm/
      vision_wasm_internal.js
      vision_wasm_internal.wasm
      vision_wasm_nosimd_internal.js
      vision_wasm_nosimd_internal.wasm
  models/
    face_landmarker.task
```

Run from the project root:

```powershell
.\web_demo\vendor\mediapipe\download_mediapipe_assets.cmd
```

Check files:

```powershell
.\web_demo\vendor\mediapipe\check_mediapipe_assets.cmd
```

The app loads these local files first. No jsDelivr or Google Storage requests are needed after these files exist.
