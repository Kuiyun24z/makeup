# Vosk WASM local assets

Local, offline Chinese speech recognition for the 魔镜待机 wake word (and as a
fallback for push-to-talk when Web Speech is unavailable).

## Expected files (not committed to git)

- `vosk.js` — vosk-browser web bundle (defines the global `Vosk`)
- `vosk-model-small-cn.tar.gz` — Chinese small model (~45 MB)

## Setup

```powershell
.\download_vosk_assets.cmd
.\check_vosk_assets.cmd
```

Then restart the demo server and reload the page. The 魔镜待机 status should
show 本地 Vosk instead of Web Speech 原型. The first toggle-on takes a few
seconds while the model is unpacked in the browser; later loads come from the
browser cache (the server allows caching for /vendor/ paths).

## Notes

- All wake-word detection runs locally; standby audio never leaves the machine.
- If the direct tar.gz mirrors are unavailable, the script downloads the
  official zip from alphacephei.com and repacks it with Windows tar.
- The adapter contract lives in `web_demo/speech_adapters.mjs`
  (`VoskWasmVoiceInput` / `VoskWasmWakeWordInput`).
