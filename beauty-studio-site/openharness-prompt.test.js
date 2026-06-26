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

test("beauty adjustments remain acknowledged as already applied", () => {
  const prompt = buildBeautyOpenHarnessPrompt({
    userRequest: "帮我提亮一点",
    gpupixelControl: { applied: true },
  });

  assert.match(prompt, /美颜参数已经在回复前执行完成/);
  assert.match(prompt, /单纯调整美颜参数时，不要调用视觉工具/);
});
