const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const autoPreview = document.getElementById("autoPreview");
const statusEl = document.getElementById("status");
const inputCanvas = document.getElementById("inputCanvas");
const resultImage = document.getElementById("resultImage");
const logBox = document.getElementById("logBox");
const video = document.getElementById("cameraVideo");
const controls = [...document.querySelectorAll("[data-param]")];
const settings = [...document.querySelectorAll("[data-setting]")];

const inputCtx = inputCanvas.getContext("2d");
const frameCanvas = document.createElement("canvas");
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

const MODEL_URL = "/vendor/mediapipe/models/face_landmarker.task";
const WASM_URL = "/vendor/mediapipe/tasks-vision/wasm";
const MODULE_URL = "/vendor/mediapipe/tasks-vision/vision_bundle.mjs";

let landmarker = null;
let mediaPipeError = "";
let stream = null;
let running = false;
let processing = false;
let lastProcessAt = 0;
let lastVideoTime = -1;
let lastGpupixelLandmarks = [];
let lastMediaPipeLandmarks = [];

const faceOval = [
  109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176,
  148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389, 251,
  284, 332,
];

const mapping = [
  ...faceOval,
  70, 63, 105, 66, 107,
  336, 296, 334, 293, 300,
  [168, 6], 197, 195, 5, 98, 94, 2, 326, 327,
  33, 160, 159, 133, 153, 145,
  362, 386, 387, 263, 373, 374,
  46, 53, 52, 65,
  276, 283, 282, 295,
  159, 145, [33, 133, 159, 145],
  386, 374, [362, 263, 386, 374],
  133, 362, 49, 279, 205, 425,
  61, 185, 40, 0, 269, 409, 291,
  375, 321, 17, 91, 146,
  78, 82, 13, 312, 308,
  318, 14, 88,
  [33, 133, 159, 145], [362, 263, 386, 374], [13, 14],
  [105, 66, 107], [334, 293, 336], 205, 425,
];

const LANDMARK_VALUE_COUNT = mapping.length * 2;
const MEDIAPIPE_POINT_COUNT = 468;
const MEDIAPIPE_VALUE_COUNT = MEDIAPIPE_POINT_COUNT * 2;
const CORRECT_CAMERA_MIRROR = true;

function setStatus(text) {
  statusEl.textContent = text;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function pointFromSpec(landmarks, spec) {
  if (Array.isArray(spec)) {
    const points = spec.map((index) => landmarks[index]).filter(Boolean);
    if (!points.length) return null;
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  const point = landmarks[spec];
  return point ? { x: point.x, y: point.y } : null;
}

function normalizeCameraPoint(point) {
  return {
    x: CORRECT_CAMERA_MIRROR ? 1 - point.x : point.x,
    y: point.y,
  };
}

function toGpupixelLandmarks(landmarks) {
  const fallback = landmarks[1] || { x: 0.5, y: 0.5 };
  const points = mapping.map((spec) =>
    normalizeCameraPoint(pointFromSpec(landmarks, spec) || fallback),
  );
  return points.flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function toMediaPipeLandmarks(landmarks) {
  return landmarks
    .slice(0, MEDIAPIPE_POINT_COUNT)
    .map(normalizeCameraPoint)
    .flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function valuesToText(values) {
  return values.map((value) => value.toFixed(6)).join(" ");
}

function updateOutputs() {
  [...controls, ...settings].forEach((input) => {
    const value = Number(input.value);
    const digits = input.dataset.setting ? 0 : 1;
    input.parentElement.querySelector("output").value = value.toFixed(digits);
  });
}

function paramsFromControls() {
  return Object.fromEntries(
    controls.map((input) => [input.dataset.param, Number(input.value)]),
  );
}

function targetFps() {
  const input = document.querySelector("[data-setting='fps']");
  return Math.max(1, Number(input?.value || 4));
}

function resizeCanvases() {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const maxSide = 540;
  const scale = Math.min(maxSide / width, maxSide / height, 1);
  inputCanvas.width = Math.round(width * scale);
  inputCanvas.height = Math.round(height * scale);
  frameCanvas.width = inputCanvas.width;
  frameCanvas.height = inputCanvas.height;
}

function drawInputFrame() {
  frameCtx.save();
  frameCtx.setTransform(1, 0, 0, 1, 0, 0);
  frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
  if (CORRECT_CAMERA_MIRROR) {
    frameCtx.translate(frameCanvas.width, 0);
    frameCtx.scale(-1, 1);
  }
  frameCtx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  frameCtx.restore();
  inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);
  inputCtx.drawImage(frameCanvas, 0, 0);
}

function drawLandmarks(values) {
  inputCtx.save();
  inputCtx.fillStyle = "#53d6a1";
  for (let i = 0; i < values.length; i += 2) {
    const x = values[i] * inputCanvas.width;
    const y = values[i + 1] * inputCanvas.height;
    inputCtx.beginPath();
    inputCtx.arc(x, y, 1.35, 0, Math.PI * 2);
    inputCtx.fill();
  }
  inputCtx.restore();
}

function detectCurrentFrame(now) {
  if (!landmarker || !video.videoWidth || video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, now);
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) {
    lastGpupixelLandmarks = [];
    lastMediaPipeLandmarks = [];
    return;
  }
  lastGpupixelLandmarks = toGpupixelLandmarks(landmarks);
  lastMediaPipeLandmarks = toMediaPipeLandmarks(landmarks);
}

async function processCurrentFrame(now) {
  if (
    processing ||
    !autoPreview.checked ||
    lastGpupixelLandmarks.length !== LANDMARK_VALUE_COUNT ||
    lastMediaPipeLandmarks.length !== MEDIAPIPE_VALUE_COUNT
  ) {
    return;
  }
  const interval = 1000 / targetFps();
  if (now - lastProcessAt < interval) return;

  processing = true;
  lastProcessAt = now;
  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageData: frameCanvas.toDataURL("image/jpeg", 0.82),
        landmarksText: valuesToText(lastGpupixelLandmarks),
        mediapipeLandmarksText: valuesToText(lastMediaPipeLandmarks),
        params: paramsFromControls(),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.log || payload.error || "处理失败");
    }
    resultImage.src = payload.imageData;
    logBox.textContent = payload.log || "";
    setStatus(`视频处理中：${targetFps()} FPS 目标，当前帧已返回。`);
  } catch (error) {
    console.error(error);
    logBox.textContent = error.message || String(error);
    setStatus("视频帧处理失败，查看日志。");
  } finally {
    processing = false;
  }
}

function loop(now) {
  if (!running) return;
  drawInputFrame();
  detectCurrentFrame(now);
  if (lastMediaPipeLandmarks.length) {
    drawLandmarks(lastMediaPipeLandmarks);
  }
  processCurrentFrame(now);
  requestAnimationFrame(loop);
}

async function initMediaPipe() {
  try {
    const { FaceLandmarker, FilesetResolver } = await import(MODULE_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      setStatus("MediaPipe 已加载，GPU 视频模式。");
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      setStatus("MediaPipe 已加载，CPU 视频模式。");
    }
    startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    mediaPipeError = `MediaPipe 加载失败：${error.message || error}`;
    setStatus(mediaPipeError);
  }
}

async function startCamera() {
  if (!landmarker) {
    setStatus(mediaPipeError || "MediaPipe 还没有加载完成。");
    return;
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  resizeCanvases();
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  resultImage.removeAttribute("src");
  logBox.textContent = "";
  setStatus("摄像头已开启，正在检测视频关键点。");
  requestAnimationFrame(loop);
}

function stopCamera() {
  running = false;
  processing = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("视频已停止。");
}

startBtn.addEventListener("click", () => {
  startCamera().catch((error) => {
    console.error(error);
    setStatus(`摄像头启动失败：${error.message || error}`);
  });
});
stopBtn.addEventListener("click", stopCamera);

[...controls, ...settings].forEach((input) => {
  input.addEventListener("input", updateOutputs);
});

window.addEventListener("resize", () => {
  if (running) resizeCanvases();
});

updateOutputs();
startBtn.disabled = true;
initMediaPipe();
