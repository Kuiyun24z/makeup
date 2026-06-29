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

function buildUserMemoryPromptSection(userMemory = {}) {
  const summary = normalizeText(userMemory.summary);
  const feedbackReflectionSummary = normalizeText(userMemory.feedbackReflectionSummary);
  const nextQuestion = normalizeText(userMemory.nextQuestion);
  const shouldAsk = Boolean(userMemory.shouldAsk && nextQuestion);
  const proactiveLevel = normalizeText(userMemory.proactiveLevel) || "normal";
  if (!summary && !nextQuestion && !feedbackReflectionSummary) {
    return "";
  }
  return [
    "# 用户记忆",
    summary || "暂无可用用户画像。",
    `主动程度策略：${proactiveLevel}`,
    proactiveLevel === "low"
      ? "本轮尽量不要追问；如果用户有明确业务问题，只回答正事，追问可以省略。"
      : proactiveLevel === "high"
      ? "用户愿意补充信息，空档可自然追问一个问题，但仍必须先回答当前问题。"
      : "保持轻量引导，回答当前问题优先。",
    "回答用户当前问题优先；只有在不打断当前诉求时，才可以顺手引导补充画像。",
    "每轮最多追问一个问题，不要像问卷一样连续发问。",
    shouldAsk
      ? `本轮必须追问：${nextQuestion}。如果用户只是打招呼，必须在简短寒暄后问出这个问题；如果用户有明确美妆任务，先完成任务，再把这个问题放在最后一句。此规则优先级高于“打招呼就简短回应”。`
      : "本轮不要主动追问用户画像问题。",
    feedbackReflectionSummary,
  ].filter(Boolean).join("\n");
}

function buildCapabilityBoundaryPromptSection() {
  return [
    "# 能力边界",
    "你可以实际调整：磨皮、提亮、瘦脸、大眼、嘴型、鼻型、眉毛、腮红。",
    "你可以看当前镜头画面并给美妆建议，但只有调用视觉工具并拿到结果后，才能描述用户当前脸型、肤色、妆容状态或五官细节。",
    "你不能真的替用户涂润唇膏、口红、眼影、粉底，也不能真的替用户完成卸妆、护肤或实物上妆。",
    "如果用户让你“涂一点”“画一下”“上口红看看”，不要说你已经给用户涂了、画了或上了；应说明当前只能给建议或调整已支持的美颜参数。",
    "不要说“我已经帮你涂上了”“我现在就给你画好了”“已经上妆了”等暗示真实实物化妆已完成的话。",
    "如果用户要未支持的实物妆效，可以推荐颜色、步骤或先调用视觉工具观察，再给她自己动手的建议。",
  ].join("\n");
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
    buildCapabilityBoundaryPromptSection(),
    buildUserMemoryPromptSection(input.userMemory),
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
  buildUserMemoryPromptSection,
  buildCapabilityBoundaryPromptSection,
};
