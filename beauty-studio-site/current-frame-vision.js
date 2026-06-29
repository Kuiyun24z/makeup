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

function stripArkCompletionSuffix(rawUrl) {
  const trimmed = String(rawUrl || "").trim().replace(/\/+$/, "");
  return trimmed
    .replace(/\/responses$/i, "")
    .replace(/\/chat\/completions$/i, "");
}

function buildArkChatCompletionsUrl(rawUrl) {
  const base = stripArkCompletionSuffix(rawUrl);
  return base ? `${base}/chat/completions` : "";
}

function buildArkChatVisionPayload({
  model = "",
  imageBuffer,
  imageBase64 = "",
  imageMimeType = "image/jpeg",
  promptText = "",
  maxTokens = 800,
} = {}) {
  const base64 = imageBase64 || Buffer.from(imageBuffer || "").toString("base64");
  const mimeType = String(imageMimeType || "image/jpeg").split(";")[0].trim() || "image/jpeg";
  const imageUrl = `data:${mimeType};base64,${base64}`;

  return {
    model,
    max_tokens: maxTokens,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: String(promptText || ""),
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ],
  };
}

function extractArkTextFromPayload(payload) {
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
      walkContent(item?.content);
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
      walkContent(choice?.message?.content);
    }
  }

  return chunks.join("\n").trim();
}

module.exports = {
  createVisionRequestRegistry,
  buildCurrentFrameVisionPrompt,
  buildArkChatCompletionsUrl,
  buildArkChatVisionPayload,
  extractArkTextFromPayload,
};
