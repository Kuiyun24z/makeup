import assert from "node:assert/strict";
import { interpolateLandmarks, LandmarkSmoother, OneEuroFilter } from "../tracking.mjs";

const filter = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
assert.equal(filter.filter(0, 0), 0);
const smoothed = filter.filter(10, 16);
assert.ok(smoothed > 0 && smoothed < 10, "filter should move toward the signal without jumping");

const smoother = new LandmarkSmoother({ minCutoff: 1, beta: 0.02 });
const first = smoother.smooth([{ x: 0, y: 0, z: 0 }], 0);
const second = smoother.smooth([{ x: 1, y: 1, z: 0.5 }], 16);
assert.equal(first.length, 1);
assert.ok(second[0].x > 0 && second[0].x < 1);
assert.ok(second[0].y > 0 && second[0].y < 1);

const interpolated = interpolateLandmarks(
  [{ x: 0, y: 0, z: 0 }],
  [{ x: 1, y: 3, z: 0.5 }],
  0.5,
);
assert.deepEqual(interpolated, [{ x: 0.5, y: 1.5, z: 0.25 }]);

assert.equal(interpolateLandmarks(null, [{ x: 1, y: 1 }], 0.5)[0].x, 1);

console.log("tracking filters ok");
