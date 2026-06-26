#pragma once

#include <cstdint>
#include <vector>

namespace gpupixel_demo {

struct LipRenderSettings {
  float strength = 0.0f;
  float upper_lip_strength = 1.0f;
  float lower_lip_strength = 0.9f;
  float edge_feather_px = 7.0f;
  float outer_expand_px = 6.0f;
  float outer_opacity_scale = 0.68f;
  float inner_erode_px = 2.4f;
  float opacity_scale = 0.68f;
  float red = 176.0f;
  float green = 42.0f;
  float blue = 70.0f;
};

struct LipDebugPoint {
  float x = 0.0f;
  float y = 0.0f;
};

struct LipDebugOverlay {
  bool valid = false;
  std::vector<LipDebugPoint> upper_lip;
  std::vector<LipDebugPoint> lower_lip;
  std::vector<LipDebugPoint> inner_mouth;
  std::vector<LipDebugPoint> expanded_upper_lip;
  std::vector<LipDebugPoint> expanded_lower_lip;
};

class LipRendererMP468 {
 public:
  bool Apply(std::vector<uint8_t>* rgba,
             int width,
             int height,
             const std::vector<float>& mediapipe_landmarks,
             const LipRenderSettings& settings) const;

  bool BuildDebugOverlay(int width,
                         int height,
                         const std::vector<float>& mediapipe_landmarks,
                         const LipRenderSettings& settings,
                         LipDebugOverlay* overlay) const;
};

}  // namespace gpupixel_demo
