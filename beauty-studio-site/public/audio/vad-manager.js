export class AudioLevelVadManager extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = {
      startThreshold: 0.038,
      endThreshold: 0.02,
      speechStartMs: 120,
      speechEndMs: 520,
      ...options,
    };
    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.frameHandle = 0;
    this.aboveSince = 0;
    this.belowSince = 0;
    this.isSpeaking = false;
    this.buffer = null;
    this.mode = "normal";
    this.modeSince = 0;
    this.levelSnapshot = {
      rms: 0,
      at: 0,
      startThreshold: this.options.startThreshold,
      endThreshold: this.options.endThreshold,
      mode: "normal",
    };
  }

  async start({ audioContext, stream }) {
    this.stop();

    this.audioContext = audioContext;
    this.stream = stream;
    this.sourceNode = audioContext.createMediaStreamSource(stream);
    this.analyserNode = audioContext.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.analyserNode.smoothingTimeConstant = 0.15;
    this.buffer = new Float32Array(this.analyserNode.fftSize);
    this.sourceNode.connect(this.analyserNode);
    this.mode = "normal";
    this.modeSince = performance.now();

    this.loop();
  }

  setMode(mode = "normal") {
    this.mode = mode;
    this.modeSince = performance.now();
  }

  getDynamicThresholds(now = performance.now()) {
    const normalStart = this.options.startThreshold;
    const normalEnd = this.options.endThreshold;
    const boostedStart = Math.max(normalStart, 0.05);
    const boostedEnd = Math.max(normalEnd, 0.03);

    if (this.mode === "tts") {
      return {
        startThreshold: boostedStart,
        endThreshold: boostedEnd,
      };
    }

    if (this.mode === "cooldown") {
      const elapsed = now - this.modeSince;
      if (elapsed <= 200) {
        return {
          startThreshold: boostedStart,
          endThreshold: boostedEnd,
        };
      }
      if (elapsed >= 500) {
        return {
          startThreshold: normalStart,
          endThreshold: normalEnd,
        };
      }

      const progress = (elapsed - 200) / 300;
      return {
        startThreshold: boostedStart - (boostedStart - normalStart) * progress,
        endThreshold: boostedEnd - (boostedEnd - normalEnd) * progress,
      };
    }

    return {
      startThreshold: normalStart,
      endThreshold: normalEnd,
    };
  }

  getLevelSnapshot() {
    return { ...this.levelSnapshot };
  }

  stop() {
    if (this.frameHandle) {
      window.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
    }

    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.buffer = null;
    this.aboveSince = 0;
    this.belowSince = 0;
    this.isSpeaking = false;
    this.mode = "normal";
    this.modeSince = 0;
  }

  loop = () => {
    if (!this.analyserNode || !this.buffer) {
      return;
    }

    const now = performance.now();
    const thresholds = this.getDynamicThresholds(now);
    this.analyserNode.getFloatTimeDomainData(this.buffer);

    let energy = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const sample = this.buffer[index];
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / this.buffer.length);
    this.levelSnapshot = {
      rms,
      at: now,
      startThreshold: thresholds.startThreshold,
      endThreshold: thresholds.endThreshold,
      mode: this.mode,
    };

    this.dispatchEvent(new CustomEvent("level", { detail: this.levelSnapshot }));

    if (rms >= thresholds.startThreshold) {
      if (!this.aboveSince) {
        this.aboveSince = now;
      }
      this.belowSince = 0;

      if (!this.isSpeaking && now - this.aboveSince >= this.options.speechStartMs) {
        this.isSpeaking = true;
        this.dispatchEvent(new CustomEvent("speechstart", { detail: { rms, at: now, mode: this.mode } }));
      }
    } else if (rms <= thresholds.endThreshold) {
      if (!this.belowSince) {
        this.belowSince = now;
      }
      this.aboveSince = 0;

      if (!this.isSpeaking && this.mode === "cooldown" && now - this.modeSince >= 500) {
        this.mode = "normal";
      }

      if (this.isSpeaking && now - this.belowSince >= this.options.speechEndMs) {
        this.isSpeaking = false;
        this.dispatchEvent(new CustomEvent("speechend", { detail: { rms, at: now, mode: this.mode } }));
      }
    } else {
      this.aboveSince = 0;
      this.belowSince = 0;
    }

    this.frameHandle = window.requestAnimationFrame(this.loop);
  };
}
