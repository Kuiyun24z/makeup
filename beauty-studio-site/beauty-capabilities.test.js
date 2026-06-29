const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BEAUTY_CAPABILITY_MANIFEST,
  buildBeautyCapabilityContext,
  enforceBeautyCapabilityBoundary,
  shouldBufferBeautyCapabilitySensitiveReply,
} = require("./beauty-capabilities");

test("beauty capability manifest separates executable actions from advice-only cosmetics", () => {
  assert.deepEqual(
    BEAUTY_CAPABILITY_MANIFEST.executableActions.map((item) => item.label),
    ["磨皮", "提亮", "瘦脸", "大眼", "嘴型", "鼻型", "眉毛", "腮红"]
  );
  assert.ok(BEAUTY_CAPABILITY_MANIFEST.adviceOnlyCosmetics.includes("润唇膏"));
  assert.ok(BEAUTY_CAPABILITY_MANIFEST.adviceOnlyCosmetics.includes("口红"));
  assert.ok(BEAUTY_CAPABILITY_MANIFEST.adviceOnlyCosmetics.includes("眼影"));
  assert.ok(BEAUTY_CAPABILITY_MANIFEST.adviceOnlyCosmetics.includes("粉底"));
});

test("capability context records actual GPUPixel actions in an action ledger", () => {
  const context = buildBeautyCapabilityContext({
    gpupixelControl: {
      applied: true,
      key: "eyeEnlarge",
      label: "大眼",
      message: "我帮你把眼睛放大了一点哦。",
    },
  });

  assert.deepEqual(context.actionLedger, [
    {
      type: "gpupixel",
      key: "eyeEnlarge",
      label: "大眼",
    },
  ]);
});

test("response guard rewrites unsupported real makeup application claims", () => {
  const result = enforceBeautyCapabilityBoundary(
    "好啦～我现在就把甜甜的蜜桃色润唇膏轻轻涂在你嘴唇上啦，气色也一下子亮起来哦～",
    buildBeautyCapabilityContext({})
  );

  assert.equal(result.changed, true);
  assert.match(result.text, /不能真的替你涂润唇膏/);
  assert.match(result.text, /可以建议你试/);
  assert.doesNotMatch(result.text, /我现在就把.*涂在你嘴唇上/);
});

test("response guard leaves supported GPUPixel adjustment feedback alone when ledger proves execution", () => {
  const result = enforceBeautyCapabilityBoundary(
    "我帮你把眼睛放大了一点哦，看起来更有神啦。",
    buildBeautyCapabilityContext({
      gpupixelControl: {
        applied: true,
        key: "eyeEnlarge",
        label: "大眼",
      },
    })
  );

  assert.equal(result.changed, false);
  assert.equal(result.text, "我帮你把眼睛放大了一点哦，看起来更有神啦。");
});

test("sensitive unsupported makeup requests should buffer raw streaming deltas", () => {
  assert.equal(shouldBufferBeautyCapabilitySensitiveReply({ userRequest: "你给我涂一些看看" }), true);
  assert.equal(shouldBufferBeautyCapabilitySensitiveReply({ userRequest: "帮我上口红看看" }), true);
  assert.equal(shouldBufferBeautyCapabilitySensitiveReply({ userRequest: "帮我提亮一点" }), false);
});
