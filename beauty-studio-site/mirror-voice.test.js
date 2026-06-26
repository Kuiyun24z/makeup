const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGpupixelControlMessage,
  joinMirrorReply,
  WARM_MIRROR_STYLE_INSTRUCTION,
} = require("./mirror-voice");

test("提亮增强使用自然反馈且不播报参数数值", () => {
  const message = buildGpupixelControlMessage({
    key: "whitening",
    label: "提亮",
    mode: "increase",
    previousValue: 2,
    value: 3,
    text: "帮我提亮一点",
  });

  assert.match(message, /帮你|给你/);
  assert.match(message, /透亮|气色|亮/);
  assert.doesNotMatch(message, /\b3(?:\.0)?\b|调到|参数/);
});

test("瘦脸减弱准确表达自然一些而不是继续增强", () => {
  const message = buildGpupixelControlMessage({
    key: "faceSlim",
    label: "瘦脸",
    mode: "decrease",
    previousValue: 2,
    value: 1.5,
    text: "瘦脸弱一点",
  });

  assert.match(message, /自然|柔和|减轻|收一点/);
  assert.doesNotMatch(message, /更瘦|加强|调到|1\.5/);
});

test("魔镜人格指令要求先肯定再建议并保持简短亲切", () => {
  assert.match(WARM_MIRROR_STYLE_INSTRUCTION, /温柔|闺蜜|亲切/);
  assert.match(WARM_MIRROR_STYLE_INSTRUCTION, /先肯定|正向/);
  assert.match(WARM_MIRROR_STYLE_INSTRUCTION, /1\s*到\s*3\s*句|一至三句/);
});

test("魔镜人格指令禁止容貌焦虑和参数播报", () => {
  assert.match(WARM_MIRROR_STYLE_INSTRUCTION, /容貌焦虑|贬低|缺陷/);
  assert.match(WARM_MIRROR_STYLE_INSTRUCTION, /具体数值|参数数值|机械播报/);
});

test("参数反馈与后续建议拼接时不会产生重复标点", () => {
  const reply = joinMirrorReply(
    "我帮你提亮了一点哦，气色看起来更透亮啦。",
    "你现在的状态很好，再轻轻整理一下底妆就可以啦。"
  );

  assert.equal(
    reply,
    "我帮你提亮了一点哦，气色看起来更透亮啦。你现在的状态很好，再轻轻整理一下底妆就可以啦。"
  );
  assert.doesNotMatch(reply, /。。|！！|？？/);
});
