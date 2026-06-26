export class OneEuroFilter {
  constructor({ minCutoff = 1.2, beta = 0.04, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  filter(value, timestampMs) {
    if (!Number.isFinite(value)) return value;
    if (this.t === null || this.x === null) {
      this.t = timestampMs;
      this.x = value;
      return value;
    }

    const dt = Math.max(1 / 240, (timestampMs - this.t) / 1000);
    const rawDx = (value - this.x) / dt;
    this.dx = exponentialSmooth(rawDx, this.dx, smoothingAlpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = exponentialSmooth(value, this.x, smoothingAlpha(dt, cutoff));
    this.t = timestampMs;
    return this.x;
  }
}

export class LandmarkSmoother {
  constructor(options = {}) {
    this.options = options;
    this.filters = [];
  }

  reset() {
    this.filters = [];
  }

  smooth(landmarks, timestampMs) {
    if (!Array.isArray(landmarks) || !landmarks.length) {
      this.reset();
      return landmarks;
    }
    while (this.filters.length < landmarks.length) {
      this.filters.push({
        x: new OneEuroFilter(this.options),
        y: new OneEuroFilter(this.options),
        z: new OneEuroFilter({ ...this.options, beta: (this.options.beta || 0.04) * 0.5 }),
      });
    }
    if (this.filters.length > landmarks.length) this.filters.length = landmarks.length;

    return landmarks.map((point, index) => {
      const f = this.filters[index];
      return {
        ...point,
        x: f.x.filter(point.x, timestampMs),
        y: f.y.filter(point.y, timestampMs),
        z: f.z.filter(point.z || 0, timestampMs),
      };
    });
  }
}

export function interpolateLandmarks(previous, next, amount) {
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
    return next || previous || null;
  }
  const t = clamp01(amount);
  return previous.map((point, index) => ({
    ...point,
    x: lerp(point.x, next[index].x, t),
    y: lerp(point.y, next[index].y, t),
    z: lerp(point.z || 0, next[index].z || 0, t),
  }));
}

export function smoothingAlpha(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoff));
  return 1 / (1 + tau / Math.max(0.0001, dt));
}

function exponentialSmooth(value, previous, alpha) {
  return alpha * value + (1 - alpha) * previous;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
