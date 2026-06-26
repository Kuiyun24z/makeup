import assert from "node:assert/strict";
import {
  VoskWasmWakeWordInput,
  VoskWasmVoiceInput,
  WebSpeechWakeWordInput,
  WebSpeechVoiceInput,
  checkVoskAssets,
  collectSpeechResult,
  createVoiceInput,
  detectWakePhrase,
  extractVoskText,
  isBrowserHost,
  normalizeWakeText,
} from "../speech_adapters.mjs";

function FakeRecognition() {}

assert.equal(WebSpeechVoiceInput.isSupported({}), false);
assert.equal(WebSpeechVoiceInput.isSupported({ SpeechRecognition: FakeRecognition }), true);
assert.equal(WebSpeechVoiceInput.isSupported({ webkitSpeechRecognition: FakeRecognition }), true);
assert.equal(WebSpeechWakeWordInput.isSupported({}), false);
assert.equal(WebSpeechWakeWordInput.isSupported({ SpeechRecognition: FakeRecognition }), true);

assert.equal(createVoiceInput({ host: { SpeechRecognition: FakeRecognition } }).kind, "web-speech");
assert.equal(createVoiceInput({ host: {} }).kind, "vosk-wasm");

const speech = collectSpeechResult({
  resultIndex: 0,
  results: [
    { 0: { transcript: "试试" }, isFinal: true },
    { 0: { transcript: "豆沙口红" }, isFinal: false },
  ],
});
assert.deepEqual(speech, {
  text: "试试豆沙口红",
  finalText: "试试",
  interimText: "豆沙口红",
});

const vosk = new VoskWasmVoiceInput({ modelUrl: "/vendor/vosk/model", workerUrl: "/vendor/vosk/worker.js" });
const status = await vosk.prepare();
assert.equal(status.ok, false);
assert.equal(status.reason, "vosk-wasm-not-vendored");

let errorMessage = "";
assert.equal(
  vosk.start({
    onError(error) {
      errorMessage = error.message;
    },
  }),
  false,
);
assert.match(errorMessage, /Vosk WASM/);

assert.equal(normalizeWakeText("魔 镜，魔 镜！"), "魔镜魔镜");
assert.deepEqual(detectWakePhrase("魔镜魔镜，试试豆沙口红"), {
  matched: true,
  phrase: "魔镜魔镜",
  transcript: "魔镜魔镜，试试豆沙口红",
  after: "试试豆沙口红",
});
assert.equal(detectWakePhrase("你好镜子").matched, false);

const wakeVosk = new VoskWasmWakeWordInput();
const wakeStatus = await wakeVosk.prepare();
assert.equal(wakeStatus.ok, false);
assert.equal(wakeStatus.reason, "vosk-wasm-not-vendored");

// ---- Stage 5C-2: filled Vosk adapters ----

assert.equal(isBrowserHost({}), false);
assert.equal(isBrowserHost({ document: {}, fetch: () => {} }), true);

const nodeStatus = await checkVoskAssets({ host: {} });
assert.equal(nodeStatus.ok, false);
assert.equal(nodeStatus.reason, "vosk-wasm-not-vendored");
assert.deepEqual(nodeStatus.missing, ["library", "model"]);

const browserOkStatus = await checkVoskAssets({
  host: {
    document: {},
    fetch: async () => ({ ok: true }),
  },
});
assert.equal(browserOkStatus.ok, true);

const browserMissingModel = await checkVoskAssets({
  host: {
    document: {},
    fetch: async (url) => ({ ok: !String(url).includes("tar.gz") }),
  },
});
assert.equal(browserMissingModel.ok, false);
assert.deepEqual(browserMissingModel.missing, ["model"]);

assert.equal(extractVoskText({ result: { text: " 魔镜魔镜 " } }, "text"), "魔镜魔镜");
assert.equal(extractVoskText({ result: { partial: "试试豆沙" } }, "partial"), "试试豆沙");
assert.equal(extractVoskText({}, "text"), "");
assert.equal(extractVoskText(null, "partial"), "");

let wakeErrorMessage = "";
assert.equal(
  wakeVosk.start({
    onError(error) {
      wakeErrorMessage = error.message;
    },
  }),
  false,
);
assert.match(wakeErrorMessage, /wake-word/);

const readyVoice = new VoskWasmVoiceInput({ host: {} });
readyVoice.ready = false;
assert.equal(readyVoice.start({}), false);

console.log("speech adapters ok");
