const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createEmptyBeautyUserProfile,
  getNextOnboardingQuestion,
  markOnboardingQuestionAsked,
  shouldAskOnboardingThisTurn,
  summarizeBeautyUserFeedbackReflectionForPrompt,
  summarizeBeautyUserProfileForPrompt,
  updateBeautyUserBehaviorAdaptation,
  updateBeautyUserFeedbackReflection,
  updateBeautyUserProfileFromText,
  writeBeautyUserProfile,
  readBeautyUserProfile,
  resetBeautyUserProfile,
} = require("./beauty-user-memory");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "beauty-user-memory-"));
}

test("does not persist profile details before explicit consent", () => {
  const dir = makeTempDir();
  const profile = createEmptyBeautyUserProfile();

  const updated = updateBeautyUserProfileFromText(profile, "叫我小雨，我是油皮，平时通勤用");
  writeBeautyUserProfile(dir, updated);

  assert.equal(fs.existsSync(path.join(dir, "device-profile.json")), false);
});

test("persists opt-out state without keeping profile details", () => {
  const dir = makeTempDir();
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "denied", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const updated = updateBeautyUserProfileFromText(profile, "叫我小雨，我是油皮，平时通勤用");
  writeBeautyUserProfile(dir, updated);
  const stored = readBeautyUserProfile(dir);

  assert.equal(stored.consent.status, "denied");
  assert.equal(stored.nickname, "");
  assert.equal(stored.skinType, "");
  assert.equal(stored.primaryUseCase, "");
});

test("persists consented profile details and reads them back", () => {
  const dir = makeTempDir();
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const updated = updateBeautyUserProfileFromText(profile, "叫我小雨，我是油皮，平时通勤用，喜欢清透淡妆");
  writeBeautyUserProfile(dir, updated);
  const stored = readBeautyUserProfile(dir);

  assert.equal(stored.nickname, "小雨");
  assert.equal(stored.skinType, "油皮");
  assert.equal(stored.favoriteMakeupStyle, "清透淡妆");
  assert.equal(stored.primaryUseCase, "通勤");
});

test("asks onboarding questions one at a time in the expected order", () => {
  let profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  assert.match(getNextOnboardingQuestion(profile), /怎么称呼/);

  profile = updateBeautyUserProfileFromText(profile, "叫我小雨");
  assert.match(getNextOnboardingQuestion(profile), /年龄段/);

  profile = updateBeautyUserProfileFromText(profile, "我是二十多岁");
  assert.match(getNextOnboardingQuestion(profile), /肤质/);

  profile = updateBeautyUserProfileFromText(profile, "我是油皮");
  assert.match(getNextOnboardingQuestion(profile), /妆容/);
});

test("summarizes profile without exposing backend json", () => {
  const profile = updateBeautyUserProfileFromText(
    {
      ...createEmptyBeautyUserProfile(),
      consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
    },
    "叫我小雨，我是油皮，平时约会用，喜欢清透淡妆"
  );

  const summary = summarizeBeautyUserProfileForPrompt(profile);

  assert.match(summary, /称呼：小雨/);
  assert.match(summary, /肤质：油皮/);
  assert.match(summary, /常用场景：约会/);
  assert.doesNotMatch(summary, /"nickname"|device-profile|JSON/);
});

test("reset removes persisted profile and returns an empty profile", () => {
  const dir = makeTempDir();
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  writeBeautyUserProfile(dir, updateBeautyUserProfileFromText(profile, "叫我小雨"));
  const reset = resetBeautyUserProfile(dir);

  assert.equal(fs.existsSync(path.join(dir, "device-profile.json")), false);
  assert.equal(reset.consent.status, "unknown");
  assert.equal(reset.nickname, "");
});

test("records answered onboarding signal when profile completeness improves after a question", () => {
  const base = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };
  const asked = markOnboardingQuestionAsked(base, "ageRange", "方便告诉我你的年龄段吗？");
  const updated = { ...asked, ageRange: "二十多岁" };

  const adapted = updateBeautyUserBehaviorAdaptation(asked, updated, "我是二十多岁");

  assert.equal(adapted.evolution.answeredOnboardingCount, 1);
  assert.equal(adapted.evolution.ignoredOnboardingCount, 0);
});

test("lowers proactive level after repeated ignored onboarding questions", () => {
  const base = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };
  const firstAsked = markOnboardingQuestionAsked(base, "ageRange", "方便告诉我你的年龄段吗？");
  const firstIgnored = updateBeautyUserBehaviorAdaptation(firstAsked, firstAsked, "今天怎么画");
  const secondAsked = markOnboardingQuestionAsked(firstIgnored, "ageRange", "方便告诉我你的年龄段吗？");
  const secondIgnored = updateBeautyUserBehaviorAdaptation(secondAsked, secondAsked, "先说妆容建议");

  assert.equal(secondIgnored.evolution.ignoredOnboardingCount, 2);
  assert.equal(secondIgnored.evolution.proactiveLevel, "low");
});

test("explicit stop phrases immediately lower proactive level", () => {
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const adapted = updateBeautyUserBehaviorAdaptation(profile, profile, "别问了，直接告诉我怎么画");

  assert.equal(adapted.evolution.proactiveLevel, "low");
});

test("raises proactive level after repeated answered onboarding questions", () => {
  let profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  for (const [field, value] of [
    ["nickname", "小雨"],
    ["ageRange", "二十多岁"],
    ["skinType", "油皮"],
  ]) {
    const asked = markOnboardingQuestionAsked(profile, field, "补充一下资料可以吗？");
    profile = updateBeautyUserBehaviorAdaptation(asked, { ...asked, [field]: value }, value);
  }

  assert.equal(profile.evolution.answeredOnboardingCount, 3);
  assert.equal(profile.evolution.proactiveLevel, "high");
});

test("opt-out profiles do not record behavior adaptation signals", () => {
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "denied", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const adapted = updateBeautyUserBehaviorAdaptation(profile, { ...profile, nickname: "小雨" }, "叫我小雨");

  assert.equal(adapted.evolution.answeredOnboardingCount, 0);
  assert.equal(adapted.evolution.proactiveLevel, "normal");
});

test("low proactive level only asks during conversational openings", () => {
  const lowProfile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
    evolution: {
      ...createEmptyBeautyUserProfile().evolution,
      proactiveLevel: "low",
    },
  };

  assert.equal(shouldAskOnboardingThisTurn(lowProfile, "今天怎么画", "怎么称呼你？"), false);
  assert.equal(shouldAskOnboardingThisTurn(lowProfile, "你好", "怎么称呼你？"), true);
});

test("unknown consent can ask for memory permission during greetings", () => {
  const profile = createEmptyBeautyUserProfile();

  assert.equal(
    shouldAskOnboardingThisTurn(profile, "你好", "我可以记住你的妆容偏好吗？"),
    true
  );
  assert.equal(
    shouldAskOnboardingThisTurn(profile, "你推荐我现在画什么妆？", "我可以记住你的妆容偏好吗？"),
    true
  );
  assert.equal(
    shouldAskOnboardingThisTurn(profile, "明天天气怎么样？", "我可以记住你的妆容偏好吗？"),
    false
  );
});
test("records accepted feedback as effective advice pattern", () => {
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const reflected = updateBeautyUserFeedbackReflection(
    profile,
    "这个建议挺适合我的，我喜欢自然一点",
    { topic: "眼镜风格", suggestion: "简约低改造感" }
  );

  assert.equal(reflected.evolution.feedbackReflectionReady, true);
  assert.equal(reflected.evolution.recommendationStats.acceptedCount, 1);
  assert.match(reflected.evolution.effectiveAdvicePatterns.join("\n"), /自然|简约/);
  assert.match(reflected.evolution.preferenceSignals.join("\n"), /自然/);
});

test("records rejected feedback as avoidance signal", () => {
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const reflected = updateBeautyUserFeedbackReflection(
    profile,
    "这个不适合我，太浓了，也太麻烦",
    { topic: "妆容建议", suggestion: "上镜精致" }
  );

  assert.equal(reflected.evolution.recommendationStats.rejectedCount, 1);
  assert.match(reflected.evolution.avoidanceSignals.join("\n"), /太浓|麻烦/);
  assert.match(reflected.evolution.ineffectiveAdvicePatterns.join("\n"), /避免|太浓|麻烦/);
});

test("opt-out profiles do not record feedback reflection", () => {
  const profile = {
    ...createEmptyBeautyUserProfile(),
    consent: { status: "denied", updatedAt: "2026-06-26T00:00:00.000Z" },
  };

  const reflected = updateBeautyUserFeedbackReflection(profile, "这个建议不错", {});

  assert.equal(reflected.evolution.recommendationStats.acceptedCount, 0);
  assert.equal(reflected.evolution.effectiveAdvicePatterns.length, 0);
});

test("summarizes feedback reflection without exposing backend fields", () => {
  const profile = updateBeautyUserFeedbackReflection(
    {
      ...createEmptyBeautyUserProfile(),
      consent: { status: "granted", updatedAt: "2026-06-26T00:00:00.000Z" },
    },
    "这个不适合我，太浓了；我喜欢自然一点",
    { topic: "妆容建议" }
  );

  const summary = summarizeBeautyUserFeedbackReflectionForPrompt(profile);

  assert.match(summary, /反馈反思/);
  assert.match(summary, /自然/);
  assert.match(summary, /太浓/);
  assert.doesNotMatch(summary, /acceptedCount|rejectedCount|JSON|device-profile/);
});
