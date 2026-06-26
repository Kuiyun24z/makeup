# Beauty Studio Site

Beauty Studio Site is the web voice/chat shell for the merged makeup project.
The active beauty engine is GPUPixel under `D:\work\makeup\gpupixel-main`.

## Current Runtime

- Web site: `D:\work\makeup\beauty-studio-site`
- GPUPixel adapter: `D:\work\makeup\gpupixel-service`
- GPUPixel native client: `D:\work\makeup\gpupixel-main`
- One-click launcher: `D:\work\makeup\start-beauty-studio.ps1`
- Native GPUPixel launcher: `D:\work\makeup\start-gpupixel-native.cmd`

## Notes

- The old browser-side PixelFree controls were removed.
- The old Beauty Studio MediaPipe, face-parsing, and 3DDFA module docs were removed.
- GPUPixel still owns its internal `desktop_mediapipe_bridge`; do not delete that bridge unless GPUPixel replaces it with a native tracker.
- To avoid camera conflicts, the one-click launcher stops existing `gpupixel_video_client*` processes by default. Use `-KeepNativeCameraClients` only when you deliberately want to keep a native camera client running.

## Checks

```powershell
node --check D:\work\makeup\beauty-studio-site\server.js
node --check D:\work\makeup\beauty-studio-site\public\app.js
node --check D:\work\makeup\gpupixel-service\server.js
D:\work\makeup\start-beauty-studio.ps1 -NoBrowser
```
