const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { buildStreamAsrEnvelope, describeStreamAsrEnvelope } = require("./stream-asr-adapter");
const {
  buildGpupixelControlMessage,
  joinMirrorReply,
  WARM_MIRROR_STYLE_INSTRUCTION,
} = require("./mirror-voice");
const {
  createVisionRequestRegistry,
  buildCurrentFrameVisionPrompt,
} = require("./current-frame-vision");
const { buildBeautyOpenHarnessPrompt } = require("./openharness-prompt");
const {
  shouldResolveOpenHarnessAssistant,
} = require("./openharness-bridge-events");

const SITE_ROOT = __dirname;
const PUBLIC_ROOT = path.join(SITE_ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const REQUEST_TIMEOUT_MS = 45000;
const MODULE_PROBE_TIMEOUT_MS = Number(process.env.MODULE_PROBE_TIMEOUT_MS || 3500);
const GPUPIXEL_SERVICE_URL = process.env.GPUPIXEL_SERVICE_URL || "";
const LOCAL_ASR_SERVICE_URL = process.env.LOCAL_ASR_SERVICE_URL || "";
const LOCAL_TTS_SERVICE_URL = process.env.LOCAL_TTS_SERVICE_URL || "";
const ASR_PROVIDER = process.env.ASR_PROVIDER || "whisper-local";
const ASR_ENABLE_PARTIAL = process.env.ASR_ENABLE_PARTIAL || "off";
const ARK_RESPONSES_URL = process.env.ARK_RESPONSES_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_VISION_MODEL = process.env.ARK_VISION_MODEL || "doubao-seed-1-6-vision-250815";
const OPENHARNESS_DIR = path.resolve(SITE_ROOT, "..", "OpenHarness-main");
const OPENHARNESS_PROTOCOL_PREFIX = "OHJSON:";
const OPENHARNESS_RUNTIME = process.env.OPENHARNESS_RUNTIME || "uv";
const OPENHARNESS_COMMAND = process.env.OPENHARNESS_COMMAND || "";
const OPENHARNESS_MODEL = process.env.OPENHARNESS_MODEL || "";
const OPENHARNESS_API_FORMAT = process.env.OPENHARNESS_API_FORMAT || "";
const OPENHARNESS_BASE_URL = process.env.OPENHARNESS_BASE_URL || "";
const OPENHARNESS_API_KEY = process.env.OPENHARNESS_API_KEY || "";
const OPENHARNESS_UV_EXE =
  process.env.OPENHARNESS_UV_EXE ||
  (fs.existsSync("C:\\ProgramData\\miniconda3\\envs\\openharness\\Scripts\\uv.exe")
    ? "C:\\ProgramData\\miniconda3\\envs\\openharness\\Scripts\\uv.exe"
    : "D:\\Anaconda3\\envs\\openharness\\Scripts\\uv.exe");
const OPENHARNESS_UV_CACHE_DIR =
  process.env.OPENHARNESS_UV_CACHE_DIR || path.resolve(SITE_ROOT, "..", ".uv-cache");
const OPENHARNESS_READY_TIMEOUT_MS = Number(process.env.OPENHARNESS_READY_TIMEOUT_MS || 20000);
const OPENHARNESS_REQUEST_TIMEOUT_MS = Number(process.env.OPENHARNESS_REQUEST_TIMEOUT_MS || 40000);
const GPUPIXEL_LATEST_FRAME_URL =
  process.env.GPUPIXEL_LATEST_FRAME_URL || "http://127.0.0.1:8791/latest.jpg";
const CURRENT_FRAME_MAX_BYTES = Number(process.env.CURRENT_FRAME_MAX_BYTES || 8 * 1024 * 1024);
const CURRENT_FRAME_TIMEOUT_MS = Number(process.env.CURRENT_FRAME_TIMEOUT_MS || 5000);
const CURRENT_FRAME_VISION_TIMEOUT_MS = Number(process.env.CURRENT_FRAME_VISION_TIMEOUT_MS || 30000);
const visionRequests = createVisionRequestRegistry({
  ttlMs: Math.max(OPENHARNESS_REQUEST_TIMEOUT_MS + 10000, 60000),
});

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ROUTINE_TITLES = [
  "妆前准备",
  "底妆修饰",
  "眉形定调",
  "眼妆提神",
  "修容腮红",
  "唇妆定妆",
];

const SHAPE_GUIDES = {
  oval: {
    label: "椭圆脸",
    signature: "比例比较均衡，适合做整体提气色和局部精修。",
    contour: "修容轻扫颧骨下侧和发际线即可，不需要过重压缩轮廓。",
    blush: "腮红放在苹果肌偏上，向太阳穴轻轻晕开。",
    brow: "眉峰可以略清晰，保持柔和上扬。",
  },
  round: {
    label: "圆脸",
    signature: "横向观感更饱满，重点是拉长纵向线条、提升面部重心。",
    contour: "修容集中在颧骨下方和下颌外缘，方向往上提。",
    blush: "腮红斜扫到颧骨高点，减少横向铺开。",
    brow: "眉峰稍明显、眉尾微拉长，能让脸更利落。",
  },
  square: {
    label: "方脸",
    signature: "下颌线存在感更强，重点是软化边角、增加柔和感。",
    contour: "修容落在额角和下颌转折位，晕染要圆润。",
    blush: "腮红以苹果肌为中心向外晕，弱化棱角。",
    brow: "眉形偏柔和弧度，不建议过平或过锐利。",
  },
  heart: {
    label: "心形脸",
    signature: "额头更开阔、下巴更尖，重点是平衡上下区域。",
    contour: "额角轻修容，下巴只做非常轻的柔化。",
    blush: "腮红范围控制在脸中部，避免再把注意力拉到额头。",
    brow: "眉头眉峰保持自然，别把上半脸压得太重。",
  },
  long: {
    label: "长脸",
    signature: "纵向比例更长，重点是增加横向延展和中庭饱满度。",
    contour: "发际线和下巴底部轻修容，缩短视觉长度。",
    blush: "腮红横向铺开到耳前，位置不要过高。",
    brow: "眉尾不必拖太长，保持横向延展感。",
  },
  diamond: {
    label: "菱形脸",
    signature: "颧骨更突出，重点是柔化颧骨并平衡额头和下颌。",
    contour: "修容轻压颧骨外侧，额头和下颌只做少量连接。",
    blush: "腮红放在面中偏内，避免再外扩颧骨。",
    brow: "眉形可以柔和拉长，帮助平衡中部量感。",
  },
  unknown: {
    label: "待确认脸型",
    signature: "当前识别置信度不高，建议保持正脸、稳定光线再分析一次。",
    contour: "先做轻量底妆和局部提亮，暂时不要下重修容。",
    blush: "选择中性位置的腮红，等识别更稳定后再微调。",
    brow: "眉形保持自然，不要急着大改轮廓。",
  },
};

const STEP_GUIDES = {
  "妆前准备": {
    focus: "先把肤感和表面平整度准备好，后面步骤会更服帖。",
    checkpoints: [
      "保湿有没有只停留在表面，还是已经吃进去",
      "鼻翼、嘴角、眼下有没有起皮或卡纹",
      "妆前乳是否只用在需要修饰的区域",
    ],
  },
  "底妆修饰": {
    focus: "底妆的目标不是遮到没纹理，而是统一肤色并保留真实皮肤感。",
    checkpoints: [
      "先薄铺一层，再补局部遮瑕",
      "黑眼圈、鼻翼泛红、痘印分区处理",
      "镜头里如果发灰，优先补提亮而不是加厚粉底",
    ],
  },
  "眉形定调": {
    focus: "眉毛决定整张脸的气质方向，要先定长短和眉峰，再补毛流。",
    checkpoints: [
      "眉头轻、眉尾清晰，不要一条线画死",
      "根据脸型决定眉峰角度和眉尾长度",
      "先搭轮廓，再用染眉膏或眉粉柔化",
    ],
  },
  "眼妆提神": {
    focus: "先确定眼神方向，再决定加深范围，别一上来就把面积铺太大。",
    checkpoints: [
      "基础消肿色先铺满眼窝",
      "深色只压在睫毛根和眼尾后三分之一",
      "眼线和睫毛服务于放大眼神，不是单独抢戏",
    ],
  },
  "修容腮红": {
    focus: "这一步是脸型校正核心，要跟你的骨相和今天风格同步。",
    checkpoints: [
      "修容颜色偏灰棕，位置比力度更重要",
      "腮红方向决定气质，是上提、横向还是包裹感",
      "高光只放在想凸出来的位置，不要满脸都亮",
    ],
  },
  "唇妆定妆": {
    focus: "最后一步要把整体妆面收紧，让重点更明确。",
    checkpoints: [
      "唇边是否干净，颜色是否和眼颊呼应",
      "定妆先压再扫，别把前面辛苦做的光泽全盖掉",
      "补一点局部高光或腮红，能让妆感更完整",
    ],
  },
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function serveStaticFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_ROOT, normalized);

  if (!filePath.startsWith(PUBLIC_ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, "utf8", (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = data;
    if (ext === ".html") {
      const runtimeBootstrap = `<script>window.__BEAUTY_STUDIO_ASR_PROVIDER__=${JSON.stringify(
        ASR_PROVIDER
      )};window.__BEAUTY_STUDIO_ENABLE_PARTIAL__=${JSON.stringify(ASR_ENABLE_PARTIAL)};</script>`;
      body = data.includes("</head>") ? data.replace("</head>", `${runtimeBootstrap}\n  </head>`) : `${runtimeBootstrap}${data}`;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(ext === ".html" ? body : Buffer.from(data));
  });
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shapeDetails(shape) {
  return SHAPE_GUIDES[shape] || SHAPE_GUIDES.unknown;
}

function getStepGuide(stepTitle) {
  return STEP_GUIDES[stepTitle] || {
    focus: "先把当前区域做到干净、轻薄、方向明确。",
    checkpoints: ["观察画面是否均衡", "确认重点是否清楚", "避免一次性下手过重"],
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildModuleSignalHighlights(moduleSignals) {
  const highlights = [];
  const gpupixel = moduleSignals?.gpupixel || {};
  const summary = normalizeText(gpupixel.summary);
  const mode = normalizeText(gpupixel.mode);

  if (summary) {
    highlights.push(summary);
  }
  if (mode) {
    highlights.push(`GPUPixel mode: ${mode}`);
  }

  return highlights.slice(0, 3);
}

function buildModuleFocus(moduleSignals) {
  const mode = normalizeText(moduleSignals?.gpupixel?.mode);
  return mode ? `GPUPixel active mode: ${mode}` : "";
}

function buildLocalAdvice(input) {
  const faceShape = String(input.faceProfile?.shape || "unknown");
  const detail = shapeDetails(faceShape);
  const stepTitle = String(input.currentStep || ROUTINE_TITLES[0]);
  const stepGuide = getStepGuide(stepTitle);
  const userRequest = String(input.userRequest || "").trim();
  const confidence = Number(input.faceProfile?.confidence || 0);
  const observation = String(input.observation || "").trim();
  const moduleHighlights = buildModuleSignalHighlights(input.moduleSignals);
  const moduleFocus = buildModuleFocus(input.moduleSignals);

  const summaryCore = userRequest
    ? `好呀，我明白你想要“${userRequest}”。你现在的整体状态已经很不错啦，我们先把 ${stepTitle} 轻轻调整到位，效果会更自然。`
    : `你现在的整体状态已经很不错啦，我们先轻轻处理一下 ${stepTitle}，再慢慢看下一步。`;
  const summary = moduleFocus ? `${summaryCore} ${moduleFocus}` : summaryCore;

  const nextStep = stepTitle === "修容腮红"
    ? `可以先这样试试哦：${detail.contour} 完成后再补 ${detail.blush}`
    : moduleFocus || `可以先这样试试哦：${stepGuide.focus}`;

  const tips = [
    `${detail.signature}`,
    `${detail.brow}`,
    observation || "保持正脸、光线均匀，系统能给出更稳定的下一步建议。",
  ];
  if (moduleHighlights.length) {
    tips.unshift(moduleHighlights[0]);
  }

  return {
    integration: "local-fallback",
    source: "rule-engine",
    summary,
    faceShape: {
      key: faceShape,
      label: detail.label,
      confidence,
    },
    teachingFocus: stepGuide.focus,
    nextStep,
    speakText: "",
    tips,
    routineTweaks: [
      detail.contour,
      detail.blush,
      stepGuide.checkpoints[0],
    ],
    checkpoints: stepGuide.checkpoints,
    meta: {
      vision: "unavailable-or-disabled",
      openharness: "unavailable-or-disabled",
      reason: "Ark Vision not ready, returned local guidance.",
      moduleHighlights,
    },
  };
}

function extractJsonCandidate(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) {
    return null;
  }

  let depth = 0;
  for (let index = firstBrace; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(firstBrace, index + 1);
      }
    }
  }
  return null;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function splitCommandString(commandText) {
  return String(commandText || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function buildOpenHarnessSpawnSpec() {
  if (OPENHARNESS_COMMAND.trim()) {
    const parts = splitCommandString(OPENHARNESS_COMMAND);
    if (!parts.length) {
      return null;
    }
    return {
      command: parts[0],
      args: parts.slice(1),
      description: OPENHARNESS_COMMAND.trim(),
    };
  }

  if (OPENHARNESS_RUNTIME === "uv") {
    const uvCommand = fs.existsSync(OPENHARNESS_UV_EXE) ? OPENHARNESS_UV_EXE : "uv";
    return {
      command: uvCommand,
      args: ["run", "oh", "--backend-only"],
      description: `${uvCommand} run oh --backend-only`,
    };
  }

  return null;
}

function buildOpenHarnessRequest(line) {
  return JSON.stringify({
    type: "submit_line",
    line,
  }) + "\n";
}

function normalizeOpenHarnessReply(text) {
  return normalizeText(text).replace(/\s+/gu, " ").trim();
}

function isVoiceConversation(payload) {
  return typeof payload?.source === "string" && payload.source.startsWith("voice");
}

function isOpenHarnessConversation(payload) {
  const source = normalizeText(payload?.source);
  return source.startsWith("voice") || source === "text-send" || source === "text-enter";
}

function splitReplyIntoSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[。！？!?；;，,])/u)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildOpenHarnessPrompt(input) {
  const streamAsr = input.streamAsr || null;
  const faceProfile = input.faceProfile || {};
  const moduleSignals = input.moduleSignals || {};
  const step = normalizeText(input.currentStep) || "妆前准备";
  const request = normalizeText(input.userRequest) || "请根据我当前镜头状态给我下一步化妆建议。";
  const source = normalizeText(input.source) || "manual";
  const observation = normalizeText(input.observation) || "无额外观察";
  const faceShape = normalizeText(faceProfile.label || faceProfile.shape || "待确认");
  const faceConfidence = Number(faceProfile.confidence || 0);
  const gpupixelSummary = normalizeText(moduleSignals?.gpupixel?.summary) || "GPUPixel native beauty engine is active.";
  const gpupixelMode = normalizeText(moduleSignals?.gpupixel?.mode) || "native-video-client";

  return [
    "你现在是美妆镜里的中文语音教练“魔镜”。",
    "用户正在镜前化妆，刚刚通过语音对你说话。",
    "请直接用中文回复用户，口吻自然、简洁、可执行，不要解释你的推理过程。",
    "只给当前最值得做的一步，不要列太多步骤。",
    "尽量具体到位置、方向、轻重。",
    WARM_MIRROR_STYLE_INSTRUCTION,
    input.gpupixelControl?.applied
      ? "本轮美颜参数已经在回复前执行完成。不要让用户再次开启或调整，也不要重复确认操作；直接接一句温柔、简短的搭配建议。"
      : "如果用户只是咨询，就按温柔闺蜜型语气正常回答。",
    "请自主判断回答是否需要当前画面的视觉证据。",
    "如果需要当前画面，调用 inspect_current_beauty_frame，并把下面的视觉请求 ID 原样放入 request_id；同一轮最多调用一次。",
    "如果是普通知识、打招呼或单纯调整美颜参数，不要调用视觉工具。",
    "视觉工具失败或返回看不清时，不要猜测用户的脸型或外观。",
    `视觉请求 ID: ${normalizeText(input.visionRequestId)}`,
    `语音来源: ${source}`,
    `用户诉求: ${request}`,
    `当前步骤: ${step}`,
    `镜头观察: ${observation}`,
    `脸型倾向: ${faceShape} (${percent(faceConfidence)})`,
    `GPUPixel: ${gpupixelSummary}`,
    `GPUPixel mode: ${gpupixelMode}`,
    streamAsr
      ? `ASR 协议层: ${streamAsr.provider}/${streamAsr.mode} partial=${streamAsr.transcript?.partialTranscript ? "yes" : "no"} final=${streamAsr.transcript?.finalTranscript ? "yes" : "no"}`
      : "ASR 协议层: unavailable",
    "请直接给一段适合语音播报的回复。",
  ].join("\n");
}

function createOpenHarnessBridge() {
  return {
    process: null,
    reader: null,
    pending: [],
    started: false,
    startError: "",
    commandDescription: "",
    lastReadyMessage: "",
    startPromise: null,
    lastStderr: "",
    tuningApplied: false,
    lastFailureAt: 0,
    lastFailureReason: "",
  };
}

const openHarnessBridge = createOpenHarnessBridge();

function clearOpenHarnessPendingTimer(item) {
  if (item && item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }
}

function removeOpenHarnessPendingItem(item) {
  const itemIndex = openHarnessBridge.pending.indexOf(item);
  if (itemIndex >= 0) {
    openHarnessBridge.pending.splice(itemIndex, 1);
  }
}

function flushOpenHarnessQueue(errorMessage) {
  while (openHarnessBridge.pending.length) {
    const item = openHarnessBridge.pending.shift();
    if (!item) {
      continue;
    }
    clearOpenHarnessPendingTimer(item);
    item.reject(new Error(errorMessage));
  }
}

function resetOpenHarnessBridgeProcessState() {
  openHarnessBridge.process = null;
  openHarnessBridge.reader = null;
  openHarnessBridge.started = false;
  openHarnessBridge.startPromise = null;
  openHarnessBridge.tuningApplied = false;
}

function markOpenHarnessFailure(reason) {
  const message = normalizeText(reason) || "OpenHarness request failed";
  openHarnessBridge.lastFailureAt = Date.now();
  openHarnessBridge.lastFailureReason = message;
  return message;
}

function notifyPendingOpenHarnessTool(event) {
  const item = openHarnessBridge.pending[0];
  if (!item) {
    return;
  }
  if (event.type === "tool_started" && typeof item.onToolStarted === "function") {
    item.onToolStarted(event.tool_name || "", event.tool_input || {});
  }
  if (event.type === "tool_completed" && typeof item.onToolCompleted === "function") {
    item.onToolCompleted(event.tool_name || "", event.output || "", Boolean(event.is_error));
  }
}

function handleOpenHarnessEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (event.type === "ready") {
    openHarnessBridge.started = true;
    openHarnessBridge.startError = "";
    openHarnessBridge.lastReadyMessage = "OpenHarness backend ready";
    openHarnessBridge.lastFailureAt = 0;
    openHarnessBridge.lastFailureReason = "";
    return;
  }

  if (event.type === "assistant_complete") {
    if (!shouldResolveOpenHarnessAssistant(event)) {
      return;
    }
    const item = openHarnessBridge.pending.shift();
    if (item) {
      clearOpenHarnessPendingTimer(item);
      item.resolve(normalizeOpenHarnessReply(event.message || ""));
    }
    return;
  }

  if (event.type === "assistant_delta") {
    const item = openHarnessBridge.pending[0];
    if (item && typeof item.onDelta === "function") {
      item.onDelta(event.message || "");
    }
    return;
  }

  if (event.type === "tool_started" || event.type === "tool_completed") {
    notifyPendingOpenHarnessTool(event);
    return;
  }

  if (event.type === "error") {
    const item = openHarnessBridge.pending.shift();
    if (item) {
      item.reject(new Error(normalizeText(event.message) || "OpenHarness 返回错误"));
    }
  }
}

function startOpenHarnessBridge() {
  if (openHarnessBridge.process || openHarnessBridge.startError) {
    return;
  }

  const spawnSpec = buildOpenHarnessSpawnSpec();
  if (!spawnSpec) {
    openHarnessBridge.startError = "未配置可用的 OpenHarness 启动命令。";
    return;
  }

  if (!fs.existsSync(OPENHARNESS_DIR)) {
    openHarnessBridge.startError = `找不到 OpenHarness 目录: ${OPENHARNESS_DIR}`;
    return;
  }

  const env = {
    ...process.env,
    UV_CACHE_DIR: OPENHARNESS_UV_CACHE_DIR,
  };
  if (OPENHARNESS_MODEL) {
    env.OPENHARNESS_MODEL = OPENHARNESS_MODEL;
  }
  if (OPENHARNESS_API_FORMAT) {
    env.OPENHARNESS_API_FORMAT = OPENHARNESS_API_FORMAT;
  }
  if (OPENHARNESS_BASE_URL) {
    env.OPENHARNESS_BASE_URL = OPENHARNESS_BASE_URL;
  }
  if (OPENHARNESS_API_KEY) {
    env.OPENAI_API_KEY = OPENHARNESS_API_KEY;
  }

  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: OPENHARNESS_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  openHarnessBridge.commandDescription = spawnSpec.description;
  openHarnessBridge.process = child;

  const reader = readline.createInterface({
    input: child.stdout,
  });
  openHarnessBridge.reader = reader;

  reader.on("line", (line) => {
    if (!line.startsWith(OPENHARNESS_PROTOCOL_PREFIX)) {
      return;
    }
    const event = safeParseJson(line.slice(OPENHARNESS_PROTOCOL_PREFIX.length));
    handleOpenHarnessEvent(event);
  });

  child.stderr.on("data", (chunk) => {
    const text = normalizeText(chunk.toString("utf8"));
    if (text && !openHarnessBridge.startError) {
      openHarnessBridge.startError = text;
    }
  });

  child.on("error", (error) => {
    openHarnessBridge.startError = error.message;
    flushOpenHarnessQueue(error.message);
    openHarnessBridge.process = null;
  });

  child.on("exit", (code) => {
    const message =
      openHarnessBridge.startError ||
      `OpenHarness 进程已退出 (${code == null ? "unknown" : code})`;
    flushOpenHarnessQueue(message);
    openHarnessBridge.process = null;
    openHarnessBridge.reader = null;
    openHarnessBridge.started = false;
  });
}

function submitToOpenHarness(line) {
  return new Promise((resolve, reject) => {
    startOpenHarnessBridge();

    if (!openHarnessBridge.process || !openHarnessBridge.process.stdin) {
      reject(new Error(openHarnessBridge.startError || "OpenHarness 未启动"));
      return;
    }

    openHarnessBridge.pending.push({ resolve, reject });
    openHarnessBridge.process.stdin.write(buildOpenHarnessRequest(line), "utf8", (error) => {
      if (!error) {
        return;
      }
      const itemIndex = openHarnessBridge.pending.findIndex((item) => item.resolve === resolve);
      if (itemIndex >= 0) {
        openHarnessBridge.pending.splice(itemIndex, 1);
      }
      reject(error);
    });
  });
}

function flushOpenHarnessQueue(errorMessage) {
  while (openHarnessBridge.pending.length) {
    const item = openHarnessBridge.pending.shift();
    if (!item) {
      continue;
    }
    clearOpenHarnessPendingTimer(item);
    item.reject(new Error(errorMessage));
  }
}

function resetOpenHarnessBridgeProcessState() {
  openHarnessBridge.process = null;
  openHarnessBridge.reader = null;
  openHarnessBridge.started = false;
  openHarnessBridge.startPromise = null;
}

function handleOpenHarnessEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (event.type === "ready") {
    openHarnessBridge.started = true;
    openHarnessBridge.startError = "";
    openHarnessBridge.lastReadyMessage = "OpenHarness backend ready";
    return;
  }

  if (event.type === "assistant_complete") {
    if (!shouldResolveOpenHarnessAssistant(event)) {
      return;
    }
    const item = openHarnessBridge.pending.shift();
    if (item) {
      clearOpenHarnessPendingTimer(item);
      item.resolve(normalizeOpenHarnessReply(event.message || ""));
    }
    return;
  }

  if (event.type === "assistant_delta") {
    const item = openHarnessBridge.pending[0];
    if (item && typeof item.onDelta === "function") {
      item.onDelta(event.message || "");
    }
    return;
  }

  if (event.type === "tool_started" || event.type === "tool_completed") {
    notifyPendingOpenHarnessTool(event);
    return;
  }

  if (event.type === "error") {
    const item = openHarnessBridge.pending.shift();
    if (item) {
      clearOpenHarnessPendingTimer(item);
      item.reject(new Error(normalizeText(event.message) || "OpenHarness returned an error."));
    }
  }
}

function startOpenHarnessBridge() {
  if (openHarnessBridge.started && openHarnessBridge.process) {
    return Promise.resolve(openHarnessBridge);
  }

  if (openHarnessBridge.startPromise) {
    return openHarnessBridge.startPromise;
  }

  const spawnSpec = buildOpenHarnessSpawnSpec();
  if (!spawnSpec) {
    openHarnessBridge.startError = "No OpenHarness launch command is configured.";
    return Promise.reject(new Error(openHarnessBridge.startError));
  }

  if (!fs.existsSync(OPENHARNESS_DIR)) {
    openHarnessBridge.startError = `OpenHarness directory not found: ${OPENHARNESS_DIR}`;
    return Promise.reject(new Error(openHarnessBridge.startError));
  }

  const env = {
    ...process.env,
    UV_CACHE_DIR: OPENHARNESS_UV_CACHE_DIR,
  };
  if (OPENHARNESS_MODEL) {
    env.OPENHARNESS_MODEL = OPENHARNESS_MODEL;
  }
  if (OPENHARNESS_API_FORMAT) {
    env.OPENHARNESS_API_FORMAT = OPENHARNESS_API_FORMAT;
  }
  if (OPENHARNESS_BASE_URL) {
    env.OPENHARNESS_BASE_URL = OPENHARNESS_BASE_URL;
  }
  if (OPENHARNESS_API_KEY) {
    env.OPENAI_API_KEY = OPENHARNESS_API_KEY;
  }

  openHarnessBridge.startError = "";
  openHarnessBridge.lastStderr = "";
  openHarnessBridge.lastReadyMessage = "OpenHarness starting";
  openHarnessBridge.commandDescription = spawnSpec.description;

  openHarnessBridge.startPromise = new Promise((resolve, reject) => {
    let child = null;
    let startupSettled = false;
    let readyTimer = null;

    const settleStartup = (error) => {
      if (startupSettled) {
        return;
      }
      startupSettled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      openHarnessBridge.startPromise = null;
      if (error) {
        openHarnessBridge.startError = normalizeText(error.message) || "OpenHarness startup failed";
        reject(error);
        return;
      }
      openHarnessBridge.startError = "";
      if (!openHarnessBridge.tuningApplied) {
        openHarnessBridge.tuningApplied = true;
        void writeOpenHarnessCommand("/fast on").catch(() => {});
        void writeOpenHarnessCommand("/effort low").catch(() => {});
        void writeOpenHarnessCommand("/passes 1").catch(() => {});
      }
      resolve(openHarnessBridge);
    };

    try {
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: OPENHARNESS_DIR,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      settleStartup(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    openHarnessBridge.process = child;

    const reader = readline.createInterface({
      input: child.stdout,
    });
    openHarnessBridge.reader = reader;

    readyTimer = setTimeout(() => {
      const stderrText = normalizeText(openHarnessBridge.lastStderr);
      const timeoutMessage = stderrText
        ? `OpenHarness startup timed out: ${stderrText}`
        : `OpenHarness startup timed out: no ready event within ${OPENHARNESS_READY_TIMEOUT_MS}ms`;
      openHarnessBridge.startError = timeoutMessage;
      if (child && !child.killed) {
        try {
          child.kill();
        } catch (_error) {
          // Ignore kill errors here.
        }
      }
      settleStartup(new Error(timeoutMessage));
      resetOpenHarnessBridgeProcessState();
    }, OPENHARNESS_READY_TIMEOUT_MS);

    reader.on("line", (line) => {
      if (!line.startsWith(OPENHARNESS_PROTOCOL_PREFIX)) {
        return;
      }
      const event = safeParseJson(line.slice(OPENHARNESS_PROTOCOL_PREFIX.length));
      handleOpenHarnessEvent(event);
      if (event?.type === "ready") {
        settleStartup(null);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = normalizeText(chunk.toString("utf8"));
      if (!text) {
        return;
      }
      openHarnessBridge.lastStderr = openHarnessBridge.lastStderr
        ? `${openHarnessBridge.lastStderr}\n${text}`
        : text;
    });

    child.on("error", (error) => {
      const message = normalizeText(error.message) || "OpenHarness process error";
      openHarnessBridge.startError = message;
      flushOpenHarnessQueue(message);
      resetOpenHarnessBridgeProcessState();
      settleStartup(new Error(message));
    });

    child.on("exit", (code) => {
      const exitedBeforeReady = !openHarnessBridge.started;
      const stderrText = normalizeText(openHarnessBridge.lastStderr);
      const message =
        openHarnessBridge.startError ||
        (stderrText
          ? `OpenHarness exited (${code == null ? "unknown" : code}): ${stderrText}`
          : `OpenHarness exited (${code == null ? "unknown" : code})`);
      flushOpenHarnessQueue(message);
      resetOpenHarnessBridgeProcessState();
      if (exitedBeforeReady) {
        settleStartup(new Error(message));
      }
    });
  });

  return openHarnessBridge.startPromise;
}

async function submitToOpenHarness(line) {
  await startOpenHarnessBridge();

  if (!openHarnessBridge.started || !openHarnessBridge.process || !openHarnessBridge.process.stdin) {
    throw new Error(openHarnessBridge.startError || "OpenHarness did not become ready.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const pendingItem = {
      timer: null,
      resolve: (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearOpenHarnessPendingTimer(pendingItem);
        resolve(value);
      },
      reject: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearOpenHarnessPendingTimer(pendingItem);
        reject(error);
      },
    };

    pendingItem.timer = setTimeout(() => {
      removeOpenHarnessPendingItem(pendingItem);
      pendingItem.reject(
        new Error(`OpenHarness request timed out after ${OPENHARNESS_REQUEST_TIMEOUT_MS}ms`)
      );
    }, OPENHARNESS_REQUEST_TIMEOUT_MS);

    openHarnessBridge.pending.push(pendingItem);
    openHarnessBridge.process.stdin.write(buildOpenHarnessRequest(line), "utf8", (error) => {
      if (!error) {
        return;
      }
      removeOpenHarnessPendingItem(pendingItem);
      pendingItem.reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function writeOpenHarnessCommand(line) {
  await startOpenHarnessBridge();
  if (!openHarnessBridge.process || !openHarnessBridge.process.stdin) {
    throw new Error(openHarnessBridge.startError || "OpenHarness did not become ready.");
  }
  return new Promise((resolve, reject) => {
    openHarnessBridge.process.stdin.write(buildOpenHarnessRequest(line), "utf8", (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    });
  });
}

function interruptOpenHarness() {
  if (!openHarnessBridge.process || !openHarnessBridge.process.stdin || !openHarnessBridge.started) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    openHarnessBridge.process.stdin.write(`${JSON.stringify({ type: "interrupt" })}\n`, "utf8", (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    });
  });
}

function buildPrompt(input) {
  const context = {
    user_request: input.userRequest || "",
    current_step: input.currentStep || "",
    step_index: input.stepIndex || 1,
    face_profile: input.faceProfile || {},
    observation: input.observation || "",
    preferred_style: input.preferredStyle || "",
    module_signals: input.moduleSignals || {},
  };

  return [
    "你是一个专业、克制、实用的 makeup 教练，请直接根据用户当前镜头状态给建议。",
    "请优先直接分析，不要调用工具，除非完全无法回答。",
    "回答必须是 JSON 对象，不要添加 Markdown，不要加代码块。",
    "JSON schema:",
    '{"summary":"", "faceShape":{"key":"","label":"","confidence":0}, "teachingFocus":"", "nextStep":"", "speakText":"", "tips":[""], "routineTweaks":[""], "checkpoints":[""]}',
    "要求:",
    "1. 先判断可能脸型，如果不确定要明确说可能。",
    "2. 只给当前最值得做的一步，不要一次塞太多动作。",
    "3. 语言务必具体到位置、方向、轻重，不要空泛鼓励。",
    "4. 不要做医疗判断，不要夸大效果。",
    `用户上下文: ${JSON.stringify(context, null, 2)}`,
  ].join("\n");
}

function moduleDescriptor({
  key,
  name,
  mode,
  source,
  purpose,
  status,
  available,
  detail,
  endpoint = null,
}) {
  return {
    key,
    name,
    mode,
    source,
    purpose,
    status,
    available,
    detail,
    endpoint,
  };
}

function buildServiceHealthUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/health";
  }
  return parsed.toString();
}

function buildServiceApiUrl(rawUrl, apiPath) {
  const parsed = new URL(rawUrl);
  parsed.pathname = apiPath;
  return parsed.toString();
}

function fetchServiceProbe(urlString) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (error) {
      reject(new Error(`Invalid URL: ${error.message}`));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const request = transport.request(
      parsedUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain;q=0.8, */*;q=0.5",
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk.toString("utf8");
        });
        response.on("end", () => {
          const payload = safeParseJson(raw);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            payload,
            text: normalizeText(raw),
          });
        });
      }
    );

    request.setTimeout(MODULE_PROBE_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out after ${MODULE_PROBE_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function probeServiceModule(key, name, source, purpose, rawUrl) {
  if (!normalizeText(rawUrl)) {
    return moduleDescriptor({
      key,
      name,
      source,
      purpose,
      mode: "service-adapter",
      status: "standby",
      available: false,
      detail: "未配置服务地址，当前保留为系统适配层。",
    });
  }

  try {
    const endpoint = buildServiceHealthUrl(rawUrl);
    const result = await fetchServiceProbe(endpoint);
    const payloadStatus = normalizeText(result.payload?.status).toLowerCase();
    const available =
      result.ok &&
      (payloadStatus
        ? payloadStatus === "ready"
        : Boolean(result.payload?.available ?? result.payload?.ok ?? result.ok));
    const status = payloadStatus || (available ? "ready" : result.ok ? "warming" : "error");
    const detail =
      normalizeText(result.payload?.detail) ||
      normalizeText(result.payload?.reason) ||
      normalizeText(result.payload?.message) ||
      (result.ok ? `????????? (${result.statusCode})` : `????????? (${result.statusCode})`);

    return moduleDescriptor({
      key,
      name,
      source,
      purpose,
      mode: "service-adapter",
      status,
      available,
      detail,
      endpoint,
    });
  } catch (error) {
    return moduleDescriptor({
      key,
      name,
      source,
      purpose,
      mode: "service-adapter",
      status: "error",
      available: false,
      detail: error.message,
      endpoint: rawUrl,
    });
  }
}

async function requestGpupixelAdvice(payload) {
  if (!normalizeText(GPUPIXEL_SERVICE_URL)) {
    return {
      available: false,
      reason: "GPUPixel service URL is not configured.",
    };
  }

  const endpoint = buildServiceApiUrl(GPUPIXEL_SERVICE_URL, "/v1/advice");
  const result = await requestJson(endpoint, {
    method: "POST",
    body: payload,
    timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 8000),
  });

  if (!result.ok) {
    throw new Error(
      normalizeText(result.payload?.error) ||
        normalizeText(result.payload?.message) ||
        result.text ||
        `GPUPixel adapter error (${result.statusCode})`
    );
  }

  return {
    available: true,
    endpoint,
    payload: result.payload || {},
  };
}

async function requestGpupixelControl(apiPath, { method = "GET", body = null } = {}) {
  if (!normalizeText(GPUPIXEL_SERVICE_URL)) {
    throw new Error("GPUPixel service URL is not configured.");
  }
  const endpoint = buildServiceApiUrl(GPUPIXEL_SERVICE_URL, apiPath);
  const result = await requestJson(endpoint, {
    method,
    body,
    timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 8000),
  });
  if (!result.ok) {
    throw new Error(
      normalizeText(result.payload?.error) ||
        normalizeText(result.payload?.message) ||
        `GPUPixel adapter error (${result.statusCode})`
    );
  }
  return result.payload;
}

const GPUPIXEL_PARAM_SKILLS = [
  { key: "smoothing", label: "磨皮", aliases: ["磨皮", "皮肤", "光滑", "细腻"], min: 0, max: 10, step: 1 },
  { key: "whitening", label: "提亮", aliases: ["提亮", "亮度", "变亮", "美白", "白一点", "亮一点"], min: 0, max: 10, step: 1 },
  { key: "faceSlim", label: "瘦脸", aliases: ["瘦脸", "小脸", "脸瘦", "脸小", "脸变瘦", "脸变得瘦", "变瘦", "瘦一点"], min: 0, max: 4, step: 0.5 },
  { key: "eyeEnlarge", label: "大眼", aliases: ["大眼", "眼睛", "放大眼", "眼睛大"], min: 0, max: 8, step: 0.8 },
  { key: "mouthResize", label: "嘴型", aliases: ["嘴型", "嘴巴", "嘴唇大小", "嘴"], min: -1, max: 1, step: 0.25 },
  { key: "noseResize", label: "鼻型", aliases: ["鼻型", "鼻子", "鼻"], min: -1, max: 1, step: 0.2 },
  { key: "eyebrow", label: "眉毛", aliases: ["眉毛", "眉色", "眉"], min: 0, max: 10, step: 1 },
  { key: "blusher", label: "腮红", aliases: ["腮红", "脸颊红", "气色"], min: 0, max: 10, step: 1 },
];

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function collectGpupixelCommandText(payload) {
  return [
    payload?.userRequest,
    payload?.finalTranscript,
    payload?.stableTranscript,
    payload?.partialTranscript,
    payload?.streamAsr?.transcript?.finalTranscript,
    payload?.streamAsr?.transcript?.stableTranscript,
    payload?.streamAsr?.transcript?.partialTranscript,
    payload?.realtimeSnapshot?.transcript?.finalTranscript,
    payload?.realtimeSnapshot?.transcript?.stableTranscript,
    payload?.realtimeSnapshot?.transcript?.partialTranscript,
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(" ");
}

function parseGpupixelParamCommand(payload, currentParams) {
  const text = collectGpupixelCommandText(payload);
  if (!text) {
    return null;
  }

  const skill = GPUPIXEL_PARAM_SKILLS.find((candidate) =>
    candidate.aliases.some((alias) => text.includes(alias))
  );
  if (!skill) {
    return null;
  }

  const current = Number(currentParams?.[skill.key] ?? 0);
  const numberMatch = text.match(/(?:到|为|成|设为|设置为|调到|拉到)\s*(-?\d+(?:\.\d+)?)/);
  const rawNumber = numberMatch ? Number(numberMatch[1]) : null;
  const wantsOff = /关闭|关掉|不要|去掉|清零|归零|取消/.test(text);
  const wantsDown = /降低|调低|减|少|弱|淡|小|缩/.test(text);
  const wantsUp = /提高|调高|增加|加|更|一点|一下|强|明显|大|亮|白|红/.test(text);
  const large = /很多|大幅|拉满|最大|最强|非常|特别/.test(text);

  let next = current;
  let mode = "none";
  if (wantsOff) {
    next = skill.key === "mouthResize" || skill.key === "noseResize" ? 0 : skill.min;
    mode = "off";
  } else if (rawNumber != null && Number.isFinite(rawNumber)) {
    next = rawNumber;
    mode = "absolute";
  } else {
    let direction = wantsDown ? -1 : 1;
    if ((skill.key === "mouthResize" || skill.key === "noseResize") && /缩小|小一点|小一下|收/.test(text)) {
      direction = -1;
    }
    const delta = skill.step * (large ? 2 : 1) * direction;
    next = current + delta;
    mode = direction >= 0 ? "increase" : "decrease";
  }

  next = clampNumber(next, skill.min, skill.max);
  if (Math.abs(next - current) < 0.0001 && mode !== "absolute" && !wantsOff) {
    return null;
  }

  return {
    key: skill.key,
    label: skill.label,
    value: Number(next.toFixed(2)),
    previousValue: Number(current.toFixed(2)),
    mode,
    text,
  };
}

async function applyGpupixelParamCommand(payload) {
  const currentResult = await requestGpupixelControl("/v1/params");
  const currentParams = currentResult?.params || {};
  const command = parseGpupixelParamCommand(payload, currentParams);
  if (!command) {
    return {
      applied: false,
      reason: "No GPUPixel parameter command detected.",
      params: currentParams,
    };
  }

  const nextParams = {
    ...currentParams,
    [command.key]: command.value,
  };
  const writeResult = await requestGpupixelControl("/v1/params", {
    method: "POST",
    body: { params: nextParams },
  });

  return {
    applied: true,
    command,
    params: writeResult?.params || nextParams,
    message: buildGpupixelControlMessage(command),
  };
}

async function handleGpupixelControl(req, res, apiPath) {
  try {
    const raw = req.method === "POST" ? await readRequestBody(req) : "";
    const payload = raw ? JSON.parse(raw) : null;
    const result = await requestGpupixelControl(apiPath, {
      method: req.method,
      body: payload,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
    });
  }
}

function mergeGpupixelAdvice(baseAdvice, gpupixelResult) {
  const gpupixelAdvice = gpupixelResult?.payload?.advice;
  if (!gpupixelAdvice || typeof gpupixelAdvice !== "object") {
    return baseAdvice;
  }

  const preset = gpupixelAdvice.preset || {};
  const presetLabel = normalizeText(preset.presetLabel) || "GPUPixel 原生建议";
  const styleIntent = normalizeText(preset.styleIntent) || "balanced";
  const tips = Array.isArray(baseAdvice.tips) ? [...baseAdvice.tips] : [];
  tips.unshift(`${presetLabel}(${styleIntent})`);

  const checkpoints = Array.isArray(baseAdvice.checkpoints) ? [...baseAdvice.checkpoints] : [];
  for (const item of gpupixelAdvice.checkpoints || []) {
    if (normalizeText(item) && !checkpoints.includes(item)) {
      checkpoints.push(item);
    }
  }

  return {
    ...baseAdvice,
    integration: baseAdvice.integration === "ark-vision" ? "ark-vision+gpupixel" : "gpupixel-adapter",
    summary: `${baseAdvice.summary} ${gpupixelAdvice.summary || ""}`.trim(),
    nextStep: gpupixelAdvice.nextStep || baseAdvice.nextStep,
    replyText: baseAdvice.replyText || baseAdvice.rawReplyText || baseAdvice.nextStep || baseAdvice.summary,
    rawReplyText: baseAdvice.rawReplyText || baseAdvice.replyText || "",
    tips: tips.slice(0, 6),
    checkpoints: checkpoints.slice(0, 6),
    gpupixel: {
      available: true,
      endpoint: gpupixelResult.endpoint,
      preset,
      nativeRuntime: gpupixelResult.payload?.nativeRuntime || null,
    },
    meta: {
      ...(baseAdvice.meta || {}),
      gpupixel: "active",
      gpupixelPreset: preset.presetKey || "",
      gpupixelProvider: "pixpark/gpupixel",
    },
  };
}

function probeArkVision() {
  if (!normalizeText(ARK_API_KEY)) {
    return {
      available: false,
      status: "missing-api-key",
      reason: "未配置 ARK_API_KEY，当前无法调用 Ark 视觉模型。",
      provider: "volcengine-ark",
      model: ARK_VISION_MODEL,
      endpoint: ARK_RESPONSES_URL,
    };
  }

  return {
    available: true,
    status: "ready",
    reason: `Ark 视觉模型已配置：${ARK_VISION_MODEL}`,
    provider: "volcengine-ark",
    model: ARK_VISION_MODEL,
    endpoint: ARK_RESPONSES_URL,
  };
}

function probeOpenHarnessBridge() {
  Promise.resolve(startOpenHarnessBridge()).catch((error) => {
    openHarnessBridge.startError = normalizeText(error?.message) || "OpenHarness startup failed";
    markOpenHarnessFailure(openHarnessBridge.startError);
  });

  if (openHarnessBridge.started) {
    return {
      available: true,
      status: "ready",
      reason:
        openHarnessBridge.lastReadyMessage ||
        (openHarnessBridge.lastFailureReason
          ? `OpenHarness backend ready, last request fallback: ${openHarnessBridge.lastFailureReason}`
          : "OpenHarness backend ready"),
      command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
    };
  }

  if (openHarnessBridge.process) {
    return {
      available: false,
      status: "loading",
      reason: "OpenHarness 正在启动中。",
      command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
    };
  }

  return {
    available: false,
    status: openHarnessBridge.startError ? "error" : "standby",
    reason: openHarnessBridge.startError || "OpenHarness 尚未启动。",
    command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
  };
}

async function buildModuleHealth(visionRuntime, openHarnessRuntime) {
  const [gpupixel, localAsr, localTts] = await Promise.all([
    probeServiceModule(
      "gpupixel",
      "GPUPixel",
      "pixpark/gpupixel",
      "Native GPUPixel beauty engine and parameter adapter.",
      GPUPIXEL_SERVICE_URL
    ),
    probeServiceModule(
      "localAsr",
      ASR_PROVIDER === "funasr-local" ? "FunASR Local ASR" : "Whisper Local ASR",
      ASR_PROVIDER === "funasr-local" ? "FunASR / paraformer-zh-streaming" : "faster-whisper",
      ASR_PROVIDER === "funasr-local"
        ? "Local FunASR streaming-capable speech-to-text service used to replace browser-native recognition."
        : "Local faster-whisper speech-to-text service used to replace browser-native recognition.",
      LOCAL_ASR_SERVICE_URL
    ),
    probeServiceModule(
      "localTts",
      "Windows Local TTS",
      "System.Speech / Microsoft Huihui Desktop",
      "Local offline speech synthesis service used to replace browser online voices.",
      LOCAL_TTS_SERVICE_URL
    ),
  ]);

  return {
    localAsr,
    localTts,
    gpupixel,
    openharness: moduleDescriptor({
      key: "openharness",
      name: "OpenHarness",
      source: openHarnessRuntime.command || "uv run oh --backend-only",
      purpose: "Beauty mirror voice/chat agent runtime.",
      mode: "agent-runtime",
      status: openHarnessRuntime.status || "standby",
      available: openHarnessRuntime.available,
      detail: openHarnessRuntime.reason,
      endpoint: null,
    }),
  };
}
function requestJson(urlString, { method = "POST", headers = {}, body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (error) {
      reject(new Error(`Invalid URL: ${error.message}`));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const rawBody = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    const request = transport.request(
      parsedUrl,
      {
        method,
        headers: {
          Accept: "application/json, text/plain;q=0.8, */*;q=0.5",
          ...(rawBody
            ? {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(rawBody),
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk.toString("utf8");
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            payload: safeParseJson(raw),
            text: normalizeText(raw),
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (rawBody) {
      request.write(rawBody);
    }
    request.end();
  });
}

function requestBuffer(
  urlString,
  {
    timeoutMs = CURRENT_FRAME_TIMEOUT_MS,
    maxBytes = CURRENT_FRAME_MAX_BYTES,
  } = {}
) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (error) {
      reject(new Error(`Invalid URL: ${error.message}`));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const request = transport.get(parsedUrl, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Frame endpoint returned ${response.statusCode}`));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          request.destroy(new Error("Current frame exceeded the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks),
          contentType: normalizeText(response.headers["content-type"]) || "image/jpeg",
        });
      });
      response.on("error", reject);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Current frame timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

function extractArkText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  const pushText = (value) => {
    if (typeof value === "string" && value.trim()) {
      chunks.push(value.trim());
    }
  };
  const walkContent = (content) => {
    if (typeof content === "string") {
      pushText(content);
      return;
    }
    if (!Array.isArray(content)) {
      return;
    }
    for (const item of content) {
      pushText(item?.text);
      pushText(item?.output_text);
      pushText(item?.content);
    }
  };

  walkContent(payload.content);
  walkContent(payload.output);

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      pushText(item?.text);
      walkContent(item?.content);
    }
  }

  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      pushText(choice?.message?.content);
      walkContent(choice?.message?.content);
    }
  }

  return chunks.join("\n").trim();
}

async function callArkCurrentFrameVision({ imageBuffer, imageMimeType, question, analysisFocus }) {
  const imageUrl = `data:${imageMimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const result = await requestJson(ARK_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: {
      model: ARK_VISION_MODEL,
      max_output_tokens: 800,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: imageUrl,
            },
            {
              type: "input_text",
              text: buildCurrentFrameVisionPrompt({
                question,
                analysisFocus,
              }),
            },
          ],
        },
      ],
    },
    timeoutMs: CURRENT_FRAME_VISION_TIMEOUT_MS,
  });

  if (!result.ok) {
    throw new Error(
      normalizeText(result.payload?.error?.message) ||
        normalizeText(result.payload?.message) ||
        result.text ||
        `Ark API error (${result.statusCode})`
    );
  }

  const assistantText = extractArkText(result.payload);
  const jsonCandidate = extractJsonCandidate(assistantText);
  const parsed = jsonCandidate ? safeParseJson(jsonCandidate) : null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      assistantText ? `Ark returned non-JSON output: ${assistantText}` : "Ark API returned no usable text."
    );
  }
  return parsed;
}

async function callArkVision(input) {
  const imageUrl = `data:${input.imageMimeType || "image/jpeg"};base64,${input.imageBase64}`;
  const result = await requestJson(ARK_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: {
      model: ARK_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: imageUrl,
            },
            {
              type: "input_text",
              text: buildPrompt(input),
            },
          ],
        },
      ],
    },
  });

  if (!result.ok) {
    throw new Error(
      normalizeText(result.payload?.error?.message) ||
        normalizeText(result.payload?.message) ||
        result.text ||
        `Ark API error (${result.statusCode})`
    );
  }

  const assistantText = extractArkText(result.payload);
  const jsonCandidate = extractJsonCandidate(assistantText);
  const parsed = jsonCandidate ? safeParseJson(jsonCandidate) : null;
  if (!parsed) {
    throw new Error(
      assistantText ? `Ark returned non-JSON output: ${assistantText}` : "Ark API returned no usable text."
    );
  }

  return {
    integration: "ark-vision",
    source: "vision-api",
    rawText: assistantText,
    parsed,
  };
}

function isLocalRequest(req) {
  const address = normalizeText(req.socket?.remoteAddress);
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

async function handleCurrentFrameVision(req, res) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { ok: false, error: "Local requests only." });
    return;
  }

  let payload;
  try {
    payload = safeParseJson(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  const requestId = normalizeText(payload?.requestId);
  const registeredContext = visionRequests.getContext(requestId) || {};
  const question =
    normalizeText(payload?.question) ||
    normalizeText(registeredContext.question);
  const analysisFocus =
    normalizeText(payload?.analysisFocus) ||
    normalizeText(registeredContext.analysisFocus);
  if (!requestId || !question) {
    sendJson(res, 400, {
      ok: false,
      error: "requestId and question are required.",
    });
    return;
  }
  if (!visionRequests.claim(requestId)) {
    sendJson(res, 409, {
      ok: false,
      error: "Visual request is missing, expired, or already used.",
    });
    return;
  }

  try {
    visionRequests.emit(
      requestId,
      "capturing",
      "正在读取当前画面 · 请保持自然正脸"
    );
    const frame = await requestBuffer(GPUPIXEL_LATEST_FRAME_URL);
    if (!frame.body.length) {
      throw new Error("GPUPixel returned an empty frame.");
    }

    visionRequests.emit(
      requestId,
      "analyzing",
      "正在分析脸型和妆容特点"
    );
    const observation = await callArkCurrentFrameVision({
      imageBuffer: frame.body,
      imageMimeType: frame.contentType,
      question,
      analysisFocus,
    });

    visionRequests.emit(
      requestId,
      "composing",
      "已经看清啦，正在整理建议"
    );
    sendJson(res, 200, {
      ok: true,
      requestId,
      source: "gpupixel-latest-frame",
      model: ARK_VISION_MODEL,
      observation,
    });
  } catch (error) {
    visionRequests.emit(
      requestId,
      "failed",
      "我暂时没看清画面，可以调整一下镜头再试试哦。"
    );
    sendJson(res, 502, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleHealth(_req, res) {
  const vision = probeArkVision();
  const openharness = probeOpenHarnessBridge();
  const modules = await buildModuleHealth(vision, openharness);
  sendJson(res, 200, {
    ok: true,
    site: "Beauty Studio Coach",
    runtime: {
      node: process.version,
      visionModel: ARK_VISION_MODEL,
    },
    vision,
    openharness,
    modules,
  });
}

async function handleLocalAsrProxy(req, res, targetPath) {
  if (!normalizeText(LOCAL_ASR_SERVICE_URL)) {
    sendJson(res, 503, { ok: false, error: "Local ASR service URL is not configured." });
    return;
  }

  let payload = {};
  if (req.method === "POST") {
    try {
      const raw = await readRequestBody(req);
      payload = safeParseJson(raw) || {};
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }
  }

  try {
    const endpoint = buildServiceApiUrl(LOCAL_ASR_SERVICE_URL, targetPath);
    const result = await requestJson(endpoint, {
      method: req.method,
      body: req.method === "POST" ? payload : null,
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 30000),
    });
    sendJson(res, result.statusCode || 200, result.payload || { ok: result.ok });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error.message });
  }
}

function proxyGpupixelLiveStream(req, res) {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: 8791,
      path: "/stream.mjpg",
      method: "GET",
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        "Content-Type": upstreamRes.headers["content-type"] || "multipart/x-mixed-replace; boundary=gpupixel",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Connection: "close",
      });
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      sendText(res, 502, `GPUPixel stream unavailable: ${error.message}`);
    } else {
      res.destroy(error);
    }
  });

  req.on("close", () => upstream.destroy());
  upstream.end();
}

async function handleLocalAsrPrewarm(_req, res) {
  if (!normalizeText(LOCAL_ASR_SERVICE_URL)) {
    sendJson(res, 503, { ok: false, error: "Local ASR service URL is not configured." });
    return;
  }

  try {
    const endpoint = buildServiceApiUrl(LOCAL_ASR_SERVICE_URL, "/session/prewarm");
    const result = await requestJson(endpoint, {
      method: "POST",
      body: {},
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 5000),
    });
    sendJson(res, result.statusCode || 200, result.payload || { ok: result.ok });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error.message });
  }
}

async function handleLocalTtsProxy(req, res, targetPath) {
  if (!normalizeText(LOCAL_TTS_SERVICE_URL)) {
    sendJson(res, 503, { ok: false, error: "Local TTS service URL is not configured." });
    return;
  }

  let payload = {};
  if (req.method === "POST") {
    try {
      const raw = await readRequestBody(req);
      payload = safeParseJson(raw) || {};
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }
  }

  try {
    const endpoint = buildServiceApiUrl(LOCAL_TTS_SERVICE_URL, targetPath);
    const result = await requestJson(endpoint, {
      method: req.method,
      body: req.method === "POST" ? payload : null,
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 30000),
    });
    sendJson(res, result.statusCode || 200, result.payload || { ok: result.ok });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error.message });
  }
}

async function handleAdvice(req, res) {
  let payload;
  try {
    const raw = await readRequestBody(req);
    payload = safeParseJson(raw);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  if (!payload || typeof payload !== "object") {
    sendJson(res, 400, { ok: false, error: "Invalid JSON payload." });
    return;
  }

  const streamAsr = buildStreamAsrEnvelope(payload);
  payload.streamAsr = streamAsr;

  const vision = probeArkVision();
  const fallback = buildLocalAdvice(payload);

  if (isOpenHarnessConversation(payload)) {
    try {
      const replyText = await submitToOpenHarness(buildBeautyOpenHarnessPrompt(payload));
      const voiceAdvice = {
        ...fallback,
        integration: "openharness",
        source: "agent-runtime",
        summary: replyText || fallback.summary,
        nextStep: replyText || fallback.nextStep,
        teachingFocus: replyText || fallback.teachingFocus,
        speakText: replyText || fallback.speakText,
        replyText: replyText || fallback.nextStep || fallback.summary,
        meta: {
          vision: vision.available ? "active" : "unavailable-or-disabled",
          openharness: "active",
          provider: "openharness",
          command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
        },
      };
      sendJson(res, 200, {
        ok: true,
        advice: voiceAdvice,
        integration: {
          available: true,
          reason: openHarnessBridge.lastReadyMessage || "OpenHarness 语音对话已接管。",
        },
        vision,
        openharness: {
          available: true,
          reason: openHarnessBridge.lastReadyMessage || "OpenHarness 语音对话已接管。",
        },
      });
      return;
    } catch (error) {
      markOpenHarnessFailure(error.message);
      void interruptOpenHarness().catch(() => {});
      sendJson(res, 200, {
        ok: true,
        advice: {
          ...fallback,
          replyText: fallback.nextStep || fallback.summary,
          meta: {
            vision: vision.available ? "active" : "unavailable-or-disabled",
            openharness: "fallback",
            reason: error.message,
          },
        },
        integration: {
          available: false,
          reason: error.message,
        },
        vision,
        openharness: {
          available: false,
          reason: error.message,
        },
      });
      return;
    }
  }

  if (!payload.imageBase64 || !vision.available) {
    sendJson(res, 200, {
      ok: true,
      advice: fallback,
      integration: vision,
      vision,
      openharness: vision,
    });
    return;
  }

  try {
    const result = await callArkVision(payload);
    const parsed = result.parsed || {};
    sendJson(res, 200, {
      ok: true,
      advice: {
        integration: "ark-vision",
        source: "vision-api",
        summary: parsed.summary || fallback.summary,
        faceShape: parsed.faceShape || fallback.faceShape,
        teachingFocus: parsed.teachingFocus || fallback.teachingFocus,
        nextStep: parsed.nextStep || fallback.nextStep,
        speakText: parsed.speakText || fallback.speakText,
        tips: Array.isArray(parsed.tips) && parsed.tips.length ? parsed.tips : fallback.tips,
        routineTweaks:
          Array.isArray(parsed.routineTweaks) && parsed.routineTweaks.length
            ? parsed.routineTweaks
            : fallback.routineTweaks,
        checkpoints:
          Array.isArray(parsed.checkpoints) && parsed.checkpoints.length
            ? parsed.checkpoints
            : fallback.checkpoints,
        meta: {
          vision: "active",
          openharness: "active",
          provider: "volcengine-ark",
          model: ARK_VISION_MODEL,
        },
      },
      integration: vision,
      vision,
      openharness: vision,
    });
  } catch (error) {
    sendJson(res, 200, {
      ok: true,
      advice: {
        ...fallback,
        meta: {
          vision: "fallback",
          openharness: "fallback",
          reason: error.message,
        },
      },
      integration: {
        ...vision,
        fallback_reason: error.message,
      },
      vision: {
        ...vision,
        fallback_reason: error.message,
      },
      openharness: {
        ...vision,
        fallback_reason: error.message,
      },
    });
  }
}

async function handleAdviceWithGpupixel(req, res) {
  let payload;
  try {
    const raw = await readRequestBody(req);
    payload = safeParseJson(raw);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  if (!payload || typeof payload !== "object") {
    sendJson(res, 400, { ok: false, error: "Invalid JSON payload." });
    return;
  }

  const streamAsr = buildStreamAsrEnvelope(payload);
  payload.streamAsr = streamAsr;
  payload.visionRequestId =
    normalizeText(payload.visionRequestId) ||
    `vision-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vision = probeArkVision();
  const fallback = buildLocalAdvice(payload);
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const wantsStream = requestUrl.searchParams.get("stream") === "1";
  let gpupixelState = {
    available: false,
    reason: normalizeText(GPUPIXEL_SERVICE_URL)
      ? "GPUPixel adapter not requested yet."
      : "GPUPixel service URL is not configured.",
  };
  let gpupixelControl = {
    applied: false,
    reason: "No GPUPixel parameter command detected.",
  };

  if (normalizeText(GPUPIXEL_SERVICE_URL)) {
    try {
      gpupixelControl = await applyGpupixelParamCommand(payload);
    } catch (error) {
      gpupixelControl = {
        applied: false,
        reason: error.message,
      };
    }
  }
  payload.gpupixelControl = gpupixelControl;

  if (!isOpenHarnessConversation(payload)) {
    try {
      gpupixelState = await requestGpupixelAdvice(payload);
    } catch (error) {
      gpupixelState = {
        available: false,
        reason: error.message,
      };
    }
  }

  const describeGpupixel = () =>
    gpupixelControl.applied
      ? {
          available: true,
          reason: gpupixelControl.message || "GPUPixel 参数已调整。",
          control: gpupixelControl,
        }
      : gpupixelState.available
      ? {
          available: true,
          reason: gpupixelState.payload?.advice?.summary || "GPUPixel adapter contributed native preset guidance.",
          endpoint: gpupixelState.endpoint,
          control: gpupixelControl,
        }
      : {
          available: false,
          reason: gpupixelState.reason,
          control: gpupixelControl,
        };

  if (isOpenHarnessConversation(payload)) {
    try {
      if (wantsStream) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const writeEvent = (event) => {
          res.write(`${JSON.stringify({
            serverAt: Date.now(),
            ...event,
          })}\n`);
        };
        visionRequests.register(payload.visionRequestId, writeEvent, {
          question: payload.userRequest,
          analysisFocus: "",
        });
        writeEvent({
          type: "vision-progress",
          stage: "deciding",
          message: "正在理解你的问题",
        });
        const writeCompleteFallback = (reason) => {
          const baseAdvice = {
            ...fallback,
            replyText: fallback.nextStep || fallback.summary,
            rawReplyText: "",
            meta: {
              vision: vision.available ? "active" : "unavailable-or-disabled",
              openharness: "fallback",
              reason,
            },
          };
          const advice = gpupixelState.available ? mergeGpupixelAdvice(baseAdvice, gpupixelState) : baseAdvice;
          writeEvent({
            type: "complete",
            sessionId,
            turnId,
            conversationMode,
            result: {
              ok: true,
              advice,
              streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
              integration: {
                available: false,
                reason,
              },
              vision,
              gpupixel: describeGpupixel(),
              openharness: {
                available: false,
                reason,
              },
            },
          });
        };

        const requestText = buildBeautyOpenHarnessPrompt(payload);
        const sessionId = normalizeText(payload.sessionId);
        const turnId = Number(payload.turnId || 0);
        const conversationMode = normalizeText(payload.conversationMode) || "standard";
        if (gpupixelControl.applied) {
          writeEvent({
            type: "gpupixel-control",
            message: gpupixelControl.message,
            control: gpupixelControl,
            source: payload.source || "",
            sessionId,
            turnId,
            conversationMode,
          });
        }
        writeEvent({
          type: "status",
          message: "我听到了，正在回答，请稍等...",
          voiceText: "已听到你的问题，正在回答，请稍等。",
          source: payload.source || "",
          sessionId,
          turnId,
          conversationMode,
        });

        let replyText = "";
        try {
          await startOpenHarnessBridge();
          replyText = await new Promise((resolve, reject) => {
            let settled = false;
            const pendingItem = {
              timer: null,
              accumulatedText: "",
              onToolStarted: (toolName) => {
                if (toolName === "inspect_current_beauty_frame") {
                  visionRequests.emit(
                    payload.visionRequestId,
                    "capturing",
                    "正在读取当前画面 · 请保持自然正脸"
                  );
                }
              },
              onToolCompleted: (toolName, _output, isError) => {
                if (toolName !== "inspect_current_beauty_frame") {
                  return;
                }
                visionRequests.emit(
                  payload.visionRequestId,
                  isError ? "failed" : "composing",
                  isError
                    ? "我暂时没看清画面，可以调整一下镜头再试试哦。"
                    : "已经看清啦，正在整理建议"
                );
              },
              onDelta: (deltaText) => {
                pendingItem.accumulatedText = normalizeOpenHarnessReply(
                  `${pendingItem.accumulatedText}${deltaText || ""}`
                );
                writeEvent({
                  type: "delta",
                  text: pendingItem.accumulatedText,
                  sessionId,
                  turnId,
                  conversationMode,
                });
              },
              resolve: (value) => {
                if (settled) {
                  return;
                }
                settled = true;
                clearOpenHarnessPendingTimer(pendingItem);
                resolve(value);
              },
              reject: (error) => {
                if (settled) {
                  return;
                }
                settled = true;
                clearOpenHarnessPendingTimer(pendingItem);
                reject(error);
              },
            };

            pendingItem.timer = setTimeout(() => {
              removeOpenHarnessPendingItem(pendingItem);
              pendingItem.reject(
                new Error(`OpenHarness request timed out after ${OPENHARNESS_REQUEST_TIMEOUT_MS}ms`)
              );
            }, OPENHARNESS_REQUEST_TIMEOUT_MS);

            openHarnessBridge.pending.push(pendingItem);
            openHarnessBridge.process.stdin.write(buildOpenHarnessRequest(requestText), "utf8", (error) => {
              if (!error) {
                return;
              }
              removeOpenHarnessPendingItem(pendingItem);
              pendingItem.reject(error instanceof Error ? error : new Error(String(error)));
            });

            req.on("close", () => {
              if (!settled) {
                removeOpenHarnessPendingItem(pendingItem);
                void interruptOpenHarness().catch(() => {});
                visionRequests.remove(payload.visionRequestId);
                pendingItem.reject(new Error("Client disconnected."));
              }
            });
          });
        } catch (error) {
          const reason = normalizeText(error?.message) || "OpenHarness stream failed";
          markOpenHarnessFailure(reason);
          void interruptOpenHarness().catch(() => {});
          writeEvent({
            type: "status",
            message: "本轮切换到本地回退建议。",
            source: payload.source || "",
            sessionId,
            turnId,
            conversationMode,
          });
          writeCompleteFallback(reason);
          visionRequests.remove(payload.visionRequestId);
          res.end();
          return;
        }

        const finalReplyText = gpupixelControl.applied
          ? joinMirrorReply(gpupixelControl.message, replyText)
          : replyText;
        const voiceAdvice = {
          ...fallback,
          integration: "openharness",
          source: "agent-runtime",
          summary: fallback.summary,
          nextStep: fallback.nextStep,
          teachingFocus: fallback.teachingFocus,
          speakText: finalReplyText || fallback.speakText,
          replyText: finalReplyText || fallback.nextStep || fallback.summary,
          rawReplyText: finalReplyText || "",
          meta: {
            vision: vision.available ? "active" : "unavailable-or-disabled",
            openharness: "active",
            provider: "openharness",
            command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
          },
        };

        for (const sentence of splitReplyIntoSentences(finalReplyText || voiceAdvice.replyText || "")) {
          writeEvent({
            type: "sentence",
            text: sentence,
            sessionId,
            turnId,
            conversationMode,
          });
        }

        writeEvent({
          type: "complete",
          sessionId,
          turnId,
          conversationMode,
          result: {
            ok: true,
            advice: voiceAdvice,
            streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
            integration: {
              available: true,
              reason: openHarnessBridge.lastReadyMessage || "OpenHarness voice bridge is active.",
            },
            vision,
            gpupixel: {
              ...describeGpupixel(),
            },
            openharness: {
              available: true,
              reason: openHarnessBridge.lastReadyMessage || "OpenHarness voice bridge is active.",
            },
          },
        });
        visionRequests.remove(payload.visionRequestId);
        res.end();
        return;
      }

      visionRequests.register(payload.visionRequestId, () => {}, {
        question: payload.userRequest,
        analysisFocus: "",
      });
      const replyText = await submitToOpenHarness(buildBeautyOpenHarnessPrompt(payload));
      const finalReplyText = gpupixelControl.applied
        ? joinMirrorReply(gpupixelControl.message, replyText)
        : replyText;
      const voiceAdvice = {
        ...fallback,
        integration: "openharness",
        source: "agent-runtime",
        summary: fallback.summary,
        nextStep: fallback.nextStep,
        teachingFocus: fallback.teachingFocus,
        speakText: finalReplyText || fallback.speakText,
        replyText: finalReplyText || fallback.nextStep || fallback.summary,
        rawReplyText: finalReplyText || "",
        meta: {
          vision: vision.available ? "active" : "unavailable-or-disabled",
          openharness: "active",
          provider: "openharness",
          command: openHarnessBridge.commandDescription || "uv run oh --backend-only",
        },
      };
      const advice = gpupixelState.available ? mergeGpupixelAdvice(voiceAdvice, gpupixelState) : voiceAdvice;
      sendJson(res, 200, {
        ok: true,
        advice,
        streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
        integration: {
          available: true,
          reason: openHarnessBridge.lastReadyMessage || "OpenHarness voice bridge is active.",
        },
        vision,
        gpupixel: describeGpupixel(),
        openharness: {
          available: true,
          reason: openHarnessBridge.lastReadyMessage || "OpenHarness voice bridge is active.",
        },
      });
      visionRequests.remove(payload.visionRequestId);
      return;
    } catch (error) {
      markOpenHarnessFailure(error.message);
      void interruptOpenHarness().catch(() => {});
      const baseAdvice = {
        ...fallback,
        replyText: fallback.nextStep || fallback.summary,
        rawReplyText: "",
        meta: {
          vision: vision.available ? "active" : "unavailable-or-disabled",
          openharness: "fallback",
          reason: error.message,
        },
      };
      const advice = gpupixelState.available ? mergeGpupixelAdvice(baseAdvice, gpupixelState) : baseAdvice;
      sendJson(res, 200, {
        ok: true,
        advice,
        streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
        integration: {
          available: false,
          reason: error.message,
        },
        vision,
        gpupixel: describeGpupixel(),
        openharness: {
          available: false,
          reason: error.message,
        },
      });
      return;
    }
  }

  if (!payload.imageBase64 || !vision.available) {
    const advice = gpupixelState.available ? mergeGpupixelAdvice(fallback, gpupixelState) : fallback;
    sendJson(res, 200, {
      ok: true,
      advice,
      streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
      integration: vision,
      vision,
      gpupixel: describeGpupixel(),
      openharness: vision,
    });
    return;
  }

  try {
    const result = await callArkVision(payload);
    const parsed = result.parsed || {};
    const baseAdvice = {
      integration: "ark-vision",
      source: "vision-api",
      summary: parsed.summary || fallback.summary,
      faceShape: parsed.faceShape || fallback.faceShape,
      teachingFocus: parsed.teachingFocus || fallback.teachingFocus,
      nextStep: parsed.nextStep || fallback.nextStep,
      speakText: parsed.speakText || fallback.speakText,
      tips: Array.isArray(parsed.tips) && parsed.tips.length ? parsed.tips : fallback.tips,
      routineTweaks:
        Array.isArray(parsed.routineTweaks) && parsed.routineTweaks.length
          ? parsed.routineTweaks
          : fallback.routineTweaks,
      checkpoints:
        Array.isArray(parsed.checkpoints) && parsed.checkpoints.length
          ? parsed.checkpoints
          : fallback.checkpoints,
      meta: {
        vision: "active",
        openharness: "active",
        provider: "volcengine-ark",
        model: ARK_VISION_MODEL,
      },
    };
    const advice = gpupixelState.available ? mergeGpupixelAdvice(baseAdvice, gpupixelState) : baseAdvice;
    sendJson(res, 200, {
      ok: true,
      advice,
      streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
      integration: vision,
      vision,
      gpupixel: describeGpupixel(),
      openharness: vision,
    });
  } catch (error) {
    const baseAdvice = {
      ...fallback,
      meta: {
        vision: "fallback",
        openharness: "fallback",
        reason: error.message,
      },
    };
    const advice = gpupixelState.available ? mergeGpupixelAdvice(baseAdvice, gpupixelState) : baseAdvice;
    sendJson(res, 200, {
      ok: true,
      advice,
      streamAsr: describeStreamAsrEnvelope(payload.streamAsr),
      integration: {
        ...vision,
        fallback_reason: error.message,
      },
      vision: {
        ...vision,
        fallback_reason: error.message,
      },
      gpupixel: describeGpupixel(),
      openharness: {
        ...vision,
        fallback_reason: error.message,
      },
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Bad request");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    await handleHealth(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/modules") {
    await handleHealth(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vision/inspect-current-frame") {
    await handleCurrentFrameVision(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/start") {
    await handleLocalAsrProxy(req, res, "/session/start");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/chunk") {
    await handleLocalAsrProxy(req, res, "/session/chunk");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/partial") {
    await handleLocalAsrProxy(req, res, "/session/partial");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/stop") {
    await handleLocalAsrProxy(req, res, "/session/stop");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/cancel") {
    await handleLocalAsrProxy(req, res, "/session/cancel");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/asr/prewarm") {
    await handleLocalAsrPrewarm(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/tts/speak") {
    await handleLocalTtsProxy(req, res, "/speak");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/tts/stop") {
    await handleLocalTtsProxy(req, res, "/stop");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/advice") {
    req.on("aborted", () => {
      void interruptOpenHarness().catch(() => {});
    });
    await handleAdviceWithGpupixel(req, res);
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/gpupixel/params") {
    await handleGpupixelControl(req, res, "/v1/params");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/gpupixel/stream") {
    await handleGpupixelControl(req, res, "/v1/stream");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/gpupixel/live.mjpg") {
    proxyGpupixelLiveStream(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  serveStaticFile(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Beauty Studio Coach running at http://${HOST}:${PORT}`);
});

function buildOpenHarnessPrompt(input) {
  const faceProfile = input.faceProfile || {};
  const moduleSignals = input.moduleSignals || {};
  const step = normalizeText(input.currentStep) || "妆前准备";
  const request = normalizeText(input.userRequest) || "请根据我当前状态给我一个简短建议。";
  const source = normalizeText(input.source) || "manual";
  const observation = normalizeText(input.observation) || "无额外观察";
  const faceShape = normalizeText(faceProfile.label || faceProfile.shape || "待确认");
  const faceConfidence = Number(faceProfile.confidence || 0);
  const gpupixelSummary = normalizeText(moduleSignals?.gpupixel?.summary) || "GPUPixel native beauty engine is active.";
  const gpupixelMode = normalizeText(moduleSignals?.gpupixel?.mode) || "native-video-client";

  return [
    "你是美妆镜里的中文助手“魔镜”。",
    "请直接回答，尽量短，优先 1 到 3 句。",
    "不要解释推理，不要铺垫，不要长篇输出。",
    "如果只是打招呼，就自然简短回应。",
    "如果是妆容问题，只给当前最值得做的一步。",
    WARM_MIRROR_STYLE_INSTRUCTION,
    input.gpupixelControl?.applied
      ? "本轮美颜参数已经在回复前执行完成。不要让用户再次开启或调整，也不要重复确认操作；直接接一句温柔、简短的搭配建议。"
      : "如果用户只是咨询，就按温柔闺蜜型语气正常回答。",
    "请自主判断回答是否需要当前画面的视觉证据。",
    "如果需要当前画面，调用 inspect_current_beauty_frame，并把下面的视觉请求 ID 原样放入 request_id；同一轮最多调用一次。",
    "如果是普通知识、打招呼或单纯调整美颜参数，不要调用视觉工具。",
    "视觉工具失败或返回看不清时，不要猜测用户的脸型或外观。",
    `视觉请求 ID: ${normalizeText(input.visionRequestId)}`,
    `语音来源: ${source}`,
    `用户诉求: ${request}`,
    `当前步骤: ${step}`,
    `镜头观察: ${observation}`,
    `脸型倾向: ${faceShape} (${percent(faceConfidence)})`,
    `GPUPixel: ${gpupixelSummary}`,
    `GPUPixel mode: ${gpupixelMode}`,
    "请给适合直接显示和语音播报的简短回复。",
  ].join("\n");
}
