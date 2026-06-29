const BEAUTY_CAPABILITY_MANIFEST = Object.freeze({
  executableActions: Object.freeze([
    Object.freeze({ key: "smoothing", label: "磨皮" }),
    Object.freeze({ key: "whitening", label: "提亮" }),
    Object.freeze({ key: "faceSlim", label: "瘦脸" }),
    Object.freeze({ key: "eyeEnlarge", label: "大眼" }),
    Object.freeze({ key: "mouthResize", label: "嘴型" }),
    Object.freeze({ key: "noseResize", label: "鼻型" }),
    Object.freeze({ key: "eyebrow", label: "眉毛" }),
    Object.freeze({ key: "blusher", label: "腮红" }),
  ]),
  adviceOnlyCosmetics: Object.freeze(["润唇膏", "口红", "眼影", "粉底"]),
});

const UNSUPPORTED_COSMETIC_PATTERN =
  /润唇膏|唇膏|口红|唇彩|眼影|粉底|底妆|遮瑕|卸妆|护肤/;
const REAL_APPLICATION_VERB_PATTERN = /涂|画|上|抹|擦|铺|打底/;
const UNSUPPORTED_REQUEST_PATTERN =
  /(给我|帮我|替我|你来|你帮我).{0,16}(涂|画|上|抹|擦|铺|打底)|((涂|画|上|抹|擦|铺|打底).{0,10}(看看|一下|一点))/;
const REAL_APPLICATION_CLAIM_PATTERN =
  /(我|已经|现在就|马上|这就|好啦|帮你|给你).{0,36}(涂|画|上|抹|擦|铺|打底).{0,36}(润唇膏|唇膏|口红|唇彩|眼影|粉底|底妆|遮瑕)|(润唇膏|唇膏|口红|唇彩|眼影|粉底|底妆|遮瑕).{0,24}(涂在你|画在你|上到你|已经)/;

function normalizeText(value) {
  return String(value || "").trim();
}

function buildBeautyCapabilityContext(input = {}) {
  const actionLedger = [];
  const gpupixelControl = input.gpupixelControl || {};
  if (gpupixelControl.applied) {
    actionLedger.push({
      type: "gpupixel",
      key: normalizeText(gpupixelControl.key),
      label: normalizeText(gpupixelControl.label),
    });
  }
  if (input.visionToolCompleted || input.currentFrameVisionCompleted) {
    actionLedger.push({
      type: "vision",
      key: "inspect_current_beauty_frame",
      label: "当前画面观察",
    });
  }

  return {
    manifest: BEAUTY_CAPABILITY_MANIFEST,
    actionLedger,
    userRequest: normalizeText(input.userRequest),
  };
}

function shouldBufferBeautyCapabilitySensitiveReply(input = {}) {
  const text = normalizeText(input.userRequest || input.text);
  if (!text) return false;
  return UNSUPPORTED_REQUEST_PATTERN.test(text) && (
    UNSUPPORTED_COSMETIC_PATTERN.test(text) ||
    /妆|嘴|唇|脸|眼|眉|皮肤|气色|看看/.test(text)
  );
}

function enforceBeautyCapabilityBoundary(replyText, context = {}) {
  const text = normalizeText(replyText);
  if (!text) {
    return { text, changed: false, violations: [] };
  }

  const violations = [];
  if (REAL_APPLICATION_CLAIM_PATTERN.test(text)) {
    violations.push("unsupported-real-cosmetic-application-claim");
  }

  if (!violations.length) {
    return { text, changed: false, violations };
  }

  const requestedOrClaimedProduct = extractAdviceOnlyCosmetic(`${context.userRequest || ""} ${text}`);
  const product = requestedOrClaimedProduct || "这类实物妆品";
  const suggestion = buildSafeAdviceReplacement(product, text);
  return {
    text: suggestion,
    changed: true,
    violations,
  };
}

function extractAdviceOnlyCosmetic(text) {
  const input = normalizeText(text);
  if (/润唇膏|唇膏/.test(input)) return "润唇膏";
  if (/口红|唇彩/.test(input)) return "口红";
  if (/眼影/.test(input)) return "眼影";
  if (/粉底|底妆|遮瑕/.test(input)) return "粉底";
  return "";
}

function buildSafeAdviceReplacement(product, originalText) {
  const colorHint = extractColorHint(originalText);
  const colorPhrase = colorHint ? `可以建议你试${colorHint}` : "可以建议你先试自然提气色的颜色";
  return `我现在不能真的替你涂${product}，但${colorPhrase}；如果你愿意，我也可以先看看当前画面，再给你更贴脸的选择。`;
}

function extractColorHint(text) {
  const input = normalizeText(text);
  const match = input.match(/蜜桃色|豆沙色|裸粉色|奶茶色|玫瑰色|珊瑚色|番茄色|红棕色/);
  return match ? match[0] : "";
}

module.exports = {
  BEAUTY_CAPABILITY_MANIFEST,
  buildBeautyCapabilityContext,
  enforceBeautyCapabilityBoundary,
  shouldBufferBeautyCapabilitySensitiveReply,
};
