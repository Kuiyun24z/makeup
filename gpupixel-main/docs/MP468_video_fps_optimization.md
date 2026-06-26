# MP468 Video FPS Optimization

## What changed

The video demo backend now prefers a resident GPUPixel processor:

```text
Browser camera frame
  -> MediaPipe VIDEO landmarks in browser
  -> HTTP POST /api/process
  -> Python server writes frame/landmarks to the job folder
  -> gpupixel_processor_mp468_daemon.exe stays alive
  -> Python sends one PROCESS line over stdin
  -> daemon reuses the initialized GPUPixel/OpenGL context
  -> daemon writes result.png and returns a DONE line
  -> Python returns the result image to the browser
```

The old `gpupixel_processor_mp468.exe` path is still kept as a fallback if the
daemon binary is missing.

## Why this improves frame rate

The previous prototype launched `gpupixel_processor_mp468.exe` for every frame.
That meant every processed frame paid for:

- process startup
- DLL loading
- GPUPixel resource setup
- GLFW/OpenGL context creation

The resident daemon pays most of that once at startup, then only handles the
per-frame image, landmarks, parameters, and output.

## Protocol

The Python server sends one tab-separated line per frame:

```text
PROCESS    image_path    output_path    landmarks_path    mediapipe_landmarks_path
           smoothing    whitening      slim              eye
           lipstick     blusher        acne              eye_bag
           nasolabial   redness        dullness          pores
           nose         eyelid         brow              mouth
           double_chin  neck
```

The daemon responds with:

```text
__GPUPIXEL_DONE__    1
```

or:

```text
__GPUPIXEL_DONE__    0    error message
```

## Frontend tuning

The browser now uploads camera frames as JPEG instead of PNG:

- lower base64 payload size
- faster browser encoding
- faster backend image decode

The processing FPS slider now defaults to 8 FPS and allows up to 15 FPS.
The video processing canvas is capped at 540 px on the longest side, and the
camera request now targets 960x540 instead of 1280x720. This trades some preview
resolution for lower backend latency.

The Python server also warms the daemon during startup, so the first processed
camera frame does not pay the daemon startup cost.

## Remaining bottlenecks

This is smoother, but it is still not the final real-time architecture. The
current path still does per-frame HTTP, base64, disk IO, and PNG output.

The next useful optimizations are:

- keep the GPUPixel filter graph alive across frames, not just the process
- switch HTTP POST to WebSocket and drop stale frames
- send raw RGBA, JPEG, or WebP buffers instead of data URLs
- return JPEG/WebP or a raw texture-backed frame instead of PNG
- move more MP468 post-processing from CPU image loops to GPU shaders
- add landmark temporal smoothing to reduce visual jitter
