export class BrowserTtsAdapter extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = {
      speakEndpoint: "/api/voice/tts/speak",
      stopEndpoint: "/api/voice/tts/stop",
      startTimeoutMs: 2500,
      ...options,
    };
    this.audio = null;
    this.activeObjectUrl = "";
    this.isPlayingFlag = false;
    this.lastError = "";
    this.lastErrorDetail = "";
    this.lastErrorDiagnostics = null;
    this.voiceName = "Microsoft Huihui Desktop";
  }

  isSupported() {
    return typeof window !== "undefined" && typeof window.fetch === "function" && typeof Audio !== "undefined";
  }

  isSpeaking() {
    return this.isPlayingFlag;
  }

  getVoiceOptions() {
    return [
      {
        name: "Microsoft Huihui Desktop",
        lang: "zh-CN",
        default: true,
        label: "Microsoft Huihui Desktop | zh-CN | local",
      },
    ];
  }

  setVoiceByName(name) {
    const target = String(name || "").trim();
    if (!target) {
      this.voiceName = "Microsoft Huihui Desktop";
      return true;
    }
    this.voiceName = target;
    return true;
  }

  getSelectedVoiceName() {
    return this.voiceName;
  }

  getDiagnostics() {
    return {
      supported: this.isSupported(),
      voiceCount: 1,
      selectedVoiceName: this.voiceName,
      selectedVoiceLang: "zh-CN",
      speaking: this.isPlayingFlag,
      lastError: this.lastError || "",
      lastErrorDetail: this.lastErrorDetail || "",
      lastErrorDiagnostics: this.lastErrorDiagnostics || null,
    };
  }

  dispatchDiagnostics(reason = "") {
    this.dispatchEvent(
      new CustomEvent("diagnostics", {
        detail: {
          reason,
          ...this.getDiagnostics(),
        },
      })
    );
  }

  revokeObjectUrl() {
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = "";
    }
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
      const error = new Error(result?.error || `Request failed: ${response.status}`);
      error.detail = result?.detail || "";
      error.diagnostics = result?.diagnostics || null;
      throw error;
    }
    return result;
  }

  async speak(text) {
    const content = String(text || "").trim();
    if (!this.isSupported() || !content) {
      return false;
    }

    this.stopNow({ silent: true });
    this.lastError = "";
    this.lastErrorDetail = "";
    this.lastErrorDiagnostics = null;

    try {
      const result = await this.postJson(this.options.speakEndpoint, {
        text: content,
        voiceName: this.voiceName,
      });
      const mimeType = result.mimeType || "audio/wav";
      const binary = window.atob(String(result.audioBase64 || ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const blob = new Blob([bytes], { type: mimeType });
      this.activeObjectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.activeObjectUrl);
      this.audio = audio;

      audio.addEventListener(
        "play",
        () => {
          this.isPlayingFlag = true;
          this.dispatchEvent(
            new CustomEvent("start", {
              detail: {
                text: content,
                voiceName: result.voiceName || this.voiceName,
                voiceLang: "zh-CN",
              },
            })
          );
          this.dispatchDiagnostics("start");
        },
        { once: true }
      );

      audio.addEventListener(
        "ended",
        () => {
          this.isPlayingFlag = false;
          this.audio = null;
          this.revokeObjectUrl();
          this.dispatchEvent(
            new CustomEvent("end", {
              detail: {
                text: content,
                voiceName: result.voiceName || this.voiceName,
              },
            })
          );
          this.dispatchDiagnostics("end");
        },
        { once: true }
      );

      audio.addEventListener(
        "error",
        () => {
          this.isPlayingFlag = false;
          this.audio = null;
          this.lastError = "tts-audio-playback-error";
          this.revokeObjectUrl();
          this.dispatchEvent(
            new CustomEvent("error", {
              detail: {
                error: this.lastError,
                text: content,
                voiceName: result.voiceName || this.voiceName,
              },
            })
          );
          this.dispatchDiagnostics("error");
        },
        { once: true }
      );

      await audio.play();
      return true;
    } catch (error) {
      this.lastError = String(error?.message || error || "tts-error");
      this.lastErrorDetail = String(error?.detail || "");
      this.lastErrorDiagnostics = error?.diagnostics || null;
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: {
            error: this.lastError,
            errorDetail: this.lastErrorDetail,
            diagnostics: this.lastErrorDiagnostics,
            text: content,
            voiceName: this.voiceName,
          },
        })
      );
      this.dispatchDiagnostics("error");
      return false;
    }
  }

  stopNow({ silent = false } = {}) {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch (_error) {
        // Ignore playback stop failures.
      }
    }
    this.audio = null;
    this.isPlayingFlag = false;
    this.revokeObjectUrl();
    void this.postJson(this.options.stopEndpoint, {}).catch(() => {});
    if (!silent) {
      this.dispatchEvent(new CustomEvent("cancel"));
      this.dispatchDiagnostics("cancel");
    }
  }

  clearQueue() {
    this.stopNow();
  }
}
