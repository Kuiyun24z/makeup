#include "lip_renderer_mp468.h"

#include <algorithm>
#include <cmath>

namespace gpupixel_demo {
namespace {

constexpr int kMediaPipePointCount = 468;

struct Point2 {
  float x = 0.0f;
  float y = 0.0f;
};

float ClampFloat(float value, float min_value, float max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

uint8_t ClampByte(float value) {
  return static_cast<uint8_t>(ClampFloat(value, 0.0f, 255.0f));
}

float SmoothStep(float edge0, float edge1, float x) {
  x = ClampFloat((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
  return x * x * (3.0f - 2.0f * x);
}

int IntMax(int a, int b) {
  return a > b ? a : b;
}

int IntMin(int a, int b) {
  return a < b ? a : b;
}

Point2 LandmarkAt(const std::vector<float>& landmarks,
                  int index,
                  int width,
                  int height) {
  if (index < 0 || index * 2 + 1 >= static_cast<int>(landmarks.size())) {
    return {};
  }
  return {landmarks[index * 2] * width, landmarks[index * 2 + 1] * height};
}

std::vector<Point2> PolygonFromIndices(const std::vector<float>& landmarks,
                                       const int* indices,
                                       size_t count,
                                       int width,
                                       int height) {
  std::vector<Point2> polygon;
  polygon.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    polygon.push_back(LandmarkAt(landmarks, indices[i], width, height));
  }
  return polygon;
}

bool PointInPolygon(float x, float y, const std::vector<Point2>& polygon) {
  bool inside = false;
  if (polygon.size() < 3) return false;
  for (size_t i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
    const Point2& a = polygon[i];
    const Point2& b = polygon[j];
    const bool crosses = ((a.y > y) != (b.y > y)) &&
                         (x < (b.x - a.x) * (y - a.y) /
                                      ((b.y - a.y) + 0.0001f) +
                                  a.x);
    if (crosses) inside = !inside;
  }
  return inside;
}

float DistanceToSegment(float x, float y, Point2 a, Point2 b) {
  const float vx = b.x - a.x;
  const float vy = b.y - a.y;
  const float len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001f) {
    const float dx = x - a.x;
    const float dy = y - a.y;
    return std::sqrt(dx * dx + dy * dy);
  }
  const float t = ClampFloat(((x - a.x) * vx + (y - a.y) * vy) / len2, 0.0f,
                             1.0f);
  const float px = a.x + vx * t;
  const float py = a.y + vy * t;
  const float dx = x - px;
  const float dy = y - py;
  return std::sqrt(dx * dx + dy * dy);
}

float DistanceToPolygon(float x, float y, const std::vector<Point2>& polygon) {
  if (polygon.size() < 2) return 1000000.0f;
  float min_distance = 1000000.0f;
  for (size_t i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
    min_distance =
        std::min(min_distance, DistanceToSegment(x, y, polygon[j], polygon[i]));
  }
  return min_distance;
}

void BoundsForPolygons(const std::vector<Point2>& a,
                       const std::vector<Point2>& b,
                       int width,
                       int height,
                       float padding,
                       int* x0,
                       int* y0,
                       int* x1,
                       int* y1) {
  float min_x = static_cast<float>(width - 1);
  float max_x = 0.0f;
  float min_y = static_cast<float>(height - 1);
  float max_y = 0.0f;
  auto collect = [&](const std::vector<Point2>& polygon) {
    for (const Point2& p : polygon) {
      min_x = std::min(min_x, p.x);
      max_x = std::max(max_x, p.x);
      min_y = std::min(min_y, p.y);
      max_y = std::max(max_y, p.y);
    }
  };
  collect(a);
  collect(b);
  *x0 = IntMax(0, static_cast<int>(min_x - padding));
  *x1 = IntMin(width - 1, static_cast<int>(max_x + padding));
  *y0 = IntMax(0, static_cast<int>(min_y - padding));
  *y1 = IntMin(height - 1, static_cast<int>(max_y + padding));
}

float TeethGuard(const uint8_t* pixel) {
  const float r = pixel[0];
  const float g = pixel[1];
  const float b = pixel[2];
  const float max_c = std::max(r, std::max(g, b));
  const float min_c = std::min(r, std::min(g, b));
  const float chroma = max_c - min_c;
  const float luminance = r * 0.299f + g * 0.587f + b * 0.114f;
  if (luminance > 228.0f && chroma < 34.0f) return 0.08f;
  if (luminance > 212.0f && chroma < 24.0f) return 0.25f;
  return 1.0f;
}

float LipPixelConfidence(const uint8_t* pixel) {
  const float r = pixel[0];
  const float g = pixel[1];
  const float b = pixel[2];
  const float max_c = std::max(r, std::max(g, b));
  const float min_c = std::min(r, std::min(g, b));
  const float chroma = max_c - min_c;
  const float luminance = r * 0.299f + g * 0.587f + b * 0.114f;
  const float red_over_green = r - g;
  const float red_over_blue = r - b;

  const float lip_chroma = SmoothStep(6.0f, 42.0f, chroma);
  const float warm_red = SmoothStep(-4.0f, 28.0f, red_over_green) *
                         SmoothStep(-16.0f, 24.0f, red_over_blue);
  const float natural_shadow = 1.0f - SmoothStep(150.0f, 215.0f, luminance);
  float confidence =
      0.48f + 0.52f * std::max(lip_chroma * warm_red, natural_shadow * 0.82f);

  if (luminance > 198.0f && chroma < 30.0f) {
    confidence *= 0.78f;
  }
  return ClampFloat(confidence, 0.36f, 1.0f);
}

float PolygonWidth(const std::vector<Point2>& polygon) {
  if (polygon.empty()) return 0.0f;
  float min_x = polygon[0].x;
  float max_x = polygon[0].x;
  for (const Point2& p : polygon) {
    min_x = std::min(min_x, p.x);
    max_x = std::max(max_x, p.x);
  }
  return max_x - min_x;
}

float PolygonHeight(const std::vector<Point2>& polygon) {
  if (polygon.empty()) return 0.0f;
  float min_y = polygon[0].y;
  float max_y = polygon[0].y;
  for (const Point2& p : polygon) {
    min_y = std::min(min_y, p.y);
    max_y = std::max(max_y, p.y);
  }
  return max_y - min_y;
}

float AdaptiveFeatherPx(const std::vector<Point2>& lip_polygon,
                        const LipRenderSettings& settings) {
  const float lip_width = PolygonWidth(lip_polygon);
  const float lip_height = PolygonHeight(lip_polygon);
  const float size_based = std::max(lip_width * 0.032f, lip_height * 0.28f);
  return ClampFloat(std::max(settings.edge_feather_px, size_based), 5.0f,
                    12.0f);
}

Point2 PolygonCentroid(const std::vector<Point2>& polygon) {
  Point2 center;
  if (polygon.empty()) return center;
  for (const Point2& p : polygon) {
    center.x += p.x;
    center.y += p.y;
  }
  center.x /= static_cast<float>(polygon.size());
  center.y /= static_cast<float>(polygon.size());
  return center;
}

float AdaptiveExpandPx(const std::vector<Point2>& lip_polygon,
                       const LipRenderSettings& settings) {
  const float lip_width = PolygonWidth(lip_polygon);
  const float lip_height = PolygonHeight(lip_polygon);
  const float size_based = std::max(lip_width * 0.026f, lip_height * 0.26f);
  return ClampFloat(std::max(settings.outer_expand_px, size_based), 3.0f,
                    14.0f);
}

std::vector<Point2> ExpandPolygonFromCentroid(
    const std::vector<Point2>& polygon,
    float expand_px) {
  std::vector<Point2> expanded;
  expanded.reserve(polygon.size());
  const Point2 center = PolygonCentroid(polygon);
  for (const Point2& p : polygon) {
    float dx = p.x - center.x;
    float dy = p.y - center.y;
    const float length = std::sqrt(dx * dx + dy * dy);
    if (length > 0.0001f) {
      dx /= length;
      dy /= length;
    }
    expanded.push_back({p.x + dx * expand_px, p.y + dy * expand_px});
  }
  return expanded;
}

std::vector<LipDebugPoint> ToNormalizedDebugPoints(
    const std::vector<Point2>& polygon,
    int width,
    int height) {
  std::vector<LipDebugPoint> points;
  points.reserve(polygon.size());
  const float inv_width = width > 0 ? 1.0f / static_cast<float>(width) : 0.0f;
  const float inv_height =
      height > 0 ? 1.0f / static_cast<float>(height) : 0.0f;
  for (const Point2& p : polygon) {
    points.push_back({ClampFloat(p.x * inv_width, 0.0f, 1.0f),
                      ClampFloat(p.y * inv_height, 0.0f, 1.0f)});
  }
  return points;
}

void BlendLipColor(uint8_t* pixel,
                   float amount,
                   const LipRenderSettings& settings) {
  const float r = pixel[0];
  const float g = pixel[1];
  const float b = pixel[2];
  const float luminance = r * 0.299f + g * 0.587f + b * 0.114f;
  const float shade = ClampFloat(luminance / 172.0f, 0.55f, 1.22f);
  const float target_r = settings.red * shade;
  const float target_g = settings.green * shade;
  const float target_b = settings.blue * shade;

  amount =
      ClampFloat(amount * TeethGuard(pixel) * LipPixelConfidence(pixel), 0.0f,
                 1.0f);
  pixel[0] = ClampByte(r * (1.0f - amount) + target_r * amount);
  pixel[1] = ClampByte(g * (1.0f - amount) + target_g * amount);
  pixel[2] = ClampByte(b * (1.0f - amount) + target_b * amount);
}

void PaintLipPart(std::vector<uint8_t>* rgba,
                  int width,
                  int height,
                  const std::vector<Point2>& lip_polygon,
                  const std::vector<Point2>& inner_mouth_polygon,
                  float part_strength,
                  const LipRenderSettings& settings) {
  int x0 = 0;
  int y0 = 0;
  int x1 = 0;
  int y1 = 0;
  const float edge_feather_px = AdaptiveFeatherPx(lip_polygon, settings);
  const float expand_px = AdaptiveExpandPx(lip_polygon, settings);
  const float inner_feather_px = edge_feather_px * 0.85f;
  const std::vector<Point2> expanded_lip =
      ExpandPolygonFromCentroid(lip_polygon, expand_px);
  BoundsForPolygons(expanded_lip, inner_mouth_polygon, width, height,
                    edge_feather_px + 2.0f, &x0, &y0, &x1, &y1);

  for (int y = y0; y <= y1; ++y) {
    for (int x = x0; x <= x1; ++x) {
      const float px = static_cast<float>(x) + 0.5f;
      const float py = static_cast<float>(y) + 0.5f;
      if (!PointInPolygon(px, py, expanded_lip) ||
          PointInPolygon(px, py, inner_mouth_polygon)) {
        continue;
      }

      const bool inside_original = PointInPolygon(px, py, lip_polygon);
      const float edge_alpha =
          SmoothStep(0.0f, edge_feather_px,
                     DistanceToPolygon(px, py, expanded_lip));
      const float outer_alpha =
          inside_original
              ? 1.0f
              : (1.0f - SmoothStep(0.0f, expand_px,
                                    DistanceToPolygon(px, py, lip_polygon))) *
                    settings.outer_opacity_scale;
      const float inner_alpha =
          SmoothStep(settings.inner_erode_px,
                     settings.inner_erode_px + inner_feather_px,
                     DistanceToPolygon(px, py, inner_mouth_polygon));
      const float amount = settings.strength * part_strength *
                           settings.opacity_scale *
                           edge_alpha * outer_alpha * inner_alpha;
      if (amount <= 0.01f) continue;
      BlendLipColor(&(*rgba)[(y * width + x) * 4], amount, settings);
    }
  }
}

bool BuildPolygons(int width,
                   int height,
                   const std::vector<float>& mediapipe_landmarks,
                   std::vector<Point2>* upper,
                   std::vector<Point2>* lower,
                   std::vector<Point2>* inner) {
  if (width <= 0 || height <= 0 ||
      mediapipe_landmarks.size() <
          static_cast<size_t>(kMediaPipePointCount * 2)) {
    return false;
  }

  static const int kUpperLip[] = {61, 185, 40, 39, 37, 0,  267, 269,
                                  270, 409, 291, 308, 415, 310, 311, 312,
                                  13, 82,  81,  80, 191, 78};
  static const int kLowerLip[] = {61, 146, 91, 181, 84, 17, 314, 405,
                                  321, 375, 291, 308, 324, 318, 402, 317,
                                  14, 87,  178, 88, 95,  78};
  static const int kInnerMouth[] = {78, 95, 88, 178, 87, 14, 317, 402,
                                    318, 324, 308, 415, 310, 311, 312, 13,
                                    82, 81, 80, 191};

  *upper = PolygonFromIndices(mediapipe_landmarks, kUpperLip,
                              sizeof(kUpperLip) / sizeof(kUpperLip[0]), width,
                              height);
  *lower = PolygonFromIndices(mediapipe_landmarks, kLowerLip,
                              sizeof(kLowerLip) / sizeof(kLowerLip[0]), width,
                              height);
  *inner =
      PolygonFromIndices(mediapipe_landmarks, kInnerMouth,
                         sizeof(kInnerMouth) / sizeof(kInnerMouth[0]), width,
                         height);
  return true;
}

}  // namespace

bool LipRendererMP468::Apply(std::vector<uint8_t>* rgba,
                             int width,
                             int height,
                             const std::vector<float>& mediapipe_landmarks,
                             const LipRenderSettings& settings) const {
  if (!rgba || rgba->empty() || width <= 0 || height <= 0 ||
      settings.strength <= 0.01f ||
      mediapipe_landmarks.size() <
          static_cast<size_t>(kMediaPipePointCount * 2)) {
    return false;
  }

  std::vector<Point2> upper;
  std::vector<Point2> lower;
  std::vector<Point2> inner;
  if (!BuildPolygons(width, height, mediapipe_landmarks, &upper, &lower,
                     &inner)) {
    return false;
  }

  PaintLipPart(rgba, width, height, upper, inner, settings.upper_lip_strength,
               settings);
  PaintLipPart(rgba, width, height, lower, inner, settings.lower_lip_strength,
               settings);
  return true;
}

bool LipRendererMP468::BuildDebugOverlay(
    int width,
    int height,
    const std::vector<float>& mediapipe_landmarks,
    const LipRenderSettings& settings,
    LipDebugOverlay* overlay) const {
  if (!overlay) return false;
  *overlay = LipDebugOverlay();

  std::vector<Point2> upper;
  std::vector<Point2> lower;
  std::vector<Point2> inner;
  if (!BuildPolygons(width, height, mediapipe_landmarks, &upper, &lower,
                     &inner)) {
    return false;
  }

  const float upper_expand = AdaptiveExpandPx(upper, settings);
  const float lower_expand = AdaptiveExpandPx(lower, settings);
  const std::vector<Point2> expanded_upper =
      ExpandPolygonFromCentroid(upper, upper_expand);
  const std::vector<Point2> expanded_lower =
      ExpandPolygonFromCentroid(lower, lower_expand);

  overlay->upper_lip = ToNormalizedDebugPoints(upper, width, height);
  overlay->lower_lip = ToNormalizedDebugPoints(lower, width, height);
  overlay->inner_mouth = ToNormalizedDebugPoints(inner, width, height);
  overlay->expanded_upper_lip =
      ToNormalizedDebugPoints(expanded_upper, width, height);
  overlay->expanded_lower_lip =
      ToNormalizedDebugPoints(expanded_lower, width, height);
  overlay->valid = true;
  return true;
}

}  // namespace gpupixel_demo
