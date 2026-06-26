# GPUPixel Local Adapter

Local HTTP adapter for the compiled `gpupixel-main` runtime.

## Run

```powershell
node .\gpupixel-service\server.js
```

Default endpoint:

```text
http://127.0.0.1:9001
```

## Endpoints

- `GET /health`
- `GET /v1/presets`
- `POST /v1/advice`

`POST /v1/advice` accepts the same high-level analysis payload used by `beauty-studio-site /api/advice` and returns a native-style preset recommendation that the site can merge into its coaching response.

## Current Status

This adapter currently exposes recommendation and health endpoints only.

On this workspace's Windows setup, the shipped `gpupixel-main` build output exists, but the native face-tracking render chain is not fully ready unless both conditions are true:

- `build/windows/CMakeCache.txt` contains `GPUPIXEL_ENABLE_FACE_DETECTOR:BOOL=ON`
- `third_party/mars-face-kit/libs/windows/msvc-x64/` contains `mars-face-kit.dll` and `mars-face-kit.lib`

If either condition is missing, `GET /health` will report that native face tracking is not ready, which means the service cannot yet provide the original GPUPixel per-frame face-following beauty render on Windows.
