export class AudioInputManager {
  constructor(options = {}) {
    this.options = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      ...options,
    };
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.levelBuffer = null;
    this.lastLevelSnapshot = null;
  }

  async start() {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.options.echoCancellation,
          noiseSuppression: this.options.noiseSuppression,
          autoGainControl: this.options.autoGainControl,
          channelCount: this.options.channelCount,
        },
        video: false,
      });
    }

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

    if (this.stream && this.audioContext && !this.analyserNode) {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.18;
      this.levelBuffer = new Float32Array(this.analyserNode.fftSize);
      this.sourceNode.connect(this.analyserNode);
    }

    return {
      stream: this.stream,
      audioContext: this.audioContext,
    };
  }

  getStream() {
    return this.stream;
  }

  getAudioContext() {
    return this.audioContext;
  }

  getInputSnapshot() {
    if (!this.analyserNode || !this.levelBuffer) {
      return null;
    }

    this.analyserNode.getFloatTimeDomainData(this.levelBuffer);
    let energy = 0;
    let peak = 0;
    for (let index = 0; index < this.levelBuffer.length; index += 1) {
      const sample = this.levelBuffer[index];
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    const rms = Math.sqrt(energy / this.levelBuffer.length);
    this.lastLevelSnapshot = {
      rms,
      peak,
      sampleCount: this.levelBuffer.length,
      sampleRate: this.audioContext?.sampleRate || 0,
      at: performance.now(),
    };
    return this.lastLevelSnapshot;
  }

  async stop() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }
      this.analyserNode = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch (_error) {
        // Ignore repeated close calls.
      }
      this.audioContext = null;
    }

    this.levelBuffer = null;
    this.lastLevelSnapshot = null;
  }
}
