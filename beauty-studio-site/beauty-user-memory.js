const fs = require("node:fs");
const path = require("node:path");

const PROFILE_FILE = "device-profile.json";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmptyBeautyUserProfile() {
  return {
    version: 1,
    consent: {
      status: "unknown",
      updatedAt: "",
    },
    nickname: "",
    ageRange: "",
    skinType: "",
    sensitivity: "",
    favoriteMakeupStyle: "",
    primaryUseCase: "",
    constraints: [],
    evolution: {
      behaviorAdaptationReady: false,
      reflectionReady: false,
      feedbackReflectionReady: false,
      proactiveLevel: "normal",
      answeredOnboardingCount: 0,
      ignoredOnboardingCount: 0,
      recommendationStats: {
        acceptedCount: 0,
        rejectedCount: 0,
        neutralCount: 0,
      },
      preferenceSignals: [],
      avoidanceSignals: [],
      effectiveAdvicePatterns: [],
      ineffectiveAdvicePatterns: [],
      lastOnboardingField: "",
      lastOnboardingQuestion: "",
      lastOnboardingAskedAt: "",
      lastAdaptedAt: "",
      lastSignalAt: "",
      lastFeedbackAt: "",
      lastReflectionAt: "",
    },
    updatedAt: "",
  };
}

function getBeautyUserProfilePath(memoryDir) {
  return path.join(memoryDir, PROFILE_FILE);
}

function isConsentGranted(profile) {
  return profile?.consent?.status === "granted";
}

function readBeautyUserProfile(memoryDir) {
  const filePath = getBeautyUserProfilePath(memoryDir);
  if (!fs.existsSync(filePath)) {
    return createEmptyBeautyUserProfile();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeBeautyUserProfile(parsed);
  } catch {
    return createEmptyBeautyUserProfile();
  }
}

function writeBeautyUserProfile(memoryDir, profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (normalized.consent.status === "unknown") {
    return null;
  }
  fs.mkdirSync(memoryDir, { recursive: true });
  const filePath = getBeautyUserProfilePath(memoryDir);
  const profileToPersist =
    normalized.consent.status === "denied"
      ? {
          ...createEmptyBeautyUserProfile(),
          consent: normalized.consent,
          updatedAt: normalized.updatedAt,
        }
      : normalized;
  fs.writeFileSync(filePath, `${JSON.stringify(profileToPersist, null, 2)}\n`, "utf8");
  return filePath;
}

function resetBeautyUserProfile(memoryDir) {
  const filePath = getBeautyUserProfilePath(memoryDir);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
  return createEmptyBeautyUserProfile();
}

function normalizeBeautyUserProfile(profile) {
  const empty = createEmptyBeautyUserProfile();
  const source = profile && typeof profile === "object" ? profile : {};
  const sourceEvolution =
    source.evolution && typeof source.evolution === "object" ? source.evolution : {};
  const sourceStats =
    sourceEvolution.recommendationStats && typeof sourceEvolution.recommendationStats === "object"
      ? sourceEvolution.recommendationStats
      : {};
  return {
    ...empty,
    ...source,
    consent: {
      ...empty.consent,
      ...(source.consent && typeof source.consent === "object" ? source.consent : {}),
    },
    constraints: Array.isArray(source.constraints)
      ? source.constraints.map(normalizeText).filter(Boolean).slice(0, 10)
      : [],
    evolution: {
      ...empty.evolution,
      ...sourceEvolution,
      recommendationStats: {
        ...empty.evolution.recommendationStats,
        ...sourceStats,
      },
      preferenceSignals: normalizeTextList(sourceEvolution.preferenceSignals, 20),
      avoidanceSignals: normalizeTextList(sourceEvolution.avoidanceSignals, 20),
      effectiveAdvicePatterns: normalizeTextList(sourceEvolution.effectiveAdvicePatterns, 10),
      ineffectiveAdvicePatterns: normalizeTextList(sourceEvolution.ineffectiveAdvicePatterns, 10),
    },
  };
}

function normalizeTextList(value, limit) {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean).slice(0, limit)
    : [];
}

function setBeautyUserConsent(profile, status) {
  const nextStatus = status === "granted" || status === "denied" ? status : "unknown";
  return {
    ...normalizeBeautyUserProfile(profile),
    consent: {
      status: nextStatus,
      updatedAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
}

function updateBeautyUserProfileFromText(profile, text) {
  const input = normalizeText(text);
  const next = normalizeBeautyUserProfile(profile);
  if (!input) {
    return next;
  }

  const nickname = extractNickname(input);
  if (nickname) next.nickname = nickname;

  const ageRange = extractAgeRange(input);
  if (ageRange) next.ageRange = ageRange;

  const skinType = extractSkinType(input);
  if (skinType) next.skinType = skinType;

  const sensitivity = extractSensitivity(input);
  if (sensitivity) next.sensitivity = sensitivity;

  const style = extractMakeupStyle(input);
  if (style) next.favoriteMakeupStyle = style;

  const useCase = extractUseCase(input);
  if (useCase) next.primaryUseCase = useCase;

  const constraints = extractConstraints(input);
  if (constraints.length) {
    next.constraints = Array.from(new Set([...next.constraints, ...constraints])).slice(0, 10);
  }

  if (
    nickname ||
    ageRange ||
    skinType ||
    sensitivity ||
    style ||
    useCase ||
    constraints.length
  ) {
    next.updatedAt = nowIso();
  }
  return next;
}

function getNextOnboardingQuestion(profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (normalized.consent.status === "unknown") {
    return "我可以记住你的妆容偏好和使用习惯吗？这样下次给建议会更贴合你。";
  }
  if (normalized.consent.status === "denied") {
    return "";
  }
  if (!normalized.nickname) {
    return "那我先慢慢认识你一下～我以后怎么称呼你比较好？";
  }
  if (!normalized.ageRange) {
    return `${normalized.nickname}，方便告诉我你的年龄段吗？比如十几岁、二十多岁、三十多岁。`;
  }
  if (!normalized.skinType) {
    return "你的肤质更偏干皮、油皮、混合皮，还是敏感肌呀？";
  }
  if (!normalized.favoriteMakeupStyle) {
    return "你平常更喜欢什么妆容？比如清透淡妆、通勤自然、甜美约会、上镜精致。";
  }
  if (!normalized.primaryUseCase) {
    return "你平常用魔镜更多是为了出勤通勤、约会，还是拍照上镜呀？";
  }
  return "";
}

function markOnboardingQuestionAsked(profile, field, question) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (!isConsentGranted(normalized) || !normalizeText(question)) {
    return normalized;
  }
  return {
    ...normalized,
    evolution: {
      ...normalized.evolution,
      lastOnboardingField: normalizeText(field),
      lastOnboardingQuestion: normalizeText(question),
      lastOnboardingAskedAt: nowIso(),
    },
  };
}

function updateBeautyUserBehaviorAdaptation(previousProfile, nextProfile, text) {
  const previous = normalizeBeautyUserProfile(previousProfile);
  const next = normalizeBeautyUserProfile(nextProfile);
  if (!isConsentGranted(previous) || !isConsentGranted(next)) {
    return next;
  }

  const input = normalizeText(text);
  let evolution = { ...next.evolution };
  if (isOnboardingStopPhrase(input)) {
    evolution = {
      ...evolution,
      proactiveLevel: "low",
      lastAdaptedAt: nowIso(),
      lastSignalAt: nowIso(),
    };
    return { ...next, evolution };
  }

  if (!previous.evolution.lastOnboardingQuestion) {
    return next;
  }

  const beforeScore = getProfileCompletenessScore(previous);
  const afterScore = getProfileCompletenessScore(next);
  if (afterScore > beforeScore) {
    evolution.answeredOnboardingCount = Number(evolution.answeredOnboardingCount || 0) + 1;
    evolution.ignoredOnboardingCount = Math.max(0, Number(evolution.ignoredOnboardingCount || 0) - 1);
  } else if (input) {
    evolution.ignoredOnboardingCount = Number(evolution.ignoredOnboardingCount || 0) + 1;
  }

  if (evolution.ignoredOnboardingCount >= 2) {
    evolution.proactiveLevel = "low";
  } else if (evolution.answeredOnboardingCount >= 3) {
    evolution.proactiveLevel = "high";
  } else {
    evolution.proactiveLevel = evolution.proactiveLevel || "normal";
  }

  evolution.lastAdaptedAt = nowIso();
  evolution.lastSignalAt = nowIso();
  return { ...next, evolution };
}

function updateBeautyUserFeedbackReflection(profile, text, adviceContext = {}) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (!isConsentGranted(normalized)) {
    return normalized;
  }

  const input = normalizeText(text);
  const signal = classifyFeedbackSignal(input);
  if (signal === "neutral") {
    return normalized;
  }

  const topic = normalizeText(adviceContext.topic) || inferFeedbackTopic(input);
  const suggestion = normalizeText(adviceContext.suggestion);
  const preferenceSignals = extractPreferenceSignals(input);
  const avoidanceSignals = extractAvoidanceSignals(input);
  const now = nowIso();
  const stats = {
    ...normalized.evolution.recommendationStats,
  };
  if (signal === "accepted") {
    stats.acceptedCount = Number(stats.acceptedCount || 0) + 1;
  } else if (signal === "rejected") {
    stats.rejectedCount = Number(stats.rejectedCount || 0) + 1;
  }

  const patternBase = [topic, suggestion, ...preferenceSignals, ...avoidanceSignals]
    .map(normalizeText)
    .filter(Boolean)
    .join("：");
  const effectiveAdvicePatterns =
    signal === "accepted"
      ? appendUniqueLimited(
          normalized.evolution.effectiveAdvicePatterns,
          patternBase || "用户明确表示这个建议适合她",
          10
        )
      : normalized.evolution.effectiveAdvicePatterns;
  const ineffectiveAdvicePatterns =
    signal === "rejected"
      ? appendUniqueLimited(
          normalized.evolution.ineffectiveAdvicePatterns,
          patternBase ? `避免类似建议：${patternBase}` : "避免重复用户明确表示不适合的建议",
          10
        )
      : normalized.evolution.ineffectiveAdvicePatterns;

  return {
    ...normalized,
    updatedAt: now,
    evolution: {
      ...normalized.evolution,
      feedbackReflectionReady: true,
      reflectionReady: true,
      recommendationStats: stats,
      preferenceSignals: appendUniqueLimited(normalized.evolution.preferenceSignals, preferenceSignals, 20),
      avoidanceSignals: appendUniqueLimited(normalized.evolution.avoidanceSignals, avoidanceSignals, 20),
      effectiveAdvicePatterns,
      ineffectiveAdvicePatterns,
      lastFeedbackAt: now,
      lastReflectionAt: now,
    },
  };
}

function classifyFeedbackSignal(text) {
  const input = normalizeText(text);
  if (!input) return "neutral";
  if (/不喜欢|不太喜欢|不适合|不太适合|太浓|太重|太麻烦|不要这种|换一个|不会这么|不想这样|算了/.test(input)) {
    return "rejected";
  }
  if (/可以|不错|挺好|很好|喜欢|适合我|挺适合|就按这个|这个好|有用|靠谱|满意/.test(input)) {
    return "accepted";
  }
  return "neutral";
}

function inferFeedbackTopic(text) {
  const input = normalizeText(text);
  if (/眼镜|框/.test(input)) return "眼镜风格";
  if (/妆|口红|眼影|腮红|修容/.test(input)) return "妆容建议";
  if (/发型|卷发|刘海/.test(input)) return "发型建议";
  return "美妆建议";
}

function extractPreferenceSignals(text) {
  const input = normalizeText(text);
  const signals = [];
  if (/自然|日常|低调|淡一点|清淡/.test(input)) signals.push("更接受自然、日常、低改造感建议");
  if (/简单|省事|快|别麻烦/.test(input)) signals.push("更接受简单省时的建议");
  if (/精致|上镜|明显/.test(input)) signals.push("可接受更精致上镜的建议");
  if (/甜美|温柔/.test(input)) signals.push("偏好温柔甜美方向");
  if (/酷|利落|高级/.test(input)) signals.push("偏好利落高级方向");
  return signals;
}

function extractAvoidanceSignals(text) {
  const input = normalizeText(text);
  const signals = [];
  if (/太浓|太重|浓妆/.test(input)) signals.push("避免太浓或妆感太重的建议");
  if (/太麻烦|复杂|不会/.test(input)) signals.push("避免太麻烦、步骤复杂的建议");
  if (/不自然|夸张/.test(input)) signals.push("避免夸张、不自然的风格");
  if (/不适合|不喜欢|不要这种/.test(input)) signals.push("避免重复用户明确否定的方向");
  return signals;
}

function appendUniqueLimited(existing, values, limit) {
  const additions = Array.isArray(values) ? values : [values];
  return Array.from(
    new Set([
      ...normalizeTextList(existing, limit),
      ...additions.map(normalizeText).filter(Boolean),
    ])
  ).slice(-limit);
}

function shouldAskOnboardingThisTurn(profile, text, nextQuestion) {
  const normalized = normalizeBeautyUserProfile(profile);
  const question = normalizeText(nextQuestion);
  if (!question || normalized.consent.status === "denied") {
    return false;
  }
  const input = normalizeText(text);
  if (normalized.consent.status === "unknown") {
    return isConversationalOpening(input) || isOpenToChatPhrase(input) || isBeautyMemoryEntryTask(input);
  }
  if (!isConsentGranted(normalized)) {
    return false;
  }
  const proactiveLevel = normalized.evolution.proactiveLevel || "normal";
  if (proactiveLevel === "high" || proactiveLevel === "normal") {
    return true;
  }
  return isConversationalOpening(input) || isOpenToChatPhrase(input);
}

function getNextOnboardingField(profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (normalized.consent.status === "unknown") return "consent";
  if (normalized.consent.status === "denied") return "";
  if (!normalized.nickname) return "nickname";
  if (!normalized.ageRange) return "ageRange";
  if (!normalized.skinType) return "skinType";
  if (!normalized.favoriteMakeupStyle) return "favoriteMakeupStyle";
  if (!normalized.primaryUseCase) return "primaryUseCase";
  return "";
}

function getProfileCompletenessScore(profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  return [
    normalized.nickname,
    normalized.ageRange,
    normalized.skinType,
    normalized.favoriteMakeupStyle,
    normalized.primaryUseCase,
  ].filter(Boolean).length;
}

function isOnboardingStopPhrase(text) {
  return /别问了|先别问|不要问|直接告诉我|直接说|先说建议/.test(normalizeText(text));
}

function isConversationalOpening(text) {
  return /^(你好|嗨|哈喽|hello|hi|早|晚上好|下午好|在吗)/i.test(normalizeText(text));
}

function isOpenToChatPhrase(text) {
  return /可以聊|慢慢问|继续问|你问吧|想聊/.test(normalizeText(text));
}

function isBeautyMemoryEntryTask(text) {
  const input = normalizeText(text);
  if (!input) return false;
  return /妆|美妆|化妆|脸型|五官|肤|皮肤|眉|眼妆|眼影|眼镜|腮红|修容|口红|唇|发型|刘海|推荐|适合|好看|看看|截图|画|涂/.test(input);
}

function summarizeBeautyUserProfileForPrompt(profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (!isConsentGranted(normalized)) {
    return "用户尚未同意持久记忆。不要写入长期画像；可以自然询问是否允许记住美妆偏好。";
  }

  const lines = ["用户已同意本地记忆。"];
  if (normalized.nickname) lines.push(`称呼：${normalized.nickname}`);
  if (normalized.ageRange) lines.push(`年龄段：${normalized.ageRange}`);
  if (normalized.skinType) lines.push(`肤质：${normalized.skinType}`);
  if (normalized.sensitivity) lines.push(`敏感情况：${normalized.sensitivity}`);
  if (normalized.favoriteMakeupStyle) lines.push(`偏好妆容：${normalized.favoriteMakeupStyle}`);
  if (normalized.primaryUseCase) lines.push(`常用场景：${normalized.primaryUseCase}`);
  if (normalized.constraints.length) lines.push(`常用限制：${normalized.constraints.join("、")}`);

  const missing = getMissingProfileFields(normalized);
  const proactiveLevel = normalized.evolution.proactiveLevel || "normal";
  lines.push(
    proactiveLevel === "low"
      ? "主动程度：low。用户可能不喜欢被频繁追问，本轮尽量不要追问；如要问，只能放在回答最后且可省略。"
      : proactiveLevel === "high"
      ? "主动程度：high。用户愿意补充信息，空档可自然追问一个画像问题。"
      : "主动程度：normal。保持轻量引导，每轮最多追问一个问题。"
  );
  lines.push(
    missing.length
      ? `资料缺口：${missing.join("、")}。如果本轮适合，只能自然追问其中一个。`
      : "基础画像已比较完整；不要为了建档继续追问。"
  );
  return lines.join("\n");
}

function summarizeBeautyUserFeedbackReflectionForPrompt(profile) {
  const normalized = normalizeBeautyUserProfile(profile);
  if (!isConsentGranted(normalized) || !normalized.evolution.feedbackReflectionReady) {
    return "";
  }

  const accepted = normalizeTextList(normalized.evolution.effectiveAdvicePatterns, 5);
  const rejected = normalizeTextList(normalized.evolution.ineffectiveAdvicePatterns, 5);
  const preferences = normalizeTextList(normalized.evolution.preferenceSignals, 5);
  const avoidances = normalizeTextList(normalized.evolution.avoidanceSignals, 5);
  if (!accepted.length && !rejected.length && !preferences.length && !avoidances.length) {
    return "";
  }

  const lines = ["# 用户反馈反思"];
  if (preferences.length) {
    lines.push(`用户更接受：${preferences.join("；")}`);
  }
  if (avoidances.length) {
    lines.push(`用户不喜欢或应避免：${avoidances.join("；")}`);
  }
  if (accepted.length) {
    lines.push(`有效建议模式：${accepted.join("；")}`);
  }
  if (rejected.length) {
    lines.push(`低效建议模式：${rejected.join("；")}`);
  }
  lines.push("只把这些当作轻量倾向，不要绝对化；不要暴露后台记录、计数或格式。");
  return lines.join("\n");
}

function getMissingProfileFields(profile) {
  const missing = [];
  if (!profile.nickname) missing.push("称呼");
  if (!profile.ageRange) missing.push("年龄段");
  if (!profile.skinType) missing.push("肤质");
  if (!profile.favoriteMakeupStyle) missing.push("妆容偏好");
  if (!profile.primaryUseCase) missing.push("常用场景");
  return missing;
}

function extractNickname(text) {
  const match = text.match(/(?:叫我|喊我|称呼我|我叫|我是)\s*([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/);
  if (!match) return "";
  const value = match[1].replace(/^(油皮|干皮|混油皮|混干皮|敏感肌)$/, "");
  return value || "";
}

function extractAgeRange(text) {
  if (/十几岁|1[0-9]\s*岁|高中|学生党/.test(text)) return "十几岁";
  if (/二十多岁|20\s*多|2[0-9]\s*岁|二十|大学|刚工作/.test(text)) return "二十多岁";
  if (/三十多岁|30\s*多|3[0-9]\s*岁|三十/.test(text)) return "三十多岁";
  if (/四十多岁|40\s*多|4[0-9]\s*岁|四十/.test(text)) return "四十多岁";
  if (/五十多岁|50\s*多|5[0-9]\s*岁|五十/.test(text)) return "五十多岁";
  return "";
}

function extractSkinType(text) {
  if (/混油|T区油|t区油/i.test(text)) return "混油皮";
  if (/混干/.test(text)) return "混干皮";
  if (/油皮|爱出油|容易出油|大油田/.test(text)) return "油皮";
  if (/干皮|偏干|拔干/.test(text)) return "干皮";
  if (/敏感肌|容易敏感|泛红/.test(text)) return "敏感肌";
  if (/中性皮|正常肤质/.test(text)) return "中性皮";
  return "";
}

function extractSensitivity(text) {
  if (/敏感|泛红|刺痛|过敏/.test(text)) return "容易敏感";
  if (/不敏感|不过敏/.test(text)) return "不敏感";
  return "";
}

function extractMakeupStyle(text) {
  if (/清透淡妆|清透|淡妆|伪素颜/.test(text)) return "清透淡妆";
  if (/通勤自然|自然通勤|自然妆|日常妆/.test(text)) return "通勤自然";
  if (/约会妆|甜美|温柔/.test(text)) return "甜美约会";
  if (/上镜|拍照|精致|浓颜/.test(text)) return "上镜精致";
  return "";
}

function extractUseCase(text) {
  if (/出勤|通勤|上班|上学|日常/.test(text)) return "通勤";
  if (/约会|见朋友/.test(text)) return "约会";
  if (/拍照|上镜|直播|视频|面试|会议/.test(text)) return "上镜";
  return "";
}

function extractConstraints(text) {
  const constraints = [];
  if (/戴眼镜|眼镜/.test(text)) constraints.push("戴眼镜");
  if (/赶时间|时间紧|三分钟|五分钟|快速/.test(text)) constraints.push("时间紧");
  if (/平价|预算|便宜/.test(text)) constraints.push("偏好平价");
  if (/不想太浓|不要太浓|淡一点/.test(text)) constraints.push("偏好淡妆");
  return constraints;
}

module.exports = {
  PROFILE_FILE,
  createEmptyBeautyUserProfile,
  getBeautyUserProfilePath,
  getMissingProfileFields,
  getNextOnboardingQuestion,
  getNextOnboardingField,
  isConsentGranted,
  markOnboardingQuestionAsked,
  readBeautyUserProfile,
  resetBeautyUserProfile,
  setBeautyUserConsent,
  shouldAskOnboardingThisTurn,
  summarizeBeautyUserFeedbackReflectionForPrompt,
  summarizeBeautyUserProfileForPrompt,
  updateBeautyUserBehaviorAdaptation,
  updateBeautyUserFeedbackReflection,
  updateBeautyUserProfileFromText,
  writeBeautyUserProfile,
};
