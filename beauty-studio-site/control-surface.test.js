const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("前端不再显示播报音色选择框", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");

  assert.doesNotMatch(html, /id="voice-select"|播报音色/);
  assert.doesNotMatch(
    app,
    /voiceSelect|VOICE_PREFERENCE_STORAGE_KEY|populateVoiceOptions|已切换播报音色/
  );
});

test("删除音色选择后仍保留默认 TTS 播报链路", () => {
  const app = read("public/app.js");
  const adapter = read("public/audio/tts-adapter.js");

  assert.match(app, /ttsAdapter = new BrowserTtsAdapter\(\)/);
  assert.match(app, /ttsAdapter\.speak\(content\)/);
  assert.match(adapter, /speakEndpoint:\s*"\/api\/voice\/tts\/speak"/);
});

test("前端不再显示口红滑块", () => {
  const html = read("public/index.html");

  assert.doesNotMatch(
    html,
    /data-gpupixel-param="lipstick"|gpupixel-lipstick-value/
  );
});

test("服务端冻结口红 skill 并保留其他美颜 skill", () => {
  const server = read("server.js");
  const skillsMatch = server.match(
    /const GPUPIXEL_PARAM_SKILLS = \[(.*?)\n\];/s
  );

  assert.ok(skillsMatch, "应能找到 GPUPIXEL_PARAM_SKILLS");
  assert.doesNotMatch(skillsMatch[1], /key:\s*"lipstick"/);
  for (const key of [
    "smoothing",
    "whitening",
    "faceSlim",
    "eyeEnlarge",
    "mouthResize",
    "noseResize",
    "eyebrow",
    "blusher",
  ]) {
    assert.match(skillsMatch[1], new RegExp(`key:\\s*"${key}"`));
  }
});

test("前端支持真实 vision-progress 思考气泡且不进入 TTS", () => {
  const app = read("public/app.js");
  const styles = read("public/styles.css");

  assert.match(app, /event\.type === "vision-progress"/);
  assert.match(app, /visionThinking/);
  assert.match(app, /魔镜正在看看你/);
  assert.match(styles, /\.vision-thinking/);
  assert.match(styles, /\.vision-thinking-progress/);
  assert.doesNotMatch(app, /speak\(event\.message/);
});
