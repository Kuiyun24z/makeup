const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.GPUPIXEL_HOST || "127.0.0.1";
const PORT = Number(process.env.GPUPIXEL_PORT || 9001);
const ROOT_DIR = path.resolve(__dirname, "..", "gpupixel-main");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const BIN_DIR = path.join(OUTPUT_DIR, "bin");
const LIB_DIR = path.join(OUTPUT_DIR, "lib");
const MODEL_DIR = path.join(OUTPUT_DIR, "models");
const RES_DIR = path.join(OUTPUT_DIR, "res");
const DEMO_EXE = path.join(BIN_DIR, "app.exe");
const DLL_PATH = path.join(LIB_DIR, "gpupixel.dll");
const WINDOWS_NMAKE_BIN_DIR = path.join(ROOT_DIR, "build", "windows-nmake", "out", "bin");
const LIVE_PARAMS_PATH = path.join(WINDOWS_NMAKE_BIN_DIR, "gpupixel_live_params.json");
const GPUPIXEL_STREAM_PORT = Number(process.env.GPUPIXEL_STREAM_PORT || 8791);
const GPUPIXEL_STREAM_URL = `http://127.0.0.1:${GPUPIXEL_STREAM_PORT}/stream.mjpg`;
const GPUPIXEL_STREAM_HEALTH_URL = `http://127.0.0.1:${GPUPIXEL_STREAM_PORT}/health`;
const VIDEO_CLIENT_VERSION_CANDIDATES = [
  "v21",
  "v20",
  "v19",
  "v18",
  "v17",
  "v16",
  "v15",
  "v14",
  "v13",
  "v12",
  "v11",
  "v10",
  "v9",
  "v8",
  "v7",
  "v6",
  "v5",
  "v4",
  "v3",
  "v2",
];
const VIDEO_CLIENT_CANDIDATES = [
  ...VIDEO_CLIENT_VERSION_CANDIDATES.map((version) =>
    path.join(WINDOWS_NMAKE_BIN_DIR, `gpupixel_video_client_${version}.exe`)
  ),
  path.join(WINDOWS_NMAKE_BIN_DIR, "gpupixel_video_client.exe"),
];
const WINDOWS_FACE_KIT_DLL = path.join(ROOT_DIR, "third_party", "mars-face-kit", "libs", "windows", "msvc-x64", "mars-face-kit.dll");
const WINDOWS_FACE_KIT_LIB = path.join(ROOT_DIR, "third_party", "mars-face-kit", "libs", "windows", "msvc-x64", "mars-face-kit.lib");
const WINDOWS_BUILD_CACHE = path.join(ROOT_DIR, "build", "windows-nmake", "CMakeCache.txt");
const LEGACY_WINDOWS_BUILD_CACHE = path.join(ROOT_DIR, "build", "windows", "CMakeCache.txt");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function exists(target) {
  try {
    return fs.existsSync(target);
  } catch (_error) {
    return false;
  }
}

function readTextIfExists(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch (_error) {
    return "";
  }
}

function findFirstExistingPath(candidates) {
  return candidates.find((candidate) => exists(candidate)) || "";
}

function detectNativeFaceTrackingStatus() {
  const cache = readTextIfExists(WINDOWS_BUILD_CACHE) || readTextIfExists(LEGACY_WINDOWS_BUILD_CACHE);
  const faceDetectorEnabled = /GPUPIXEL_ENABLE_FACE_DETECTOR:BOOL=ON/i.test(cache);
  const windowsFaceKitReady = exists(WINDOWS_FACE_KIT_DLL) && exists(WINDOWS_FACE_KIT_LIB);

  return {
    faceDetectorEnabled,
    windowsFaceKitReady,
    renderFrameReady: faceDetectorEnabled && windowsFaceKitReady,
  };
}

function buildRuntimeFlags() {
  const nativeFaceTracking = detectNativeFaceTrackingStatus();
  const selectedVideoClient = findFirstExistingPath(VIDEO_CLIENT_CANDIDATES);
  const legacyAdapterReady =
    exists(OUTPUT_DIR) &&
    exists(DEMO_EXE) &&
    exists(DLL_PATH) &&
    exists(MODEL_DIR) &&
    exists(path.join(MODEL_DIR, "face_det.mars_model"));
  return {
    outputReady: exists(OUTPUT_DIR),
    demoReady: exists(DEMO_EXE),
    libraryReady: exists(DLL_PATH),
    modelsReady: exists(MODEL_DIR) && exists(path.join(MODEL_DIR, "face_det.mars_model")),
    resourcesReady: exists(RES_DIR) && exists(path.join(RES_DIR, "lookup_skin.png")),
    legacyAdapterReady,
    windowsNmakeOutputReady: exists(WINDOWS_NMAKE_BIN_DIR),
    videoClientReady: Boolean(selectedVideoClient),
    selectedVideoClient,
    preferredVideoClient: VIDEO_CLIENT_CANDIDATES[0],
    videoClientCandidates: VIDEO_CLIENT_CANDIDATES,
    nativeFaceTracking,
  };
}

function summarizeSignals(payload) {
  const gpupixel = payload?.moduleSignals?.gpupixel || {};
  return {
    engine: normalizeText(gpupixel.mode) || "native-video-client",
    summary: normalizeText(gpupixel.summary) || "GPUPixel native beauty engine",
    emphasis: "none",
    expression: "stable",
    pose: "stable",
  };
}

const DEFAULT_PARAMS = {
  smoothing: 4,
  whitening: 2,
  faceSlim: 0,
  eyeEnlarge: 0,
  mouthResize: 0,
  noseResize: 0,
  lipstick: 0,
  eyebrow: 0,
  blusher: 0,
};

function readLiveParams() {
  try {
    if (!exists(LIVE_PARAMS_PATH)) {
      return { ...DEFAULT_PARAMS };
    }
    return { ...DEFAULT_PARAMS, ...JSON.parse(fs.readFileSync(LIVE_PARAMS_PATH, "utf8")) };
  } catch (_error) {
    return { ...DEFAULT_PARAMS };
  }
}

function normalizeParamValue(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return clamp(number, min, max);
}

function normalizeLiveParams(rawParams) {
  const current = readLiveParams();
  const input = rawParams && typeof rawParams === "object" ? rawParams : {};
  return {
    ...current,
    smoothing: normalizeParamValue(input.smoothing ?? current.smoothing, 0, 10),
    whitening: normalizeParamValue(
      input.whitening ?? input.brighten ?? current.whitening,
      0,
      10
    ),
    faceSlim: normalizeParamValue(input.faceSlim ?? current.faceSlim, 0, 4),
    eyeEnlarge: normalizeParamValue(input.eyeEnlarge ?? current.eyeEnlarge, 0, 8),
    mouthResize: normalizeParamValue(input.mouthResize ?? current.mouthResize, -1, 1),
    noseResize: normalizeParamValue(input.noseResize ?? current.noseResize, -1, 1),
    lipstick: normalizeParamValue(input.lipstick ?? current.lipstick, 0, 10),
    eyebrow: normalizeParamValue(input.eyebrow ?? current.eyebrow, 0, 10),
    blusher: normalizeParamValue(input.blusher ?? input.blush ?? current.blusher, 0, 10),
    updatedAt: new Date().toISOString(),
  };
}

function writeLiveParams(params) {
  fs.mkdirSync(WINDOWS_NMAKE_BIN_DIR, { recursive: true });
  fs.writeFileSync(LIVE_PARAMS_PATH, JSON.stringify(params, null, 2), "utf8");
}

function buildStyleIntent(payload) {
  const request = normalizeText(payload?.userRequest).toLowerCase();
  const step = normalizeText(payload?.currentStep);
  if (/clean|clear|natural|通透|自然|裸|轻/.test(request)) {
    return "natural";
  }
  if (/bright|glow|提亮|透亮|水光/.test(request)) {
    return "glow";
  }
  if (/lip|唇|口红|唇线/.test(request)) {
    return "lip-focus";
  }
  if (/eye|眼|睫毛|眼线/.test(request)) {
    return "eye-focus";
  }
  if (/base|底妆|粉底|遮瑕/.test(request) || step === "底妆修饰") {
    return "base-polish";
  }
  return "balanced";
}

function buildPreset(payload) {
  const faceProfile = payload?.faceProfile || {};
  const confidence = Number(faceProfile.confidence || 0);
  const shape = normalizeText(faceProfile.shape) || "unknown";
  const step = normalizeText(payload?.currentStep) || "妆前准备";
  const styleIntent = buildStyleIntent(payload);
  const { emphasis, expression, pose } = summarizeSignals(payload);

  const preset = {
    presetKey: `gpupixel-${styleIntent}`,
    presetLabel: "GPUPixel 原生建议",
    styleIntent,
    currentStep: step,
    strengths: {
      smoothing: 0.28,
      brighten: 0.18,
      toneBalance: 0.24,
      blush: 0.12,
      sharpenEyeLip: 0.18,
    },
    lookupTexture: "lookup_skin.png",
    overlays: [],
    engineHints: [],
  };

  if (styleIntent === "natural") {
    preset.strengths.smoothing = 0.22;
    preset.strengths.brighten = 0.14;
    preset.strengths.toneBalance = 0.18;
    preset.engineHints.push("Favor low-contrast skin refinement to keep texture visible.");
  } else if (styleIntent === "glow") {
    preset.strengths.smoothing = 0.26;
    preset.strengths.brighten = 0.26;
    preset.strengths.toneBalance = 0.22;
    preset.lookupTexture = "lookup_light.png";
    preset.engineHints.push("Lift forehead, nose bridge, and cheek center brightness without flattening contour.");
  } else if (styleIntent === "lip-focus") {
    preset.strengths.smoothing = 0.18;
    preset.strengths.brighten = 0.14;
    preset.strengths.sharpenEyeLip = 0.28;
    preset.overlays.push("mouth.png");
    preset.engineHints.push("Keep lip edge crisp and avoid over-softening around the mouth.");
  } else if (styleIntent === "eye-focus") {
    preset.strengths.smoothing = 0.2;
    preset.strengths.sharpenEyeLip = 0.3;
    preset.engineHints.push("Protect lash root and eyeliner contrast while softening surrounding skin.");
  } else if (styleIntent === "base-polish") {
    preset.strengths.smoothing = 0.32;
    preset.strengths.brighten = 0.2;
    preset.strengths.toneBalance = 0.28;
    preset.engineHints.push("Unify skin tone first, then add local highlight instead of raising whole-frame exposure.");
  } else {
    preset.engineHints.push("Use balanced tuning and refine only the area that matches the current makeup step.");
  }

  if (shape === "round") {
    preset.strengths.blush = 0.1;
    preset.engineHints.push("Blush placement should lift diagonally rather than spread sideways.");
  } else if (shape === "long") {
    preset.strengths.brighten = 0.16;
    preset.strengths.blush = 0.14;
    preset.engineHints.push("Keep cheek color slightly wider to balance face length.");
  } else if (shape === "square") {
    preset.strengths.smoothing = 0.3;
    preset.engineHints.push("Contour transitions should stay soft to avoid emphasizing edges.");
  }

  if (emphasis === "skin") {
    preset.strengths.smoothing = clamp(preset.strengths.smoothing + 0.06, 0, 0.45);
    preset.engineHints.push("Face parsing highlights skin coverage, so skin blending can be pushed a bit further.");
  } else if (emphasis === "eyes") {
    preset.strengths.sharpenEyeLip = clamp(preset.strengths.sharpenEyeLip + 0.06, 0, 0.4);
  }

  if (/动作明显|闭合较多/.test(expression)) {
    preset.engineHints.push("Hold adjustments light until the face is steady again.");
  }

  if (!/正|stable|稳定/.test(pose.toLowerCase())) {
    preset.engineHints.push("Current pose is not fully neutral; keep contour and lip-edge decisions conservative.");
  }

  return {
    confidence,
    preset,
  };
}

function buildAdvice(payload) {
  const runtime = buildRuntimeFlags();
  const { confidence, preset } = buildPreset(payload);
  const summary =
    preset.styleIntent === "base-polish"
      ? "GPUPixel 建议先走底妆统一和轻磨皮，再叠加局部提亮。"
      : preset.styleIntent === "lip-focus"
        ? "GPUPixel 建议保护唇线边缘清晰度，底层磨皮保持轻量。"
        : preset.styleIntent === "eye-focus"
          ? "GPUPixel 建议优先保留眼周对比度，再做轻度皮肤修饰。"
          : "GPUPixel 建议先做轻量原生润饰，再根据当前步骤叠加重点区域。";

  const nextStep =
    preset.styleIntent === "glow"
      ? "先把额头中心、鼻梁和颧骨高点做轻提亮，避免整脸一并拉亮。"
      : preset.styleIntent === "lip-focus"
        ? "先稳住嘴角和唇峰边缘，再补颜色完整度。"
        : preset.styleIntent === "eye-focus"
          ? "先压实睫毛根部和眼尾后段，再决定是否继续加深。"
          : "先把当前步骤对应区域做均匀，再补强单个高光或色彩点。";

  return {
    ok: true,
    service: "gpupixel-adapter",
    version: "0.1.0",
    nativeRuntime: runtime,
    advice: {
      integration: "gpupixel-adapter",
      provider: "pixpark/gpupixel",
      summary,
      nextStep,
      preset,
      confidence,
      checkpoints: [
        "参数先低后高，不要一次把磨皮和提亮同时拉满。",
        "保持局部边缘清晰，尤其是眼线、睫毛根和唇峰。",
        "姿态不稳定时先做轻量调整，再决定是否加强。",
      ],
    },
  };
}

function collectHealth() {
  const runtime = buildRuntimeFlags();
  const ready = runtime.legacyAdapterReady || runtime.videoClientReady;
  const renderFrameReady = runtime.nativeFaceTracking.renderFrameReady;
  return {
    ok: ready,
    service: "gpupixel-adapter",
    provider: "pixpark/gpupixel",
    detail: !ready
      ? "GPUPixel build output is incomplete. Rebuild gpupixel-main before using the adapter or video client."
      : renderFrameReady
        ? "GPUPixel native artifacts are ready and the local adapter can serve presets."
        : runtime.videoClientReady
          ? "GPUPixel video client is ready. Native GPUPixel is the active beauty engine."
          : "GPUPixel legacy adapter artifacts exist, but native face tracking is not ready on Windows yet. The adapter can only serve preset advice right now.",
    runtime,
    stream: {
      url: GPUPIXEL_STREAM_URL,
      healthUrl: GPUPIXEL_STREAM_HEALTH_URL,
      paramsPath: LIVE_PARAMS_PATH,
      params: readLiveParams(),
    },
    paths: {
      rootDir: ROOT_DIR,
      outputDir: OUTPUT_DIR,
      demoExe: DEMO_EXE,
      dllPath: DLL_PATH,
      windowsNmakeBinDir: WINDOWS_NMAKE_BIN_DIR,
      selectedVideoClient: runtime.selectedVideoClient,
      preferredVideoClient: runtime.preferredVideoClient,
      windowsFaceKitDll: WINDOWS_FACE_KIT_DLL,
      windowsFaceKitLib: WINDOWS_FACE_KIT_LIB,
      windowsBuildCache: WINDOWS_BUILD_CACHE,
      legacyWindowsBuildCache: LEGACY_WINDOWS_BUILD_CACHE,
    },
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: "Missing URL." });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    sendJson(res, 200, collectHealth());
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/stream") {
    sendJson(res, 200, {
      ok: true,
      streamUrl: GPUPIXEL_STREAM_URL,
      healthUrl: GPUPIXEL_STREAM_HEALTH_URL,
      paramsPath: LIVE_PARAMS_PATH,
      params: readLiveParams(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/params") {
    sendJson(res, 200, {
      ok: true,
      params: readLiveParams(),
      paramsPath: LIVE_PARAMS_PATH,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/params") {
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const params = normalizeLiveParams(payload.params || payload);
      writeLiveParams(params);
      sendJson(res, 200, {
        ok: true,
        params,
        paramsPath: LIVE_PARAMS_PATH,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/advice") {
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      sendJson(res, 200, buildAdvice(payload));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/presets") {
    sendJson(res, 200, {
      ok: true,
      presets: [
        "gpupixel-balanced",
        "gpupixel-natural",
        "gpupixel-glow",
        "gpupixel-base-polish",
        "gpupixel-eye-focus",
        "gpupixel-lip-focus",
      ],
    });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Not found.",
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GPUPixel adapter running at http://${HOST}:${PORT}`);
});
