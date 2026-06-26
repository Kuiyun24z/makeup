const { WARM_MIRROR_STYLE_INSTRUCTION } = require("./mirror-voice");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function percent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0%";
  }
  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)}%`;
}

function buildBeautyOpenHarnessPrompt(input = {}) {
  const faceProfile = input.faceProfile || {};
  const moduleSignals = input.moduleSignals || {};
  const step = normalizeText(input.currentStep) || "妆前准备";
  const request =
    normalizeText(input.userRequest) || "请根据我当前的状态给一个简短建议。";
  const source = normalizeText(input.source) || "manual";
  const observation = normalizeText(input.observation) || "暂无额外视觉观察";
  const faceShape = normalizeText(faceProfile.label || faceProfile.shape) || "待确认";
  const faceConfidence = Number(faceProfile.confidence || 0);
  const gpupixelSummary =
    normalizeText(moduleSignals?.gpupixel?.summary) ||
    "GPUPixel native beauty engine is active.";
  const gpupixelMode =
    normalizeText(moduleSignals?.gpupixel?.mode) || "native-video-client";

  return [
    "你是美妆镜里的中文助手“魔镜”。",
    "直接回答，尽量简短，优先 1 到 3 句。",
    "不要解释推理，不要铺垫，不要输出内部工具调用、协议标记或参数 JSON。",
    "如果只是打招呼，就自然简短回应。",
    "如果是美容问题，只给当前最值得做的一步。",
    WARM_MIRROR_STYLE_INSTRUCTION,
    input.gpupixelControl?.applied
      ? "本轮美颜参数已经在回复前执行完成。不要让用户再次开启或调整，也不要重复确认操作；直接接一句温柔、简短的效果反馈或搭配建议。"
      : "如果用户只是咨询，就用温柔闺蜜型语气正常回答。",
    "自主判断回答是否需要当前画面的视觉证据。",
    "当用户询问自己的脸型、五官、肤色、妆容状态、眉形是否合适，或其他必须看见本人当前画面才能回答的问题时，必须调用 inspect_current_beauty_frame。",
    "调用工具时，把下面的视觉请求 ID 原样放入 request_id；同一轮最多调用一次。question 可以省略，网站会通过 request_id 恢复用户原问题。",
    "普通知识、打招呼或单纯调整美颜参数时，不要调用视觉工具。",
    "视觉工具失败或返回看不清时，不要猜测用户的脸型或外观。",
    `视觉请求 ID: ${normalizeText(input.visionRequestId)}`,
    `输入来源: ${source}`,
    `用户诉求: ${request}`,
    `当前步骤: ${step}`,
    `已有观察: ${observation}`,
    `已有脸型倾向: ${faceShape} (${percent(faceConfidence)})`,
    `GPUPixel: ${gpupixelSummary}`,
    `GPUPixel mode: ${gpupixelMode}`,
    "最终请给出适合直接显示和语音播报的自然中文回答。",
  ].join("\n");
}

module.exports = {
  buildBeautyOpenHarnessPrompt,
};
