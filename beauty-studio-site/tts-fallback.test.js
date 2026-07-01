const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8");

test("frontend falls back to browser speech synthesis when cloud TTS fails", () => {
  const adapter = read("public/audio/tts-adapter.js");

  assert.match(adapter, /canUseSpeechSynthesis/);
  assert.match(adapter, /speakWithBrowserFallback/);
  assert.match(adapter, /cloud-error-browser-fallback/);
  assert.match(adapter, /window\.speechSynthesis\.speak\(utterance\)/);
});
