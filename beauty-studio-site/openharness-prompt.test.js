const test = require("node:test");
const assert = require("node:assert/strict");

const { buildBeautyOpenHarnessPrompt } = require("./openharness-prompt");

test("face-shape questions require the current-frame vision tool", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "看看我的脸型怎么样",
    visionRequestId: "vision-test-1",
  });

  assert.match(prompt, /必须调用 inspect_current_beauty_frame/);
  assert.match(prompt, /视觉请求 ID: vision-test-1/);
  assert.match(prompt, /用户诉求: 看看我的脸型怎么样/);
  assert.doesNotMatch(prompt, /PLHD20|PLHD21/);
});

test("injects consented beauty user memory and limits proactive onboarding", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "今天怎么画",
    userMemory: {
      summary: [
        "用户已同意本地记忆。",
        "称呼：小雨",
        "肤质：油皮",
        "偏好妆容：清透淡妆",
        "资料缺口：年龄段、常用场景。"
      ].join("\n"),
      nextQuestion: "方便告诉我你的年龄段吗？",
      shouldAsk: true,
    },
  });

  assert.match(prompt, /# 用户记忆/);
  assert.match(prompt, /称呼：小雨/);
  assert.match(prompt, /肤质：油皮/);
  assert.match(prompt, /每轮最多追问一个问题/);
  assert.match(prompt, /方便告诉我你的年龄段吗/);
});

test("unknown consent prompt is a hard requirement for greetings and beauty tasks", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "你好",
    userMemory: {
      summary: "用户尚未同意持久记忆。不要写入长期画像；可以自然询问是否允许记住美妆偏好。",
      nextQuestion: "我可以记住你的妆容偏好和使用习惯吗？",
      shouldAsk: true,
    },
  });

  assert.match(prompt, /必须追问/);
  assert.match(prompt, /优先级高于.*打招呼/);
  assert.match(prompt, /我可以记住你的妆容偏好和使用习惯吗/);
});

test("prompt states mirror capability boundaries for unsupported makeup application", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "你给我涂一些看看",
  });

  assert.match(prompt, /# 能力边界/);
  assert.match(prompt, /不能真的替用户涂润唇膏、口红、眼影、粉底/);
  assert.match(prompt, /不要说.*已经.*涂/);
  assert.match(prompt, /可以实际调整：磨皮、提亮、瘦脸、大眼、嘴型、鼻型、眉毛、腮红/);
});

test("injects proactive behavior strategy for low and high levels", () => {
  const lowPrompt = buildBeautyOpenHarnessPrompt({
    userRequest: "今天怎么画",
    userMemory: {
      summary: "用户已同意本地记忆。",
      nextQuestion: "怎么称呼你？",
      shouldAsk: false,
      proactiveLevel: "low",
    },
  });
  const highPrompt = buildBeautyOpenHarnessPrompt({
    userRequest: "你好",
    userMemory: {
      summary: "用户已同意本地记忆。",
      nextQuestion: "怎么称呼你？",
      shouldAsk: true,
      proactiveLevel: "high",
    },
  });

  assert.match(lowPrompt, /主动程度策略/);
  assert.match(lowPrompt, /本轮尽量不要追问/);
  assert.match(highPrompt, /空档可自然追问一个问题/);
});

test("injects feedback reflection strategy without backend counters", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "今天怎么画",
    userMemory: {
      summary: "用户已同意本地记忆。",
      feedbackReflectionSummary: [
        "# 用户反馈反思",
        "用户更接受：自然、日常、低改造感建议",
        "用户不喜欢或应避免：避免太浓或太麻烦的建议",
        "只把这些当作轻量倾向，不要绝对化。",
      ].join("\n"),
    },
  });

  assert.match(prompt, /# 用户反馈反思/);
  assert.match(prompt, /自然、日常、低改造感/);
  assert.match(prompt, /避免太浓/);
  assert.doesNotMatch(prompt, /acceptedCount|rejectedCount|device-profile/);
});

test("beauty adjustments remain acknowledged as already applied", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "帮我提亮一点",
    gpupixelControl: { applied: true },
  });

  assert.match(prompt, /美颜参数已经在回复前执行完成/);
  assert.match(prompt, /单纯调整美颜参数时，不要调用视觉工具/);
});
