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

## Volcengine / Doubao TTS MVP

The first cloud voice MVP keeps ASR on the existing local `funasr-local` path
and replaces only TTS with Volcengine/Doubao cloud synthesis. This avoids
breaking the current realtime voice pipeline while giving the mirror a better
Chinese speaking voice.

1. Copy `D:\work\makeup\beauty-studio.local.example.ps1` to
   `D:\work\makeup\beauty-studio.local.ps1`.
2. Fill in local-only values:

```powershell
$env:TTS_PROVIDER = "volcengine"
$env:VOLC_TTS_API_KEY = "your-volcengine-speech-api-key"
$env:VOLC_TTS_RESOURCE_ID = "seed-tts-2.0"
$env:VOLC_TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
$env:VOLC_TTS_VOICE_TYPE = "zh_female_vv_uranus_bigtts"
$env:VOLC_TTS_ENCODING = "mp3"
$env:VOLC_TTS_SAMPLE_RATE = "24000"
```

3. Restart:

```powershell
D:\work\makeup\start-beauty-studio.ps1 -NoBrowser
```

When `TTS_PROVIDER=volcengine`, the launcher skips the local TTS service and
`/api/voice/tts/speak` calls the OpenSpeech v3 unidirectional HTTP TTS API
directly using `X-Api-Key` and `X-Api-Resource-Id`. If the provider is not set,
the existing local TTS fallback remains unchanged.
