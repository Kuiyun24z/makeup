export class RealtimeConversationOrchestrator {
  constructor({
    audioInputManager,
    vadManager,
    asrAdapter,
    ttsAdapter,
    onStateChange = () => {},
    onPartialTranscript = () => {},
    onFinalTranscript = () => {},
    onCommittedTranscript = () => {},
    onInterruptRequest = () => {},
    onSubmitTranscript = async () => {},
    onError = () => {},
    onMetrics = () => {},
  } = {}) {
    this.audioInputManager = audioInputManager;
    this.vadManager = vadManager;
    this.asrAdapter = asrAdapter;
    this.ttsAdapter = ttsAdapter;
    this.onStateChange = onStateChange;
    this.onPartialTranscript = onPartialTranscript;
    this.onFinalTranscript = onFinalTranscript;
    this.onCommittedTranscript = onCommittedTranscript;
    this.onInterruptRequest = onInterruptRequest;
    this.onSubmitTranscript = onSubmitTranscript;
    this.onError = onError;
    this.onMetrics = onMetrics;

    this.enabled = false;
    this.status = "idle";
    this.partialTranscript = "";
    this.finalTranscript = "";
    this.sessionId = "";
    this.turnCounter = 0;
    this.activeTurnId = 0;
    this.pendingCommitTimer = 0;
    this.pendingCommitTurnId = 0;
    this.commitConfirmDelayMs = 180;
    this.maxCaptureMs = 6500;
    this.captureTimeoutTimer = 0;
    this.extremeEchoSuppressUntil = 0;
    this.metrics = this.createEmptyMetrics();

    this.bindEvents();
  }

  createEmptyMetrics() {
    return {
      vadStartAt: 0,
      vadEndAt: 0,
      asrFirstPartialAt: 0,
      committedAt: 0,
      llmRequestStartAt: 0,
      llmFirstDeltaAt: 0,
      ttsSpeakStartAt: 0,
      interruptedAt: 0,
    };
  }

  isExtremelySuppressed() {
    return performance.now() < this.extremeEchoSuppressUntil;
  }

  usesTurnBasedAsr() {
    return ["handy-local", "whisper-local", "funasr-local"].includes(
      this.asrAdapter?.getRuntimeInfo?.()?.provider
    );
  }

  resetTranscriptBuffers() {
    this.partialTranscript = "";
    this.finalTranscript = "";
    this.asrAdapter?.resetBuffer?.();
    this.onPartialTranscript("");
    this.onFinalTranscript("");
  }

  clearPendingCommit() {
    if (this.pendingCommitTimer) {
      window.clearTimeout(this.pendingCommitTimer);
      this.pendingCommitTimer = 0;
    }
    this.pendingCommitTurnId = 0;
  }

  clearCaptureTimeout() {
    if (this.captureTimeoutTimer) {
      window.clearTimeout(this.captureTimeoutTimer);
      this.captureTimeoutTimer = 0;
    }
  }

  scheduleCaptureTimeout() {
    this.clearCaptureTimeout();
    this.captureTimeoutTimer = window.setTimeout(() => {
      this.captureTimeoutTimer = 0;
      if (!this.enabled || this.status !== "capturing") {
        return;
      }
      void this.finishTurnCapture("realtime-max-capture");
    }, this.maxCaptureMs);
  }

  enterExtremeEchoSuppression(durationMs = 350) {
    this.extremeEchoSuppressUntil = performance.now() + durationMs;
    this.clearPendingCommit();
    this.resetTranscriptBuffers();
  }

  resumeListeningAfterTts(message = "等待你开口") {
    if (!this.enabled) {
      return;
    }
    this.vadManager?.setMode?.("cooldown");
    this.enterExtremeEchoSuppression(180);
    this.setStatus("listening", message);
  }

  getBestTranscriptCandidate() {
    const promoted = this.asrAdapter?.promotePartialToFinal?.() || "";
    return String(promoted || this.finalTranscript || this.partialTranscript || "").trim();
  }

  async finishTurnCapture(reason = "speechend") {
    if (!this.enabled || this.isExtremelySuppressed()) {
      return;
    }

    this.clearCaptureTimeout();
    this.metrics.vadEndAt = performance.now();
    this.onMetrics({ ...this.metrics });

    if (this.usesTurnBasedAsr()) {
      try {
        await this.asrAdapter?.stop?.();
      } catch (error) {
        this.setStatus("error", "本地语音转写结束失败");
        this.onError(error);
        return;
      }
    }

    const transcript = this.getBestTranscriptCandidate();
    if (!transcript) {
      this.activeTurnId = 0;
      this.setStatus("listening", reason === "realtime-max-capture" ? "这段没听清，等你再说一遍" : "等待你开口");
      return;
    }

    const turnId = this.activeTurnId || this.nextTurnId();
    this.clearPendingCommit();
    this.pendingCommitTurnId = turnId;
    this.setStatus("listening", "检测到停顿，准备提交");

    this.pendingCommitTimer = window.setTimeout(async () => {
      this.pendingCommitTimer = 0;

      if (!this.enabled || this.isExtremelySuppressed()) {
        this.pendingCommitTurnId = 0;
        return;
      }

      const latestTranscript = this.getBestTranscriptCandidate();
      if (!latestTranscript) {
        this.pendingCommitTurnId = 0;
        this.setStatus("listening", "等待你开口");
        return;
      }

      const commitTurnId = this.pendingCommitTurnId || turnId;
      this.pendingCommitTurnId = 0;
      this.metrics.committedAt = performance.now();
      this.onMetrics({ ...this.metrics });
      this.setStatus("thinking", "正在思考");
      this.onCommittedTranscript(latestTranscript);
      this.activeTurnId = 0;

      try {
        await this.onSubmitTranscript({
          text: latestTranscript,
          turnId: commitTurnId,
          metrics: { ...this.metrics },
        });
      } catch (error) {
        if (this.turnCounter !== commitTurnId) {
          return;
        }
        this.setStatus("error", "语音请求失败");
        this.onError(error);
      }
    }, this.commitConfirmDelayMs);
  }

  bindEvents() {
    this.vadManager?.addEventListener("speechstart", async (event) => {
      if (!this.enabled || this.isExtremelySuppressed()) {
        return;
      }

      const rms = Number(event.detail?.rms || 0);
      const mode = event.detail?.mode || "normal";
      if (mode === "tts" && rms < 0.085) {
        return;
      }

      this.clearPendingCommit();

      if (!this.activeTurnId) {
        const nextTurnId = this.nextTurnId();
        this.activeTurnId = nextTurnId;
        this.asrAdapter?.prepareTurn?.({ turnId: nextTurnId });
      }

      this.metrics.vadStartAt = performance.now();
      this.onMetrics({ ...this.metrics });

      if (this.status === "thinking" || this.status === "speaking") {
        this.metrics.interruptedAt = performance.now();
        this.onMetrics({ ...this.metrics });
        this.onInterruptRequest("realtime-vad-speechstart");
      }

      this.resetTranscriptBuffers();
      this.setStatus("capturing", "正在听你说话");

      if (this.usesTurnBasedAsr()) {
        try {
          await this.asrAdapter?.start({
            sessionId: this.sessionId,
            turnId: this.activeTurnId,
          });
          this.scheduleCaptureTimeout();
        } catch (error) {
          this.setStatus("error", "本地语音录制启动失败");
          this.onError(error);
        }
      }
    });

    this.vadManager?.addEventListener("speechend", async () => {
      await this.finishTurnCapture("speechend");
    });

    this.asrAdapter?.addEventListener("partial", (event) => {
      if (this.isExtremelySuppressed()) {
        return;
      }

      const text = String(event.detail?.text || "").trim();
      if (!text) {
        return;
      }

      if (!this.metrics.asrFirstPartialAt) {
        this.metrics.asrFirstPartialAt = performance.now();
        this.onMetrics({ ...this.metrics });
      }

      this.partialTranscript = text;
      if (this.status === "listening") {
        this.setStatus("capturing", "正在听你说话");
      }
      this.onPartialTranscript(text);
    });

    this.asrAdapter?.addEventListener("final", (event) => {
      if (this.isExtremelySuppressed()) {
        return;
      }

      const text = String(event.detail?.text || "").trim();
      if (!text) {
        return;
      }

      this.finalTranscript = text;
      this.onFinalTranscript(text);
    });

    this.asrAdapter?.addEventListener("error", (event) => {
      const errorCode = String(event.detail?.error || "Speech recognition failed.");
      if (["network", "no-speech", "aborted", "audio-capture"].includes(errorCode) && this.enabled) {
        this.setStatus("listening", "语音连接有波动，正在自动恢复...");
        return;
      }
      this.setStatus("error", "语音识别失败");
      this.onError(new Error(errorCode));
    });

    this.ttsAdapter?.addEventListener("start", () => {
      if (!this.enabled) {
        return;
      }

      this.clearPendingCommit();
      this.resetTranscriptBuffers();
      this.vadManager?.setMode?.("tts");
      this.metrics.ttsSpeakStartAt = performance.now();
      this.onMetrics({ ...this.metrics });
      this.setStatus("speaking", "正在回答");
    });

    this.ttsAdapter?.addEventListener("end", () => {
      this.resumeListeningAfterTts("等待你开口");
    });

    this.ttsAdapter?.addEventListener("cancel", () => {
      this.resumeListeningAfterTts("等待你开口");
    });

    this.ttsAdapter?.addEventListener("error", (event) => {
      this.resumeListeningAfterTts("播报失败，已回到监听");
      this.onError(new Error(String(event.detail?.error || "tts-error")));
    });
  }

  async start() {
    if (!this.asrAdapter?.isSupported()) {
      throw new Error("Local ASR service is not available.");
    }

    if (!this.sessionId) {
      this.sessionId = this.createSessionId();
    }

    const nextTurnId = this.nextTurnId();
    this.activeTurnId = nextTurnId;

    await this.audioInputManager.start();
    await this.vadManager.start({
      audioContext: this.audioInputManager.getAudioContext(),
      stream: this.audioInputManager.getStream(),
    });
    this.vadManager?.setMode?.("normal");
    this.asrAdapter?.prepareTurn?.({ turnId: nextTurnId });
    if (!this.usesTurnBasedAsr()) {
      await this.asrAdapter.start({
        sessionId: this.sessionId,
        turnId: nextTurnId,
      });
    }

    this.enabled = true;
    this.extremeEchoSuppressUntil = 0;
    this.clearPendingCommit();
    this.clearCaptureTimeout();
    this.resetTranscriptBuffers();
    this.metrics = this.createEmptyMetrics();
    this.setStatus("listening", "实时语音已开启，等待你开口");
  }

  async stop() {
    this.enabled = false;
    this.turnCounter += 1;
    this.activeTurnId = 0;
    this.extremeEchoSuppressUntil = 0;
    this.clearPendingCommit();
    this.clearCaptureTimeout();
    this.resetTranscriptBuffers();
    this.ttsAdapter?.stopNow();
    if (this.usesTurnBasedAsr()) {
      await this.asrAdapter?.abort?.();
    } else {
      await this.asrAdapter?.stop?.();
    }
    this.vadManager?.stop?.();
    await this.audioInputManager.stop();
    this.setStatus("idle", "实时语音已关闭");
  }

  interrupt(reason = "manual-interrupt") {
    this.turnCounter += 1;
    this.activeTurnId = 0;
    this.clearPendingCommit();
    this.clearCaptureTimeout();
    this.metrics.interruptedAt = performance.now();
    this.onMetrics({ ...this.metrics });
    this.ttsAdapter?.stopNow();
    if (this.usesTurnBasedAsr()) {
      void this.asrAdapter?.abort?.();
    }
    this.vadManager?.setMode?.("cooldown");
    this.enterExtremeEchoSuppression(180);
    this.setStatus("interrupted", "已打断上一轮");
    this.onInterruptRequest(reason);
  }

  notifyReplyCompleted({ spoken = false } = {}) {
    if (!this.enabled) {
      return;
    }
    if (!spoken && this.status === "thinking") {
      this.setStatus("listening", "这轮没有播报，继续等你开口");
    }
  }

  notifyReplyError(error) {
    if (!this.enabled) {
      return;
    }
    this.setStatus("error", "回复失败");
    this.onError(error);
    window.setTimeout(() => {
      if (this.enabled && this.status === "error") {
        this.setStatus("listening", "等待你开口");
      }
    }, 400);
  }

  getStatus() {
    return this.status;
  }

  isEnabled() {
    return this.enabled;
  }

  nextTurnId() {
    this.turnCounter += 1;
    return this.turnCounter;
  }

  createSessionId() {
    if (globalThis.crypto?.randomUUID) {
      return `voice-session-${globalThis.crypto.randomUUID()}`;
    }
    return `voice-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getRealtimeSnapshot() {
    return {
      sessionId: this.sessionId,
      turnId: this.activeTurnId || this.turnCounter || 0,
      metrics: { ...this.metrics },
      transcript: this.asrAdapter?.getTranscriptSnapshot?.() || null,
      audioInput: this.audioInputManager?.getInputSnapshot?.() || null,
      asrRuntime: this.asrAdapter?.getRuntimeInfo?.() || null,
      vadRuntime: this.vadManager?.getLevelSnapshot?.() || null,
    };
  }

  markLlmRequestStart() {
    this.metrics.llmRequestStartAt = performance.now();
    this.metrics.llmFirstDeltaAt = 0;
    this.metrics.ttsSpeakStartAt = 0;
    this.onMetrics({ ...this.metrics });
  }

  markLlmFirstDelta() {
    if (!this.metrics.llmFirstDeltaAt) {
      this.metrics.llmFirstDeltaAt = performance.now();
      this.onMetrics({ ...this.metrics });
    }
  }

  setStatus(status, message = "") {
    this.status = status;
    this.onStateChange(status, message);
  }
}
