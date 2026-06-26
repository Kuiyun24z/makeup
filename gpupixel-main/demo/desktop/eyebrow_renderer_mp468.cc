#include "eyebrow_renderer_mp468.h"

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

int IntMax(int a, int b) { return a > b ? a : b; }
int IntMin(int a, int b) { return a < b ? a : b; }

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
    const bool crosses =
        ((a.y > y) != (b.y > y)) &&
        (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) + 0.0001f) + a.x);
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
  const float t =
      ClampFloat(((x - a.x) * vx + (y - a.y) * vy) / len2, 0.0f, 1.0f);
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

std::vector<Point2> ExpandPolygonFromCentroid(const std::vector<Point2>& polygon,
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

void BoundsForPolygon(const std::vector<Point2>& polygon,
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
  for (const Point2& p : polygon) {
    min_x = std::min(min_x, p.x);
    max_x = std::max(max_x, p.x);
    min_y = std::min(min_y, p.y);
    max_y = std::max(max_y, p.y);
  }
  *x0 = IntMax(0, static_cast<int>(min_x - padding));
  *x1 = IntMin(width - 1, static_cast<int>(max_x + padding));
  *y0 = IntMax(0, static_cast<int>(min_y - padding));
  *y1 = IntMin(height - 1, static_cast<int>(max_y + padding));
}

// Higher on darker (hair) pixels, lower on bright skin between the hairs, so
// the deepening tracks the actual brow rather than flooding the whole patch.
float BrowConfidence(const uint8_t* pixel) {
  const float luminance =
      pixel[0] * 0.299f + pixel[1] * 0.587f + pixel[2] * 0.114f;
  const float hair = 1.0f - SmoothStep(70.0f, 185.0f, luminance);
  return ClampFloat(0.4f + 0.6f * hair, 0.4f, 1.0f);
}

void DarkenEyebrow(std::vector<uint8_t>* rgba,
                   int width,
                   int height,
                   const std::vector<Point2>& brow_polygon,
                   const EyebrowRenderSettings& settings) {
  if (brow_polygon.size() < 3) return;
  const std::vector<Point2> expanded =
      ExpandPolygonFromCentroid(brow_polygon, settings.expand_px);
  int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  BoundsForPolygon(expanded, width, height, settings.edge_feather_px + 2.0f, &x0,
                   &y0, &x1, &y1);

  for (int y = y0; y <= y1; ++y) {
    for (int x = x0; x <= x1; ++x) {
      const float px = static_cast<float>(x) + 0.5f;
      const float py = static_cast<float>(y) + 0.5f;
      if (!PointInPolygon(px, py, expanded)) continue;

      const float edge_alpha =
          SmoothStep(0.0f, settings.edge_feather_px,
                     DistanceToPolygon(px, py, expanded));
      uint8_t* pixel = &(*rgba)[(y * width + x) * 4];
      const float amount = ClampFloat(
          settings.strength * edge_alpha * BrowConfidence(pixel), 0.0f, 1.0f);
      if (amount <= 0.01f) continue;

      const float factor = 1.0f - amount * settings.darkness;
      pixel[0] = ClampByte(pixel[0] * factor);
      pixel[1] = ClampByte(pixel[1] * factor);
      pixel[2] = ClampByte(pixel[2] * factor);
    }
  }
}

}  // namespace

bool EyebrowRendererMP468::Apply(
    std::vector<uint8_t>* rgba,
    int width,
    int height,
    const std::vector<float>& mediapipe_landmarks,
    const EyebrowRenderSettings& settings) const {
  if (!rgba || rgba->empty() || width <= 0 || height <= 0 ||
      settings.strength <= 0.01f ||
      mediapipe_landmarks.size() <
          static_cast<size_t>(kMediaPipePointCount * 2)) {
    return false;
  }

  // Closed rings around each brow: along the upper edge, then back along the
  // lower edge (MediaPipe 468 eyebrow landmark indices).
  static const int kRightBrow[] = {70, 63, 105, 66, 107, 55, 65, 52, 53, 46};
  static const int kLeftBrow[] = {300, 293, 334, 296, 336,
                                   285, 295, 282, 283, 276};

  const std::vector<Point2> right = PolygonFromIndices(
      mediapipe_landmarks, kRightBrow,
      sizeof(kRightBrow) / sizeof(kRightBrow[0]), width, height);
  const std::vector<Point2> left = PolygonFromIndices(
      mediapipe_landmarks, kLeftBrow, sizeof(kLeftBrow) / sizeof(kLeftBrow[0]),
      width, height);

  DarkenEyebrow(rgba, width, height, right, settings);
  DarkenEyebrow(rgba, width, height, left, settings);
  return true;
}

}  // namespace gpupixel_demo
