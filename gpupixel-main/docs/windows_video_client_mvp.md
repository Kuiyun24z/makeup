# Windows Video Client MVP

## Goal

This is the first native Windows client prototype for GPUPixel video beauty.
It avoids the web demo path entirely:

```text
Windows camera
  -> Media Foundation RGB32 frame
  -> CPU BGRA to RGBA copy
  -> GPUPixel SourceRawData
  -> lipstick / blusher / reshape / beauty filters
  -> SinkRawData
  -> OpenGL window preview
```

There is no browser, HTTP, base64, Python server, temporary image file, or PNG
round trip in this path.

The client corrects the common front-camera selfie mirror before sending frames
into GPUPixel.

## Build

```powershell
cd "C:\Users\huaweiuser\Desktop\GPUPixel"
cmd.exe /d /s /c "call ""C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"" -arch=x64 && cmake --build build\windows-nmake --config Release --target gpupixel_video_client"
```

Output:

```text
build/windows-nmake/out/bin/gpupixel_video_client.exe
```

## Run

```powershell
cd "C:\Users\huaweiuser\Desktop\GPUPixel"
.\start_video_client.cmd
```

Optional static GPUPixel 111-point landmark file:

```powershell
.\start_video_client.cmd "C:\path\to\landmarks.txt"
```

If no landmark file is provided, the client still runs smoothing and whitening.
Face reshape, lipstick, and blusher need live or matching landmarks to align
with the face.

## Controls

The ImGui panel in the window exposes:

- smoothing
- whitening
- face slim
- eye enlarge
- lipstick
- blusher

Press `Esc` to close the window.

## Current limitation

This first version does not embed MediaPipe C++ yet. The reason is deliberate:
the main goal of this slice is to prove that the native video path is smooth
without the web/Python/image-file pipeline.

Next slice:

```text
Windows camera
  -> MediaPipe C++ or ONNX landmark engine
  -> 468-to-111 mapping and 468 local effects
  -> GPUPixel client render
```
