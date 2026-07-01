export function sanitizeTtsSpeechText(text) {
  return String(text || "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

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
    this.fallbackUtterance = null;
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

  canUseSpeechSynthesis() {
    return (
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined" &&
      typeof window.SpeechSynthesisUtterance !== "undefined"
    );
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

  speakWithBrowserFallback(content) {
    if (!this.canUseSpeechSynthesis()) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const utterance = new window.SpeechSynthesisUtterance(content);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices?.() || [];
      const preferredVoice =
        voices.find((voice) => voice.name === this.voiceName) ||
        voices.find((voice) => String(voice.lang || "").toLowerCase().startsWith("zh")) ||
        null;
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      let started = false;
      let failedBeforeStart = false;
      const markStarted = () => {
        if (started || failedBeforeStart) {
          return;
        }
        started = true;
        this.isPlayingFlag = true;
        this.dispatchEvent(
          new CustomEvent("start", {
            detail: {
              text: content,
              voiceName: preferredVoice?.name || "browser-speechSynthesis",
              voiceLang: preferredVoice?.lang || "zh-CN",
              fallback: true,
            },
          })
        );
        this.dispatchDiagnostics("fallback-start");
        resolve(true);
      };

      utterance.onstart = markStarted;

      utterance.onend = () => {
        markStarted();
        this.isPlayingFlag = false;
        this.fallbackUtterance = null;
        this.dispatchEvent(
          new CustomEvent("end", {
            detail: {
              text: content,
              voiceName: preferredVoice?.name || "browser-speechSynthesis",
              fallback: true,
            },
          })
        );
        this.dispatchDiagnostics("fallback-end");
      };

      utterance.onerror = (event) => {
        this.isPlayingFlag = false;
        this.fallbackUtterance = null;
        this.lastErrorDetail = String(event?.error || "browser-speechSynthesis-error");
        if (!started) {
          failedBeforeStart = true;
          resolve(false);
        }
        this.dispatchDiagnostics("fallback-error");
      };

      this.fallbackUtterance = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      window.setTimeout(markStarted, 0);
    });
  }

  async speak(text) {
    const content = sanitizeTtsSpeechText(text);
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
      const fallbackStarted = await this.speakWithBrowserFallback(content);
      if (fallbackStarted) {
        this.dispatchDiagnostics("cloud-error-browser-fallback");
        return true;
      }
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
    if (this.canUseSpeechSynthesis()) {
      try {
        window.speechSynthesis.cancel();
      } catch (_error) {
        // Ignore browser TTS stop failures.
      }
    }
    this.fallbackUtterance = null;
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
