class BaseSpeechProvider extends EventTarget {
  constructor() {
    super();
    this.provider = "unknown";
    this.mode = "unknown";
    this.engine = "unknown";
    this.supported = false;
    this.listening = false;
    this.activeRequestId = "";
    this.lastError = "";
  }

  isSupported() {
    return this.supported;
  }
}

class WhisperLocalSpeechProvider extends BaseSpeechProvider {
  constructor(options = {}) {
    super();
    const provider = options.provider === "funasr-local" ? "funasr-local" : "whisper-local";
    const providerDefaults =
      provider === "funasr-local"
        ? {
            partialChunkMs: 360,
            minPartialIntervalMs: 260,
            maxRecorderFlushMs: 700,
            enablePartial: true,
            stopTailPaddingMs: 500,
          }
        : {};
    this.options = {
      startEndpoint: "/api/voice/asr/start",
      chunkEndpoint: "/api/voice/asr/chunk",
      partialEndpoint: "/api/voice/asr/partial",
      stopEndpoint: "/api/voice/asr/stop",
      cancelEndpoint: "/api/voice/asr/cancel",
      lang: "zh",
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 64000,
      maxRecorderFlushMs: 1200,
      partialChunkMs: 1200,
      minPartialIntervalMs: 1400,
      enablePartial: true,
      stopTailPaddingMs: 0,
      ...providerDefaults,
      ...options,
    };
    this.isFunasrProvider = provider === "funasr-local";
    this.provider = provider;
    this.mode = "browser-recorder";
    this.engine = this.provider === "funasr-local" ? "funasr" : "faster-whisper";
    this.supported =
      typeof window !== "undefined" &&
      typeof window.fetch === "function" &&
      typeof window.MediaRecorder !== "undefined" &&
      typeof window.navigator?.mediaDevices?.getUserMedia === "function";
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.startedAt = 0;
    this.partialRequestSerial = 0;
    this.latestPartialAppliedSerial = 0;
    this.partialInFlight = false;
    this.chunkUploadInFlight = false;
    this.lastPartialDispatchAt = 0;
    this.chunkUploadChain = Promise.resolve();
    this.currentPartialTask = null;
    this.isStopping = false;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.processorNode = null;
    this.pendingPcmSamples = [];
    this.flushTimer = 0;
  }

  async postJson(url, payload = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `Request failed: ${response.status}`);
    }
    return result;
  }

  resolveMimeType() {
    const candidates = [
      this.options.mimeType,
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (typeof MediaRecorder.isTypeSupported !== "function") {
        return candidate;
      }
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  async ensureStream() {
    if (this.stream) {
      return this.stream;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    return this.stream;
  }

  async ensureAudioContext() {
    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Current browser does not support AudioContext.");
      }
      this.audioContext = new AudioContextCtor();
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  clearFlushTimer() {
    if (this.flushTimer) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = 0;
    }
  }

  destroyPcmPipeline() {
    this.clearFlushTimer();
    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.mediaStreamSource) {
      try {
        this.mediaStreamSource.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
      this.mediaStreamSource = null;
    }
    this.pendingPcmSamples = [];
  }

  downsampleFloat32To16k(inputSamples, inputSampleRate) {
    if (!inputSamples?.length) {
      return new Int16Array(0);
    }

    const targetSampleRate = 16000;
    if (inputSampleRate === targetSampleRate) {
      const pcm = new Int16Array(inputSamples.length);
      for (let index = 0; index < inputSamples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, inputSamples[index]));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return pcm;
    }

    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.max(1, Math.round(inputSamples.length / ratio));
    const output = new Int16Array(outputLength);
    let outputIndex = 0;
    let inputIndex = 0;

    while (outputIndex < outputLength) {
      const nextInputIndex = Math.min(inputSamples.length, Math.round((outputIndex + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let cursor = inputIndex; cursor < nextInputIndex; cursor += 1) {
        sum += inputSamples[cursor];
        count += 1;
      }
      const sample = count > 0 ? sum / count : inputSamples[Math.min(inputIndex, inputSamples.length - 1)] || 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      output[outputIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      outputIndex += 1;
      inputIndex = nextInputIndex;
    }

    return output;
  }

  pcm16ToBase64(pcm16) {
    if (!pcm16?.length) {
      return "";
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
      binary += String.fromCharCode(...slice);
    }
    return window.btoa(binary);
  }

  async flushPendingPcmChunk({ force = false } = {}) {
    if (!this.activeRequestId || (!force && this.isStopping) || !this.pendingPcmSamples.length) {
      return;
    }

    const merged = new Float32Array(this.pendingPcmSamples.reduce((sum, part) => sum + part.length, 0));
    let cursor = 0;
    for (const part of this.pendingPcmSamples) {
      merged.set(part, cursor);
      cursor += part.length;
    }
    this.pendingPcmSamples = [];

    const sampleRate = this.audioContext?.sampleRate || 48000;
    const pcm16 = this.downsampleFloat32To16k(merged, sampleRate);
    const audioBase64 = this.pcm16ToBase64(pcm16);
    if (!audioBase64) {
      return;
    }

    const uploadTask = async () => {
      this.chunkUploadInFlight = true;
      try {
        await this.postJson(this.options.chunkEndpoint, {
          requestId: this.activeRequestId,
          mimeType: "audio/pcm;rate=16000",
          audioBase64,
          durationMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
          lang: this.options.lang,
        });
      } finally {
        this.chunkUploadInFlight = false;
      }
    };

    this.chunkUploadChain = this.chunkUploadChain.then(uploadTask, uploadTask);
    await this.chunkUploadChain;

    if (!this.isStopping) {
      void this.maybeSendPartial();
    }
  }

  async startFunasrPcmCapture() {
    const stream = await this.ensureStream();
    const audioContext = await this.ensureAudioContext();
    this.destroyPcmPipeline();

    this.mediaStreamSource = audioContext.createMediaStreamSource(stream);
    this.processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);
      this.pendingPcmSamples.push(new Float32Array(channelData));
    };

    this.mediaStreamSource.connect(this.processorNode);
    this.processorNode.connect(audioContext.destination);
    this.clearFlushTimer();
    this.flushTimer = window.setInterval(() => {
      void this.flushPendingPcmChunk().catch(() => {});
    }, this.options.partialChunkMs);
  }

  async start({ requestId = "" } = {}) {
    if (!this.supported) {
      throw new Error("Local ASR is not supported in this browser.");
    }

    const runtimeRequestId = String(requestId || `whisper-${Date.now()}`);
    await this.postJson(this.options.startEndpoint, {
      requestId: runtimeRequestId,
      lang: this.options.lang,
      engine: this.engine,
    });

    this.audioChunks = [];
    this.partialRequestSerial = 0;
    this.latestPartialAppliedSerial = 0;
    this.partialInFlight = false;
    this.chunkUploadInFlight = false;
    this.lastPartialDispatchAt = 0;
    this.chunkUploadChain = Promise.resolve();
    this.currentPartialTask = null;
    this.isStopping = false;

    if (this.isFunasrProvider) {
      await this.startFunasrPcmCapture();
    } else {
      const stream = await this.ensureStream();
      const mimeType = this.resolveMimeType();
      const recorderOptions = mimeType
        ? { mimeType, audioBitsPerSecond: this.options.audioBitsPerSecond }
        : { audioBitsPerSecond: this.options.audioBitsPerSecond };
      this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
      this.mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          void this.handleChunk(event.data);
        }
      });
      this.mediaRecorder.start(this.options.partialChunkMs);
    }

    this.activeRequestId = runtimeRequestId;
    this.listening = true;
    this.startedAt = performance.now();
    this.dispatchEvent(new CustomEvent("started"));
  }

  waitForRecorderStop() {
    return new Promise((resolve) => {
      if (this.isFunasrProvider) {
        resolve();
        return;
      }
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        resolve();
        return;
      }

      let settled = false;
      const finalize = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      this.mediaRecorder.addEventListener("stop", finalize, { once: true });

      window.setTimeout(finalize, this.options.maxRecorderFlushMs);
      try {
        this.mediaRecorder.stop();
      } catch (_error) {
        finalize();
      }
    });
  }

  async stop() {
    if (!this.activeRequestId) {
      this.listening = false;
      return;
    }

    try {
      this.isStopping = true;
      await this.waitForRecorderStop();
      if (this.isFunasrProvider) {
        if (this.options.stopTailPaddingMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, this.options.stopTailPaddingMs));
        }
        await this.flushPendingPcmChunk({ force: true }).catch(() => {});
        this.destroyPcmPipeline();
      }
      await this.chunkUploadChain.catch(() => {});
      await this.currentPartialTask?.catch?.(() => {});
      const mimeType = this.isFunasrProvider
        ? "audio/pcm;rate=16000"
        : this.mediaRecorder?.mimeType || this.resolveMimeType() || "audio/webm";
      const result = await this.postJson(this.options.stopEndpoint, {
        requestId: this.activeRequestId,
        mimeType,
        durationMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
        lang: this.options.lang,
      });
      const text = String(result?.text || "").trim();
      const now = performance.now();
      this.listening = false;
      this.dispatchEvent(new CustomEvent("stopped"));
      if (text) {
        this.dispatchEvent(
          new CustomEvent("segment", {
            detail: {
              type: "final",
              text,
              isFinal: true,
              provider: this.provider,
              mode: this.mode,
              engine: this.engine,
              at: now,
            },
          })
        );
      }
    } catch (error) {
      this.lastError = String(error?.message || error || "whisper-stop-error");
      this.listening = false;
      this.dispatchEvent(new CustomEvent("stopped"));
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: {
            error: this.lastError,
          },
        })
      );
    } finally {
      this.activeRequestId = "";
      this.audioChunks = [];
      this.mediaRecorder = null;
      this.partialInFlight = false;
      this.chunkUploadInFlight = false;
      this.currentPartialTask = null;
      this.isStopping = false;
    }
  }

  async abort() {
    const requestId = this.activeRequestId;
    this.activeRequestId = "";
    this.listening = false;
    try {
      if (!this.isFunasrProvider && this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    } catch (_error) {
      // Ignore teardown failures.
    }
    if (this.isFunasrProvider) {
      this.destroyPcmPipeline();
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.partialInFlight = false;
    this.chunkUploadInFlight = false;
    this.currentPartialTask = null;
    this.isStopping = false;
    if (requestId) {
      try {
        await this.postJson(this.options.cancelEndpoint, { requestId });
      } catch (_error) {
        // Ignore cancellation failures during teardown.
      }
    }
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || "");
        const encoded = dataUrl.split(",")[1] || "";
        resolve(encoded);
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read audio blob."));
      reader.readAsDataURL(blob);
    });
  }

  async maybeSendPartial() {
    if (!this.options.enablePartial || !this.activeRequestId || this.partialInFlight || this.isStopping) {
      return;
    }

    const now = performance.now();
    if (now - this.lastPartialDispatchAt < this.options.minPartialIntervalMs) {
      return;
    }

    this.partialInFlight = true;
    this.lastPartialDispatchAt = now;
    const serial = ++this.partialRequestSerial;

    this.currentPartialTask = (async () => {
      try {
        const mimeType = this.mediaRecorder?.mimeType || this.resolveMimeType() || "audio/webm";
        const result = await this.postJson(this.options.partialEndpoint, {
          requestId: this.activeRequestId,
          mimeType,
          durationMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
          lang: this.options.lang,
        });
        const text = String(result?.text || "").trim();
        if (!text || serial < this.latestPartialAppliedSerial || this.isStopping) {
          return;
        }
        this.latestPartialAppliedSerial = serial;
        this.dispatchEvent(
          new CustomEvent("segment", {
            detail: {
              type: "partial",
              text,
              isFinal: false,
              provider: this.provider,
              mode: this.mode,
              engine: this.engine,
              at: performance.now(),
            },
          })
        );
      } catch (_error) {
        // Partial failures should not tear down the whole turn.
      } finally {
        this.partialInFlight = false;
      }
    })();

    await this.currentPartialTask;
  }

  async handleChunk(chunkBlob) {
    this.audioChunks.push(chunkBlob);
    if (!this.activeRequestId) {
      return;
    }

    const uploadTask = async () => {
      this.chunkUploadInFlight = true;
      try {
        const mimeType = this.mediaRecorder?.mimeType || this.resolveMimeType() || "audio/webm";
        const audioBase64 = await this.blobToBase64(chunkBlob);
        await this.postJson(this.options.chunkEndpoint, {
          requestId: this.activeRequestId,
          mimeType,
          audioBase64,
          durationMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
          lang: this.options.lang,
        });
      } finally {
        this.chunkUploadInFlight = false;
      }
    };

    this.chunkUploadChain = this.chunkUploadChain.then(uploadTask, uploadTask);
    await this.chunkUploadChain;

    if (!this.isStopping) {
      void this.maybeSendPartial();
    }
  }
}

class PlaceholderRealtimeStreamSpeechProvider extends BaseSpeechProvider {
  constructor(options = {}) {
    super();
    this.options = {
      lang: "zh-CN",
      ...options,
    };
    this.provider = "realtime-stream";
    this.mode = "websocket-stream";
    this.engine = "pending-provider";
    this.supported = false;
    this.lastError = "Realtime streaming ASR provider is not configured yet.";
  }

  async start() {
    throw new Error(this.lastError);
  }

  async stop() {}

  async abort() {}
}

function createSpeechProvider(options = {}) {
  const provider = String(options.provider || "whisper-local").trim();
  if (provider === "realtime-stream") {
    return new PlaceholderRealtimeStreamSpeechProvider(options);
  }
  if (provider === "funasr-local") {
    return new WhisperLocalSpeechProvider({
      ...options,
      provider: "funasr-local",
    });
  }
  return new WhisperLocalSpeechProvider(options);
}

export class WebSpeechAsrAdapter extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = {
      lang: "zh-CN",
      provider: "whisper-local",
      segmentCommitSilenceMs: 260,
      ...options,
    };
    this.runtime = {
      provider: this.options.provider,
      mode: "stream-adapter-v1",
      engine: "unknown",
    };
    this.provider = createSpeechProvider(this.options);
    this.runtime.provider = this.provider.provider;
    this.runtime.mode = this.provider.mode;
    this.runtime.engine = this.provider.engine;
    this.supported = this.provider.isSupported();
    this.listening = false;
    this.lastPartialText = "";
    this.lastFinalText = "";
    this.lastStableText = "";
    this.lastError = "";
    this.sessionId = "";
    this.turnId = 0;
    this.utteranceCounter = 0;
    this.currentUtteranceId = "";
    this.segmentCounter = 0;
    this.currentSegments = [];
    this.lastSegmentAt = 0;

    this.bindProviderEvents();
  }

  bindProviderEvents() {
    this.provider.addEventListener("started", () => {
      this.listening = true;
      this.dispatchEvent(new CustomEvent("started", { detail: this.createEventDetail() }));
    });

    this.provider.addEventListener("stopped", () => {
      this.listening = false;
      this.dispatchEvent(new CustomEvent("stopped", { detail: this.createEventDetail() }));
    });

    this.provider.addEventListener("error", (event) => {
      const errorCode = event.detail?.error || "unknown-error";
      this.lastError = String(errorCode);
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: this.createEventDetail({
            error: errorCode,
          }),
        })
      );
    });

    this.provider.addEventListener("segment", (event) => {
      const segment = event.detail || {};
      const text = String(segment.text || "").trim();
      if (!text) {
        return;
      }

      const normalizedSegment = {
        id: `${this.currentUtteranceId || "utterance"}-segment-${++this.segmentCounter}`,
        type: segment.type === "final" ? "final" : "partial",
        text,
        isFinal: Boolean(segment.isFinal),
        at: Number(segment.at || performance.now()),
      };

      this.lastSegmentAt = normalizedSegment.at;
      this.currentSegments.push(normalizedSegment);
      this.currentSegments = this.currentSegments.slice(-12);

      if (normalizedSegment.isFinal) {
        this.lastFinalText = this.mergeTranscriptText(this.lastFinalText, normalizedSegment.text);
        this.lastStableText = this.lastFinalText;
        this.dispatchEvent(
          new CustomEvent("final", {
            detail: this.createEventDetail({
              text: this.lastFinalText,
              segment: normalizedSegment,
              segments: [...this.currentSegments],
              isFinal: true,
            }),
          })
        );
        return;
      }

      this.lastPartialText = normalizedSegment.text;
      this.dispatchEvent(
        new CustomEvent("partial", {
          detail: this.createEventDetail({
            text: this.lastPartialText,
            segment: normalizedSegment,
            segments: [...this.currentSegments],
            isFinal: false,
          }),
        })
      );
    });
  }

  mergeTranscriptText(existingText, incomingText) {
    const existing = String(existingText || "").trim();
    const incoming = String(incomingText || "").trim();
    if (!incoming) {
      return existing;
    }
    if (!existing) {
      return incoming;
    }
    if (existing.endsWith(incoming)) {
      return existing;
    }
    return `${existing}${incoming}`.trim();
  }

  isSupported() {
    return this.supported;
  }

  getRuntimeInfo() {
    return {
      supported: this.supported,
      provider: this.runtime.provider,
      mode: this.runtime.mode,
      engine: this.runtime.engine,
      lang: this.options.lang,
      sessionId: this.sessionId,
      turnId: this.turnId,
      utteranceId: this.currentUtteranceId,
      segmentCount: this.currentSegments.length,
      lastSegmentAt: this.lastSegmentAt,
      lastError: this.lastError,
    };
  }

  setSessionContext({ sessionId = "", turnId = 0 } = {}) {
    this.sessionId = String(sessionId || "").trim();
    this.turnId = Number(turnId || 0);
  }

  prepareTurn({ turnId = 0 } = {}) {
    this.turnId = Number(turnId || this.turnId || 0);
    this.utteranceCounter += 1;
    this.currentUtteranceId = `utterance-${this.utteranceCounter}`;
    this.segmentCounter = 0;
    this.resetBuffer();
  }

  createEventDetail(extra = {}) {
    return {
      sessionId: this.sessionId,
      turnId: this.turnId,
      utteranceId: this.currentUtteranceId,
      provider: this.runtime.provider,
      mode: this.runtime.mode,
      engine: this.runtime.engine,
      at: performance.now(),
      ...extra,
    };
  }

  async start({ sessionId = "", turnId = 0 } = {}) {
    this.setSessionContext({ sessionId, turnId });
    if (!this.currentUtteranceId) {
      this.prepareTurn({ turnId });
    }
    await this.provider.start({
      requestId: `${this.sessionId || "session"}-${this.currentUtteranceId}`,
    });
  }

  async stop() {
    await this.provider.stop();
  }

  async abort() {
    await this.provider.abort();
    this.listening = false;
  }

  resetBuffer() {
    this.lastPartialText = "";
    this.lastFinalText = "";
    this.lastStableText = "";
    this.currentSegments = [];
    this.lastSegmentAt = 0;
  }

  promotePartialToFinal() {
    const candidate = String(this.lastFinalText || this.lastPartialText || "").trim();
    if (!candidate) {
      return "";
    }
    this.lastFinalText = candidate;
    this.lastStableText = candidate;
    return candidate;
  }

  getTranscriptSnapshot() {
    return {
      sessionId: this.sessionId,
      turnId: this.turnId,
      utteranceId: this.currentUtteranceId,
      partialTranscript: this.lastPartialText,
      finalTranscript: this.lastFinalText,
      stableTranscript: this.lastStableText,
      provider: this.runtime.provider,
      mode: this.runtime.mode,
      engine: this.runtime.engine,
      lastError: this.lastError,
      segments: [...this.currentSegments],
      lastSegmentAt: this.lastSegmentAt,
    };
  }
}
