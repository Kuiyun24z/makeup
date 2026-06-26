# Windows Video Client MediaPipe Bridge

This is the first live-landmark version for the native Windows video client.

## Pipeline

```text
gpupixel_video_client_v21.exe
  -> captures and mirror-corrects camera frames
  -> writes a small BMP frame to out/bin/mediapipe_bridge_frame.bmp

desktop_mediapipe_bridge
  -> serves a local browser page
  -> MediaPipe JS/WASM detects 468 face points from the BMP frame
  -> maps 468 points to the 111-point GPUPixel layout
  -> writes out/bin/mediapipe_live_landmarks.txt

gpupixel_video_client_v21.exe
  -> reloads mediapipe_live_landmarks.txt
  -> smooths landmarks
  -> feeds BlusherFilter and FaceReshapeFilter
  -> uses latest raw MP468 lip polygons plus stronger lip-only lead
  -> applies post-GPUPixel soft outer lip expansion for the dedicated lipstick renderer
  -> reads mediapipe_live_meta.json for latency diagnostics
```

## Run

```powershell
cd "C:\Users\huaweiuser\Desktop\GPUPixel"
.\start_video_client_mediapipe.cmd
```

Keep the bridge browser window open and foreground while testing the client. The
launcher opens it with Edge/Chrome background-throttling flags so MediaPipe
landmarks can keep updating while the native client is also running. The bridge
window runs MediaPipe landmarks only; GPUPixel rendering stays in the native
client.

## Notes

- This is not yet a pure C++ MediaPipe integration.
- It reuses the same MediaPipe JS/WASM model as the web demo.
- The client publishes a downscaled BMP every few frames to keep the native
  video path smooth.
- The live landmarks are EMA-smoothed in the client to reduce jitter.
- v5 publishes and reloads bridge landmarks every frame, uses lighter landmark
  smoothing, and caps face reshape controls to reduce side-view warping.
- v6 disables GPUPixel's built-in lipstick pass and applies a MediaPipe
  outer-lip minus inner-mouth lipstick mask before the GPUPixel pipeline.
- v7 moves lip rendering into `demo/desktop/lip_renderer_mp468.*`, paints upper
  and lower lips separately, erodes the inner mouth edge, and adds a simple
  high-luminance teeth guard.
- v8-v9 experimented with an extra browser-side lip segmentation path, but it
  was removed from the live client because it added latency and stale-mask
  failure modes.
- v10 fixes the startup white-window case by drawing
  the control panel even while the camera has not delivered a frame yet.
- v11 removes the browser ONNX face parsing path from the live client. Lipstick
  uses MP468 lip points only, which avoids the WASM/model load and stale mask
  failures.
- v12 restores 1080p camera capture for the native GPUPixel render path. The
  MediaPipe bridge still receives a downscaled BMP, so landmark detection stays
  lightweight while the displayed beauty frame is no longer upscaled from
  640x360.
- v13 reduces lipstick latency and hard edges. Lipstick uses the latest raw
  MP468 points while reshape/blusher keep smoothed landmarks, the bridge polls
  frames more frequently, and the lip renderer uses adaptive feathering plus
  source-pixel confidence to avoid hard mask-like boundaries.
- v14 adds a small soft outer expansion around the MP468 lip polygons, relaxes
  light-lip color confidence, adds lip-only one-frame lead prediction, and adds
  a `Lip debug` overlay for the raw lip outline, expanded outline, and inner
  mouth exclusion.
- v15 moves the dedicated lipstick renderer after the GPUPixel beauty pipeline
  so smoothing/whitening no longer washes out the lip color, increases soft
  coverage for visible border filling, and strengthens the lip-only prediction.
- v16 adds latency diagnostics. The client writes
  `mediapipe_bridge_frame_meta.json`, the browser bridge posts timing data with
  landmarks, the Python server writes `mediapipe_live_meta.json`, and the native
  panel shows frame age, landmark age, detect cost, image load cost, server age,
  landmark FPS, and C++ read cost.
- v17 fixes `cppPublishMs` precision in the diagnostics metadata, shows the
  landmark interval in milliseconds, warns when browser throttling is suspected,
  and launches the bridge browser with timer/background/occlusion throttling
  disabled where Edge or Chrome is available.
- v18 adds age-compensated lipstick landmarks. The dedicated lip renderer still
  uses raw MP468 lip points, but it predicts only the lip points forward based
  on the measured frame/landmark age and recent lip motion, with FPS and
  movement caps to avoid runaway drift. The bridge poll loop also skips the
  extra 16 ms wait only after a new frame was actually processed; repeated or
  missing frames still wait 16 ms to avoid a busy loop.
- v19 reworks the lipstick lead after the aggressive v19 prototype (continuous
  per-point velocity extrapolation) made tracking worse. Lip motion is now split
  into an overall mouth-center translation and per-point shape deformation. The
  smooth, low-noise center translation gets an age-based lead computed from the
  landmark age (not frame age), capped much lower than v18 (max scale 1.0, max
  age 80 ms). The noisy deformation gets only a small fixed lead. Prediction is
  still applied for a single new-frame tick and reverts to raw on repeated
  frames, so it cannot keep extrapolating during pauses or reversals. The panel
  shows `center lead`, a `Lip pred gap` (average raw->pred displacement in px),
  and the Lip debug overlay now draws the raw (green) and predicted (cyan) lip
  contours together so overshoot is visible.
- v20 freezes the lipstick work (left exactly as v19) and adds two new GPUPixel
  reshape effects driven by the same 111-point landmarks: mouth enlarge/shrink
  and nose/ala enlarge/shrink. Both are implemented in `FaceReshapeFilter` as a
  signed radial `scaleFeature` warp (positive enlarges, negative shrinks, with a
  falloff so the rest of the face is untouched), running after the existing
  thin-face and big-eye warps. The control panel adds `Mouth size` and
  `Nose size` sliders (-1..+1) and the whole panel is enlarged via
  `FontGlobalScale`/`ScaleAllSizes` for easier reading and dragging.
  v20 reshape strength was tuned down from 0.30 to 0.15 after the max setting
  looked like a funhouse mirror.
- v21 adds an eyebrow-darkening effect via a new `EyebrowRendererMP468`
  post-process (same landmark-polygon style as the lip renderer). It builds left
  and right brow polygons from MediaPipe 468 eyebrow points and multiplies the
  pixels darker, weighted by a brow-hair confidence (darker hair pixels are
  deepened more than the skin gaps), with an edge feather. The control panel
  adds an `Eyebrow` slider (0..10). The post-process step now applies lipstick
  and/or eyebrow into the same working frame.
