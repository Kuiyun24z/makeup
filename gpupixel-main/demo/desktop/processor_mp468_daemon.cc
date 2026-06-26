// clang-format off
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <glad/glad.h>
#include <GLFW/glfw3.h>
// clang-format on
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "ghc/filesystem.hpp"
#include "gpupixel/gpupixel.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace fs = ghc::filesystem;
using namespace gpupixel;

#ifdef _WIN32
#include <Shlwapi.h>
#include <windows.h>
#pragma comment(lib, "Shlwapi.lib")
#elif defined(__linux__)
#include <limits.h>
#include <unistd.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <stdlib.h>
#endif

struct Options {
  std::string image_path;
  std::string output_path;
  std::string landmarks_path;
  std::string mediapipe_landmarks_path;
  float smoothing = 0.0f;
  float whitening = 0.0f;
  float face_slim = 0.0f;
  float eye_enlarge = 0.0f;
  float lipstick = 0.0f;
  float blusher = 0.0f;
  float acne = 0.0f;
  float eye_bag = 0.0f;
  float nasolabial = 0.0f;
  float redness = 0.0f;
  float dullness = 0.0f;
  float pores = 0.0f;
  float nose_slim = 0.0f;
  float eyelid = 0.0f;
  float brow = 0.0f;
  float mouth_size = 0.0f;
  float double_chin = 0.0f;
  float neck = 0.0f;
};

constexpr int kMediaPipePointCount = 468;

struct Point2 {
  float x = 0.0f;
  float y = 0.0f;
};

float ClampFloat(float value, float min_value, float max_value) {
  return std::max(min_value, std::min(max_value, value));
}

uint8_t ClampByte(float value) {
  return static_cast<uint8_t>(ClampFloat(value, 0.0f, 255.0f));
}

float SmoothStep(float edge0, float edge1, float x) {
  x = ClampFloat((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
  return x * x * (3.0f - 2.0f * x);
}

Point2 LandmarkAt(const std::vector<float>& landmarks, int index, int width,
                  int height) {
  if (index < 0 || index * 2 + 1 >= static_cast<int>(landmarks.size())) {
    return {};
  }
  return {landmarks[index * 2] * width, landmarks[index * 2 + 1] * height};
}

Point2 AveragePoint(const std::vector<float>& landmarks,
                    const std::vector<int>& indices, int width, int height) {
  Point2 out;
  int count = 0;
  for (int index : indices) {
    Point2 p = LandmarkAt(landmarks, index, width, height);
    out.x += p.x;
    out.y += p.y;
    ++count;
  }
  if (count > 0) {
    out.x /= count;
    out.y /= count;
  }
  return out;
}

float Distance(Point2 a, Point2 b) {
  float dx = a.x - b.x;
  float dy = a.y - b.y;
  return std::sqrt(dx * dx + dy * dy);
}

float EllipseWeight(float x, float y, Point2 center, float rx, float ry) {
  if (rx <= 1.0f || ry <= 1.0f) return 0.0f;
  float nx = (x - center.x) / rx;
  float ny = (y - center.y) / ry;
  float d = nx * nx + ny * ny;
  if (d >= 1.0f) return 0.0f;
  return 1.0f - SmoothStep(0.35f, 1.0f, d);
}

float LineWeight(float x, float y, Point2 a, Point2 b, float radius) {
  float vx = b.x - a.x;
  float vy = b.y - a.y;
  float len2 = vx * vx + vy * vy;
  if (len2 <= 1.0f || radius <= 1.0f) return 0.0f;
  float t = ((x - a.x) * vx + (y - a.y) * vy) / len2;
  t = ClampFloat(t, 0.0f, 1.0f);
  float px = a.x + vx * t;
  float py = a.y + vy * t;
  float dx = x - px;
  float dy = y - py;
  float d = std::sqrt(dx * dx + dy * dy) / radius;
  if (d >= 1.0f) return 0.0f;
  return (1.0f - SmoothStep(0.0f, 1.0f, d)) * SmoothStep(0.0f, 0.18f, t) *
         (1.0f - SmoothStep(0.82f, 1.0f, t));
}

void SampleBilinear(const std::vector<uint8_t>& pixels, int width, int height,
                    float x, float y, uint8_t* out) {
  x = ClampFloat(x, 0.0f, static_cast<float>(width - 1));
  y = ClampFloat(y, 0.0f, static_cast<float>(height - 1));
  int x0 = static_cast<int>(std::floor(x));
  int y0 = static_cast<int>(std::floor(y));
  int x1 = std::min(x0 + 1, width - 1);
  int y1 = std::min(y0 + 1, height - 1);
  float tx = x - x0;
  float ty = y - y0;
  for (int c = 0; c < 4; ++c) {
    float c00 = pixels[(y0 * width + x0) * 4 + c];
    float c10 = pixels[(y0 * width + x1) * 4 + c];
    float c01 = pixels[(y1 * width + x0) * 4 + c];
    float c11 = pixels[(y1 * width + x1) * 4 + c];
    float top = c00 + (c10 - c00) * tx;
    float bottom = c01 + (c11 - c01) * tx;
    out[c] = ClampByte(top + (bottom - top) * ty);
  }
}

void LocalAverage(const std::vector<uint8_t>& pixels, int width, int height,
                  int x, int y, int radius, float* rgb) {
  int count = 0;
  rgb[0] = rgb[1] = rgb[2] = 0.0f;
  for (int yy = std::max(0, y - radius); yy <= std::min(height - 1, y + radius);
       ++yy) {
    for (int xx = std::max(0, x - radius); xx <= std::min(width - 1, x + radius);
         ++xx) {
      const uint8_t* p = &pixels[(yy * width + xx) * 4];
      rgb[0] += p[0];
      rgb[1] += p[1];
      rgb[2] += p[2];
      ++count;
    }
  }
  if (count > 0) {
    rgb[0] /= count;
    rgb[1] /= count;
    rgb[2] /= count;
  }
}

void BlendColor(uint8_t* p, float r, float g, float b, float amount) {
  amount = ClampFloat(amount, 0.0f, 1.0f);
  p[0] = ClampByte(p[0] * (1.0f - amount) + r * amount);
  p[1] = ClampByte(p[1] * (1.0f - amount) + g * amount);
  p[2] = ClampByte(p[2] * (1.0f - amount) + b * amount);
}

void Lighten(uint8_t* p, float amount) {
  amount = ClampFloat(amount, 0.0f, 1.0f);
  p[0] = ClampByte(p[0] + (255.0f - p[0]) * amount);
  p[1] = ClampByte(p[1] + (255.0f - p[1]) * amount);
  p[2] = ClampByte(p[2] + (255.0f - p[2]) * amount);
}

void ReduceRedness(uint8_t* p, float amount) {
  amount = ClampFloat(amount, 0.0f, 1.0f);
  float red_excess = std::max(0.0f, p[0] - (p[1] + p[2]) * 0.5f);
  p[0] = ClampByte(p[0] - red_excess * amount);
  p[1] = ClampByte(p[1] + red_excess * amount * 0.18f);
}

void ApplyLocalWarp(std::vector<uint8_t>* pixels, int width, int height,
                    Point2 center, float rx, float ry, float scale_x,
                    float scale_y) {
  if (rx <= 2.0f || ry <= 2.0f) return;
  std::vector<uint8_t> src = *pixels;
  int min_x = std::max(0, static_cast<int>(center.x - rx - 2));
  int max_x = std::min(width - 1, static_cast<int>(center.x + rx + 2));
  int min_y = std::max(0, static_cast<int>(center.y - ry - 2));
  int max_y = std::min(height - 1, static_cast<int>(center.y + ry + 2));
  for (int y = min_y; y <= max_y; ++y) {
    for (int x = min_x; x <= max_x; ++x) {
      float w = EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                              center, rx, ry);
      if (w <= 0.0f) continue;
      float sx = 1.0f + (scale_x - 1.0f) * w;
      float sy = 1.0f + (scale_y - 1.0f) * w;
      float src_x = center.x + (x - center.x) / std::max(0.05f, sx);
      float src_y = center.y + (y - center.y) / std::max(0.05f, sy);
      SampleBilinear(src, width, height, src_x, src_y,
                     &(*pixels)[(y * width + x) * 4]);
    }
  }
}

void ApplyCurveWarp(std::vector<uint8_t>* pixels, int width, int height,
                    Point2 origin, Point2 target, float radius, float delta) {
  if (radius <= 2.0f || delta <= 0.0f) return;
  std::vector<uint8_t> src = *pixels;
  int min_x = std::max(0, static_cast<int>(origin.x - radius - 2));
  int max_x = std::min(width - 1, static_cast<int>(origin.x + radius + 2));
  int min_y = std::max(0, static_cast<int>(origin.y - radius - 2));
  int max_y = std::min(height - 1, static_cast<int>(origin.y + radius + 2));
  Point2 direction{(target.x - origin.x) * delta,
                   (target.y - origin.y) * delta};

  for (int y = min_y; y <= max_y; ++y) {
    for (int x = min_x; x <= max_x; ++x) {
      float dx = static_cast<float>(x) - origin.x;
      float dy = static_cast<float>(y) - origin.y;
      float distance = std::sqrt(dx * dx + dy * dy);
      if (distance >= radius) continue;
      float ratio = 1.0f - distance / radius;
      float falloff = ratio * ratio * (3.0f - 2.0f * ratio);
      float src_x = static_cast<float>(x) - direction.x * falloff;
      float src_y = static_cast<float>(y) - direction.y * falloff;
      SampleBilinear(src, width, height, src_x, src_y,
                     &(*pixels)[(y * width + x) * 4]);
    }
  }
}

void ApplyLineDarken(std::vector<uint8_t>* pixels, int width, int height,
                     Point2 a, Point2 b, float radius, float amount) {
  int min_x = std::max(0, static_cast<int>(std::min(a.x, b.x) - radius - 2));
  int max_x =
      std::min(width - 1, static_cast<int>(std::max(a.x, b.x) + radius + 2));
  int min_y = std::max(0, static_cast<int>(std::min(a.y, b.y) - radius - 2));
  int max_y =
      std::min(height - 1, static_cast<int>(std::max(a.y, b.y) + radius + 2));
  for (int y = min_y; y <= max_y; ++y) {
    for (int x = min_x; x <= max_x; ++x) {
      float w = LineWeight(static_cast<float>(x), static_cast<float>(y), a, b,
                           radius) *
                amount;
      if (w <= 0.0f) continue;
      uint8_t* p = &(*pixels)[(y * width + x) * 4];
      BlendColor(p, p[0] * 0.45f, p[1] * 0.35f, p[2] * 0.32f, w);
    }
  }
}

void ApplyRetouch(std::vector<uint8_t>* pixels, int width, int height,
                  const std::vector<float>& landmarks,
                  const std::vector<float>& mediapipe_landmarks,
                  const Options& options) {
  if (pixels->empty() || landmarks.size() < 106 * 2) return;

  const bool has_mp =
      mediapipe_landmarks.size() >= static_cast<size_t>(kMediaPipePointCount * 2);
  const std::vector<float>& detail_landmarks =
      has_mp ? mediapipe_landmarks : landmarks;
  auto point = [&](int mp_index, int gp_index) {
    return LandmarkAt(detail_landmarks, has_mp ? mp_index : gp_index, width, height);
  };
  auto average = [&](std::vector<int> mp_indices, std::vector<int> gp_indices) {
    return AveragePoint(detail_landmarks, has_mp ? mp_indices : gp_indices, width,
                        height);
  };

  Point2 left_eye = average({33, 133, 159, 145}, {74});
  Point2 right_eye = average({362, 263, 386, 374}, {77});
  Point2 mouth = average({13, 14, 61, 291}, {106});
  Point2 chin = point(152, 16);
  Point2 forehead = point(10, 0);
  Point2 face_center = average({6, 4, 5, 168, 13, 14}, {43, 46, 49, 74, 77, 106});
  float face_width = std::max(1.0f, Distance(point(234, 3), point(454, 29)));
  float face_height = std::max(1.0f, Distance(forehead, chin));
  Point2 face_mask_center{face_center.x, face_center.y + face_height * 0.08f};
  float face_rx = face_width * 0.62f;
  float face_ry = face_height * 0.66f;

  if (has_mp && options.face_slim > 0.01f) {
    float slim = ClampFloat(options.face_slim / 10.0f, 0.0f, 1.0f);
    float cheek_delta = slim * 0.22f;
    float jaw_delta = slim * 0.16f;
    float cheek_radius = face_width * (0.16f + slim * 0.04f);
    float jaw_radius = face_width * (0.13f + slim * 0.03f);
    auto inward_target = [&](Point2 origin, float amount) {
      return Point2{origin.x + (face_center.x - origin.x) * amount, origin.y};
    };

    for (int index : {234, 93, 132, 58, 172}) {
      Point2 origin = LandmarkAt(mediapipe_landmarks, index, width, height);
      ApplyCurveWarp(pixels, width, height, origin, inward_target(origin, 0.48f),
                     cheek_radius, cheek_delta);
    }
    for (int index : {454, 323, 361, 288, 397}) {
      Point2 origin = LandmarkAt(mediapipe_landmarks, index, width, height);
      ApplyCurveWarp(pixels, width, height, origin, inward_target(origin, 0.48f),
                     cheek_radius, cheek_delta);
    }
    for (int index : {136, 150, 149, 176}) {
      Point2 origin = LandmarkAt(mediapipe_landmarks, index, width, height);
      Point2 target = inward_target(origin, 0.36f);
      target.y -= face_height * 0.015f;
      ApplyCurveWarp(pixels, width, height, origin, target, jaw_radius,
                     jaw_delta);
    }
    for (int index : {365, 379, 378, 400}) {
      Point2 origin = LandmarkAt(mediapipe_landmarks, index, width, height);
      Point2 target = inward_target(origin, 0.36f);
      target.y -= face_height * 0.015f;
      ApplyCurveWarp(pixels, width, height, origin, target, jaw_radius,
                     jaw_delta);
    }
    Point2 chin_target{chin.x, chin.y - face_height * 0.035f};
    ApplyCurveWarp(pixels, width, height, chin, chin_target, face_width * 0.16f,
                   slim * 0.10f);
  }

  if (std::abs(options.mouth_size) > 0.01f) {
    float mouth_width = Distance(point(61, 84), point(291, 90));
    float mouth_height = Distance(point(13, 98), point(14, 102));
    float scale = 1.0f + ClampFloat(options.mouth_size / 10.0f, -1.0f, 1.0f) * 0.28f;
    ApplyLocalWarp(pixels, width, height, mouth, mouth_width * 0.95f,
                   std::max(mouth_height * 2.0f, mouth_width * 0.35f), scale,
                   scale);
  }

  if (options.nose_slim > 0.01f) {
    Point2 nose = average({1, 2, 98, 327}, {45, 46, 48, 49, 50});
    float nose_width = Distance(point(98, 47), point(327, 51));
    float strength = ClampFloat(options.nose_slim / 10.0f, 0.0f, 1.0f);
    ApplyLocalWarp(pixels, width, height, nose, nose_width * 1.2f,
                   nose_width * 1.65f, 1.0f - strength * 0.24f, 1.0f);
  }

  std::vector<uint8_t> src = *pixels;
  float skin_smooth =
      std::max(options.acne * 0.055f, options.pores * 0.045f);
  float eye_bag = ClampFloat(options.eye_bag / 10.0f, 0.0f, 1.0f);
  float nasolabial = ClampFloat(options.nasolabial / 10.0f, 0.0f, 1.0f);
  float redness = ClampFloat(options.redness / 10.0f, 0.0f, 1.0f);
  float dullness = ClampFloat(options.dullness / 10.0f, 0.0f, 1.0f);
  float double_chin = ClampFloat(options.double_chin / 10.0f, 0.0f, 1.0f);
  float neck = ClampFloat(options.neck / 10.0f, 0.0f, 1.0f);

  Point2 left_under{left_eye.x, left_eye.y + face_height * 0.055f};
  Point2 right_under{right_eye.x, right_eye.y + face_height * 0.055f};
  float eye_rx = face_width * 0.18f;
  float eye_ry = face_height * 0.075f;
  Point2 chin_area{chin.x, chin.y + face_height * 0.08f};
  Point2 neck_area{chin.x, chin.y + face_height * 0.24f};

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      uint8_t* p = &(*pixels)[(y * width + x) * 4];
      float face_w = EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                                   face_mask_center, face_rx, face_ry);
      float avg[3];

      if (face_w > 0.0f && skin_smooth > 0.0f) {
        LocalAverage(src, width, height, x, y, options.pores > 5.0f ? 2 : 1,
                     avg);
        BlendColor(p, avg[0], avg[1], avg[2],
                   ClampFloat(skin_smooth * face_w, 0.0f, 0.55f));
      }

      if (face_w > 0.0f && redness > 0.0f) {
        ReduceRedness(p, redness * face_w * 0.85f);
      }

      if (face_w > 0.0f && dullness > 0.0f) {
        Lighten(p, dullness * face_w * 0.10f);
        BlendColor(p, p[0] * 1.03f, p[1] * 1.02f, p[2] * 0.98f,
                   dullness * face_w * 0.22f);
      }

      if (eye_bag > 0.0f) {
        float w = std::max(EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                                         left_under, eye_rx, eye_ry),
                           EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                                         right_under, eye_rx, eye_ry));
        if (w > 0.0f) {
          LocalAverage(src, width, height, x, y, 2, avg);
          BlendColor(p, avg[0] * 1.04f, avg[1] * 1.04f, avg[2] * 1.04f,
                     eye_bag * w * 0.36f);
          Lighten(p, eye_bag * w * 0.10f);
        }
      }

      if (nasolabial > 0.0f) {
        float w = 0.0f;
        if (has_mp) {
          w = std::max(
              std::max(LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(98, 47), point(205, 84),
                                  face_width * 0.032f),
                       LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(205, 84), point(61, 84),
                                  face_width * 0.034f)),
              std::max(LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(327, 51), point(425, 90),
                                  face_width * 0.032f),
                       LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(425, 90), point(291, 90),
                                  face_width * 0.034f)));
        } else {
          w = std::max(LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(98, 47), point(61, 84),
                                  face_width * 0.035f),
                       LineWeight(static_cast<float>(x), static_cast<float>(y),
                                  point(327, 51), point(291, 90),
                                  face_width * 0.035f));
        }
        if (w > 0.0f) {
          LocalAverage(src, width, height, x, y, 2, avg);
          BlendColor(p, avg[0] * 1.05f, avg[1] * 1.05f, avg[2] * 1.05f,
                     nasolabial * w * 0.45f);
        }
      }

      if (double_chin > 0.0f) {
        float w = EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                                chin_area, face_width * 0.38f,
                                face_height * 0.11f);
        if (w > 0.0f) {
          LocalAverage(src, width, height, x, y, 2, avg);
          BlendColor(p, avg[0] * 1.03f, avg[1] * 1.03f, avg[2] * 1.03f,
                     double_chin * w * 0.35f);
        }
      }

      if (neck > 0.0f) {
        float w = EllipseWeight(static_cast<float>(x), static_cast<float>(y),
                                neck_area, face_width * 0.48f,
                                face_height * 0.22f);
        if (w > 0.0f) {
          LocalAverage(src, width, height, x, y, 3, avg);
          BlendColor(p, avg[0] * 1.02f, avg[1] * 1.02f, avg[2] * 1.02f,
                     neck * w * 0.32f);
        }
      }
    }
  }

  if (options.brow > 0.01f) {
    float amount = ClampFloat(options.brow / 10.0f, 0.0f, 1.0f) * 0.45f;
    ApplyLineDarken(pixels, width, height, point(70, 33), point(107, 37),
                    face_width * 0.035f, amount);
    ApplyLineDarken(pixels, width, height, point(336, 38), point(300, 42),
                    face_width * 0.035f, amount);
  }

  if (options.eyelid > 0.01f) {
    float amount = ClampFloat(options.eyelid / 10.0f, 0.0f, 1.0f) * 0.35f;
    Point2 l1 = point(33, 52);
    Point2 l2 = point(133, 54);
    Point2 r1 = point(362, 58);
    Point2 r2 = point(263, 60);
    float offset = face_height * 0.018f;
    l1.y -= offset;
    l2.y -= offset;
    r1.y -= offset;
    r2.y -= offset;
    ApplyLineDarken(pixels, width, height, l1, l2, face_width * 0.016f, amount);
    ApplyLineDarken(pixels, width, height, r1, r2, face_width * 0.016f, amount);
  }
}

std::string GetExecutablePath() {
  std::string path;
#ifdef _WIN32
  char buffer[MAX_PATH];
  GetModuleFileNameA(NULL, buffer, MAX_PATH);
  PathRemoveFileSpecA(buffer);
  path = buffer;
#elif defined(__APPLE__)
  char buffer[PATH_MAX];
  uint32_t size = sizeof(buffer);
  if (_NSGetExecutablePath(buffer, &size) == 0) {
    char real_path[PATH_MAX];
    if (realpath(buffer, real_path)) {
      path = real_path;
      size_t pos = path.find_last_of("/\\");
      if (pos != std::string::npos) {
        path = path.substr(0, pos);
      }
    }
  }
#elif defined(__linux__)
  char buffer[PATH_MAX];
  ssize_t count = readlink("/proc/self/exe", buffer, PATH_MAX);
  if (count != -1) {
    buffer[count] = '\0';
    path = buffer;
    size_t pos = path.find_last_of("/\\");
    if (pos != std::string::npos) {
      path = path.substr(0, pos);
    }
  }
#endif
  return path;
}

std::string ResolveInputPath(const std::string& path) {
  if (path.empty()) {
    return {};
  }

  fs::path input_path(path);
  if (input_path.is_absolute() || fs::exists(input_path)) {
    return input_path.string();
  }

  fs::path exe_relative_path = fs::path(GetExecutablePath()) / input_path;
  if (fs::exists(exe_relative_path)) {
    return exe_relative_path.string();
  }

  return path;
}

std::vector<float> LoadLandmarksFromTextFile(const std::string& path) {
  if (path.empty()) {
    return {};
  }

  std::ifstream file(path);
  if (!file.is_open()) {
    std::cerr << "[Processor] Landmarks file not found: " << path << std::endl;
    return {};
  }

  std::vector<float> values;
  std::string line;
  while (std::getline(file, line)) {
    if (line.size() >= 3 &&
        static_cast<unsigned char>(line[0]) == 0xEF &&
        static_cast<unsigned char>(line[1]) == 0xBB &&
        static_cast<unsigned char>(line[2]) == 0xBF) {
      line.erase(0, 3);
    }
    for (char& ch : line) {
      if (ch == ',' || ch == '[' || ch == ']') {
        ch = ' ';
      }
    }

    std::stringstream stream(line);
    float value = 0.0f;
    while (stream >> value) {
      values.push_back(value);
    }
  }

  if (values.size() < 106 * 2) {
    std::cerr << "[Processor] Landmarks file has " << values.size()
              << " floats, expected at least " << 106 * 2 << std::endl;
    return {};
  }

  std::cout << "[Processor] Loaded " << values.size() / 2
            << " face landmarks" << std::endl;
  return values;
}

bool SetupHiddenGlfwWindow(GLFWwindow** window) {
  glfwSetErrorCallback([](int, const char* description) {
    std::cerr << "[Processor] GLFW Error: " << description << std::endl;
  });

  if (!glfwInit()) {
    std::cerr << "[Processor] Failed to initialize GLFW" << std::endl;
    return false;
  }

  glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);

  *window = glfwCreateWindow(32, 32, "GPUPixel Processor", nullptr, nullptr);
  if (*window == nullptr) {
    std::cerr << "[Processor] Failed to create hidden GLFW window" << std::endl;
    glfwTerminate();
    return false;
  }

  glfwMakeContextCurrent(*window);
  if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
    std::cerr << "[Processor] Failed to initialize GLAD" << std::endl;
    glfwDestroyWindow(*window);
    glfwTerminate();
    return false;
  }

  return true;
}

void PrintUsage() {
  std::cerr
      << "Usage: gpupixel_processor.exe --image <path> --output <path> "
         "[--landmarks <path>] [--smoothing 0-10] [--whitening 0-10] "
         "[--slim 0-10] [--eye 0-10] [--lipstick 0-10] [--blusher 0-10] "
         "[--acne 0-10] [--eye-bag 0-10] [--nasolabial 0-10] "
         "[--redness 0-10] [--dullness 0-10] [--pores 0-10] "
         "[--nose 0-10] [--eyelid 0-10] [--brow 0-10] "
         "[--mouth -10-10] [--double-chin 0-10] [--neck 0-10] "
         "[--mediapipe-landmarks <path>]\n";
}

bool ParseArgs(int argc, char** argv, Options* options) {
  for (int i = 1; i < argc; ++i) {
    std::string key = argv[i];
    auto require_value = [&](std::string* out) -> bool {
      if (i + 1 >= argc) {
        std::cerr << "[Processor] Missing value for " << key << std::endl;
        return false;
      }
      *out = argv[++i];
      return true;
    };
    auto require_float = [&](float* out) -> bool {
      std::string value;
      if (!require_value(&value)) {
        return false;
      }
      *out = std::stof(value);
      return true;
    };

    if (key == "--image") {
      if (!require_value(&options->image_path)) return false;
    } else if (key == "--output") {
      if (!require_value(&options->output_path)) return false;
    } else if (key == "--landmarks") {
      if (!require_value(&options->landmarks_path)) return false;
    } else if (key == "--mediapipe-landmarks") {
      if (!require_value(&options->mediapipe_landmarks_path)) return false;
    } else if (key == "--smoothing") {
      if (!require_float(&options->smoothing)) return false;
    } else if (key == "--whitening") {
      if (!require_float(&options->whitening)) return false;
    } else if (key == "--slim") {
      if (!require_float(&options->face_slim)) return false;
    } else if (key == "--eye") {
      if (!require_float(&options->eye_enlarge)) return false;
    } else if (key == "--lipstick") {
      if (!require_float(&options->lipstick)) return false;
    } else if (key == "--blusher") {
      if (!require_float(&options->blusher)) return false;
    } else if (key == "--acne") {
      if (!require_float(&options->acne)) return false;
    } else if (key == "--eye-bag") {
      if (!require_float(&options->eye_bag)) return false;
    } else if (key == "--nasolabial") {
      if (!require_float(&options->nasolabial)) return false;
    } else if (key == "--redness") {
      if (!require_float(&options->redness)) return false;
    } else if (key == "--dullness") {
      if (!require_float(&options->dullness)) return false;
    } else if (key == "--pores") {
      if (!require_float(&options->pores)) return false;
    } else if (key == "--nose") {
      if (!require_float(&options->nose_slim)) return false;
    } else if (key == "--eyelid") {
      if (!require_float(&options->eyelid)) return false;
    } else if (key == "--brow") {
      if (!require_float(&options->brow)) return false;
    } else if (key == "--mouth") {
      if (!require_float(&options->mouth_size)) return false;
    } else if (key == "--double-chin") {
      if (!require_float(&options->double_chin)) return false;
    } else if (key == "--neck") {
      if (!require_float(&options->neck)) return false;
    } else {
      std::cerr << "[Processor] Unknown argument: " << key << std::endl;
      return false;
    }
  }

  if (options->image_path.empty() || options->output_path.empty()) {
    return false;
  }

  return true;
}

bool ProcessFrame(const Options& options, std::string* error) {
  std::string image_path = ResolveInputPath(options.image_path);
  std::string output_path = options.output_path;
  std::string landmarks_path = ResolveInputPath(options.landmarks_path);
  std::string mediapipe_landmarks_path =
      ResolveInputPath(options.mediapipe_landmarks_path);

  auto source_image = SourceImage::Create(image_path);
  auto lipstick_filter = LipstickFilter::Create();
  auto blusher_filter = BlusherFilter::Create();
  auto reshape_filter = FaceReshapeFilter::Create();
  auto beauty_filter = BeautyFaceFilter::Create();
  auto sink_raw_data = SinkRawData::Create();

  if (!source_image || !lipstick_filter || !blusher_filter || !reshape_filter ||
      !beauty_filter || !sink_raw_data) {
    *error = "Failed to create GPUPixel pipeline";
    std::cerr << "[Processor] " << *error << std::endl;
    return false;
  }

  beauty_filter->SetBlurAlpha(options.smoothing / 10.0f);
  beauty_filter->SetWhite(options.whitening / 20.0f);
  reshape_filter->SetFaceSlimLevel(0.0f);
  reshape_filter->SetEyeZoomLevel(options.eye_enlarge / 100.0f);
  lipstick_filter->SetBlendLevel(options.lipstick / 10.0f);
  blusher_filter->SetBlendLevel(options.blusher / 10.0f);

  std::vector<float> landmarks = LoadLandmarksFromTextFile(landmarks_path);
  std::vector<float> mediapipe_landmarks =
      LoadLandmarksFromTextFile(mediapipe_landmarks_path);
  if (!mediapipe_landmarks.empty()) {
    std::cout << "[Processor] Loaded " << mediapipe_landmarks.size() / 2
              << " MediaPipe landmarks" << std::endl;
  }
  if (!landmarks.empty()) {
    lipstick_filter->SetFaceLandmarks(landmarks);
    blusher_filter->SetFaceLandmarks(landmarks);
    reshape_filter->SetFaceLandmarks(landmarks);
  }

  source_image->AddSink(lipstick_filter)
      ->AddSink(blusher_filter)
      ->AddSink(reshape_filter)
      ->AddSink(beauty_filter)
      ->AddSink(sink_raw_data);

  source_image->Render();
  const uint8_t* rgba = sink_raw_data->GetRgbaBuffer();
  int width = sink_raw_data->GetWidth();
  int height = sink_raw_data->GetHeight();
  if (!rgba || width <= 0 || height <= 0) {
    *error = "No output pixels produced";
    std::cerr << "[Processor] " << *error << std::endl;
    return false;
  }

  std::vector<uint8_t> output_pixels(rgba, rgba + width * height * 4);
  ApplyRetouch(&output_pixels, width, height, landmarks, mediapipe_landmarks,
               options);

  fs::create_directories(fs::path(output_path).parent_path());
  int ok = stbi_write_png(output_path.c_str(), width, height, 4,
                          output_pixels.data(), width * 4);

  if (!ok) {
    *error = "Failed to write output PNG: " + output_path;
    std::cerr << "[Processor] " << *error << std::endl;
    return false;
  }

  std::cout << "[Processor] Wrote " << output_path << " (" << width << "x"
            << height << ")" << std::endl;
  return true;
}

std::vector<std::string> SplitTabs(const std::string& line) {
  std::vector<std::string> fields;
  std::stringstream stream(line);
  std::string field;
  while (std::getline(stream, field, '\t')) {
    fields.push_back(field);
  }
  return fields;
}

bool ParseDaemonRequest(const std::string& line, Options* options,
                        std::string* error) {
  auto fields = SplitTabs(line);
  if (fields.empty()) {
    *error = "empty request";
    return false;
  }
  if (fields[0] == "QUIT") {
    return true;
  }
  if (fields[0] != "PROCESS") {
    *error = "unknown request: " + fields[0];
    return false;
  }
  if (fields.size() != 23) {
    *error = "bad field count: " + std::to_string(fields.size());
    return false;
  }

  options->image_path = fields[1];
  options->output_path = fields[2];
  options->landmarks_path = fields[3];
  options->mediapipe_landmarks_path = fields[4];

  auto parse_float = [&](size_t index, float* out) -> bool {
    try {
      *out = std::stof(fields[index]);
      return true;
    } catch (...) {
      *error = "bad float at field " + std::to_string(index);
      return false;
    }
  };

  return parse_float(5, &options->smoothing) &&
         parse_float(6, &options->whitening) &&
         parse_float(7, &options->face_slim) &&
         parse_float(8, &options->eye_enlarge) &&
         parse_float(9, &options->lipstick) &&
         parse_float(10, &options->blusher) &&
         parse_float(11, &options->acne) &&
         parse_float(12, &options->eye_bag) &&
         parse_float(13, &options->nasolabial) &&
         parse_float(14, &options->redness) &&
         parse_float(15, &options->dullness) &&
         parse_float(16, &options->pores) &&
         parse_float(17, &options->nose_slim) &&
         parse_float(18, &options->eyelid) &&
         parse_float(19, &options->brow) &&
         parse_float(20, &options->mouth_size) &&
         parse_float(21, &options->double_chin) &&
         parse_float(22, &options->neck);
}

int main(int argc, char** argv) {
#ifdef _WIN32
  std::string exe_path = GetExecutablePath();
  char dll_dir[MAX_PATH];
  sprintf_s(dll_dir, MAX_PATH, "%s\\..\\lib", exe_path.c_str());
  SetDllDirectoryA(dll_dir);
#endif

  GLFWwindow* window = nullptr;
  if (!SetupHiddenGlfwWindow(&window)) {
    return 1;
  }

  auto resource_path = fs::path(GetExecutablePath()).parent_path();
  GPUPixel::SetResourcePath(resource_path.string());
  std::cout << "__GPUPIXEL_READY__" << std::endl;

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == "QUIT") {
      break;
    }

    Options options;
    std::string error;
    bool parsed = ParseDaemonRequest(line, &options, &error);
    bool ok = false;
    if (parsed) {
      ok = ProcessFrame(options, &error);
    }

    std::cout << "__GPUPIXEL_DONE__\t" << (ok ? "1" : "0") << "\t" << error
              << std::endl;
  }

  glfwDestroyWindow(window);
  glfwTerminate();
  return 0;
}
