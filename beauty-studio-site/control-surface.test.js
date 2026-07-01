const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const workspaceRoot = path.resolve(root, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const readWorkspace = (relativePath) =>
  fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");

test("前端不再显示播报音色选择框", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");

  assert.doesNotMatch(html, /id="voice-select"|播报音色/);
  assert.doesNotMatch(
    app,
    /voiceSelect|VOICE_PREFERENCE_STORAGE_KEY|populateVoiceOptions|已切换播报音色/
  );
});

test("服务端不把 GPUPixel 内部运行模式当成用户回复", () => {
  const server = read("server.js");

  assert.doesNotMatch(server, /GPUPixel active mode/);
  assert.doesNotMatch(server, /nextStep[\s\S]{0,120}moduleFocus\s*\|\|/);
});

test("删除音色选择后仍保留默认 TTS 播报链路", () => {
  const app = read("public/app.js");
  const adapter = read("public/audio/tts-adapter.js");

  assert.match(app, /ttsAdapter = new BrowserTtsAdapter\(\)/);
  assert.match(app, /ttsAdapter\.speak\(content\)/);
  assert.match(adapter, /speakEndpoint:\s*"\/api\/voice\/tts\/speak"/);
});

test("服务端支持用火山 TTS provider 替换本地播报代理并保留 fallback", () => {
  const server = read("server.js");

  assert.match(server, /require\("\.\/volcengine-tts"\)/);
  assert.match(server, /TTS_PROVIDER/);
  assert.match(server, /handleTtsSpeak/);
  assert.match(server, /synthesizeVolcengineTts/);
  assert.match(server, /handleLocalTtsProxy\(req,\s*res,\s*"\/speak"\)/);
});

test("启动脚本在火山 TTS provider 下不强制启动和等待本地 TTS", () => {
  const launcher = readWorkspace("start-beauty-studio.ps1");

  assert.match(launcher, /\$useLocalTts\s*=/);
  assert.match(launcher, /if \(\$useLocalTts\) \{[\s\S]*localTtsProcess/s);
  assert.match(launcher, /if \(\$useLocalTts -and -not \(Wait-ForUrl -Url \$localTtsHealthUrl/);
  assert.match(launcher, /Cloud TTS provider/);
});

test("启动脚本优先使用带依赖的 OpenHarness Python 启动本地 ASR", () => {
  const launcher = readWorkspace("start-beauty-studio.ps1");

  assert.match(launcher, /C:\\ProgramData\\miniconda3\\envs\\openharness\\python\.exe/);
  assert.match(
    launcher,
    /C:\\ProgramData\\miniconda3\\envs\\openharness\\python\.exe[\s\S]*D:\\Anaconda3\\envs\\openharness\\python\.exe/
  );
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

test("实时语音采集有最大时长兜底避免 ASR session 一直不提交", () => {
  const orchestrator = read("public/audio/conversation-orchestrator.js");

  assert.match(orchestrator, /maxCaptureMs\s*=\s*6500/);
  assert.match(orchestrator, /scheduleCaptureTimeout/);
  assert.match(orchestrator, /clearCaptureTimeout/);
  assert.match(orchestrator, /realtime-max-capture/);
  assert.match(orchestrator, /this\.finishTurnCapture\("realtime-max-capture"\)/);
});
