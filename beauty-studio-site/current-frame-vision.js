function createVisionRequestRegistry({
  ttlMs = 60_000,
  now = () => Date.now(),
} = {}) {
  const requests = new Map();

  function getActive(requestId) {
    const key = String(requestId || "").trim();
    const entry = requests.get(key);
    if (!entry) {
      return null;
    }
    if (now() - entry.createdAt > ttlMs) {
      requests.delete(key);
      return null;
    }
    return entry;
  }

  return {
    register(requestId, emit, context = {}) {
      const key = String(requestId || "").trim();
      if (!key || typeof emit !== "function") {
        return false;
      }
      requests.set(key, {
        createdAt: now(),
        claimed: false,
        emit,
        context: {
          question: String(context.question || "").trim(),
          analysisFocus: String(context.analysisFocus || "").trim(),
        },
      });
      return true;
    },

    claim(requestId) {
      const entry = getActive(requestId);
      if (!entry || entry.claimed) {
        return false;
      }
      entry.claimed = true;
      return true;
    },

    emit(requestId, stage, message) {
      const entry = getActive(requestId);
      if (!entry) {
        return false;
      }
      entry.emit({
        type: "vision-progress",
        stage: String(stage || ""),
        message: String(message || ""),
      });
      return true;
    },

    getContext(requestId) {
      const entry = getActive(requestId);
      return entry ? { ...entry.context } : null;
    },

    remove(requestId) {
      return requests.delete(String(requestId || "").trim());
    },

    has(requestId) {
      return Boolean(getActive(requestId));
    },
  };
}

function buildCurrentFrameVisionPrompt({
  question = "",
  analysisFocus = "",
} = {}) {
  return [
    "你是美妆镜的视觉观察模块。请只根据这张 GPUPixel 美颜后的当前画面作答。",
    `用户问题: ${String(question || "").trim() || "请观察当前妆容"}`,
    `重点观察: ${String(analysisFocus || "").trim() || "与用户问题最相关的可见特征"}`,
    "如果画面没有清晰可见的人脸，请将 visible 设为 false，并说明无法看清；不要猜测用户外观。",
    "不要做身份识别、医疗诊断或绝对化审美判断。",
    "只返回 JSON 对象，不要 Markdown。结构如下：",
    JSON.stringify({
      visible: true,
      faceShape: {
        label: "",
        confidence: 0,
        evidence: [""],
      },
      makeup: {
        summary: "",
        visibleFeatures: [""],
      },
      answerEvidence: [""],
      gentleSuggestion: "",
    }),
  ].join("\n");
}

module.exports = {
  createVisionRequestRegistry,
  buildCurrentFrameVisionPrompt,
};
