const fileInput = document.getElementById("fileInput");
const detectBtn = document.getElementById("detectBtn");
const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const autoPreview = document.getElementById("autoPreview");
const statusEl = document.getElementById("status");
const inputCanvas = document.getElementById("inputCanvas");
const resultImage = document.getElementById("resultImage");
const landmarksBox = document.getElementById("landmarksBox");
const mediapipeBox = document.getElementById("mediapipeBox");
const logBox = document.getElementById("logBox");
const controls = [...document.querySelectorAll("[data-param]")];
const inputCtx = inputCanvas.getContext("2d");

const MODEL_URL = "/vendor/mediapipe/models/face_landmarker.task";
const WASM_URL = "/vendor/mediapipe/tasks-vision/wasm";
const MODULE_URL = "/vendor/mediapipe/tasks-vision/vision_bundle.mjs";

let landmarker = null;
let mediaPipeError = "";
let imageBitmap = null;
let imageDataUrl = "";
let resultDataUrl = "";
let landmarkValues = [];
let mediapipeValues = [];
let autoTimer = 0;
let isProcessing = false;
let pendingProcess = false;

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

const LANDMARK_POINT_COUNT = mapping.length;
const LANDMARK_VALUE_COUNT = LANDMARK_POINT_COUNT * 2;
const MIN_MEDIAPIPE_POINT_COUNT = 468;
const MIN_MEDIAPIPE_VALUE_COUNT = MIN_MEDIAPIPE_POINT_COUNT * 2;

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

function toGpupixelLandmarks(landmarks) {
  const fallback = landmarks[1] || { x: 0.5, y: 0.5 };
  const points = mapping.map((spec) => pointFromSpec(landmarks, spec) || fallback);
  return points.flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function toMediaPipeLandmarks(landmarks) {
  return landmarks
    .slice(0, MIN_MEDIAPIPE_POINT_COUNT)
    .flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function parseLandmarkText(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function updateOutputs() {
  controls.forEach((input) => {
    input.parentElement.querySelector("output").value = Number(input.value).toFixed(1);
  });
}

function paramsFromControls() {
  return Object.fromEntries(
    controls.map((input) => [input.dataset.param, Number(input.value)]),
  );
}

function scheduleAutoProcess(delay = 450) {
  if (!autoPreview?.checked || !imageDataUrl) return;
  window.clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => {
    processImage(false);
  }, delay);
}

function drawImage() {
  if (!imageBitmap) return;
  const maxSide = 1600;
  const scale = Math.min(maxSide / imageBitmap.width, maxSide / imageBitmap.height, 1);
  inputCanvas.width = Math.round(imageBitmap.width * scale);
  inputCanvas.height = Math.round(imageBitmap.height * scale);
  inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);
  inputCtx.drawImage(imageBitmap, 0, 0, inputCanvas.width, inputCanvas.height);
}

function drawLandmarks(values) {
  drawImage();
  inputCtx.save();
  inputCtx.fillStyle = "#53d6a1";
  inputCtx.strokeStyle = "#d3513f";
  inputCtx.lineWidth = 1;
  const radius = values.length > LANDMARK_VALUE_COUNT ? 1.45 : 2.4;
  for (let i = 0; i < values.length; i += 2) {
    const x = values[i] * inputCanvas.width;
    const y = values[i + 1] * inputCanvas.height;
    inputCtx.beginPath();
    inputCtx.arc(x, y, radius, 0, Math.PI * 2);
    inputCtx.fill();
  }
  inputCtx.restore();
}

function detectLandmarks() {
  if (!imageBitmap) {
    setStatus("请先选择图片。");
    return false;
  }
  if (!landmarker) {
    setStatus(mediaPipeError || "MediaPipe 还没有加载完成，请稍后再试。");
    return false;
  }
  const result = landmarker.detect(imageBitmap);
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) {
    setStatus("没有检测到人脸。");
    return false;
  }
  landmarkValues = toGpupixelLandmarks(landmarks);
  mediapipeValues = toMediaPipeLandmarks(landmarks);
  landmarksBox.value = landmarkValues.map((value) => value.toFixed(6)).join(" ");
  mediapipeBox.value = mediapipeValues.map((value) => value.toFixed(6)).join(" ");
  drawLandmarks(mediapipeValues);
  setStatus(`已生成 ${LANDMARK_POINT_COUNT} 个 GPUPixel 点和 ${mediapipeValues.length / 2} 个 MediaPipe 点。`);
  return true;
}

function canvasToPngDataUrl(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas.toDataURL("image/png");
}

async function initMediaPipe() {
  try {
    const { FaceLandmarker, FilesetResolver } = await import(MODULE_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      setStatus("MediaPipe 已加载，GPU 模式。");
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      setStatus("MediaPipe 已加载，CPU 模式。");
    }
    detectBtn.disabled = !imageBitmap;
    if (imageBitmap) {
      landmarkValues = [];
      scheduleAutoProcess(120);
    }
  } catch (error) {
    console.error(error);
    mediaPipeError = `MediaPipe 加载失败：${error.message || error}`;
    setStatus(mediaPipeError);
    detectBtn.disabled = !imageBitmap;
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  imageBitmap?.close?.();
  imageBitmap = await createImageBitmap(file);
  imageDataUrl = canvasToPngDataUrl(imageBitmap);
  resultDataUrl = "";
  landmarkValues = [];
  mediapipeValues = [];
  landmarksBox.value = "";
  mediapipeBox.value = "";
  resultImage.removeAttribute("src");
  logBox.textContent = "";
  drawImage();
  detectBtn.disabled = false;
  processBtn.disabled = false;
  downloadBtn.disabled = true;
  setStatus(`已载入图片：${imageBitmap.width} x ${imageBitmap.height}`);
  scheduleAutoProcess(220);
});

detectBtn.addEventListener("click", () => {
  if (detectLandmarks()) {
    scheduleAutoProcess(120);
  }
});

async function processImage(manual = true) {
  if (!imageDataUrl) return;
  if (isProcessing) {
    pendingProcess = true;
    return;
  }
  if (
    landmarker &&
    (landmarkValues.length !== LANDMARK_VALUE_COUNT ||
      mediapipeValues.length < MIN_MEDIAPIPE_VALUE_COUNT)
  ) {
    setStatus("正在检测关键点...");
    if (!detectLandmarks()) return;
  }
  const parsedLandmarks = parseLandmarkText(landmarksBox.value);
  if (parsedLandmarks.length && parsedLandmarks.length !== LANDMARK_VALUE_COUNT) {
    setStatus(`关键点数量不对：需要 ${LANDMARK_POINT_COUNT} 个点。`);
    logBox.textContent = `landmarks.txt 需要 ${LANDMARK_VALUE_COUNT} 个数字，当前是 ${parsedLandmarks.length} 个。`;
    return;
  }
  const parsedMediapipeLandmarks = parseLandmarkText(mediapipeBox.value);
  if (
    parsedMediapipeLandmarks.length &&
    parsedMediapipeLandmarks.length < MIN_MEDIAPIPE_VALUE_COUNT
  ) {
    setStatus(`MediaPipe 点数量不对：至少需要 ${MIN_MEDIAPIPE_POINT_COUNT} 个点。`);
    logBox.textContent = `mediapipe_468.txt 至少需要 ${MIN_MEDIAPIPE_VALUE_COUNT} 个数字，当前是 ${parsedMediapipeLandmarks.length} 个。`;
    return;
  }
  isProcessing = true;
  processBtn.disabled = true;
  setStatus("正在调用 GPUPixel 处理...");
  logBox.textContent = "";
  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageData: imageDataUrl,
        landmarksText: landmarksBox.value.trim(),
        mediapipeLandmarksText: mediapipeBox.value.trim(),
        params: paramsFromControls(),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.log || payload.error || "处理失败");
    }
    resultDataUrl = payload.imageData;
    resultImage.src = resultDataUrl;
    logBox.textContent = payload.log || "";
    downloadBtn.disabled = false;
    setStatus("GPUPixel 处理完成。");
  } catch (error) {
    console.error(error);
    logBox.textContent = error.message || String(error);
    setStatus("处理失败，查看日志。");
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
    if (pendingProcess) {
      pendingProcess = false;
      scheduleAutoProcess(80);
    }
  }
}

processBtn.addEventListener("click", () => {
  processImage(true);
});

downloadBtn.addEventListener("click", () => {
  if (!resultDataUrl) return;
  const link = document.createElement("a");
  link.href = resultDataUrl;
  link.download = "gpupixel-result.png";
  link.click();
});

controls.forEach((input) =>
  input.addEventListener("input", () => {
    updateOutputs();
    scheduleAutoProcess();
  }),
);
landmarksBox.addEventListener("input", () => {
  landmarkValues = parseLandmarkText(landmarksBox.value);
  scheduleAutoProcess();
});
mediapipeBox.addEventListener("input", () => {
  mediapipeValues = parseLandmarkText(mediapipeBox.value);
  if (mediapipeValues.length >= MIN_MEDIAPIPE_VALUE_COUNT) {
    drawLandmarks(mediapipeValues.slice(0, MIN_MEDIAPIPE_VALUE_COUNT));
  }
  scheduleAutoProcess();
});
updateOutputs();
initMediaPipe();
