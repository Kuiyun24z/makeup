#pragma once

#include <cstdint>
#include <vector>

namespace gpupixel_demo {

struct EyebrowRenderSettings {
  float strength = 0.0f;        // 0..1, from the UI slider (slider / 10)
  float darkness = 0.55f;       // max darken factor at full coverage
  float edge_feather_px = 6.0f; // soft edge so the brow blends into skin
  float expand_px = 2.0f;       // small outward expand for full hair coverage
};

// Darkens (deepens) the eyebrow region using MediaPipe 468 landmarks. The
// effect multiplies pixels toward darker, weighted by a brow-hair confidence
// so the actual brow hair is deepened more than the skin gaps between hairs.
class EyebrowRendererMP468 {
 public:
  bool Apply(std::vector<uint8_t>* rgba,
             int width,
             int height,
             const std::vector<float>& mediapipe_landmarks,
             const EyebrowRenderSettings& settings) const;
};

}  // namespace gpupixel_demo
