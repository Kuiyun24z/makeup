const statusEl = document.getElementById("status");
const frameSeqEl = document.getElementById("frameSeq");
const mpStateEl = document.getElementById("mpState");
const faceStateEl = document.getElementById("faceState");
const postedCountEl = document.getElementById("postedCount");
const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");

const MODEL_URL = "/vendor/mediapipe/models/face_landmarker.task";
const WASM_URL = "/vendor/mediapipe/tasks-vision/wasm";
const MODULE_URL = "/vendor/mediapipe/tasks-vision/vision_bundle.mjs";
const MEDIAPIPE_POINT_COUNT = 468;

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

let landmarker = null;
let lastSeq = "";
let busy = false;
let posted = 0;
let lastPostMs = Date.now();

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
  return mapping
    .map((spec) => pointFromSpec(landmarks, spec) || fallback)
    .flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function toMediaPipeLandmarks(landmarks) {
  return landmarks
    .slice(0, MEDIAPIPE_POINT_COUNT)
    .flatMap((point) => [clamp01(point.x), clamp01(point.y)]);
}

function valuesToText(values) {
  return values.map((value) => value.toFixed(6)).join(" ");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawLandmarks(values) {
  ctx.save();
  ctx.fillStyle = "#29d19c";
  for (let i = 0; i < values.length; i += 2) {
    ctx.beginPath();
    ctx.arc(
      values[i] * canvas.width,
      values[i + 1] * canvas.height,
      1.25,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

async function processFrame(seq, frameInfo, frameInfoRoundTripMs) {
  if (!landmarker || busy || seq === lastSeq) return false;
  busy = true;
  lastSeq = seq;
  frameSeqEl.textContent = seq;
  try {
    const frameMeta = frameInfo.frameMeta || {};
    const cppPublishMs = Number(frameMeta.cppPublishMs || 0);
    const frameInfoEndMs = Date.now();
    const loadStartMs = Date.now();
    const image = await loadImage(`/frame.bmp?seq=${encodeURIComponent(seq)}`);
    const loadEndMs = Date.now();
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    image.width = canvas.width;
    image.height = canvas.height;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const detectStartMs = Date.now();
    const result = landmarker.detect(image);
    const detectEndMs = Date.now();
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks) {
      faceStateEl.textContent = "none";
      setStatus("Waiting for face...");
      return true;
    }

    const gp = toGpupixelLandmarks(landmarks);
    const mp = toMediaPipeLandmarks(landmarks);
    drawLandmarks(mp);
    const postStartMs = Date.now();
    const payload = {
      landmarksText: valuesToText(gp),
      mediapipeLandmarksText: valuesToText(mp),
      diagnostics: {
        seq,
        cppFrameIndex: Number(frameMeta.frameIndex || 0),
        cppPublishMs,
        frameInfoRoundTripMs,
        jsFrameInfoReceivedMs: frameInfoEndMs,
        jsImageLoadMs: loadEndMs - loadStartMs,
        jsDetectStartMs: detectStartMs,
        jsDetectEndMs: detectEndMs,
        jsDetectCostMs: detectEndMs - detectStartMs,
        jsPostStartMs: postStartMs,
        jsLandmarkIntervalMs: postStartMs - lastPostMs,
      },
    };
    await fetch("/api/landmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const postEndMs = Date.now();
    lastPostMs = postEndMs;
    posted += 1;
    postedCountEl.textContent = String(posted);
    faceStateEl.textContent = `${landmarks.length} points`;
    setStatus(
      `MediaPipe bridge live. detect=${detectEndMs - detectStartMs}ms post=${
        postEndMs - postStartMs
      }ms age=${cppPublishMs > 0 ? Math.round(postEndMs - cppPublishMs) : 0}ms`,
    );
    return true;
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
    return true;
  } finally {
    busy = false;
  }
}

async function poll() {
  let processed = false;
  try {
    const frameInfoStartMs = Date.now();
    const response = await fetch("/api/frame-info", { cache: "no-store" });
    const payload = await response.json();
    const frameInfoEndMs = Date.now();
    if (payload.ok && payload.seq) {
      processed = await processFrame(
        payload.seq,
        payload,
        frameInfoEndMs - frameInfoStartMs,
      );
    }
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(poll, processed ? 0 : 16);
  }
}

async function init() {
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
      mpStateEl.textContent = "GPU";
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      mpStateEl.textContent = "CPU";
    }
    setStatus("MediaPipe loaded. Start the video client if no frame appears.");
    poll();
  } catch (error) {
    console.error(error);
    mpStateEl.textContent = "failed";
    setStatus(error.message || String(error));
  }
}

init();
