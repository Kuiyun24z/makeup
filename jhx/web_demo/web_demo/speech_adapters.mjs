export const SPEECH_LOCALE = "zh-CN";
export const WAKE_PHRASES = ["魔镜魔镜"];
export const VOSK_LIBRARY_URL = "/vendor/vosk/vosk.js";
export const VOSK_MODEL_URL = "/vendor/vosk/vosk-model-small-cn.tar.gz";

export function getSpeechRecognitionCtor(host = globalThis) {
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}

export class WebSpeechVoiceInput {
  constructor({ locale = SPEECH_LOCALE, host = globalThis } = {}) {
    this.locale = locale;
    this.host = host;
    this.recognition = null;
    this.active = false;
    this.kind = "web-speech";
  }

  static isSupported(host = globalThis) {
    return Boolean(getSpeechRecognitionCtor(host));
  }

  isSupported() {
    return WebSpeechVoiceInput.isSupported(this.host);
  }

  start(callbacks = {}) {
    const Recognition = getSpeechRecognitionCtor(this.host);
    if (!Recognition) {
      callbacks.onError?.(new Error("Web Speech API is not available in this browser."));
      return false;
    }

    this.stop();
    const recognition = new Recognition();
    recognition.lang = this.locale;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.active = true;
      callbacks.onStart?.();
    };
    recognition.onresult = (event) => {
      const result = collectSpeechResult(event);
      if (result.text) callbacks.onResult?.(result);
      if (result.finalText) callbacks.onFinal?.(result.finalText);
    };
    recognition.onerror = (event) => {
      callbacks.onError?.(new Error(event.error || "Speech recognition failed."));
    };
    recognition.onend = () => {
      this.active = false;
      this.recognition = null;
      callbacks.onEnd?.();
    };

    this.recognition = recognition;
    recognition.start();
    return true;
  }

  stop() {
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    this.active = false;
    try {
      recognition.stop();
    } catch {
      /* stop can throw when the recognizer is already inactive */
    }
  }

  abort() {
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    this.active = false;
    try {
      recognition.abort();
    } catch {
      /* abort can throw when the recognizer is already inactive */
    }
  }
}

export class WebSpeechWakeWordInput {
  constructor({ locale = SPEECH_LOCALE, host = globalThis, phrases = WAKE_PHRASES, restartDelay = 650 } = {}) {
    this.locale = locale;
    this.host = host;
    this.phrases = phrases;
    this.restartDelay = restartDelay;
    this.recognition = null;
    this.restartTimer = null;
    this.listening = false;
    this.kind = "web-speech-wake";
  }

  static isSupported(host = globalThis) {
    return Boolean(getSpeechRecognitionCtor(host));
  }

  start(callbacks = {}) {
    const Recognition = getSpeechRecognitionCtor(this.host);
    if (!Recognition) {
      callbacks.onError?.(new Error("Web Speech API is not available for wake-word mode."));
      return false;
    }

    this.stop();
    this.listening = true;
    const startRecognition = () => {
      if (!this.listening) return;
      const recognition = new Recognition();
      recognition.lang = this.locale;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => callbacks.onStart?.();
      recognition.onresult = (event) => {
        const result = collectSpeechResult(event);
        if (result.text) callbacks.onPartial?.(result.text);
        const wake = detectWakePhrase(result.text, this.phrases);
        if (!wake.matched) return;
        this.stop();
        callbacks.onWake?.({ ...wake, transcript: result.text });
      };
      recognition.onerror = (event) => {
        callbacks.onError?.(new Error(event.error || "Wake-word recognition failed."));
      };
      recognition.onend = () => {
        this.recognition = null;
        callbacks.onEnd?.();
        if (this.listening) {
          this.restartTimer = this.host.setTimeout?.(startRecognition, this.restartDelay) ?? null;
        }
      };
      this.recognition = recognition;
      recognition.start();
    };

    startRecognition();
    return true;
  }

  stop() {
    this.listening = false;
    if (this.restartTimer) {
      this.host.clearTimeout?.(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition.stop();
    } catch {
      /* stop can throw when the recognizer is already inactive */
    }
  }

  abort() {
    this.listening = false;
    if (this.restartTimer) {
      this.host.clearTimeout?.(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition.abort();
    } catch {
      /* abort can throw when the recognizer is already inactive */
    }
  }
}

/* ---------------- Vosk WASM (local, offline) ---------------- */

let voskLibraryPromise = null;
let voskModelPromise = null;

export function isBrowserHost(host = globalThis) {
  return typeof host.document !== "undefined" && typeof host.fetch === "function";
}

export async function checkVoskAssets({
  libraryUrl = VOSK_LIBRARY_URL,
  modelUrl = VOSK_MODEL_URL,
  host = globalThis,
} = {}) {
  if (!isBrowserHost(host)) {
    return { ok: false, reason: "vosk-wasm-not-vendored", libraryUrl, modelUrl, missing: ["library", "model"] };
  }
  try {
    const [lib, model] = await Promise.all([
      host.fetch(libraryUrl, { method: "HEAD" }),
      host.fetch(modelUrl, { method: "HEAD" }),
    ]);
    const missing = [];
    if (!lib.ok) missing.push("library");
    if (!model.ok) missing.push("model");
    if (missing.length) {
      return { ok: false, reason: "vosk-wasm-not-vendored", libraryUrl, modelUrl, missing };
    }
    return { ok: true, libraryUrl, modelUrl };
  } catch {
    return { ok: false, reason: "vosk-wasm-not-vendored", libraryUrl, modelUrl, missing: ["library", "model"] };
  }
}

export function loadVoskLibrary(host = globalThis) {
  if (host.Vosk) return Promise.resolve(host.Vosk);
  if (!voskLibraryPromise) {
    voskLibraryPromise = new Promise((resolve, reject) => {
      const script = host.document.createElement("script");
      script.src = VOSK_LIBRARY_URL;
      script.onload = () => {
        if (host.Vosk) resolve(host.Vosk);
        else reject(new Error("Vosk library loaded but the Vosk global is missing."));
      };
      script.onerror = () => {
        voskLibraryPromise = null;
        reject(new Error("Failed to load the local Vosk library."));
      };
      host.document.head.append(script);
    });
  }
  return voskLibraryPromise;
}

export function loadVoskModel(host = globalThis) {
  if (!voskModelPromise) {
    voskModelPromise = loadVoskLibrary(host)
      .then((Vosk) => Vosk.createModel(VOSK_MODEL_URL))
      .catch((error) => {
        voskModelPromise = null;
        throw error;
      });
  }
  return voskModelPromise;
}

export function extractVoskText(message, key = "text") {
  const value = message?.result?.[key];
  return typeof value === "string" ? value.trim() : "";
}

class VoskAudioSession {
  constructor({ host = globalThis } = {}) {
    this.host = host;
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.recognizer = null;
    this.stopped = false;
  }

  async start(handlers = {}) {
    const model = await loadVoskModel(this.host);
    if (this.stopped) return;

    this.stream = await this.host.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (this.stopped) {
      this.releaseStream();
      return;
    }

    const AudioContextCtor = this.host.AudioContext || this.host.webkitAudioContext;
    this.audioContext = new AudioContextCtor();
    this.recognizer = new model.KaldiRecognizer(this.audioContext.sampleRate);
    this.recognizer.setWords?.(false);
    this.recognizer.on("result", (message) => {
      const text = extractVoskText(message, "text");
      if (text) handlers.onResultText?.(text);
    });
    this.recognizer.on("partialresult", (message) => {
      const text = extractVoskText(message, "partial");
      if (text) handlers.onPartialText?.(text);
    });

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.stopped || !this.recognizer) return;
      try {
        this.recognizer.acceptWaveform(event.inputBuffer);
      } catch {
        /* a single bad frame should not kill the session */
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    handlers.onReady?.();
  }

  releaseStream() {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  stop() {
    this.stopped = true;
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.processor = null;
    this.source = null;
    try {
      this.recognizer?.remove?.();
    } catch {
      /* recognizer already removed */
    }
    this.recognizer = null;
    this.releaseStream();
    const context = this.audioContext;
    this.audioContext = null;
    context?.close?.().catch?.(() => {});
  }
}

export class VoskWasmVoiceInput {
  constructor({ modelUrl = VOSK_MODEL_URL, workerUrl = VOSK_LIBRARY_URL, host = globalThis } = {}) {
    this.modelUrl = modelUrl;
    this.workerUrl = workerUrl;
    this.host = host;
    this.kind = "vosk-wasm";
    this.ready = false;
    this.session = null;
    this.finalParts = [];
    this.lastPartial = "";
    this.callbacks = null;
    this.ended = false;
  }

  async prepare() {
    const status = await checkVoskAssets({ modelUrl: this.modelUrl, host: this.host });
    this.ready = status.ok === true;
    return status;
  }

  start(callbacks = {}) {
    if (!this.ready) {
      callbacks.onError?.(
        new Error("Vosk WASM is not installed yet. Add the local model under vendor/vosk to enable it."),
      );
      return false;
    }

    this.stop();
    this.session = new VoskAudioSession({ host: this.host });
    this.finalParts = [];
    this.lastPartial = "";
    this.callbacks = callbacks;
    this.ended = false;

    this.session
      .start({
        onReady: () => callbacks.onStart?.(),
        onPartialText: (text) => {
          this.lastPartial = text;
          const combined = `${this.finalParts.join("")}${text}`.trim();
          if (combined) {
            callbacks.onResult?.({
              text: combined,
              finalText: this.finalParts.join("").trim(),
              interimText: text,
            });
          }
        },
        onResultText: (text) => {
          this.finalParts.push(text);
          this.lastPartial = "";
          const finalText = this.finalParts.join("").trim();
          callbacks.onResult?.({ text: finalText, finalText, interimText: "" });
          callbacks.onFinal?.(finalText);
        },
      })
      .catch((error) => {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.finish();
      });
    return true;
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    const callbacks = this.callbacks;
    this.callbacks = null;
    const finalText = this.finalParts.join("").trim() || this.lastPartial.trim();
    if (finalText) callbacks?.onFinal?.(finalText);
    callbacks?.onEnd?.();
  }

  stop() {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    session.stop();
    this.finish();
  }

  abort() {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    session.stop();
    this.ended = true;
    const callbacks = this.callbacks;
    this.callbacks = null;
    callbacks?.onEnd?.();
  }
}

export class VoskWasmWakeWordInput {
  constructor({
    modelUrl = VOSK_MODEL_URL,
    workerUrl = VOSK_LIBRARY_URL,
    phrases = WAKE_PHRASES,
    graceMs = 900,
    host = globalThis,
  } = {}) {
    this.modelUrl = modelUrl;
    this.workerUrl = workerUrl;
    this.phrases = phrases;
    this.graceMs = graceMs;
    this.host = host;
    this.kind = "vosk-wasm-wake";
    this.ready = false;
    this.session = null;
    this.callbacks = null;
    this.pendingTimer = null;
    this.lastWakeText = "";
  }

  async prepare() {
    const status = await checkVoskAssets({ modelUrl: this.modelUrl, host: this.host });
    this.ready = status.ok === true;
    return { ...status, phrases: this.phrases };
  }

  start(callbacks = {}) {
    if (!this.ready) {
      callbacks.onError?.(
        new Error("Vosk WASM wake-word mode is not installed yet. Add the local model under vendor/vosk."),
      );
      return false;
    }

    this.stop();
    this.session = new VoskAudioSession({ host: this.host });
    this.callbacks = callbacks;
    this.lastWakeText = "";

    const fire = (text) => {
      const wake = detectWakePhrase(text, this.phrases);
      this.stop();
      callbacks.onWake?.({ ...wake, transcript: text });
    };

    // Vosk partials grow incrementally, so the wake phrase usually appears
    // before the trailing command ("魔镜魔镜，试试豆沙口红"). When the wake
    // phrase matches but has no trailing text yet, wait a short grace period
    // for the rest of the sentence before firing.
    const inspect = (text, isFinal) => {
      if (!text || !this.session) return;
      callbacks.onPartial?.(text);
      const wake = detectWakePhrase(text, this.phrases);
      if (!wake.matched) return;
      this.lastWakeText = text;
      if (wake.after || isFinal) {
        fire(text);
        return;
      }
      if (this.pendingTimer) return;
      const setT = this.host.setTimeout?.bind(this.host) ?? setTimeout;
      this.pendingTimer = setT(() => {
        this.pendingTimer = null;
        if (this.session) fire(this.lastWakeText);
      }, this.graceMs);
    };

    this.session
      .start({
        onReady: () => callbacks.onStart?.(),
        onPartialText: (text) => inspect(text, false),
        onResultText: (text) => inspect(text, true),
      })
      .catch((error) => {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.stop();
      });
    return true;
  }

  clearPendingWake() {
    if (!this.pendingTimer) return;
    const clearT = this.host.clearTimeout?.bind(this.host) ?? clearTimeout;
    clearT(this.pendingTimer);
    this.pendingTimer = null;
  }

  stop() {
    this.clearPendingWake();
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    session.stop();
    const callbacks = this.callbacks;
    this.callbacks = null;
    callbacks?.onEnd?.();
  }

  abort() {
    this.stop();
  }
}

export function createVoiceInput({ prefer = "web-speech", host = globalThis } = {}) {
  if (prefer === "web-speech" && WebSpeechVoiceInput.isSupported(host)) {
    return new WebSpeechVoiceInput({ host });
  }
  return new VoskWasmVoiceInput({ host });
}

export function normalizeWakeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]\s]/g, "");
}

export function detectWakePhrase(text, phrases = WAKE_PHRASES) {
  const raw = String(text || "").trim();
  const normalized = normalizeWakeText(raw);
  const ordered = [...phrases].sort((a, b) => normalizeWakeText(b).length - normalizeWakeText(a).length);
  for (const phrase of ordered) {
    const normalizedPhrase = normalizeWakeText(phrase);
    if (!normalized.includes(normalizedPhrase)) continue;
    const rawIndex = raw.indexOf(phrase);
    const after =
      rawIndex >= 0
        ? raw.slice(rawIndex + phrase.length).replace(/^[，。！？、,.!?;；:：\s]+/, "").trim()
        : "";
    return {
      matched: true,
      phrase,
      transcript: raw,
      after,
    };
  }
  return {
    matched: false,
    phrase: null,
    transcript: raw,
    after: "",
  };
}

export function collectSpeechResult(event) {
  let interimText = "";
  let finalText = "";
  for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    const text = result?.[0]?.transcript || "";
    if (result?.isFinal) finalText += text;
    else interimText += text;
  }
  return {
    text: `${finalText}${interimText}`.trim(),
    finalText: finalText.trim(),
    interimText: interimText.trim(),
  };
}
