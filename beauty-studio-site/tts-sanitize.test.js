const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("TTS speech text removes emoji so engines do not read emoji descriptions", async () => {
  const moduleUrl = pathToFileURL(path.join(__dirname, "public", "audio", "tts-adapter.js"));
  const { sanitizeTtsSpeechText } = await import(moduleUrl.href);

  assert.equal(
    sanitizeTtsSpeechText("嗨呀 😊 很高兴见到你～我可以记住你的偏好吗？"),
    "嗨呀 很高兴见到你～我可以记住你的偏好吗？"
  );
  assert.equal(sanitizeTtsSpeechText("你的眼镜很适合你 😀✨"), "你的眼镜很适合你");
});
