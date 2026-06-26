// Beauty Agent web demo — stage 1: color sampling, pose gating, photo upload.
console.info("Beauty Agent app.js build: 6B per-pixel lip recolor (2026-06-11)");
import { matchCatalogItem, parseMakeupCommand } from "./command_parser.mjs";
import {
  createVoiceInput,
  VoskWasmVoiceInput,
  VoskWasmWakeWordInput,
  WebSpeechWakeWordInput,
} from "./speech_adapters.mjs";
import { interpolateLandmarks, LandmarkSmoother } from "./tracking.mjs";

const MEDIAPIPE_VERSION = "0.10.21";
const MEDIAPIPE_VENDOR_ROOT = "/vendor/mediapipe";
const MEDIAPIPE_CDN_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const MEDIAPIPE_SOURCES = [
  {
    name: "local",
    moduleUrl: `${MEDIAPIPE_VENDOR_ROOT}/tasks-vision/vision_bundle.mjs`,
    wasmUrl: `${MEDIAPIPE_VENDOR_ROOT}/tasks-vision/wasm`,
    modelUrl: `${MEDIAPIPE_VENDOR_ROOT}/models/face_landmarker.task`,
  },
  {
    name: "cdn",
    moduleUrl: `${MEDIAPIPE_CDN_ROOT}/vision_bundle.mjs`,
    wasmUrl: `${MEDIAPIPE_CDN_ROOT}/wasm`,
    modelUrl:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
  },
];
const DEBUG_OVERLAY = new URLSearchParams(window.location.search).get("debug") === "1";
const HEALTH_POLL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 3_000;
const ANALYSIS_INTERVAL_MS = 220;
const LANDMARK_SLOW_FRAME_MS = 25;
const LANDMARK_RECOVER_FRAME_MS = 18;
const LANDMARK_SLOW_FRAME_LIMIT = 4;
const LANDMARK_RECOVER_FRAME_LIMIT = 45;
const LANDMARK_INTERPOLATION_MS = 48;

const TEXT = {
  runtimeChecking: "Ollama 检查中",
  runtimeReady: (model) => `Ollama ${model} 就绪`,
  runtimeMissing: "Ollama 未连接",
  backendMissing: "后端未连接",
  cameraWaiting: "等待摄像头",
  cameraRunning: "摄像头运行中",
  cameraStopped: "摄像头已停止",
  cameraUnavailable: "摄像头不可用",
  imageMode: "照片分析模式",
  searchingFace: "寻找面部",
  noDetector: "关键点模型不可用",
  generating: "生成中...",
  noAdvice: "没有生成建议。",
  faceDetected: "已检测",
  faceMissing: "未检测",
  stable: "稳定",
  adjusting: "调整中",
  dark: "偏暗",
  bright: "偏亮",
  normal: "正常",
  centered: "居中",
  offCenter: "偏离中心",
  tooFar: "距离偏远",
  tooClose: "距离偏近",
  unknown: "-",
  poseFront: "正脸",
  poseGatedShape: "转正脸后判定",
  poseGatedEyes: "姿态偏转，暂不判定",
  poseGatedFocus: "先正对镜头再看妆容重点",
  colorLowConfidence: "光线或姿态欠佳，色彩判定仅供参考。",
};

const video = document.getElementById("video");
const photo = document.getElementById("photo");
const viewer = document.getElementById("viewer");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const cameraState = document.getElementById("cameraState");
const runtimeStatus = document.getElementById("runtimeStatus");
const landmarkStatus = document.getElementById("landmarkStatus");
const adviceForm = document.getElementById("adviceForm");
const adviceBtn = document.getElementById("adviceBtn");
const adviceOutput = document.getElementById("adviceOutput");
const questionInput = document.getElementById("question");
const voiceBtn = document.getElementById("voiceBtn");
const voiceStatus = document.getElementById("voiceStatus");
const wakeToggle = document.getElementById("wakeToggle");
const wakeStatus = document.getElementById("wakeStatus");
const expandBtn = document.getElementById("expandBtn");
const panelEl = document.querySelector(".panel");

const faceMetric = document.getElementById("faceMetric");
const lightMetric = document.getElementById("lightMetric");
const poseMetric = document.getElementById("poseMetric");
const headPoseMetric = document.getElementById("headPoseMetric");
const stableMetric = document.getElementById("stableMetric");
const brightnessValue = document.getElementById("brightnessValue");
const sharpnessValue = document.getElementById("sharpnessValue");
const faceSizeValue = document.getElementById("faceSizeValue");
const offsetValue = document.getElementById("offsetValue");
const landmarkCountValue = document.getElementById("landmarkCountValue");
const faceShapeValue = document.getElementById("faceShapeValue");
const eyeBalanceValue = document.getElementById("eyeBalanceValue");
const browEyeValue = document.getElementById("browEyeValue");
const lipShapeValue = document.getElementById("lipShapeValue");
const makeupFocusValue = document.getElementById("makeupFocusValue");
const skinSwatch = document.getElementById("skinSwatch");
const skinToneValue = document.getElementById("skinToneValue");
const lipSwatch = document.getElementById("lipSwatch");
const lipColorValue = document.getElementById("lipColorValue");
const colorConfidence = document.getElementById("colorConfidence");
const makeupEnabled = document.getElementById("makeupEnabled");
const makeupPreset = document.getElementById("makeupPreset");
const smoothLevel = document.getElementById("smoothLevel");
const lipLevel = document.getElementById("lipLevel");
const blushLevel = document.getElementById("blushLevel");
const browLevel = document.getElementById("browLevel");
const eyeshadowLevel = document.getElementById("eyeshadowLevel");
const currentCosmeticName = document.getElementById("currentCosmeticName");
const pixelFreeStatus = document.getElementById("pixelFreeStatus");
const pixelFreeSnapshotBtn = document.getElementById("pixelFreeSnapshotBtn");

const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
const colorCanvas = document.createElement("canvas");
const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
const uploadedCanvas = document.createElement("canvas");
const uploadedCtx = uploadedCanvas.getContext("2d", { willReadFrequently: true });
const lipMaskCanvas = document.createElement("canvas");
const lipMaskCtx = lipMaskCanvas.getContext("2d", { willReadFrequently: true });
const lipWorkCanvas = document.createElement("canvas");
const lipWorkCtx = lipWorkCanvas.getContext("2d", { willReadFrequently: true });

const OUTER_LIP_INDEXES = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const INNER_LIP_INDEXES = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const LEFT_BROW_TOP = [70, 63, 105, 66, 107];
const LEFT_BROW_BOTTOM = [46, 53, 52, 65, 55];
const RIGHT_BROW_TOP = [300, 293, 334, 296, 336];
const RIGHT_BROW_BOTTOM = [276, 283, 282, 295, 285];
const LEFT_EYE_TOP_ARC = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const RIGHT_EYE_TOP_ARC = [263, 466, 388, 387, 386, 385, 384, 398, 362];

let stream = null;
let browserDetector = null;
let faceLandmarker = null;
let detectorMode = "loading";
let mode = "camera"; // "camera" | "image"
let imageFaceData; // cached detection for the uploaded still image
let lastCenter = null;
let liveFaceData = null;
let previousLiveFaceData = null;
let liveFaceTimestamp = 0;
let landmarkFrameSkip = 0;
let landmarkSlowFrames = 0;
let landmarkFastFrames = 0;
let landmarkFrameCounter = 0;
let landmarkDelegate = "CPU";
const landmarkSmoother = new LandmarkSmoother({ minCutoff: 1.25, beta: 0.08, dCutoff: 1.0 });
let currentAnalysis = {
  faceDetected: false,
  detector: "loading",
  lighting: "unknown",
  framing: "unknown",
  stable: false,
  landmarkCount: 0,
};
let adviceAbortController = null;
let streamTextTarget = null;
let streamCursor = null;
let streamHint = null;
let analysisTimer = null;
let healthTimer = null;
let renderFrameId = null;
let runtimeStatusSignature = "";
let cosmeticsCatalog = [];
let commandMakeup = {
  lip: null,
  blush: null,
  brow: null,
  eyeshadow: null,
};
let voiceInput = null;
let voiceMode = "unavailable";
let voicePointerId = null;
let voiceClickActive = false;
let voiceFinalText = "";
let suppressVoiceClick = false;
let wakeInput = null;
let wakeMode = "unavailable";
let wakeEnabled = false;
let wakeCapturing = false;
let wakeCommandTimer = null;
let wakeCommandVoiceInput = null;
let wakeActiveCommandInput = null;

const MAKEUP_PRESETS = {
  daily: { lip: "176, 82, 92", blush: "221, 119, 127", warmth: 1.02 },
  commute: { lip: "178, 64, 94", blush: "205, 102, 128", warmth: 1.0 },
  sweet: { lip: "222, 104, 102", blush: "239, 145, 130", warmth: 1.04 },
};

/* ---------------- source abstraction (camera | uploaded image) ---------------- */

function activeSource() {
  if (mode === "image" && uploadedCanvas.width) {
    return { el: uploadedCanvas, viewEl: photo, width: uploadedCanvas.width, height: uploadedCanvas.height };
  }
  return { el: video, viewEl: video, width: video.videoWidth, height: video.videoHeight };
}

function startAnalysisLoop() {
  if (analysisTimer) clearInterval(analysisTimer);
  analysisTimer = setInterval(analyzeFrame, ANALYSIS_INTERVAL_MS);
}

function startRenderLoop() {
  if (renderFrameId || mode !== "camera" || !stream) return;
  renderFrameId = requestAnimationFrame(renderLoop);
}

function stopRenderLoop() {
  if (renderFrameId) cancelAnimationFrame(renderFrameId);
  renderFrameId = null;
}

function renderLoop() {
  renderFrameId = null;
  if (mode !== "camera" || !stream) return;
  const src = activeSource();
  if (src.width && src.height) {
    trackFaceForRender(src, performance.now());
    syncCanvas(src);
    renderOverlay(currentAnalysis, src);
  }
  renderFrameId = requestAnimationFrame(renderLoop);
}

function renderCurrentOverlay() {
  const src = activeSource();
  if (!src.width || !src.height) return;
  syncCanvas(src);
  renderOverlay(currentAnalysis, src);
}

function resetTrackingState() {
  liveFaceData = null;
  previousLiveFaceData = null;
  liveFaceTimestamp = 0;
  landmarkFrameSkip = 0;
  landmarkSlowFrames = 0;
  landmarkFastFrames = 0;
  landmarkFrameCounter = 0;
  landmarkSmoother.reset();
}

/* ---------------- init ---------------- */

async function init() {
  applyStaticText();
  await Promise.all([loadCosmeticsCatalog(), pollHealth(), checkPixelFreeStatus(), initLandmarkModel()]);
  initVoiceInput();
  initWakeWordInput();
  startHealthPolling();
  startAnalysisLoop();
}

function applyStaticText() {
  runtimeStatus.textContent = TEXT.runtimeChecking;
  cameraState.textContent = TEXT.cameraWaiting;
  questionInput.value = "我现在适合什么日常妆？";
  renderAdvice("打开摄像头或上传照片后生成建议。");
  updateCurrentMakeupDisplay();
}

function initVoiceInput() {
  voiceInput = createVoiceInput();
  voiceMode = voiceInput.kind;
  if (voiceMode === "web-speech") {
    setVoiceStatus("语音输入已就绪：按住说话，松开后自动提交。");
    if (voiceBtn) voiceBtn.disabled = false;
    return;
  }
  voiceInput.prepare?.().then((status) => {
    if (status?.reason === "vosk-wasm-not-vendored") {
      setVoiceStatus("当前浏览器未检测到 Web Speech；Vosk WASM 接口已预留，待本地模型接入。");
    }
  });
  if (voiceBtn) voiceBtn.disabled = true;
}

async function initWakeWordInput() {
  if (!wakeToggle) return;
  wakeToggle.disabled = true;
  setWakeStatus("检测待机能力", false);

  const localWake = new VoskWasmWakeWordInput();
  const localStatus = await localWake.prepare();
  if (localStatus.ok) {
    wakeInput = localWake;
    wakeMode = "vosk-wasm";
    const localVoice = new VoskWasmVoiceInput();
    const localVoiceStatus = await localVoice.prepare();
    wakeCommandVoiceInput = localVoiceStatus.ok ? localVoice : null;
    wakeToggle.disabled = false;
    setWakeStatus("默认关闭：本地 Vosk", false);
    return;
  }

  if (WebSpeechWakeWordInput.isSupported()) {
    wakeInput = new WebSpeechWakeWordInput();
    wakeMode = "web-speech-prototype";
    wakeToggle.disabled = false;
    setWakeStatus("默认关闭：Web Speech 原型", false);
    return;
  }

  wakeInput = null;
  wakeMode = "unavailable";
  wakeToggle.disabled = true;
  setWakeStatus("不可用：缺少 Vosk / Web Speech", false);
}

function setWakeStatus(text, listening = false) {
  if (wakeStatus) wakeStatus.textContent = text;
  wakeToggle?.closest(".wake-toggle")?.classList.toggle("is-listening", listening);
}

async function loadCosmeticsCatalog() {
  try {
    const res = await fetch("/cosmetics.json");
    cosmeticsCatalog = await res.json();
  } catch (error) {
    console.warn("Cosmetics catalog failed to load.", error);
    cosmeticsCatalog = [];
  }
}

async function createFaceLandmarkerFromSource(source, delegate) {
  const { FaceLandmarker, FilesetResolver } = await import(source.moduleUrl);
  const vision = await FilesetResolver.forVisionTasks(source.wasmUrl);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: source.modelUrl, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
}

async function initLandmarkModel() {
  landmarkStatus.textContent = "关键点模型加载中";
  landmarkStatus.className = "pill status-warn";

  for (const source of MEDIAPIPE_SOURCES) {
    try {
      const { FaceLandmarker, FilesetResolver } = await import(source.moduleUrl);
      const vision = await FilesetResolver.forVisionTasks(source.wasmUrl);
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: source.modelUrl, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
      landmarkDelegate = "GPU";
      detectorMode = `mediapipe-face-landmarker-${source.name}-gpu`;
      landmarkStatus.textContent =
        source.name === "local" ? "MediaPipe 本地关键点已就绪" : "MediaPipe 关键点已就绪";
      landmarkStatus.className = source.name === "local" ? "pill status-good" : "pill status-warn";
      return;
    } catch (error) {
      console.warn(`MediaPipe Face Landmarker failed to load from ${source.name}.`, error);
      try {
        faceLandmarker = await createFaceLandmarkerFromSource(source, "CPU");
        landmarkDelegate = "CPU";
        detectorMode = `mediapipe-face-landmarker-${source.name}-cpu`;
        landmarkStatus.textContent =
          source.name === "local" ? "MediaPipe 本地关键点已就绪（CPU）" : "MediaPipe 关键点已就绪（CPU）";
        landmarkStatus.className = "pill status-warn";
        return;
      } catch (cpuError) {
        console.warn(`MediaPipe Face Landmarker CPU fallback failed from ${source.name}.`, cpuError);
      }
    }
  }

  if ("FaceDetector" in window) {
    try {
      browserDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      detectorMode = "browser-face-detector";
      landmarkStatus.textContent = "已降级为浏览器人脸框";
      landmarkStatus.className = "pill status-warn";
      return;
    } catch (error) {
      console.warn("Browser FaceDetector failed to initialize.", error);
    }
  }

  detectorMode = "not-available";
  landmarkStatus.textContent = "关键点模型不可用";
  landmarkStatus.className = "pill status-bad";
}

async function pollHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/health", { signal: controller.signal });
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    if (!features.includes("advice_stream")) {
      setRuntimeStatus("backend_stale", "后端版本旧，请重启服务", "pill status-bad");
      return;
    }
    setRuntimeStatus(
      data.ok ? `ollama_ok:${data.model}` : "ollama_missing",
      data.ok ? TEXT.runtimeReady(data.model) : TEXT.runtimeMissing,
      data.ok ? "pill status-good" : "pill status-warn",
    );
  } catch {
    setRuntimeStatus("backend_missing", TEXT.backendMissing, "pill status-bad");
  } finally {
    clearTimeout(timeout);
  }
}

function startHealthPolling() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(pollHealth, HEALTH_POLL_MS);
}

function setRuntimeStatus(signature, text, className) {
  if (runtimeStatusSignature === signature) return;
  runtimeStatusSignature = signature;
  runtimeStatus.textContent = text;
  runtimeStatus.className = className;
}

async function checkPixelFreeStatus() {
  if (!pixelFreeStatus) return;

  try {
    const res = await fetch("/api/pixelfree/status");
    const data = await res.json();
    if (!data.ok) {
      pixelFreeStatus.textContent = `缺资源: ${data.missing?.join(", ") || "unknown"}`;
      pixelFreeStatus.className = "status-bad";
      return;
    }
    if (data.demoBuilt) {
      pixelFreeStatus.textContent = "可用：快照模式";
      pixelFreeStatus.className = "status-good";
      if (pixelFreeSnapshotBtn) pixelFreeSnapshotBtn.disabled = false;
      return;
    }
    if (data.buildReady) {
      pixelFreeStatus.textContent = "资源齐全，可编译";
      pixelFreeStatus.className = "status-good";
      return;
    }
    pixelFreeStatus.textContent = "资源齐全，缺 CMake/MSVC";
    pixelFreeStatus.className = "status-warn";
  } catch {
    pixelFreeStatus.textContent = "状态未知";
    pixelFreeStatus.className = "status-warn";
  }
  if (pixelFreeSnapshotBtn) pixelFreeSnapshotBtn.disabled = true;
}

/* ---------------- camera & upload ---------------- */

async function startCamera() {
  try {
    resetTrackingState();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    mode = "camera";
    imageFaceData = undefined;
    viewer.classList.remove("image-mode");
    photo.style.filter = "none";
    video.srcObject = stream;
    await video.play();
    cameraState.textContent = TEXT.cameraRunning;
    startRenderLoop();
    analyzeFrame();
  } catch (error) {
    cameraState.textContent = TEXT.cameraUnavailable;
    renderAdvice(`无法启动摄像头：${error.message}`);
  }
}

function stopCamera() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  video.srcObject = null;
  video.style.filter = "none";
  stopRenderLoop();
  resetTrackingState();
  clearOverlay();
  if (mode === "camera") cameraState.textContent = TEXT.cameraStopped;
}

async function handleUpload(event) {
  const file = event.target.files?.[0];
  fileInput.value = "";
  if (!file) return;

  let img;
  try {
    img = await loadImageFile(file);
  } catch {
    renderAdvice("无法读取这张图片，请换一张 JPG/PNG 再试。");
    return;
  }

  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  uploadedCanvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  uploadedCanvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  uploadedCtx.drawImage(img, 0, 0, uploadedCanvas.width, uploadedCanvas.height);
  photo.src = uploadedCanvas.toDataURL("image/jpeg", 0.9);

  stopCamera();
  mode = "image";
  imageFaceData = undefined;
  lastCenter = null;
  resetTrackingState();
  video.style.filter = "none";
  viewer.classList.add("image-mode");
  cameraState.textContent = TEXT.imageMode;
  analyzeFrame();
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

/* ---------------- analysis loop ---------------- */

async function analyzeFrame() {
  const src = activeSource();
  if (!src.width || !src.height) return;

  syncCanvas(src);
  const stats = sampleStats(src);
  const faceData = await detectFaceData(src);
  currentAnalysis = deriveAnalysis(stats, faceData, src);
  updateCameraState(currentAnalysis);
  if (mode === "image") renderCurrentOverlay();
  renderMetrics(currentAnalysis);
}

async function detectFaceData(src) {
  if (faceLandmarker) {
    if (mode === "image" && imageFaceData !== undefined) return imageFaceData;
    if (mode === "camera") return liveFaceData || trackFaceForRender(src, performance.now());
    const data = detectLandmarksNow(src, performance.now(), { smooth: false });
    if (mode === "image") imageFaceData = data;
    return data;
  }

  if (browserDetector && mode === "camera") {
    try {
      const faces = await browserDetector.detect(video);
      const face = faces[0] || null;
      return face ? { type: "box", boundingBox: face.boundingBox } : null;
    } catch {
      return null;
    }
  }

  return null;
}

function trackFaceForRender(src, now) {
  if (!faceLandmarker || mode !== "camera" || document.hidden) return liveFaceData;
  landmarkFrameCounter += 1;

  if (landmarkFrameSkip > 0 && landmarkFrameCounter % (landmarkFrameSkip + 1) !== 0) {
    const interpolated = interpolatedLiveFaceData(now);
    if (interpolated) applyLiveFaceData(interpolated, src);
    return interpolated || liveFaceData;
  }

  const started = performance.now();
  const data = detectLandmarksNow(src, now, { smooth: true });
  updateLandmarkCadence(performance.now() - started);
  previousLiveFaceData = liveFaceData;
  liveFaceData = data;
  liveFaceTimestamp = now;
  applyLiveFaceData(data, src);
  return data;
}

function detectLandmarksNow(src, now, { smooth = true } = {}) {
  let result;
  try {
    result = faceLandmarker.detectForVideo(src.el, now);
  } catch (error) {
    console.warn("MediaPipe detectForVideo failed.", error);
    return null;
  }
  const rawLandmarks = result.faceLandmarks?.[0] || null;
  const blendshapes = result.faceBlendshapes?.[0]?.categories || [];
  if (!rawLandmarks) {
    landmarkSmoother.reset();
    return null;
  }
  const landmarks = smooth ? landmarkSmoother.smooth(rawLandmarks, now) : rawLandmarks;
  return { type: "landmarks", landmarks, blendshapes, delegate: landmarkDelegate };
}

function interpolatedLiveFaceData(now) {
  if (!previousLiveFaceData || !liveFaceData) return liveFaceData;
  const landmarks = interpolateLandmarks(
    previousLiveFaceData.landmarks,
    liveFaceData.landmarks,
    (now - liveFaceTimestamp) / LANDMARK_INTERPOLATION_MS,
  );
  return landmarks ? { ...liveFaceData, landmarks } : liveFaceData;
}

function updateLandmarkCadence(durationMs) {
  if (durationMs > LANDMARK_SLOW_FRAME_MS) {
    landmarkSlowFrames += 1;
    landmarkFastFrames = 0;
  } else if (durationMs < LANDMARK_RECOVER_FRAME_MS) {
    landmarkFastFrames += 1;
    landmarkSlowFrames = 0;
  } else {
    landmarkSlowFrames = 0;
    landmarkFastFrames = 0;
  }

  if (landmarkSlowFrames >= LANDMARK_SLOW_FRAME_LIMIT && landmarkFrameSkip < 2) {
    landmarkFrameSkip += 1;
    landmarkSlowFrames = 0;
  }
  if (landmarkFastFrames >= LANDMARK_RECOVER_FRAME_LIMIT && landmarkFrameSkip > 0) {
    landmarkFrameSkip -= 1;
    landmarkFastFrames = 0;
  }
}

function applyLiveFaceData(faceData, src) {
  if (!faceData) {
    currentAnalysis = {
      ...currentAnalysis,
      faceDetected: false,
      box: null,
      landmarks: [],
      landmarkCount: 0,
      rawFaceData: null,
    };
    return;
  }

  const view = src.viewEl.getBoundingClientRect();
  const geometry = faceGeometry(faceData, view, src);
  const pose = estimatePose(faceData, src);
  currentAnalysis = {
    ...currentAnalysis,
    faceDetected: true,
    detector: detectorMode,
    landmarkDelegate,
    landmarkFrameSkip,
    box: geometry?.box || null,
    landmarks: geometry?.landmarks || [],
    landmarkCount: geometry?.landmarks?.length || 0,
    faceRatio: Number((geometry?.faceRatio || 0).toFixed(3)),
    offset: geometry?.offset || null,
    pose,
    rawFaceData: faceData,
  };
}

function syncCanvas(src) {
  const rect = src.viewEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(rect.width * dpr);
  overlay.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function sampleStats(src) {
  const w = 96;
  const h = Math.max(54, Math.round((src.height / src.width) * w));
  sampleCanvas.width = w;
  sampleCanvas.height = h;
  sampleCtx.drawImage(src.el, 0, 0, w, h);
  const data = sampleCtx.getImageData(0, 0, w, h).data;
  let luminance = 0;
  let gradient = 0;
  let count = 0;

  const luma = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = 1; y < h; y += 1) {
    for (let x = 1; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const here = luma(i);
      const left = luma((y * w + x - 1) * 4);
      const up = luma(((y - 1) * w + x) * 4);
      luminance += here;
      gradient += Math.abs(here - left) + Math.abs(here - up);
      count += 1;
    }
  }

  return { brightness: luminance / count, sharpness: gradient / count };
}

function deriveAnalysis(stats, faceData, src) {
  const view = src.viewEl.getBoundingClientRect();
  const lighting = stats.brightness < 72 ? "dark" : stats.brightness > 190 ? "bright" : "normal";
  const clarity = stats.sharpness < 8 ? "soft" : stats.sharpness > 18 ? "sharp" : "normal";
  const geometry = faceData ? faceGeometry(faceData, view, src) : null;
  const pose = estimatePose(faceData, src);
  const rawColors = sampleRegionColors(faceData, src);
  const colors = describeColors(rawColors, lighting, pose);
  let framing = "unknown";
  let stable = false;

  if (geometry) {
    framing =
      Math.abs(geometry.offset.x) < 0.12 && Math.abs(geometry.offset.y) < 0.16
        ? "centered"
        : "off_center";
    if (geometry.faceRatio < 0.08) framing = "too_far";
    if (geometry.faceRatio > 0.48) framing = "too_close";
    stable =
      mode === "image"
        ? true
        : lastCenter
          ? Math.hypot(geometry.center.x - lastCenter.x, geometry.center.y - lastCenter.y) < 0.035
          : false;
    lastCenter = geometry.center;
  } else {
    lastCenter = null;
  }

  return {
    faceDetected: Boolean(faceData),
    source: mode,
    detector: detectorMode,
    landmarkDelegate,
    landmarkFrameSkip,
    lighting,
    clarity,
    framing,
    stable,
    brightness: Math.round(stats.brightness),
    sharpness: Number(stats.sharpness.toFixed(1)),
    faceRatio: Number((geometry?.faceRatio || 0).toFixed(3)),
    offset: geometry?.offset || null,
    box: geometry?.box || null,
    landmarks: geometry?.landmarks || [],
    landmarkCount: geometry?.landmarks?.length || 0,
    pose,
    featureSummary: summarizeFeatures(geometry?.landmarks || [], geometry, pose, colors),
    rawFaceData: faceData,
    timestamp: new Date().toISOString(),
  };
}

/* ---------------- pose estimation & gating ---------------- */

function estimatePose(faceData, src) {
  if (!faceData || faceData.type !== "landmarks") return null;
  const lm = faceData.landmarks;
  const px = (i) => (lm[i] ? { x: lm[i].x * src.width, y: lm[i].y * src.height } : null);
  const avgPx = (indexes) => {
    const points = indexes.map(px).filter(Boolean);
    if (!points.length) return null;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  };

  const nose = px(1);
  const left = px(234);
  const right = px(454);
  const chin = px(152);
  const leftEye = avgPx([33, 133, 159, 145]);
  const rightEye = avgPx([362, 263, 386, 374]);
  if (!nose || !left || !right || !chin || !leftEye || !rightEye) return null;

  const dL = Math.hypot(nose.x - left.x, nose.y - left.y);
  const dR = Math.hypot(nose.x - right.x, nose.y - right.y);
  const yaw = (dR - dL) / Math.max(1, dR + dL);
  const rollDeg = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const pitchRatio = (nose.y - eyeMidY) / Math.max(1, chin.y - eyeMidY);

  const yawOk = Math.abs(yaw) < 0.15;
  const rollOk = Math.abs(rollDeg) < 12;
  const pitchOk = pitchRatio > 0.3 && pitchRatio < 0.58;

  let label = TEXT.poseFront;
  if (!yawOk) label = "面部侧转";
  else if (!rollOk) label = "头部倾斜";
  else if (!pitchOk) label = pitchRatio <= 0.3 ? "抬头角度大" : "低头角度大";

  return {
    ok: yawOk && rollOk && pitchOk,
    label,
    yaw: Number(yaw.toFixed(3)),
    rollDeg: Number(rollDeg.toFixed(1)),
    pitchRatio: Number(pitchRatio.toFixed(3)),
  };
}

/* ---------------- region color sampling ---------------- */

function sampleRegionColors(faceData, src) {
  if (!faceData || faceData.type !== "landmarks") return null;
  const lm = faceData.landmarks;
  const w = 320;
  const h = Math.max(120, Math.round((src.height / src.width) * w));
  colorCanvas.width = w;
  colorCanvas.height = h;
  colorCtx.drawImage(src.el, 0, 0, w, h);
  let data;
  try {
    data = colorCtx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const pt = (i) => (lm[i] ? { x: lm[i].x * w, y: lm[i].y * h } : null);
  const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);

  const faceWidth = dist(pt(234), pt(454)) || w * 0.35;
  const skinRadius = Math.max(3, faceWidth * 0.07);
  const lipRadius = Math.max(2, faceWidth * 0.045);

  const skinSamples = [
    discAverage(data, w, h, pt(117), skinRadius), // left cheek
    discAverage(data, w, h, pt(346), skinRadius), // right cheek
    discAverage(data, w, h, mid(pt(10), pt(151)), skinRadius), // mid forehead
  ].filter(Boolean);
  const lipSamples = [
    discAverage(data, w, h, mid(pt(14), pt(17)), lipRadius), // lower lip body
    discAverage(data, w, h, mid(pt(0), pt(13)), lipRadius * 0.8), // upper lip body
  ].filter(Boolean);

  if (!skinSamples.length) return null;
  return {
    skin: averageRgb(skinSamples),
    lip: lipSamples.length ? averageRgb(lipSamples) : null,
  };
}

function discAverage(data, w, h, center, radius) {
  if (!center) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(center.x - radius));
  const x1 = Math.min(w - 1, Math.ceil(center.x + radius));
  const y0 = Math.max(0, Math.floor(center.y - radius));
  const y1 = Math.min(h - 1, Math.ceil(center.y + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

function averageRgb(samples) {
  return {
    r: samples.reduce((s, c) => s + c.r, 0) / samples.length,
    g: samples.reduce((s, c) => s + c.g, 0) / samples.length,
    b: samples.reduce((s, c) => s + c.b, 0) / samples.length,
  };
}

function describeColors(rawColors, lighting, pose) {
  if (!rawColors) return null;
  const reliable = lighting === "normal" && (!pose || pose.ok);
  const skin = classifySkin(rawColors.skin);
  const lip = rawColors.lip ? classifyLip(rawColors.lip) : null;
  return {
    confidence: reliable ? "normal" : "low",
    skin: { ...skin, hex: rgbToHex(rawColors.skin) },
    lip: lip ? { ...lip, hex: rgbToHex(rawColors.lip) } : null,
  };
}

function classifySkin(rgb) {
  const luma = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  const warmth = (rgb.r - rgb.b) / Math.max(1, luma);
  let undertone = "中性调";
  let undertoneKey = "neutral";
  if (warmth > 0.4) {
    undertone = "暖调";
    undertoneKey = "warm";
  } else if (warmth < 0.24) {
    undertone = "冷调";
    undertoneKey = "cool";
  }
  const depth = luma > 180 ? "偏浅" : luma > 140 ? "自然" : luma > 105 ? "小麦" : "偏深";
  return {
    label: `${undertone} · ${depth}`,
    undertone: undertoneKey,
    depth,
    warmth: Number(warmth.toFixed(3)),
    luma: Math.round(luma),
  };
}

function classifyLip(rgb) {
  const { h, s, v } = rgbToHsv(rgb);
  let family = "自然唇色";
  if (h >= 330 || h < 10) family = s > 0.42 ? "正红调" : "粉调";
  else if (h < 30) family = "橘红调";
  else if (h < 55) family = "橘调";
  else if (h >= 260 && h < 330) family = "浆果调";
  const depth = v < 0.45 ? "偏深" : v > 0.74 ? "偏浅" : "中等";
  return {
    label: `${family} · ${depth}`,
    family,
    depth,
    hue: Math.round(h),
    saturation: Number(s.toFixed(2)),
    value: Number(v.toFixed(2)),
  };
}

function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? d / max : 0, v: max };
}

function rgbToHex({ r, g, b }) {
  const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/* ---------------- geometry ---------------- */

function faceGeometry(faceData, view, src) {
  if (faceData.type === "landmarks") {
    const mapped = faceData.landmarks.map((point) => normalizedPointToView(point, view, src));
    const box = boxFromPoints(mapped);
    return geometryFromBox(box, mapped, view);
  }

  const scale = viewScale(view, src);
  const b = faceData.boundingBox;
  const box = {
    x: b.x * scale.scale + scale.offsetX,
    y: b.y * scale.scale + scale.offsetY,
    width: b.width * scale.scale,
    height: b.height * scale.scale,
  };
  return geometryFromBox(box, [], view);
}

function normalizedPointToView(point, view, src) {
  const scale = viewScale(view, src);
  return {
    x: point.x * src.width * scale.scale + scale.offsetX,
    y: point.y * src.height * scale.scale + scale.offsetY,
    z: point.z || 0,
  };
}

function viewScale(view, src) {
  const scale = Math.max(view.width / src.width, view.height / src.height);
  return {
    scale,
    offsetX: (view.width - src.width * scale) / 2,
    offsetY: (view.height - src.height * scale) / 2,
  };
}

function boxFromPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function geometryFromBox(box, landmarks, view) {
  const center = {
    x: (box.x + box.width / 2) / view.width,
    y: (box.y + box.height / 2) / view.height,
  };
  return {
    box,
    center,
    offset: { x: center.x - 0.5, y: center.y - 0.5 },
    landmarks,
    faceRatio: (box.width * box.height) / (view.width * view.height),
  };
}

/* ---------------- beauty feature summary ---------------- */

function summarizeFeatures(landmarks, geometry, pose, colors) {
  if (!landmarks.length) return null;
  const gated = Boolean(pose && !pose.ok);
  const sample = (indexes) => indexes.map((index) => landmarks[index]).filter(Boolean);
  const average = (points) => {
    if (!points.length) return null;
    return {
      x: Number((points.reduce((sum, point) => sum + point.x, 0) / points.length).toFixed(1)),
      y: Number((points.reduce((sum, point) => sum + point.y, 0) / points.length).toFixed(1)),
    };
  };
  const point = (index) => landmarks[index] || null;
  const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
  const height = (a, b) => Math.abs((a?.y || 0) - (b?.y || 0));
  const ratio = (value, base) => (base ? Number((value / base).toFixed(3)) : 0);
  const labelByRatio = (value, low, high, labels) => {
    if (!value) return labels.unknown;
    if (value < low) return labels.low;
    if (value > high) return labels.high;
    return labels.normal;
  };

  const top = point(10);
  const chin = point(152);
  const leftCheek = point(234);
  const rightCheek = point(454);
  const leftJaw = point(172);
  const rightJaw = point(397);
  const leftTemple = point(127);
  const rightTemple = point(356);

  const faceHeight = distance(top, chin) || geometry?.box?.height || 0;
  const cheekWidth = distance(leftCheek, rightCheek) || geometry?.box?.width || 0;
  const jawWidth = distance(leftJaw, rightJaw);
  const templeWidth = distance(leftTemple, rightTemple);
  const faceLengthRatio = ratio(faceHeight, cheekWidth);
  const jawToCheek = ratio(jawWidth, cheekWidth);
  const templeToCheek = ratio(templeWidth, cheekWidth);

  let faceShape = "均衡脸型";
  if (faceLengthRatio > 1.42 && jawToCheek < 0.82) faceShape = "偏长椭圆";
  else if (faceLengthRatio < 1.18 && jawToCheek > 0.78) faceShape = "偏短圆润";
  else if (jawToCheek > 0.88) faceShape = "下颌存在感强";
  else if (templeToCheek > 0.95 && jawToCheek < 0.72) faceShape = "上庭更开阔";

  const leftEyeOuter = point(33);
  const leftEyeInner = point(133);
  const rightEyeInner = point(362);
  const rightEyeOuter = point(263);
  const leftEyeTop = point(159);
  const leftEyeBottom = point(145);
  const rightEyeTop = point(386);
  const rightEyeBottom = point(374);
  const leftBrow = average(sample([70, 63, 105, 66, 107]));
  const rightBrow = average(sample([336, 296, 334, 293, 300]));
  const leftEyeCenter = average(sample([33, 133, 159, 145]));
  const rightEyeCenter = average(sample([362, 263, 386, 374]));

  const leftEyeWidth = distance(leftEyeOuter, leftEyeInner);
  const rightEyeWidth = distance(rightEyeInner, rightEyeOuter);
  const eyeWidthAvg = (leftEyeWidth + rightEyeWidth) / 2;
  const eyeGap = distance(leftEyeInner, rightEyeInner);
  const eyeGapRatio = ratio(eyeGap, eyeWidthAvg);
  const leftEyeOpen = ratio(height(leftEyeTop, leftEyeBottom), leftEyeWidth);
  const rightEyeOpen = ratio(height(rightEyeTop, rightEyeBottom), rightEyeWidth);
  const browEyeSpace = ratio(
    ((leftBrow && leftEyeCenter ? Math.abs(leftBrow.y - leftEyeCenter.y) : 0) +
      (rightBrow && rightEyeCenter ? Math.abs(rightBrow.y - rightEyeCenter.y) : 0)) /
      2,
    faceHeight,
  );

  const eyeSpacingLabel = labelByRatio(eyeGapRatio, 0.88, 1.2, {
    low: "眼距偏近",
    normal: "眼距均衡",
    high: "眼距偏开",
    unknown: "眼距未知",
  });
  const browEyeLabel = labelByRatio(browEyeSpace, 0.085, 0.14, {
    low: "眉眼距离偏近",
    normal: "眉眼距离适中",
    high: "眉眼距离偏开",
    unknown: "眉眼距离未知",
  });
  const eyeOpenLabel =
    (leftEyeOpen + rightEyeOpen) / 2 < 0.23 ? "眼部纵向偏柔和" : "眼部轮廓较清晰";

  const lipLeft = point(61);
  const lipRight = point(291);
  const upperLip = point(13);
  const lowerLip = point(14);
  const lipWidth = distance(lipLeft, lipRight);
  const lipHeight = height(upperLip, lowerLip);
  const lipToFace = ratio(lipWidth, cheekWidth);
  const lipFullness = ratio(lipHeight, lipWidth);
  const lipLabel =
    lipFullness > 0.13 ? "唇部饱满度较高" : lipFullness < 0.075 ? "唇部线条偏薄" : "唇部比例自然";

  let makeupFocus = [];
  if (faceShape === "偏长椭圆") makeupFocus.push("横向腮红");
  if (faceShape === "偏短圆润") makeupFocus.push("轻修容拉长");
  if (faceShape === "下颌存在感强") makeupFocus.push("下颌柔化");
  if (eyeSpacingLabel === "眼距偏开") makeupFocus.push("内眼角提亮");
  if (eyeSpacingLabel === "眼距偏近") makeupFocus.push("眼尾拉长");
  if (browEyeLabel === "眉眼距离偏近") makeupFocus.push("浅色眼影减压");
  if (browEyeLabel === "眉眼距离偏开") makeupFocus.push("眉下阴影衔接");
  if (lipLabel === "唇部线条偏薄") makeupFocus.push("唇峰和中部提亮");
  if (!makeupFocus.length) makeupFocus.push("自然均衡妆");
  if (gated) makeupFocus = [TEXT.poseGatedFocus];

  return {
    gated,
    pose: pose
      ? { label: pose.label, ok: pose.ok, yaw: pose.yaw, rollDeg: pose.rollDeg, pitchRatio: pose.pitchRatio }
      : null,
    colors,
    face: {
      label: gated ? TEXT.poseGatedShape : faceShape,
      lengthWidthRatio: faceLengthRatio,
      jawToCheekRatio: jawToCheek,
      templeToCheekRatio: templeToCheek,
    },
    eyes: {
      label: gated ? TEXT.poseGatedEyes : `${eyeSpacingLabel}，${eyeOpenLabel}`,
      spacing: gated ? TEXT.poseGatedEyes : eyeSpacingLabel,
      openness: eyeOpenLabel,
      browEyeSpace: gated ? TEXT.poseGatedEyes : browEyeLabel,
      eyeGapRatio,
      leftEyeOpen,
      rightEyeOpen,
      rollDeg: pose?.rollDeg ?? null,
    },
    lips: {
      label: lipLabel,
      widthToFaceRatio: lipToFace,
      fullnessRatio: lipFullness,
      center: average(sample([13, 14, 61, 291])),
    },
    nose: { center: average(sample([1, 2, 98, 327])) },
    makeupFocus,
  };
}

/* ---------------- overlay & makeup preview ---------------- */

function renderOverlay(analysis, src) {
  const settings = makeupSettings();
  applyBeautyFilter(settings, src);
  if (!settings.enabled && !DEBUG_OVERLAY) {
    clearOverlay();
    return;
  }

  clearOverlay();
  renderMakeup(analysis, src, settings);
  if (!DEBUG_OVERLAY) return;

  const view = src.viewEl.getBoundingClientRect();
  ctx.lineWidth = 2;

  if (analysis.box) {
    ctx.strokeStyle = "#42d6b7";
    ctx.fillStyle = "rgba(66, 214, 183, 0.1)";
    const b = analysis.box;
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.strokeRect(b.x, b.y, b.width, b.height);
  }

  if (analysis.landmarks.length) {
    ctx.fillStyle = "#f3d46b";
    for (const point of analysis.landmarks) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFeatureLine([33, 133, 159, 145], analysis.landmarks, "#79d8ff");
    drawFeatureLine([362, 263, 386, 374], analysis.landmarks, "#79d8ff");
    drawFeatureLine([...OUTER_LIP_INDEXES, OUTER_LIP_INDEXES[0]], analysis.landmarks, "#ff8fb7");
    drawFeatureLine([...INNER_LIP_INDEXES, INNER_LIP_INDEXES[0]], analysis.landmarks, "#ffd27d");
    drawFeatureLine([10, 1, 152], analysis.landmarks, "#ffffff");
  }

  ctx.strokeStyle = "rgba(255,255,255,0.46)";
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(view.width / 2, 0);
  ctx.lineTo(view.width / 2, view.height);
  ctx.moveTo(0, view.height / 2);
  ctx.lineTo(view.width, view.height / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function updateCameraState(analysis) {
  if (!analysis.faceDetected) {
    cameraState.textContent =
      detectorMode === "not-available"
        ? TEXT.noDetector
        : mode === "image"
          ? "照片中未检测到面部"
          : TEXT.searchingFace;
    return;
  }
  if (analysis.pose && !analysis.pose.ok) {
    cameraState.textContent = `${analysis.pose.label}，建议正对镜头`;
    return;
  }
  cameraState.textContent =
    mode === "image" ? TEXT.imageMode : readableFraming(analysis.framing);
}

function drawFeatureLine(indexes, landmarks, color) {
  const points = indexes.map((index) => landmarks[index]).filter(Boolean);
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function renderMakeup(analysis, src, settings) {
  if (!settings.enabled || !analysis.landmarks.length) return;

  const view = src.viewEl.getBoundingClientRect();
  ctx.save();
  drawEyeshadow(analysis.landmarks, settings, src, view);
  drawBrows(analysis.landmarks, settings, src, view);
  drawLipstick(analysis.landmarks, settings, src, view);
  drawBlush(analysis.landmarks, analysis.box, settings);
  ctx.restore();
}

function makeupSettings() {
  const preset = MAKEUP_PRESETS[makeupPreset.value] || MAKEUP_PRESETS.daily;
  const lipItem = commandMakeup.lip;
  const blushItem = commandMakeup.blush;
  return {
    enabled: makeupEnabled.checked,
    preset: makeupPreset.value,
    lipColor: lipItem ? rgbList(lipItem.rgb) : preset.lip,
    lipFinish: lipItem?.finish || "satin",
    blushColor: blushItem ? rgbList(blushItem.rgb) : preset.blush,
    browColor: commandMakeup.brow ? rgbList(commandMakeup.brow.rgb) : null,
    eyeshadowColor: commandMakeup.eyeshadow ? rgbList(commandMakeup.eyeshadow.rgb) : null,
    warmth: preset.warmth,
    smooth: Number(smoothLevel.value) / 100,
    lip: Number(lipLevel.value) / 100,
    blush: Number(blushLevel.value) / 100,
    brow: Number(browLevel.value) / 100,
    eyeshadow: Number(eyeshadowLevel.value) / 100,
  };
}

function rgbList(rgb) {
  return Array.isArray(rgb) ? rgb.slice(0, 3).join(", ") : "176, 82, 92";
}

function applyBeautyFilter(settings, src) {
  if (!settings.enabled) {
    src.viewEl.style.filter = "none";
    return;
  }
  const brightness = 1 + settings.smooth * 0.08;
  const contrast = 1 - settings.smooth * 0.05;
  const saturate = settings.warmth + settings.smooth * 0.06;
  const blur = settings.smooth * 0.45;
  src.viewEl.style.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) blur(${blur}px)`;
}

function drawLipstick(landmarks, settings, src, view) {
  if (settings.lip <= 0) return;

  const outer = indexedPoints(landmarks, OUTER_LIP_INDEXES);
  const inner = indexedPoints(landmarks, INNER_LIP_INDEXES);
  if (outer.length < 12) return;

  const box = bounds(outer);
  if (box.width < 8 || box.height < 4) return;
  const feather = Math.max(1.5, box.width * 0.025);
  const pad = Math.ceil(feather * 3 + 2);
  const roiX = Math.floor(box.x - pad);
  const roiY = Math.floor(box.y - pad);
  const roiW = Math.ceil(box.width + pad * 2);
  const roiH = Math.ceil(box.height + pad * 2);

  const m = lipMaskCtx;

  // 1+2. Pull the real source pixels under the ROI (inverse of the cover
  //    mapping) at device-pixel resolution, so the recolored patch stays as
  //    sharp as the video on scaled (hiDPI) displays.
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.ceil(roiW * dpr);
  const devH = Math.ceil(roiH * dpr);
  const scale = viewScale(view, src);
  const sx = (roiX - scale.offsetX) / scale.scale;
  const sy = (roiY - scale.offsetY) / scale.scale;
  const sw = roiW / scale.scale;
  const sh = roiH / scale.scale;
  lipWorkCanvas.width = devW;
  lipWorkCanvas.height = devH;
  try {
    lipWorkCtx.drawImage(src.el, sx, sy, sw, sh, 0, 0, devW, devH);
  } catch {
    return;
  }

  // Mask is rebuilt at device resolution too, so its feather matches.
  lipMaskCanvas.width = devW;
  lipMaskCanvas.height = devH;
  m.save();
  m.scale(dpr, dpr);
  m.translate(-roiX, -roiY);
  m.filter = `blur(${feather * dpr}px)`;
  m.fillStyle = "#fff";
  fillClosedPath(m, outer);
  if (inner.length >= 12) {
    const openRatio = mouthOpenRatio(landmarks, box.width);
    const cutout = expandPolygon(inner, 1.06 + Math.min(0.3, openRatio * 1.8));
    m.globalCompositeOperation = "destination-out";
    m.filter = `blur(${Math.max(1, feather * 0.6) * dpr}px)`;
    fillClosedPath(m, cutout);
    m.globalCompositeOperation = "source-over";
  }
  m.filter = "none";
  m.restore();

  let frame;
  let maskData;
  try {
    frame = lipWorkCtx.getImageData(0, 0, devW, devH);
    maskData = m.getImageData(0, 0, devW, devH);
  } catch {
    return;
  }

  // 3. Per-pixel recolor: keep the pixel's luminance (lip texture, shine,
  //    shadows), replace chroma with the target color, shaped by finish.
  //    Compensate for the CSS beauty filter on the video element so the
  //    patch brightness matches its surroundings, and blend a little of the
  //    original chroma back in so the color is not perfectly flat.
  const target = parseRgbColor(settings.lipColor);
  const targetLuma = Math.max(
    0.08,
    (0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b) / 255,
  );
  const brightnessComp = 1 + settings.smooth * 0.08;
  const coverage = Math.min(0.8, 0.35 + settings.lip * 0.45);
  const keepChroma = 0.14;
  const data = frame.data;
  const mask = maskData.data;
  for (let i = 0; i < data.length; i += 4) {
    const maskAlpha = mask[i + 3];
    if (maskAlpha === 0) {
      data[i + 3] = 0;
      continue;
    }
    const srcR = data[i];
    const srcG = data[i + 1];
    const srcB = data[i + 2];
    const luma = (0.2126 * srcR + 0.7152 * srcG + 0.0722 * srcB) / 255;
    const shaped = finishCurve(luma, settings.lipFinish) * brightnessComp;
    const gain = shaped / targetLuma;
    data[i] = Math.min(255, target.r * gain * (1 - keepChroma) + srcR * brightnessComp * keepChroma);
    data[i + 1] = Math.min(255, target.g * gain * (1 - keepChroma) + srcG * brightnessComp * keepChroma);
    data[i + 2] = Math.min(255, target.b * gain * (1 - keepChroma) + srcB * brightnessComp * keepChroma);
    data[i + 3] = Math.round(maskAlpha * coverage);
  }
  lipWorkCtx.putImageData(frame, 0, 0);

  // 4. Composite onto the live overlay (alpha mixes the recolored lip with
  //    the real video below, so texture stays continuous at the edges).
  ctx.drawImage(lipWorkCanvas, roiX, roiY, roiW, roiH);
}

function parseRgbColor(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return { r: 176, g: 82, b: 92 };
  }
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function finishCurve(luma, finish) {
  if (finish === "matte") {
    return 0.22 + luma * 0.6;
  }
  if (finish === "soft-matte" || finish === "velvet") {
    return 0.15 + luma * 0.72;
  }
  if (finish === "gloss") {
    return luma > 0.72 ? Math.min(1.35, luma * 1.45) : luma * 0.92;
  }
  // satin / cream: keep the natural luminance, slightly lifted shadows
  return 0.06 + luma * 0.92;
}

function fillClosedPath(target, points) {
  if (points.length < 3) return;
  target.beginPath();
  target.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) target.lineTo(point.x, point.y);
  target.closePath();
  target.fill();
}

function mouthOpenRatio(landmarks, lipWidth) {
  const top = landmarks[13];
  const bottom = landmarks[14];
  if (!top || !bottom || !lipWidth) return 0;
  return Math.hypot(top.x - bottom.x, top.y - bottom.y) / lipWidth;
}

function expandPolygon(points, factor) {
  const center = averagePoint(points);
  if (!center) return points;
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
}

function paintRegion({
  points,
  color,
  coverage,
  keepChroma,
  finish,
  src,
  view,
  feather,
  topFade = false,
  tone = "recolor",
  darkenBlend = 0.7,
}) {
  if (!color || points.length < 4) return;
  const box = bounds(points);
  if (box.width < 6 || box.height < 3) return;
  const pad = Math.ceil(feather * 3 + 2);
  const roiX = Math.floor(box.x - pad);
  const roiY = Math.floor(box.y - pad);
  const roiW = Math.ceil(box.width + pad * 2);
  const roiH = Math.ceil(box.height + pad * 2);
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.ceil(roiW * dpr);
  const devH = Math.ceil(roiH * dpr);

  const scale = viewScale(view, src);
  const sx = (roiX - scale.offsetX) / scale.scale;
  const sy = (roiY - scale.offsetY) / scale.scale;
  const sw = roiW / scale.scale;
  const sh = roiH / scale.scale;
  lipWorkCanvas.width = devW;
  lipWorkCanvas.height = devH;
  try {
    lipWorkCtx.drawImage(src.el, sx, sy, sw, sh, 0, 0, devW, devH);
  } catch {
    return;
  }

  lipMaskCanvas.width = devW;
  lipMaskCanvas.height = devH;
  const m = lipMaskCtx;
  m.save();
  m.scale(dpr, dpr);
  m.translate(-roiX, -roiY);
  m.filter = `blur(${feather * dpr}px)`;
  m.fillStyle = "#fff";
  fillClosedPath(m, points);
  m.filter = "none";
  m.restore();
  if (topFade) {
    m.save();
    m.globalCompositeOperation = "destination-in";
    const fade = m.createLinearGradient(0, 0, 0, devH);
    fade.addColorStop(0, "rgba(255,255,255,0.1)");
    fade.addColorStop(0.55, "rgba(255,255,255,0.65)");
    fade.addColorStop(1, "rgba(255,255,255,1)");
    m.fillStyle = fade;
    m.fillRect(0, 0, devW, devH);
    m.restore();
  }

  let frame;
  let maskData;
  try {
    frame = lipWorkCtx.getImageData(0, 0, devW, devH);
    maskData = m.getImageData(0, 0, devW, devH);
  } catch {
    return;
  }

  const target = parseRgbColor(color);
  const targetLuma = Math.max(
    0.08,
    (0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b) / 255,
  );
  const data = frame.data;
  const mask = maskData.data;
  for (let i = 0; i < data.length; i += 4) {
    const maskAlpha = mask[i + 3];
    if (maskAlpha === 0) {
      data[i + 3] = 0;
      continue;
    }
    const srcR = data[i];
    const srcG = data[i + 1];
    const srcB = data[i + 2];
    const luma = (0.2126 * srcR + 0.7152 * srcG + 0.0722 * srcB) / 255;
    // "recolor" keeps the pixel's own luminance (lipstick-style hue swap);
    // "darken" pulls luminance toward the target so brows/eyeshadow add
    // depth instead of a barely-visible hue shift.
    const shaped =
      tone === "darken"
        ? Math.min(luma * 1.05, luma + (targetLuma - luma) * darkenBlend)
        : finishCurve(luma, finish);
    const gain = shaped / targetLuma;
    data[i] = Math.min(255, target.r * gain * (1 - keepChroma) + srcR * keepChroma);
    data[i + 1] = Math.min(255, target.g * gain * (1 - keepChroma) + srcG * keepChroma);
    data[i + 2] = Math.min(255, target.b * gain * (1 - keepChroma) + srcB * keepChroma);
    data[i + 3] = Math.round(maskAlpha * coverage);
  }
  lipWorkCtx.putImageData(frame, 0, 0);
  ctx.drawImage(lipWorkCanvas, roiX, roiY, roiW, roiH);
}

function browPolygon(landmarks, topIndexes, bottomIndexes) {
  const top = indexedPoints(landmarks, topIndexes);
  const bottom = indexedPoints(landmarks, bottomIndexes);
  if (top.length < 3 || bottom.length < 3) return null;
  return [...top, ...bottom.reverse()];
}

function drawBrows(landmarks, settings, src, view) {
  if (!settings.browColor || settings.brow <= 0) return;
  const sides = [
    [LEFT_BROW_TOP, LEFT_BROW_BOTTOM],
    [RIGHT_BROW_TOP, RIGHT_BROW_BOTTOM],
  ];
  for (const [topIndexes, bottomIndexes] of sides) {
    const polygon = browPolygon(landmarks, topIndexes, bottomIndexes);
    if (!polygon) continue;
    paintRegion({
      points: polygon,
      color: settings.browColor,
      coverage: Math.min(0.8, 0.3 + settings.brow * 0.5),
      keepChroma: 0.3,
      finish: "matte",
      tone: "darken",
      darkenBlend: 0.75,
      src,
      view,
      feather: Math.max(1, bounds(polygon).width * 0.05),
    });
  }
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function lidPolygon(landmarks, lashIndexes, browBottomIndexes) {
  const lash = indexedPoints(landmarks, lashIndexes);
  const brow = indexedPoints(landmarks, browBottomIndexes);
  if (lash.length < 5 || brow.length < 3) return null;
  const topBoundary = brow.map((browPoint, index) => {
    const fraction = index / (brow.length - 1);
    const lashPoint = lash[Math.round(fraction * (lash.length - 1))];
    return lerpPoint(lashPoint, browPoint, 0.55);
  });
  return [...lash, ...topBoundary.reverse()];
}

function drawEyeshadow(landmarks, settings, src, view) {
  if (!settings.eyeshadowColor || settings.eyeshadow <= 0) return;
  const sides = [
    [LEFT_EYE_TOP_ARC, LEFT_BROW_BOTTOM],
    [RIGHT_EYE_TOP_ARC, RIGHT_BROW_BOTTOM],
  ];
  for (const [lashIndexes, browIndexes] of sides) {
    const polygon = lidPolygon(landmarks, lashIndexes, browIndexes);
    if (!polygon) continue;
    paintRegion({
      points: polygon,
      color: settings.eyeshadowColor,
      coverage: Math.min(0.7, 0.25 + settings.eyeshadow * 0.5),
      keepChroma: 0.22,
      finish: "satin",
      tone: "darken",
      darkenBlend: 0.6,
      src,
      view,
      feather: Math.max(2, bounds(polygon).width * 0.1),
      topFade: true,
    });
  }
}

function drawBlush(landmarks, box, settings) {
  if (settings.blush <= 0 || !box) return;

  const leftCheek = averagePoint(indexedPoints(landmarks, [117, 118, 119, 123, 187, 205]));
  const rightCheek = averagePoint(indexedPoints(landmarks, [346, 347, 348, 352, 411, 425]));
  const radiusX = Math.max(28, box.width * 0.13);
  const radiusY = Math.max(18, box.height * 0.07);
  const alpha = 0.12 + settings.blush * 0.2;

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  drawBlushSpot(leftCheek, radiusX, radiusY, settings.blushColor, alpha, -0.18);
  drawBlushSpot(rightCheek, radiusX, radiusY, settings.blushColor, alpha, 0.18);
  ctx.restore();
}

function drawBlushSpot(center, radiusX, radiusY, color, alpha, rotation) {
  if (!center) return;
  const gradient = ctx.createRadialGradient(center.x, center.y, 1, center.x, center.y, radiusX);
  gradient.addColorStop(0, `rgba(${color}, ${alpha})`);
  gradient.addColorStop(0.72, `rgba(${color}, ${alpha * 0.42})`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  ctx.fill();
}

function indexedPoints(landmarks, indexes) {
  return indexes.map((index) => landmarks[index]).filter(Boolean);
}

function averagePoint(points) {
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function bounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

/* ---------------- metrics rendering ---------------- */

function renderMetrics(analysis) {
  faceMetric.textContent = analysis.faceDetected ? TEXT.faceDetected : TEXT.faceMissing;
  faceMetric.className = analysis.faceDetected ? "status-good" : "status-warn";
  lightMetric.textContent = readableLighting(analysis.lighting);
  lightMetric.className = analysis.lighting === "normal" ? "status-good" : "status-warn";
  poseMetric.textContent = readableFraming(analysis.framing);
  headPoseMetric.textContent = analysis.pose ? analysis.pose.label : TEXT.unknown;
  headPoseMetric.className = analysis.pose ? (analysis.pose.ok ? "status-good" : "status-warn") : "";
  stableMetric.textContent = analysis.faceDetected
    ? analysis.stable
      ? TEXT.stable
      : TEXT.adjusting
    : TEXT.unknown;
  brightnessValue.textContent = `${analysis.brightness}`;
  sharpnessValue.textContent = `${analysis.sharpness}`;
  faceSizeValue.textContent = analysis.faceDetected ? `${Math.round(analysis.faceRatio * 100)}%` : "-";
  offsetValue.textContent = analysis.offset
    ? `${analysis.offset.x.toFixed(2)}, ${analysis.offset.y.toFixed(2)}`
    : "-";
  landmarkCountValue.textContent = `${analysis.landmarkCount}`;
  renderBeautyFeatures(analysis.featureSummary);
}

function renderBeautyFeatures(featureSummary) {
  if (!featureSummary) {
    faceShapeValue.textContent = "-";
    eyeBalanceValue.textContent = "-";
    browEyeValue.textContent = "-";
    lipShapeValue.textContent = "-";
    makeupFocusValue.textContent = "-";
    renderColors(null);
    return;
  }

  faceShapeValue.textContent = featureSummary.face?.label || "-";
  eyeBalanceValue.textContent = featureSummary.eyes?.label || "-";
  browEyeValue.textContent = featureSummary.eyes?.browEyeSpace || "-";
  lipShapeValue.textContent = featureSummary.lips?.label || "-";
  makeupFocusValue.textContent = featureSummary.makeupFocus?.join(" / ") || "-";
  renderColors(featureSummary.colors);
}

function renderColors(colors) {
  if (!colors) {
    skinSwatch.style.background = "rgba(255,255,255,0.08)";
    lipSwatch.style.background = "rgba(255,255,255,0.08)";
    skinToneValue.textContent = "-";
    lipColorValue.textContent = "-";
    colorConfidence.hidden = true;
    return;
  }

  skinSwatch.style.background = colors.skin.hex;
  skinToneValue.textContent = colors.skin.label;
  if (colors.lip) {
    lipSwatch.style.background = colors.lip.hex;
    lipColorValue.textContent = colors.lip.label;
  } else {
    lipSwatch.style.background = "rgba(255,255,255,0.08)";
    lipColorValue.textContent = "-";
  }
  colorConfidence.hidden = colors.confidence !== "low";
  colorConfidence.textContent = TEXT.colorLowConfidence;
}

function readableLighting(value) {
  return { dark: TEXT.dark, bright: TEXT.bright, normal: TEXT.normal }[value] || TEXT.unknown;
}

function readableFraming(value) {
  return {
    centered: TEXT.centered,
    off_center: TEXT.offCenter,
    too_far: TEXT.tooFar,
    too_close: TEXT.tooClose,
    unknown: TEXT.unknown,
  }[value] || TEXT.unknown;
}

/* ---------------- advice ---------------- */

async function requestPixelFreeSnapshot() {
  if (mode !== "camera" || !video.videoWidth || !video.videoHeight) {
    renderAdvice("PixelFree 快照需要摄像头画面，请先开启摄像头。");
    return;
  }

  pixelFreeSnapshotBtn.disabled = true;
  const previousText = pixelFreeSnapshotBtn.textContent;
  pixelFreeSnapshotBtn.textContent = "启动中...";

  try {
    const image = captureVideoJpeg();
    const res = await fetch("/api/pixelfree/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "PixelFree 快照失败");
    renderAdvice("PixelFree 原生窗口已启动。这个窗口显示的是当前摄像头快照经过 PixelFree SDK 处理后的结果。");
  } catch (error) {
    renderAdvice(`PixelFree 快照失败：${error.message}`);
  } finally {
    pixelFreeSnapshotBtn.disabled = false;
    pixelFreeSnapshotBtn.textContent = previousText;
  }
}

function captureVideoJpeg() {
  const targetWidth = 720;
  const targetHeight = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const captureCtx = canvas.getContext("2d");

  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = targetWidth / targetHeight;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = Math.round(video.videoHeight * targetRatio);
    sourceX = Math.round((video.videoWidth - sourceWidth) / 2);
  } else {
    sourceHeight = Math.round(video.videoWidth / targetRatio);
    sourceY = Math.round((video.videoHeight - sourceHeight) / 2);
  }

  captureCtx.translate(targetWidth, 0);
  captureCtx.scale(-1, 1);
  captureCtx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function renderAdvice(text) {
  renderAdviceShell();
  const card = createAdviceCard("提示", "plain-card");
  const body = document.createElement("p");
  body.textContent = String(text || TEXT.noAdvice);
  card.append(body);
  adviceOutput.append(card);
}

function consumeMakeupCommand(text) {
  const command = parseMakeupCommand(text, cosmeticsCatalog);
  if (command.type === "none") return false;

  if (command.type === "apply") {
    applyCatalogItem(command.item);
    renderCommandFeedback("试妆已更新", [command.message, "你也可以继续输入“口红深一点”“口红浅一点”或“卸妆”。"]);
    return true;
  }

  if (command.type === "adjust") {
    adjustMakeupIntensity(command.target, command.delta);
    renderCommandFeedback("试妆强度已调整", [command.message]);
    return true;
  }

  if (command.type === "clear") {
    makeupEnabled.checked = false;
    renderCurrentOverlay();
    updateCurrentMakeupDisplay();
    renderCommandFeedback("已卸妆", [command.message]);
    return true;
  }

  if (command.type === "restore") {
    makeupEnabled.checked = true;
    commandMakeup = { lip: null, blush: null, brow: null, eyeshadow: null };
    renderCurrentOverlay();
    updateCurrentMakeupDisplay();
    renderCommandFeedback("已恢复", [command.message]);
    return true;
  }

  if (command.type === "unknownColor") {
    renderCommandFeedback("色库未收录", [command.message]);
    return true;
  }

  return false;
}

const CATEGORY_CONTROLS = {
  lip: () => lipLevel,
  blush: () => blushLevel,
  brow: () => browLevel,
  eyeshadow: () => eyeshadowLevel,
};

function applyCatalogItem(item) {
  if (!item || !CATEGORY_CONTROLS[item.category]) return;
  makeupEnabled.checked = true;
  commandMakeup = { ...commandMakeup, [item.category]: item };
  const control = CATEGORY_CONTROLS[item.category]();
  control.value = Math.round(Number(item.defaultIntensity || 0.55) * 100);
  renderCurrentOverlay();
  updateCurrentMakeupDisplay();
}

function adjustMakeupIntensity(target, delta) {
  makeupEnabled.checked = true;
  const control = (CATEGORY_CONTROLS[target] || CATEGORY_CONTROLS.lip)();
  const next = Math.max(0, Math.min(100, Number(control.value) + delta));
  control.value = String(next);
  renderCurrentOverlay();
  updateCurrentMakeupDisplay();
}

function updateCurrentMakeupDisplay() {
  if (!currentCosmeticName) return;
  if (!makeupEnabled.checked) {
    currentCosmeticName.textContent = "未开启";
    return;
  }
  const parts = [];
  if (commandMakeup.lip) parts.push(`口红：${commandMakeup.lip.name}`);
  if (commandMakeup.blush) parts.push(`腮红：${commandMakeup.blush.name}`);
  if (commandMakeup.brow) parts.push(`眉色：${commandMakeup.brow.name}`);
  if (commandMakeup.eyeshadow) parts.push(`眼影：${commandMakeup.eyeshadow.name}`);
  currentCosmeticName.textContent = parts.length ? parts.join(" / ") : presetDisplayName();
}

function presetDisplayName() {
  const option = makeupPreset.selectedOptions?.[0];
  return option?.textContent?.trim() || "当前预设";
}

function renderCommandFeedback(title, lines) {
  renderAdviceShell();
  setAdviceExpanded(false);
  const card = createAdviceCard(title, "command-card");
  for (const line of lines.filter(Boolean)) {
    const body = document.createElement("p");
    body.textContent = line;
    card.append(body);
  }
  adviceOutput.append(card);
}

function startVoiceCapture() {
  if (!voiceInput || voiceMode !== "web-speech") {
    setVoiceStatus("语音输入暂不可用。");
    return false;
  }
  if (!wakeCapturing) stopWakeStandby();
  voiceFinalText = "";
  setVoiceActive(true);
  setVoiceStatus("正在听，请说出指令或问题。");
  const started = voiceInput.start({
    onResult: ({ text }) => {
      if (!text) return;
      questionInput.value = text;
      setVoiceStatus(`识别中：${text}`);
    },
    onFinal: (text) => {
      voiceFinalText = text;
      if (text) questionInput.value = text;
    },
    onError: (error) => {
      voiceClickActive = false;
      setVoiceActive(false);
      setVoiceStatus(`语音识别失败：${readableVoiceError(error.message)}`);
      restartWakeStandbySoon();
    },
    onEnd: () => {
      voiceClickActive = false;
      setVoiceActive(false);
      if (voiceFinalText.trim()) {
        setVoiceStatus(`已识别：${voiceFinalText}`);
        submitUnifiedInput();
      } else {
        setVoiceStatus("没有听清，可以再试一次。");
      }
      restartWakeStandbySoon();
    },
  });
  if (!started) {
    setVoiceActive(false);
    setVoiceStatus("语音输入暂不可用，已保留 Vosk WASM 接口用于后续本地识别。");
  }
  return started;
}

function stopVoiceCapture() {
  if (!voiceInput) return;
  voiceInput.stop();
}

function toggleVoiceCapture() {
  if (voiceClickActive) {
    voiceClickActive = false;
    stopVoiceCapture();
    return;
  }
  voiceClickActive = startVoiceCapture();
}

function handleVoicePointerDown(event) {
  if (voiceBtn?.disabled) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  suppressVoiceClick = true;
  voicePointerId = event.pointerId;
  voiceBtn.setPointerCapture?.(event.pointerId);
  startVoiceCapture();
}

function handleVoicePointerUp(event) {
  if (voicePointerId !== event.pointerId) return;
  event.preventDefault();
  voiceBtn.releasePointerCapture?.(event.pointerId);
  voicePointerId = null;
  stopVoiceCapture();
  setTimeout(() => {
    suppressVoiceClick = false;
  }, 0);
}

function handleVoiceClick(event) {
  if (suppressVoiceClick) {
    event.preventDefault();
    return;
  }
  toggleVoiceCapture();
}

function setVoiceActive(active) {
  if (!voiceBtn) return;
  voiceBtn.setAttribute("aria-pressed", active ? "true" : "false");
  voiceBtn.textContent = active ? "松开提交" : "按住说话";
}

function setVoiceStatus(text) {
  if (voiceStatus) voiceStatus.textContent = text;
}

function readableVoiceError(message) {
  const text = String(message || "");
  if (text.includes("not-allowed") || text.includes("permission")) return "麦克风权限未开启";
  if (text.includes("no-speech")) return "没有检测到语音";
  if (text.includes("network")) return "浏览器语音服务网络不可用";
  return text || "未知错误";
}

function submitUnifiedInput() {
  adviceForm.requestSubmit?.();
  if (!adviceForm.requestSubmit) {
    adviceForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

function handleWakeToggleChange() {
  wakeEnabled = Boolean(wakeToggle?.checked);
  if (wakeEnabled) {
    startWakeStandby();
  } else {
    stopWakeStandby();
    setWakeStatus(wakeMode === "vosk-wasm" ? "默认关闭：本地 Vosk" : "默认关闭：Web Speech 原型", false);
  }
}

function startWakeStandby() {
  if (!wakeInput) {
    setWakeStatus("待机不可用", false);
    if (wakeToggle) wakeToggle.checked = false;
    wakeEnabled = false;
    return;
  }
  if (wakeCapturing) return;
  stopVoiceCapture();
  const started = wakeInput.start({
    onStart: () => {
      const modeLabel = wakeMode === "vosk-wasm" ? "本地 Vosk" : "Web Speech 原型";
      setWakeStatus(`魔镜待机中：${modeLabel}`, true);
    },
    onPartial: (text) => {
      if (text) setWakeStatus(`待机聆听：${text}`, true);
    },
    onWake: ({ after }) => {
      handleWakeDetected(after);
    },
    onError: (error) => {
      if (!wakeEnabled) return;
      setWakeStatus(`待机失败：${readableVoiceError(error.message)}`, false);
      if (wakeToggle) wakeToggle.checked = false;
      wakeEnabled = false;
    },
    onEnd: () => {
      if (wakeEnabled && !wakeCapturing) setWakeStatus("待机重连中", true);
    },
  });
  if (!started) {
    setWakeStatus("待机启动失败", false);
    if (wakeToggle) wakeToggle.checked = false;
    wakeEnabled = false;
  }
}

function stopWakeStandby() {
  wakeInput?.stop?.();
  clearWakeCommandTimer();
  wakeActiveCommandInput?.abort?.();
  wakeActiveCommandInput = null;
  if (wakeCapturing) stopVoiceCapture();
  wakeCapturing = false;
}

function handleWakeDetected(commandText = "") {
  wakeCapturing = true;
  clearWakeCommandTimer();
  playWakeTone();
  setAdviceExpanded(true);
  const clean = String(commandText || "").trim();
  if (clean) {
    questionInput.value = clean;
    setWakeStatus(`已唤醒：${clean}`, false);
    wakeCapturing = false;
    submitUnifiedInput();
    restartWakeStandbySoon();
    return;
  }
  setWakeStatus("我在，8 秒内说指令或问题", true);
  startWakeCommandWindow();
}

function startWakeCommandWindow() {
  const commandInput =
    wakeCommandVoiceInput || (voiceInput && voiceMode === "web-speech" ? voiceInput : null);
  if (!commandInput) {
    setWakeStatus("已唤醒，但当前缺少可用语音输入", false);
    wakeCapturing = false;
    restartWakeStandbySoon();
    return;
  }
  wakeActiveCommandInput = commandInput;
  voiceFinalText = "";
  setVoiceActive(true);
  let finishScheduled = false;
  const finishSoon = (delay = 250) => {
    if (finishScheduled) return;
    finishScheduled = true;
    setTimeout(() => commandInput.stop(), delay);
  };
  const started = commandInput.start({
    onResult: ({ text }) => {
      if (!text) return;
      questionInput.value = text;
      setWakeStatus(`聆听中：${text}`, true);
    },
    onFinal: (text) => {
      voiceFinalText = text;
      if (text) {
        questionInput.value = text;
        finishSoon();
      }
    },
    onError: (error) => {
      clearWakeCommandTimer();
      setVoiceActive(false);
      wakeCapturing = false;
      wakeActiveCommandInput = null;
      setWakeStatus(`聆听失败：${readableVoiceError(error.message)}`, false);
      restartWakeStandbySoon();
    },
    onEnd: () => {
      clearWakeCommandTimer();
      setVoiceActive(false);
      wakeCapturing = false;
      wakeActiveCommandInput = null;
      if (voiceFinalText.trim()) {
        setWakeStatus(`已识别：${voiceFinalText}`, false);
        submitUnifiedInput();
      } else {
        setWakeStatus("没有听清，回到待机", false);
      }
      restartWakeStandbySoon();
    },
  });
  if (!started) {
    setVoiceActive(false);
    wakeCapturing = false;
    wakeActiveCommandInput = null;
    setWakeStatus("聆听窗口启动失败", false);
    restartWakeStandbySoon();
    return;
  }
  wakeCommandTimer = setTimeout(() => {
    setWakeStatus("聆听超时，回到待机", false);
    commandInput.stop();
  }, 8000);
}

function restartWakeStandbySoon() {
  if (!wakeEnabled || wakeToggle?.checked === false || document.hidden) return;
  setTimeout(() => {
    if (wakeEnabled && !wakeCapturing && !document.hidden) startWakeStandby();
  }, 550);
}

function clearWakeCommandTimer() {
  if (!wakeCommandTimer) return;
  clearTimeout(wakeCommandTimer);
  wakeCommandTimer = null;
}

function playWakeTone() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.2);
    oscillator.onended = () => audio.close();
  } catch {
    /* wake tone is decorative */
  }
}

function shouldUseAgentRoute(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  if (["帮我参谋", "深度咨询", "顾问模式", "agent"].some((word) => value.includes(word))) return true;
  const markers = [
    "预算",
    "对比",
    "比较",
    "哪个",
    "哪一个",
    "挑",
    "选择",
    "整套",
    "全套",
    "搭配",
    "婚礼",
    "约会",
    "面试",
    "通勤",
    "解释",
    "为什么",
    "方案",
    "先试",
    "换个",
    "显气色",
  ];
  if (markers.some((word) => value.includes(word))) return true;
  return value.length >= 34 && /[，,。；;]|并|然后/.test(value);
}

async function requestAdviceStream(event) {
  event.preventDefault();
  if (adviceAbortController) {
    adviceAbortController.abort();
    return;
  }

  if (consumeMakeupCommand(questionInput.value)) return;
  const useAgent = shouldUseAgentRoute(questionInput.value);
  const endpoint = useAgent ? "/api/agent/stream" : "/api/advice/stream";

  const payload = {
    question: questionInput.value,
    analysis: pruneAnalysisForAdvice(currentAnalysis),
    mode: useAgent ? "agent" : "advice",
  };
  const controller = new AbortController();
  adviceAbortController = controller;
  adviceBtn.textContent = "停止生成";
  renderAdviceShell();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream unavailable: ${res.status}`);
    await readAdviceStream(res.body, controller.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      stopTypingCursor();
      appendStreamText("\n已停止生成。");
    } else {
      await requestAdviceFallback(payload, error);
    }
  } finally {
    if (adviceAbortController === controller) {
      adviceAbortController = null;
      adviceBtn.textContent = "生成建议";
    }
  }
}

async function readAdviceStream(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) processAdviceEventLine(line);
  }

  buffer += decoder.decode();
  if (buffer.trim()) processAdviceEventLine(buffer);
}

function processAdviceEventLine(line) {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "draft") {
    renderDraftCards(event.draft);
    renderInterpretationCard("顾问手记");
    showStreamHint("模型生成中，首次提问可能需要先加载模型…");
    return;
  }
  if (event.type === "status") {
    if (!streamTextTarget) renderInterpretationCard("顾问手记");
    showStreamHint(event.message || "Agent is working...");
    return;
  }
  if (event.type === "tool") {
    if (!streamTextTarget) renderInterpretationCard("顾问手记");
    if (event.name === "search_cosmetics") showStreamHint("正在查找本地色库...");
    return;
  }
  if (event.type === "action") {
    handleAgentAction(event);
    return;
  }
  if (event.type === "delta") {
    appendStreamText(event.text || "");
    return;
  }
  if (event.type === "done") {
    stopTypingCursor();
    clearStreamHint();
    if (!streamTextTarget?.textContent.trim()) appendStreamText(event.advice || TEXT.noAdvice);
    return;
  }
  if (event.type === "error") {
    stopTypingCursor();
    clearStreamHint();
    if (!streamTextTarget) renderInterpretationCard("本地规则建议（模型不可用）");
    streamTextTarget.textContent = event.fallback || event.error || TEXT.noAdvice;
  }
}

function handleAgentAction(event) {
  if (event.action === "apply_makeup") {
    const item =
      event.item ||
      cosmeticsCatalog.find((entry) => entry.id === event.itemId) ||
      cosmeticsCatalog.find((entry) => entry.id === event.itemID);
    if (!item) {
      appendStreamText(`\n未找到可试妆色号：${event.itemId || ""}`);
      return;
    }
    applyCatalogItem(item);
    if (typeof event.intensity === "number" && CATEGORY_CONTROLS[item.category]) {
      const control = CATEGORY_CONTROLS[item.category]();
      control.value = String(Math.round(Math.max(0, Math.min(1, event.intensity)) * 100));
      renderCurrentOverlay();
      updateCurrentMakeupDisplay();
    }
    appendStreamText(`\n已为你试上：${item.name || item.id}\n`);
    return;
  }

  if (event.action === "adjust_makeup") {
    adjustMakeupIntensity(event.target || "lip", Number(event.delta || 0));
    appendStreamText("\n已调整当前试妆强度。\n");
    return;
  }

  if (event.action === "clear_makeup") {
    makeupEnabled.checked = false;
    renderCurrentOverlay();
    updateCurrentMakeupDisplay();
    appendStreamText("\n已清空当前试妆。\n");
  }
}

async function requestAdviceFallback(payload, originalError) {
  console.warn("Advice stream unavailable, falling back to non-streaming mode.", originalError);
  try {
    const draftRes = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const draftData = await draftRes.json();
    if (draftData.draft) renderDraftCards(draftData.draft);
  } catch {
    /* draft preview unavailable; continue with plain advice */
  }

  let target = renderInterpretationCard("顾问手记（非流式模式）");
  target.textContent = "流式接口不可用，已切换普通模式生成中…（如果刚改过后端代码，请先重启本地服务）";

  try {
    const res = await fetch("/api/advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.draft) {
      renderDraftCards(data.draft);
      target = renderInterpretationCard(data.ok ? "顾问手记（非流式模式）" : "本地规则建议（模型不可用）");
    }
    target.textContent = data.advice || data.error || originalError.message || TEXT.noAdvice;
    stopTypingCursor();
  } catch (error) {
    renderAdvice(`请求失败：${error.message}`);
  }
}

function setAdviceExpanded(on) {
  if (!panelEl || !expandBtn) return;
  panelEl.classList.toggle("advice-expanded", on);
  expandBtn.textContent = on ? "收起" : "展开";
}

function renderAdviceShell() {
  stopTypingCursor();
  clearStreamHint();
  streamTextTarget = null;
  adviceOutput.textContent = "";
}

function renderDraftCards(draft) {
  renderAdviceShell();
  setAdviceExpanded(true);
  if (!draft?.quality) {
    renderAdvice("暂时没有生成规则草稿。");
    return;
  }

  if (!draft.quality.ok) {
    const card = createAdviceCard("请先调整拍摄", "quality-card");
    const body = document.createElement("p");
    body.textContent = draft.quality.retakeHint || "当前画面质量不足，请调整光线、角度或距离后再试。";
    card.append(body);
    adviceOutput.append(card);
    return;
  }

  if (draft.base) {
    const card = createAdviceCard("底妆", "draft-card");
    appendLine(card, "基调", draft.base.tone);
    appendChips(card, "推荐", draft.base.recommendFamilies, "", "lip");
    appendChips(card, "避开", draft.base.avoidFamilies, "avoid");
    if (draft.base.note) appendNote(card, draft.base.note);
    adviceOutput.append(card);
  }

  if (draft.lips) {
    const card = createAdviceCard("唇妆", "draft-card");
    appendChips(card, "色系", draft.lips.recommendFamilies, "", "lip");
    appendLine(card, "饱和度", draft.lips.saturation);
    if (draft.lips.prep) appendNote(card, draft.lips.prep);
    const tryBtn = document.createElement("button");
    tryBtn.type = "button";
    tryBtn.className = "btn try-look-btn";
    tryBtn.textContent = "一键试上推荐妆";
    tryBtn.addEventListener("click", () => {
      if (!applyRecommendedLook(draft)) return;
      tryBtn.textContent = "已上妆，镜中查看";
      setTimeout(() => {
        tryBtn.textContent = "一键试上推荐妆";
      }, 2000);
    });
    card.append(tryBtn);
    adviceOutput.append(card);
  }

  if (draft.eyesBrows) {
    const card = createAdviceCard("眉眼", "draft-card");
    appendLine(card, "眉形", draft.eyesBrows.browHint);
    appendChips(card, "技巧", draft.eyesBrows.techniques);
    adviceOutput.append(card);
  }

  if (draft.contour) {
    const card = createAdviceCard("修容腮红", "draft-card");
    appendLine(card, "腮红", draft.contour.blushPlacement);
    appendLine(card, "修容", draft.contour.contourHint);
    adviceOutput.append(card);
  }

  if (draft.focus?.length) {
    const card = createAdviceCard("重点", "draft-card focus-card");
    appendChips(card, "下一步", draft.focus);
    adviceOutput.append(card);
  }
}

function renderInterpretationCard(title) {
  const card = createAdviceCard(title, "interpretation-card");
  streamTextTarget = document.createElement("p");
  streamTextTarget.className = "stream-text";
  streamCursor = document.createElement("span");
  streamCursor.className = "typing-cursor";
  card.append(streamTextTarget, streamCursor);
  adviceOutput.append(card);
  return streamTextTarget;
}

function appendStreamText(text) {
  clearStreamHint();
  if (!streamTextTarget) renderInterpretationCard("顾问手记");
  streamTextTarget.textContent += text;
  adviceOutput.scrollTop = adviceOutput.scrollHeight;
}

function stopTypingCursor() {
  if (streamCursor) streamCursor.remove();
  streamCursor = null;
}

function showStreamHint(text) {
  if (!streamTextTarget) return;
  clearStreamHint();
  streamHint = document.createElement("p");
  streamHint.className = "stream-hint";
  streamHint.textContent = text;
  streamTextTarget.parentElement.insertBefore(streamHint, streamTextTarget);
}

function clearStreamHint() {
  if (streamHint) streamHint.remove();
  streamHint = null;
}

function createAdviceCard(title, extraClass = "") {
  const section = document.createElement("section");
  section.className = `advice-card ${extraClass}`.trim();
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  return section;
}

function appendLine(card, label, value) {
  if (!value) return;
  const row = document.createElement("p");
  row.className = "draft-line";
  row.textContent = `${label}：${value}`;
  card.append(row);
}

function appendChips(card, label, values, mode = "", tryCategory = null) {
  if (!Array.isArray(values) || !values.length) return;
  const wrap = document.createElement("div");
  wrap.className = "chip-row";
  const name = document.createElement("span");
  name.className = "chip-label";
  name.textContent = `${label}：`;
  wrap.append(name);
  for (const value of values) {
    const item = tryCategory && mode !== "avoid" ? pickCatalogByFamily(value, tryCategory) : null;
    if (item) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip-action";
      chip.textContent = value;
      chip.title = `点击试上${item.name}`;
      chip.addEventListener("click", () => {
        applyCatalogItem(item);
        for (const active of wrap.querySelectorAll(".chip-on")) active.classList.remove("chip-on");
        chip.classList.add("chip-on");
      });
      wrap.append(chip);
      continue;
    }
    const chip = document.createElement("span");
    chip.className = mode === "avoid" ? "chip avoid-chip" : "chip";
    chip.textContent = value;
    wrap.append(chip);
  }
  card.append(wrap);
}

function pickCatalogByFamily(name, category) {
  return matchCatalogItem(String(name || ""), cosmeticsCatalog, category);
}

function applyRecommendedLook(draft) {
  const families = draft?.lips?.recommendFamilies || draft?.base?.recommendFamilies || [];
  let lipItem = null;
  for (const family of families) {
    lipItem = pickCatalogByFamily(family, "lip");
    if (lipItem) break;
  }

  const undertone = draft?.base?.undertone || "neutral";
  const blushPreference =
    {
      warm: ["蜜桃腮红", "珊瑚腮红", "杏子腮红"],
      cool: ["冷粉腮红", "浆果腮红", "玫瑰腮红"],
      neutral: ["豆沙腮红", "奶茶腮红", "玫瑰腮红"],
    }[undertone] || ["豆沙腮红"];
  let blushItem = null;
  for (const name of blushPreference) {
    blushItem = pickCatalogByFamily(name, "blush");
    if (blushItem) break;
  }

  if (lipItem) applyCatalogItem(lipItem);
  if (blushItem) applyCatalogItem(blushItem);
  return Boolean(lipItem || blushItem);
}

function appendNote(card, text) {
  const note = document.createElement("p");
  note.className = "draft-note";
  note.textContent = text;
  card.append(note);
}

function pruneAnalysisForAdvice(analysis) {
  return {
    faceDetected: analysis.faceDetected,
    source: analysis.source,
    detector: analysis.detector,
    lighting: analysis.lighting,
    clarity: analysis.clarity,
    framing: analysis.framing,
    stable: analysis.stable,
    brightness: analysis.brightness,
    sharpness: analysis.sharpness,
    faceRatio: analysis.faceRatio,
    offset: analysis.offset,
    landmarkCount: analysis.landmarkCount,
    pose: analysis.pose,
    featureSummary: analysis.featureSummary,
    makeupPreview: makeupSettings(),
    timestamp: analysis.timestamp,
  };
}

function handleMakeupControlInput(event) {
  if (event?.target === makeupPreset) {
    commandMakeup = { lip: null, blush: null, brow: null, eyeshadow: null };
  }
  if (event?.target === browLevel && !commandMakeup.brow) {
    const item = pickCatalogByFamily("深棕", "brow");
    if (item) commandMakeup = { ...commandMakeup, brow: item };
  }
  if (event?.target === eyeshadowLevel && !commandMakeup.eyeshadow) {
    const item = pickCatalogByFamily("大地色", "eyeshadow");
    if (item) commandMakeup = { ...commandMakeup, eyeshadow: item };
  }
  updateCurrentMakeupDisplay();
  if (mode === "image") renderCurrentOverlay();
  else startRenderLoop();
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopRenderLoop();
    stopWakeStandby();
    return;
  }
  startRenderLoop();
  if (wakeEnabled) startWakeStandby();
}

function handleBeforeUnload() {
  stopWakeStandby();
  stopRenderLoop();
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/* ---------------- wiring ---------------- */

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", handleUpload);
adviceForm.addEventListener("submit", requestAdviceStream);
pixelFreeSnapshotBtn?.addEventListener("click", requestPixelFreeSnapshot);
expandBtn?.addEventListener("click", () =>
  setAdviceExpanded(!panelEl.classList.contains("advice-expanded")),
);
voiceBtn?.addEventListener("pointerdown", handleVoicePointerDown);
voiceBtn?.addEventListener("pointerup", handleVoicePointerUp);
voiceBtn?.addEventListener("pointercancel", handleVoicePointerUp);
voiceBtn?.addEventListener("click", handleVoiceClick);
wakeToggle?.addEventListener("change", handleWakeToggleChange);
window.addEventListener("resize", renderCurrentOverlay);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("beforeunload", handleBeforeUnload);
for (const control of [makeupEnabled, makeupPreset, smoothLevel, lipLevel, blushLevel, browLevel, eyeshadowLevel]) {
  control.addEventListener("input", handleMakeupControlInput);
}

init();
