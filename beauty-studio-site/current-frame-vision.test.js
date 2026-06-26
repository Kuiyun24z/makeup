const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createVisionRequestRegistry,
  buildCurrentFrameVisionPrompt,
} = require("./current-frame-vision");

test("视觉请求同一轮只能领取一次并能发送真实进度", () => {
  const events = [];
  const registry = createVisionRequestRegistry({ ttlMs: 10_000 });
  registry.register(
    "vision-1",
    (event) => events.push(event),
    { question: "看看我的脸型", analysisFocus: "脸型" }
  );

  assert.equal(registry.claim("vision-1"), true);
  assert.equal(registry.claim("vision-1"), false);
  assert.deepEqual(registry.getContext("vision-1"), {
    question: "看看我的脸型",
    analysisFocus: "脸型",
  });
  assert.equal(
    registry.emit("vision-1", "capturing", "正在读取当前画面"),
    true
  );
  assert.deepEqual(events, [
    {
      type: "vision-progress",
      stage: "capturing",
      message: "正在读取当前画面",
    },
  ]);
});

test("视觉请求过期后不可领取或发送进度", () => {
  let now = 1_000;
  const registry = createVisionRequestRegistry({
    ttlMs: 500,
    now: () => now,
  });
  registry.register("vision-expired", () => {});
  now = 1_501;

  assert.equal(registry.claim("vision-expired"), false);
  assert.equal(
    registry.emit("vision-expired", "analyzing", "正在分析"),
    false
  );
});

test("豆包当前画面提示词清晰要求结构化观察且禁止猜测", () => {
  const prompt = buildCurrentFrameVisionPrompt({
    question: "看看我的脸型怎么样",
    analysisFocus: "脸型",
  });

  assert.match(prompt, /你是美妆镜的视觉观察模块/);
  assert.match(prompt, /用户问题: 看看我的脸型怎么样/);
  assert.match(prompt, /重点观察: 脸型/);
  assert.match(prompt, /如果画面没有清晰可见的人脸/);
  assert.match(prompt, /只返回 JSON 对象/);
  assert.match(prompt, /visible/);
  assert.match(prompt, /faceShape/);
  assert.match(prompt, /gentleSuggestion/);
  assert.doesNotMatch(prompt, /浣犳槸|鐢ㄦ埛|濡傛灉/);
});

test("Beauty Studio 服务端暴露视觉接口并桥接 OpenHarness 工具事件", () => {
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

  assert.match(server, /\/api\/vision\/inspect-current-frame/);
  assert.match(server, /event\.type === "tool_started"/);
  assert.match(server, /event\.type === "tool_completed"/);
  assert.match(server, /type:\s*"vision-progress"/);
});

test("OpenHarness 提示词提供视觉 request ID 和自主调用规则", () => {
  const prompt = fs.readFileSync(
    path.join(__dirname, "openharness-prompt.js"),
    "utf8"
  );

  assert.match(prompt, /inspect_current_beauty_frame/);
  assert.match(prompt, /视觉请求 ID/);
  assert.match(prompt, /自主判断/);
});

test("当前画面视觉请求限制短输出并预留足够超时时间", () => {
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

  assert.match(
    server,
    /CURRENT_FRAME_VISION_TIMEOUT_MS\s*=\s*Number\(process\.env\.CURRENT_FRAME_VISION_TIMEOUT_MS\s*\|\|\s*30000\)/
  );
  assert.match(server, /max_output_tokens:\s*800/);
});
