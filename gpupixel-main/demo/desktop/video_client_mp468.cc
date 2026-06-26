// clang-format off
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#endif
#include <glad/glad.h>
#include <GLFW/glfw3.h>
// clang-format on

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cmath>
#include <cctype>
#include <cstdio>
#include <cstdint>
#include <atomic>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <limits>
#include <mutex>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "backends/imgui_impl_glfw.h"
#include "backends/imgui_impl_opengl3.h"
#include "ghc/filesystem.hpp"
#include "gpupixel/gpupixel.h"
#include "imgui.h"
#include "eyebrow_renderer_mp468.h"
#include "lip_renderer_mp468.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#ifdef _WIN32
#include <windows.h>
#include <Shlwapi.h>
#include <delayimp.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#pragma comment(lib, "Shlwapi.lib")
#pragma comment(lib, "Ws2_32.lib")
#endif

namespace fs {
using namespace ghc::filesystem;
}

using namespace gpupixel;
using gpupixel_demo::EyebrowRenderSettings;
using gpupixel_demo::EyebrowRendererMP468;
using gpupixel_demo::LipDebugOverlay;
using gpupixel_demo::LipDebugPoint;
using gpupixel_demo::LipRenderSettings;
using gpupixel_demo::LipRendererMP468;

namespace {

constexpr int kWindowWidth = 960;
constexpr int kWindowHeight = 540;
constexpr int kCameraWidth = 1920;
constexpr int kCameraHeight = 1080;
constexpr bool kCorrectCameraMirror = true;
constexpr int kMediaPipeBridgeMaxSide = 360;
constexpr int kMediaPipeBridgePublishEveryFrames = 1;
constexpr int kMediaPipeBridgeLoadEveryFrames = 1;
constexpr float kLandmarkSmoothingAlpha = 0.25f;
constexpr float kFaceSlimUiMax = 4.0f;
constexpr float kEyeEnlargeUiMax = 8.0f;
constexpr float kFaceSlimStrengthScale = 0.45f;
constexpr float kEyeEnlargeStrengthScale = 1.0f;
// Mouth / nose resize: UI slider is signed (-max .. +max); positive enlarges,
// negative shrinks. The strength scale maps the slider to the shader delta and
// is kept small so the warp stays natural.
constexpr float kMouthResizeUiMax = 1.0f;
constexpr float kNoseResizeUiMax = 1.0f;
constexpr float kMouthResizeStrength = 0.15f;
constexpr float kNoseResizeStrength = 0.15f;
constexpr float kUiScale = 1.6f;
constexpr int kMediaPipePointCount = 468;
constexpr const char* kClientVersion = "v21 eyebrow darken";
// v19: split lip motion into overall mouth-center translation (smooth, low
// noise -> predict) and per-point shape deformation (noisy -> very weak / no
// predict). Lead is computed from landmark age, not frame age, and is much
// gentler than v18 to avoid the v19-prototype overshoot/jitter.
constexpr float kLipLeadStrength = 0.9f;       // applied to center-lead scale
constexpr float kLipLeadMaxScale = 1.0f;       // cap center-lead (v18 was 2.25)
constexpr float kLipCenterMaxDelta = 0.010f;   // max mouth-center lead per axis
constexpr float kLipShapeLeadScale = 0.35f;    // weak deformation lead factor
constexpr float kLipShapeMaxDelta = 0.006f;    // max per-point shape lead per axis
constexpr float kLipLeadMaxAgeMs = 80.0f;      // cap lead age (v18 was 140)
constexpr float kLipLeadMinFps = 8.0f;
constexpr int kMjpegStreamPort = 8791;
constexpr int kMjpegStreamMaxSide = 960;
constexpr int kMjpegStreamQuality = 72;
constexpr int kMjpegStreamMinIntervalMs = 33;

constexpr int kLipPredictionIndices[] = {
    61, 185, 40, 39, 37, 0,   267, 269, 270, 409,
    291, 308, 415, 310, 311, 312, 13,  82,  81,  80,
    191, 78,  146, 91, 181, 84,  17,  314, 405, 321,
    375, 324, 318, 402, 317, 14,  87,  178, 88,  95};

template <typename T>
class ComPtr {
 public:
  ComPtr() = default;
  ~ComPtr() { Reset(); }
  ComPtr(const ComPtr&) = delete;
  ComPtr& operator=(const ComPtr&) = delete;

  T* Get() const { return ptr_; }
  T** Put() {
    Reset();
    return &ptr_;
  }
  T* operator->() const { return ptr_; }
  explicit operator bool() const { return ptr_ != nullptr; }

  void Reset() {
    if (ptr_) {
      ptr_->Release();
      ptr_ = nullptr;
    }
  }

  void Attach(T* ptr) {
    Reset();
    ptr_ = ptr;
  }

 private:
  T* ptr_ = nullptr;
};

std::string GetExecutablePath() {
  std::string path;
#ifdef _WIN32
  char buffer[MAX_PATH];
  GetModuleFileNameA(nullptr, buffer, MAX_PATH);
  PathRemoveFileSpecA(buffer);
  path = buffer;
#endif
  return path;
}

std::vector<float> LoadLandmarksFromTextFile(const std::string& path,
                                             bool quiet = false) {
  if (path.empty()) {
    return {};
  }

  std::ifstream file(path, std::ios::binary);
  if (!file.is_open()) {
    if (!quiet) {
      std::cout << "[VideoClient] Landmarks file not found: " << path
                << std::endl;
    }
    return {};
  }

  std::string text((std::istreambuf_iterator<char>(file)),
                   std::istreambuf_iterator<char>());
  if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
      static_cast<unsigned char>(text[1]) == 0xBB &&
      static_cast<unsigned char>(text[2]) == 0xBF) {
    text.erase(0, 3);
  }

  for (char& ch : text) {
    if (ch == ',' || ch == '[' || ch == ']') {
      ch = ' ';
    }
  }

  std::stringstream stream(text);
  std::vector<float> values;
  float value = 0.0f;
  while (stream >> value) {
    values.push_back(value);
  }

  if (values.size() < 106 * 2) {
    if (!quiet) {
      std::cerr << "[VideoClient] Landmarks file has " << values.size()
                << " floats, expected at least " << 106 * 2 << std::endl;
    }
    return {};
  }

  if (!quiet) {
    std::cout << "[VideoClient] Loaded " << values.size() / 2
              << " landmarks from " << path << std::endl;
  }
  return values;
}

std::string ResolveInputPath(const std::string& path) {
  if (path.empty()) {
    return {};
  }
  fs::path input_path(path);
  if (input_path.is_absolute() || fs::exists(input_path)) {
    return input_path.string();
  }
  fs::path exe_relative = fs::path(GetExecutablePath()) / input_path;
  if (fs::exists(exe_relative)) {
    return exe_relative.string();
  }
  return path;
}

bool CheckShader(GLuint shader, const char* label, bool program = false) {
  GLint success = 0;
  if (program) {
    glGetProgramiv(shader, GL_LINK_STATUS, &success);
  } else {
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
  }
  if (success) {
    return true;
  }

  GLchar info_log[1024];
  if (program) {
    glGetProgramInfoLog(shader, 1024, nullptr, info_log);
  } else {
    glGetShaderInfoLog(shader, 1024, nullptr, info_log);
  }
  std::cerr << "[VideoClient] Shader error " << label << ": " << info_log
            << std::endl;
  return false;
}

#ifdef _WIN32
bool IsSupportedCameraSubtype(const GUID& guid) {
  return guid == MFVideoFormat_RGB32 || guid == MFVideoFormat_ARGB32 ||
         guid == MFVideoFormat_NV12 || guid == MFVideoFormat_YUY2;
}

std::string GuidName(const GUID& guid) {
  if (guid == MFVideoFormat_RGB32) {
    return "RGB32";
  }
  if (guid == MFVideoFormat_ARGB32) {
    return "ARGB32";
  }
  if (guid == MFVideoFormat_NV12) {
    return "NV12";
  }
  if (guid == MFVideoFormat_YUY2) {
    return "YUY2";
  }
  if (guid == MFVideoFormat_MJPG) {
    return "MJPG";
  }
  LPOLESTR text = nullptr;
  StringFromCLSID(guid, &text);
  std::wstring wide = text ? text : L"unknown";
  CoTaskMemFree(text);
  return std::string(wide.begin(), wide.end());
}

uint8_t ClampByte(int value) {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return static_cast<uint8_t>(value);
}

void YuvToRgb(uint8_t y,
              uint8_t u,
              uint8_t v,
              uint8_t* r,
              uint8_t* g,
              uint8_t* b) {
  const int c = static_cast<int>(y) - 16;
  const int d = static_cast<int>(u) - 128;
  const int e = static_cast<int>(v) - 128;
  *r = ClampByte((298 * c + 409 * e + 128) >> 8);
  *g = ClampByte((298 * c - 100 * d - 208 * e + 128) >> 8);
  *b = ClampByte((298 * c + 516 * d + 128) >> 8);
}
#endif

void FlipRgbaHorizontal(std::vector<uint8_t>* rgba, int width, int height) {
  if (!rgba || width <= 1 || height <= 0) {
    return;
  }
  const int stride = width * 4;
  for (int y = 0; y < height; ++y) {
    uint8_t* row = rgba->data() + y * stride;
    for (int x = 0; x < width / 2; ++x) {
      uint8_t* left = row + x * 4;
      uint8_t* right = row + (width - 1 - x) * 4;
      for (int c = 0; c < 4; ++c) {
        std::swap(left[c], right[c]);
      }
    }
  }
}

int IntMax(int a, int b) {
  return a > b ? a : b;
}

int IntMin(int a, int b) {
  return a < b ? a : b;
}

float ClampFloatValue(float value, float min_value, float max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

float ClampNormalized(float value) {
  return ClampFloatValue(value, 0.0f, 1.0f);
}

double NowUnixMs() {
  const auto now = std::chrono::system_clock::now();
  return std::chrono::duration<double, std::milli>(now.time_since_epoch())
      .count();
}

std::string LoadTextFileQuiet(const fs::path& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file.is_open()) return {};
  return std::string((std::istreambuf_iterator<char>(file)),
                     std::istreambuf_iterator<char>());
}

bool ExtractJsonNumber(const std::string& text,
                       const std::string& key,
                       double* value) {
  if (!value) return false;
  const std::string quoted_key = "\"" + key + "\"";
  size_t pos = text.find(quoted_key);
  if (pos == std::string::npos) return false;
  pos = text.find(':', pos + quoted_key.size());
  if (pos == std::string::npos) return false;
  ++pos;
  while (pos < text.size() &&
         (text[pos] == ' ' || text[pos] == '\t' || text[pos] == '\r' ||
          text[pos] == '\n')) {
    ++pos;
  }
  size_t end = pos;
  while (end < text.size() &&
         (std::isdigit(static_cast<unsigned char>(text[end])) ||
          text[end] == '-' || text[end] == '+' || text[end] == '.' ||
          text[end] == 'e' || text[end] == 'E')) {
    ++end;
  }
  if (end == pos) return false;
  try {
    *value = std::stod(text.substr(pos, end - pos));
  } catch (...) {
    return false;
  }
  return true;
}

void WriteLe16(std::ofstream* file, uint16_t value) {
  const char bytes[] = {static_cast<char>(value & 0xff),
                        static_cast<char>((value >> 8) & 0xff)};
  file->write(bytes, sizeof(bytes));
}

void WriteLe32(std::ofstream* file, uint32_t value) {
  const char bytes[] = {static_cast<char>(value & 0xff),
                        static_cast<char>((value >> 8) & 0xff),
                        static_cast<char>((value >> 16) & 0xff),
                        static_cast<char>((value >> 24) & 0xff)};
  file->write(bytes, sizeof(bytes));
}

bool WriteRgbaAsBmp(const std::string& path,
                    const uint8_t* rgba,
                    int width,
                    int height,
                    int max_side) {
  if (!rgba || width <= 0 || height <= 0 || max_side <= 0) {
    return false;
  }

  float scale = static_cast<float>(max_side) /
                static_cast<float>(IntMax(width, height));
  if (scale > 1.0f) {
    scale = 1.0f;
  }
  int out_width = IntMax(1, static_cast<int>(width * scale));
  int out_height = IntMax(1, static_cast<int>(height * scale));
  const int row_stride = ((out_width * 3 + 3) / 4) * 4;
  const int pixel_bytes = row_stride * out_height;
  const int file_bytes = 14 + 40 + pixel_bytes;

  std::ofstream file(path, std::ios::binary);
  if (!file.is_open()) {
    return false;
  }

  file.put('B');
  file.put('M');
  WriteLe32(&file, static_cast<uint32_t>(file_bytes));
  WriteLe16(&file, 0);
  WriteLe16(&file, 0);
  WriteLe32(&file, 14 + 40);
  WriteLe32(&file, 40);
  WriteLe32(&file, static_cast<uint32_t>(out_width));
  WriteLe32(&file, static_cast<uint32_t>(out_height));
  WriteLe16(&file, 1);
  WriteLe16(&file, 24);
  WriteLe32(&file, 0);
  WriteLe32(&file, static_cast<uint32_t>(pixel_bytes));
  WriteLe32(&file, 2835);
  WriteLe32(&file, 2835);
  WriteLe32(&file, 0);
  WriteLe32(&file, 0);

  std::vector<uint8_t> row(row_stride, 0);
  for (int y = out_height - 1; y >= 0; --y) {
    int src_y = IntMin(height - 1,
                       static_cast<int>((static_cast<float>(y) + 0.5f) /
                                        scale));
    for (int x = 0; x < out_width; ++x) {
      int src_x = IntMin(width - 1,
                         static_cast<int>((static_cast<float>(x) + 0.5f) /
                                          scale));
      const uint8_t* src = rgba + (src_y * width + src_x) * 4;
      uint8_t* dst = row.data() + x * 3;
      dst[0] = src[2];
      dst[1] = src[1];
      dst[2] = src[0];
    }
    file.write(reinterpret_cast<const char*>(row.data()), row_stride);
  }

  return file.good();
}

void AppendJpegBytes(void* context, void* data, int size) {
  if (!context || !data || size <= 0) return;
  auto* bytes = static_cast<std::vector<uint8_t>*>(context);
  const auto* src = static_cast<const uint8_t*>(data);
  bytes->insert(bytes->end(), src, src + size);
}

std::vector<uint8_t> EncodeRgbaAsJpeg(const uint8_t* rgba,
                                      int width,
                                      int height,
                                      int max_side,
                                      int quality,
                                      int* out_width,
                                      int* out_height) {
  if (out_width) *out_width = 0;
  if (out_height) *out_height = 0;
  if (!rgba || width <= 0 || height <= 0) return {};

  float scale = static_cast<float>(max_side) /
                static_cast<float>(IntMax(width, height));
  if (scale > 1.0f) scale = 1.0f;
  const int jpg_width = IntMax(1, static_cast<int>(width * scale));
  const int jpg_height = IntMax(1, static_cast<int>(height * scale));
  std::vector<uint8_t> rgb(static_cast<size_t>(jpg_width) * jpg_height * 3);

  for (int y = 0; y < jpg_height; ++y) {
    const int src_y = IntMin(
        height - 1, static_cast<int>((static_cast<float>(y) + 0.5f) / scale));
    for (int x = 0; x < jpg_width; ++x) {
      const int src_x = IntMin(
          width - 1,
          static_cast<int>((static_cast<float>(x) + 0.5f) / scale));
      const uint8_t* src = rgba + (src_y * width + src_x) * 4;
      uint8_t* dst = rgb.data() + (y * jpg_width + x) * 3;
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
    }
  }

  std::vector<uint8_t> jpg;
  stbi_write_jpg_to_func(AppendJpegBytes, &jpg, jpg_width, jpg_height, 3,
                         rgb.data(), quality);
  if (out_width) *out_width = jpg_width;
  if (out_height) *out_height = jpg_height;
  return jpg;
}

class MjpegStreamServer {
 public:
  bool Start(int port) {
#ifdef _WIN32
    if (running_) return true;
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
      std::cerr << "[VideoClient] WSAStartup failed" << std::endl;
      return false;
    }

    listen_socket_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_socket_ == INVALID_SOCKET) {
      std::cerr << "[VideoClient] MJPEG socket creation failed" << std::endl;
      WSACleanup();
      return false;
    }

    BOOL reuse = TRUE;
    setsockopt(listen_socket_, SOL_SOCKET, SO_REUSEADDR,
               reinterpret_cast<const char*>(&reuse), sizeof(reuse));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(static_cast<u_short>(port));
    if (bind(listen_socket_, reinterpret_cast<sockaddr*>(&address),
             sizeof(address)) == SOCKET_ERROR ||
        listen(listen_socket_, SOMAXCONN) == SOCKET_ERROR) {
      std::cerr << "[VideoClient] MJPEG bind/listen failed on 127.0.0.1:"
                << port << std::endl;
      closesocket(listen_socket_);
      listen_socket_ = INVALID_SOCKET;
      WSACleanup();
      return false;
    }

    running_ = true;
    port_ = port;
    accept_thread_ = std::thread([this]() { AcceptLoop(); });
    std::cout << "[VideoClient] MJPEG stream: http://127.0.0.1:" << port
              << "/stream.mjpg" << std::endl;
    return true;
#else
    (void)port;
    return false;
#endif
  }

  void Stop() {
#ifdef _WIN32
    running_ = false;
    frame_cv_.notify_all();
    if (listen_socket_ != INVALID_SOCKET) {
      closesocket(listen_socket_);
      listen_socket_ = INVALID_SOCKET;
    }
    if (accept_thread_.joinable()) {
      accept_thread_.join();
    }
    WSACleanup();
#endif
  }

  void PublishFrame(const uint8_t* rgba, int width, int height) {
#ifdef _WIN32
    if (!running_) return;
    const auto now = std::chrono::steady_clock::now();
    if (last_publish_.time_since_epoch().count() != 0) {
      const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
          now - last_publish_);
      if (elapsed.count() < kMjpegStreamMinIntervalMs) return;
    }

    int jpg_width = 0;
    int jpg_height = 0;
    std::vector<uint8_t> jpg =
        EncodeRgbaAsJpeg(rgba, width, height, kMjpegStreamMaxSide,
                         kMjpegStreamQuality, &jpg_width, &jpg_height);
    if (jpg.empty()) return;

    {
      std::lock_guard<std::mutex> lock(frame_mutex_);
      latest_jpeg_ = std::move(jpg);
      latest_width_ = jpg_width;
      latest_height_ = jpg_height;
      ++latest_seq_;
      last_publish_ = now;
    }
    frame_cv_.notify_all();
#else
    (void)rgba;
    (void)width;
    (void)height;
#endif
  }

 private:
#ifdef _WIN32
  bool SendAll(SOCKET client, const std::string& text) {
    return SendAll(client, reinterpret_cast<const uint8_t*>(text.data()),
                   text.size());
  }

  bool SendAll(SOCKET client, const uint8_t* data, size_t size) {
    size_t sent_total = 0;
    while (sent_total < size) {
      const int sent = send(client,
                            reinterpret_cast<const char*>(data + sent_total),
                            static_cast<int>(size - sent_total), 0);
      if (sent <= 0) return false;
      sent_total += static_cast<size_t>(sent);
    }
    return true;
  }

  void AcceptLoop() {
    while (running_) {
      SOCKET client = accept(listen_socket_, nullptr, nullptr);
      if (client == INVALID_SOCKET) {
        if (running_) std::this_thread::sleep_for(std::chrono::milliseconds(30));
        continue;
      }
      std::thread(&MjpegStreamServer::HandleClient, this, client).detach();
    }
  }

  void HandleClient(SOCKET client) {
    char buffer[1024] = {};
    const int received = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (received <= 0) {
      closesocket(client);
      return;
    }
    const std::string request(buffer, buffer + received);
    if (request.find("GET /health") == 0) {
      std::ostringstream body;
      body << "{\"ok\":true,\"service\":\"gpupixel-mjpeg\",\"port\":"
           << port_ << ",\"seq\":" << latest_seq_ << "}";
      const std::string payload = body.str();
      std::ostringstream headers;
      headers << "HTTP/1.1 200 OK\r\n"
              << "Access-Control-Allow-Origin: *\r\n"
              << "Content-Type: application/json\r\n"
              << "Content-Length: " << payload.size() << "\r\n\r\n";
      SendAll(client, headers.str());
      SendAll(client, payload);
      closesocket(client);
      return;
    }

    if (request.find("GET /latest.jpg") == 0) {
      std::vector<uint8_t> jpg;
      {
        std::lock_guard<std::mutex> lock(frame_mutex_);
        jpg = latest_jpeg_;
      }
      if (jpg.empty()) {
        const std::string payload = "No frame yet.";
        std::ostringstream headers;
        headers << "HTTP/1.1 503 Service Unavailable\r\n"
                << "Access-Control-Allow-Origin: *\r\n"
                << "Content-Type: text/plain\r\n"
                << "Content-Length: " << payload.size() << "\r\n\r\n";
        SendAll(client, headers.str());
        SendAll(client, payload);
      } else {
        std::ostringstream headers;
        headers << "HTTP/1.1 200 OK\r\n"
                << "Access-Control-Allow-Origin: *\r\n"
                << "Cache-Control: no-store\r\n"
                << "Content-Type: image/jpeg\r\n"
                << "Content-Length: " << jpg.size() << "\r\n\r\n";
        SendAll(client, headers.str());
        SendAll(client, jpg.data(), jpg.size());
      }
      closesocket(client);
      return;
    }

    if (request.find("GET /stream.mjpg") != 0 &&
        request.find("GET /") != 0) {
      const std::string payload = "Not found.";
      std::ostringstream headers;
      headers << "HTTP/1.1 404 Not Found\r\n"
              << "Content-Type: text/plain\r\n"
              << "Content-Length: " << payload.size() << "\r\n\r\n";
      SendAll(client, headers.str());
      SendAll(client, payload);
      closesocket(client);
      return;
    }

    SendAll(client,
            "HTTP/1.1 200 OK\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Cache-Control: no-cache, no-store, must-revalidate\r\n"
            "Pragma: no-cache\r\n"
            "Connection: close\r\n"
            "Content-Type: multipart/x-mixed-replace; boundary=gpupixel\r\n\r\n");

    uint64_t seen_seq = 0;
    while (running_) {
      std::vector<uint8_t> jpg;
      uint64_t seq = 0;
      {
        std::unique_lock<std::mutex> lock(frame_mutex_);
        frame_cv_.wait_for(lock, std::chrono::milliseconds(1000), [&]() {
          return !running_ || latest_seq_ != seen_seq;
        });
        if (!running_) break;
        if (latest_seq_ == seen_seq || latest_jpeg_.empty()) continue;
        jpg = latest_jpeg_;
        seq = latest_seq_;
      }
      std::ostringstream part;
      part << "--gpupixel\r\n"
           << "Content-Type: image/jpeg\r\n"
           << "Content-Length: " << jpg.size() << "\r\n\r\n";
      if (!SendAll(client, part.str()) ||
          !SendAll(client, jpg.data(), jpg.size()) ||
          !SendAll(client, "\r\n")) {
        break;
      }
      seen_seq = seq;
    }
    closesocket(client);
  }

  std::atomic<bool> running_{false};
  SOCKET listen_socket_ = INVALID_SOCKET;
  std::thread accept_thread_;
  std::mutex frame_mutex_;
  std::condition_variable frame_cv_;
  std::vector<uint8_t> latest_jpeg_;
  int latest_width_ = 0;
  int latest_height_ = 0;
  uint64_t latest_seq_ = 0;
  int port_ = 0;
  std::chrono::steady_clock::time_point last_publish_;
#endif
};

struct BridgeDiagnostics {
  bool valid = false;
  double cpp_publish_ms = 0.0;
  double js_image_load_ms = 0.0;
  double js_detect_cost_ms = 0.0;
  double js_landmark_interval_ms = 0.0;
  double frame_info_round_trip_ms = 0.0;
  double js_post_start_ms = 0.0;
  double js_detect_end_ms = 0.0;
  double server_receive_ms = 0.0;
  double server_write_ms = 0.0;
  double server_write_cost_ms = 0.0;
  double cpp_read_cost_ms = 0.0;
  double cpp_frame_index = 0.0;
};

class MediaPipeLandmarkBridge {
 public:
  void Init() {
    fs::path exe_dir = GetExecutablePath();
    frame_path_ = exe_dir / "mediapipe_bridge_frame.bmp";
    temp_frame_path_ = exe_dir / "mediapipe_bridge_frame.tmp.bmp";
    frame_meta_path_ = exe_dir / "mediapipe_bridge_frame_meta.json";
    temp_frame_meta_path_ = exe_dir / "mediapipe_bridge_frame_meta.tmp.json";
    landmarks_path_ = exe_dir / "mediapipe_live_landmarks.txt";
    mediapipe_landmarks_path_ = exe_dir / "mediapipe_live_468.txt";
    diagnostics_path_ = exe_dir / "mediapipe_live_meta.json";
    std::error_code ec;
    fs::remove(frame_path_, ec);
    ec.clear();
    fs::remove(temp_frame_path_, ec);
    ec.clear();
    fs::remove(frame_meta_path_, ec);
    ec.clear();
    fs::remove(temp_frame_meta_path_, ec);
    ec.clear();
    fs::remove(landmarks_path_, ec);
    ec.clear();
    fs::remove(mediapipe_landmarks_path_, ec);
    ec.clear();
    fs::remove(diagnostics_path_, ec);
  }

  void MaybePublishFrame(const uint8_t* rgba, int width, int height) {
    ++publish_counter_;
    if (publish_counter_ % kMediaPipeBridgePublishEveryFrames != 0) {
      return;
    }

    if (!WriteRgbaAsBmp(temp_frame_path_.string(), rgba, width, height,
                        kMediaPipeBridgeMaxSide)) {
      return;
    }

    std::error_code ec;
    fs::remove(frame_path_, ec);
    ec.clear();
    fs::rename(temp_frame_path_, frame_path_, ec);
    if (!ec) {
      ++published_frames_;
      WriteFrameMeta();
    }
  }

  bool MaybeLoadLandmarks() {
    const auto read_start = std::chrono::steady_clock::now();
    ++load_counter_;
    if (load_counter_ % kMediaPipeBridgeLoadEveryFrames != 0) {
      return has_live_landmarks_;
    }

    std::vector<float> loaded =
        LoadLandmarksFromTextFile(landmarks_path_.string(), true);
    std::vector<float> loaded_mp =
        LoadLandmarksFromTextFile(mediapipe_landmarks_path_.string(), true);
    std::error_code time_ec;
    const fs::file_time_type mp_write_time =
        fs::last_write_time(mediapipe_landmarks_path_, time_ec);
    const bool has_mp_write_time = !time_ec;
    const bool is_new_mp_file =
        !has_mp_write_time || !has_last_mediapipe_write_time_ ||
        mp_write_time != last_mediapipe_write_time_;
    const bool has_valid_mp =
        loaded_mp.size() >= static_cast<size_t>(kMediaPipePointCount * 2);
    if (loaded.empty() && loaded_mp.empty()) {
      lip_prediction_active_ = false;
      lip_lead_ms_ = 0.0f;
      lip_lead_scale_ = 0.0f;
      LoadDiagnostics(std::chrono::duration<double, std::milli>(
                          std::chrono::steady_clock::now() - read_start)
                          .count());
      return has_live_landmarks_;
    }

    if (!loaded.empty() && smoothed_landmarks_.size() != loaded.size()) {
      smoothed_landmarks_ = loaded;
    } else if (!loaded.empty()) {
      for (size_t i = 0; i < loaded.size(); ++i) {
        smoothed_landmarks_[i] =
            smoothed_landmarks_[i] * kLandmarkSmoothingAlpha +
            loaded[i] * (1.0f - kLandmarkSmoothingAlpha);
      }
    }

    LoadDiagnostics(std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - read_start)
                        .count());

    if (has_valid_mp && is_new_mp_file) {
      UpdateLipLandmarksWithLead(loaded_mp);
      if (has_mp_write_time) {
        last_mediapipe_write_time_ = mp_write_time;
        has_last_mediapipe_write_time_ = true;
      }
    } else if (has_valid_mp) {
      if (raw_mediapipe_landmarks_.empty()) {
        raw_mediapipe_landmarks_ = loaded_mp;
        predicted_lip_mediapipe_landmarks_ = loaded_mp;
      } else {
        predicted_lip_mediapipe_landmarks_ = raw_mediapipe_landmarks_;
      }
      lip_prediction_active_ = false;
      lip_lead_ms_ = 0.0f;
      lip_lead_scale_ = 0.0f;
    }

    if (has_valid_mp &&
        smoothed_mediapipe_landmarks_.size() != loaded_mp.size()) {
      smoothed_mediapipe_landmarks_ = loaded_mp;
    } else if (has_valid_mp) {
      for (size_t i = 0; i < loaded_mp.size(); ++i) {
        smoothed_mediapipe_landmarks_[i] =
            smoothed_mediapipe_landmarks_[i] * kLandmarkSmoothingAlpha +
            loaded_mp[i] * (1.0f - kLandmarkSmoothingAlpha);
      }
    }

    has_live_landmarks_ = !smoothed_landmarks_.empty();
    has_mediapipe_landmarks_ =
        smoothed_mediapipe_landmarks_.size() >=
        static_cast<size_t>(kMediaPipePointCount * 2);
    has_raw_mediapipe_landmarks_ =
        raw_mediapipe_landmarks_.size() >=
        static_cast<size_t>(kMediaPipePointCount * 2);
    LoadDiagnostics(std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - read_start)
                        .count());
    return true;
  }

  const std::vector<float>& landmarks() const { return smoothed_landmarks_; }
  const std::vector<float>& mediapipe_landmarks() const {
    return smoothed_mediapipe_landmarks_;
  }
  const std::vector<float>& lip_mediapipe_landmarks() const {
    return predicted_lip_mediapipe_landmarks_.size() >=
                   static_cast<size_t>(kMediaPipePointCount * 2)
               ? predicted_lip_mediapipe_landmarks_
               : (has_raw_mediapipe_landmarks_ ? raw_mediapipe_landmarks_
                                                : smoothed_mediapipe_landmarks_);
  }
  bool has_live_landmarks() const { return has_live_landmarks_; }
  bool has_mediapipe_landmarks() const { return has_mediapipe_landmarks_; }
  bool has_raw_mediapipe_landmarks() const {
    return has_raw_mediapipe_landmarks_;
  }
  bool has_lip_prediction() const { return lip_prediction_active_; }
  float lip_lead_ms() const { return lip_lead_ms_; }
  float lip_lead_scale() const { return lip_lead_scale_; }
  float lip_pred_gap_norm() const { return lip_pred_gap_norm_; }
  const std::vector<float>& raw_lip_mediapipe_landmarks() const {
    return has_raw_mediapipe_landmarks_ ? raw_mediapipe_landmarks_
                                        : smoothed_mediapipe_landmarks_;
  }
  const BridgeDiagnostics& diagnostics() const { return diagnostics_; }
  int published_frames() const { return published_frames_; }
  std::string frame_path() const { return frame_path_.string(); }
  std::string landmarks_path() const { return landmarks_path_.string(); }

 private:
  void WriteFrameMeta() {
    std::ofstream file(temp_frame_meta_path_.string(), std::ios::binary);
    if (!file.is_open()) return;
    file << std::fixed << std::setprecision(3);
    file << "{\"cppPublishMs\":" << NowUnixMs()
         << ",\"frameIndex\":" << published_frames_ << "}";
    file.close();
    std::error_code ec;
    fs::remove(frame_meta_path_, ec);
    ec.clear();
    fs::rename(temp_frame_meta_path_, frame_meta_path_, ec);
  }

  void LoadDiagnostics(double cpp_read_cost_ms) {
    const std::string text = LoadTextFileQuiet(diagnostics_path_);
    if (text.empty()) return;

    BridgeDiagnostics next;
    next.valid = true;
    ExtractJsonNumber(text, "cppPublishMs", &next.cpp_publish_ms);
    ExtractJsonNumber(text, "cppFrameIndex", &next.cpp_frame_index);
    ExtractJsonNumber(text, "frameInfoRoundTripMs",
                      &next.frame_info_round_trip_ms);
    ExtractJsonNumber(text, "jsImageLoadMs", &next.js_image_load_ms);
    ExtractJsonNumber(text, "jsDetectCostMs", &next.js_detect_cost_ms);
    ExtractJsonNumber(text, "jsDetectEndMs", &next.js_detect_end_ms);
    ExtractJsonNumber(text, "jsPostStartMs", &next.js_post_start_ms);
    ExtractJsonNumber(text, "jsLandmarkIntervalMs",
                      &next.js_landmark_interval_ms);
    ExtractJsonNumber(text, "serverReceiveMs", &next.server_receive_ms);
    ExtractJsonNumber(text, "serverWriteMs", &next.server_write_ms);
    ExtractJsonNumber(text, "serverWriteCostMs", &next.server_write_cost_ms);
    next.cpp_read_cost_ms = cpp_read_cost_ms;
    diagnostics_ = next;
  }

  void UpdateLipLandmarksWithLead(const std::vector<float>& loaded_mp) {
    const bool can_predict =
        raw_mediapipe_landmarks_.size() == loaded_mp.size();
    predicted_lip_mediapipe_landmarks_ = loaded_mp;
    lip_prediction_active_ = false;
    lip_lead_ms_ = 0.0f;
    lip_lead_scale_ = 0.0f;
    lip_pred_gap_norm_ = 0.0f;

    if (can_predict && diagnostics_.valid) {
      const double now_ms = NowUnixMs();
      // v19: prefer landmark age (detect end) over frame age. Frame age
      // includes the camera->bridge transport leg and tends to over-estimate
      // how stale the lip points are, which caused v18 to over-compensate.
      double point_age_ms = diagnostics_.js_detect_end_ms > 0.0
                                ? now_ms - diagnostics_.js_detect_end_ms
                                : 0.0;
      if (point_age_ms <= 0.0 || point_age_ms > 500.0) {
        point_age_ms = diagnostics_.cpp_publish_ms > 0.0
                           ? now_ms - diagnostics_.cpp_publish_ms
                           : 0.0;
      }

      const double interval_ms = diagnostics_.js_landmark_interval_ms;
      const double landmark_fps = interval_ms > 1.0 ? 1000.0 / interval_ms : 0.0;
      const bool can_age_lead =
          point_age_ms > 0.0 && point_age_ms <= 220.0 && interval_ms >= 20.0 &&
          interval_ms <= 160.0 && landmark_fps >= kLipLeadMinFps;

      if (can_age_lead) {
        lip_lead_ms_ = static_cast<float>(
            ClampFloatValue(static_cast<float>(point_age_ms), 0.0f,
                            kLipLeadMaxAgeMs));
        lip_lead_scale_ = ClampFloatValue(
            static_cast<float>(lip_lead_ms_ / interval_ms) * kLipLeadStrength,
            0.0f, kLipLeadMaxScale);
      }
    }

    if (can_predict && lip_lead_scale_ > 0.0f) {
      // Decompose lip motion: mouth-center translation vs per-point shape
      // change. Translation is the dominant, low-noise "follow the mouth"
      // signal and gets the full age-based lead; deformation is noisy
      // (jitter + head motion mixed in) and only gets a small, fixed lead.
      double cur_cx = 0.0, cur_cy = 0.0, prev_cx = 0.0, prev_cy = 0.0;
      int center_count = 0;
      for (int index : kLipPredictionIndices) {
        const size_t x = static_cast<size_t>(index) * 2;
        const size_t y = x + 1;
        if (y >= loaded_mp.size()) continue;
        cur_cx += loaded_mp[x];
        cur_cy += loaded_mp[y];
        prev_cx += raw_mediapipe_landmarks_[x];
        prev_cy += raw_mediapipe_landmarks_[y];
        ++center_count;
      }

      if (center_count > 0) {
        const float inv = 1.0f / static_cast<float>(center_count);
        cur_cx *= inv;
        cur_cy *= inv;
        prev_cx *= inv;
        prev_cy *= inv;

        const float center_dx = ClampFloatValue(
            static_cast<float>(cur_cx - prev_cx) * lip_lead_scale_,
            -kLipCenterMaxDelta, kLipCenterMaxDelta);
        const float center_dy = ClampFloatValue(
            static_cast<float>(cur_cy - prev_cy) * lip_lead_scale_,
            -kLipCenterMaxDelta, kLipCenterMaxDelta);

        double gap_sum = 0.0;
        int gap_count = 0;
        for (int index : kLipPredictionIndices) {
          const size_t x = static_cast<size_t>(index) * 2;
          const size_t y = x + 1;
          if (y >= loaded_mp.size()) continue;

          // Shape velocity = change of point position relative to the mouth
          // center, so the overall translation is removed before applying the
          // weak deformation lead.
          const float shape_vx = (loaded_mp[x] - static_cast<float>(cur_cx)) -
                                 (raw_mediapipe_landmarks_[x] -
                                  static_cast<float>(prev_cx));
          const float shape_vy = (loaded_mp[y] - static_cast<float>(cur_cy)) -
                                 (raw_mediapipe_landmarks_[y] -
                                  static_cast<float>(prev_cy));
          const float shape_dx = ClampFloatValue(
              shape_vx * kLipShapeLeadScale, -kLipShapeMaxDelta,
              kLipShapeMaxDelta);
          const float shape_dy = ClampFloatValue(
              shape_vy * kLipShapeLeadScale, -kLipShapeMaxDelta,
              kLipShapeMaxDelta);

          const float dx = center_dx + shape_dx;
          const float dy = center_dy + shape_dy;
          predicted_lip_mediapipe_landmarks_[x] =
              ClampNormalized(loaded_mp[x] + dx);
          predicted_lip_mediapipe_landmarks_[y] =
              ClampNormalized(loaded_mp[y] + dy);
          gap_sum += std::sqrt(static_cast<double>(dx) * dx +
                               static_cast<double>(dy) * dy);
          ++gap_count;
          if (std::abs(dx) > 0.00001f || std::abs(dy) > 0.00001f) {
            lip_prediction_active_ = true;
          }
        }
        if (gap_count > 0) {
          lip_pred_gap_norm_ =
              static_cast<float>(gap_sum / static_cast<double>(gap_count));
        }
      }
    }

    raw_mediapipe_landmarks_ = loaded_mp;
    if (!lip_prediction_active_) {
      predicted_lip_mediapipe_landmarks_ = raw_mediapipe_landmarks_;
      lip_pred_gap_norm_ = 0.0f;
    }
  }

  fs::path frame_path_;
  fs::path temp_frame_path_;
  fs::path frame_meta_path_;
  fs::path temp_frame_meta_path_;
  fs::path landmarks_path_;
  fs::path mediapipe_landmarks_path_;
  fs::path diagnostics_path_;
  fs::file_time_type last_mediapipe_write_time_;
  int publish_counter_ = 0;
  int load_counter_ = 0;
  int published_frames_ = 0;
  bool has_last_mediapipe_write_time_ = false;
  bool has_live_landmarks_ = false;
  bool has_mediapipe_landmarks_ = false;
  bool has_raw_mediapipe_landmarks_ = false;
  bool lip_prediction_active_ = false;
  float lip_lead_ms_ = 0.0f;
  float lip_lead_scale_ = 0.0f;
  float lip_pred_gap_norm_ = 0.0f;
  BridgeDiagnostics diagnostics_;
  std::vector<float> smoothed_landmarks_;
  std::vector<float> smoothed_mediapipe_landmarks_;
  std::vector<float> raw_mediapipe_landmarks_;
  std::vector<float> predicted_lip_mediapipe_landmarks_;
};

class CameraCapture {
 public:
  ~CameraCapture() { Shutdown(); }

  bool Init(int desired_width, int desired_height) {
#ifndef _WIN32
    std::cerr << "[VideoClient] CameraCapture is Windows-only in this demo"
              << std::endl;
    return false;
#else
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    com_initialized_ = SUCCEEDED(hr);

    hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) {
      std::cerr << "[VideoClient] MFStartup failed: 0x" << std::hex << hr
                << std::dec << std::endl;
      return false;
    }
    mf_started_ = true;

    ComPtr<IMFAttributes> attributes;
    hr = MFCreateAttributes(attributes.Put(), 1);
    if (FAILED(hr)) {
      return false;
    }
    attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);

    IMFActivate** devices = nullptr;
    UINT32 count = 0;
    hr = MFEnumDeviceSources(attributes.Get(), &devices, &count);
    if (FAILED(hr) || count == 0) {
      std::cerr << "[VideoClient] No camera device found" << std::endl;
      return false;
    }

    hr = devices[0]->ActivateObject(IID_PPV_ARGS(media_source_.Put()));
    for (UINT32 i = 0; i < count; ++i) {
      devices[i]->Release();
    }
    CoTaskMemFree(devices);
    if (FAILED(hr)) {
      std::cerr << "[VideoClient] Activate camera failed: 0x" << std::hex << hr
                << std::dec << std::endl;
      return false;
    }

    ComPtr<IMFAttributes> reader_attributes;
    hr = MFCreateAttributes(reader_attributes.Put(), 2);
    if (FAILED(hr)) {
      return false;
    }
    reader_attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING,
                                 TRUE);

    hr = MFCreateSourceReaderFromMediaSource(media_source_.Get(),
                                             reader_attributes.Get(),
                                             reader_.Put());
    if (FAILED(hr)) {
      std::cerr << "[VideoClient] Create SourceReader failed: 0x" << std::hex
                << hr << std::dec << std::endl;
      return false;
    }

    if (!SetBestCameraFormat(desired_width, desired_height)) {
      ComPtr<IMFMediaType> type;
      MFCreateMediaType(type.Put());
      type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
      type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
      type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
      MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, desired_width,
                         desired_height);
      MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, 30, 1);
      MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
      reader_->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                   nullptr, type.Get());
    }

    ComPtr<IMFMediaType> current_type;
    hr = reader_->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                      current_type.Put());
    if (FAILED(hr)) {
      return false;
    }

    UINT32 actual_width = 0;
    UINT32 actual_height = 0;
    MFGetAttributeSize(current_type.Get(), MF_MT_FRAME_SIZE, &actual_width,
                       &actual_height);
    current_type->GetGUID(MF_MT_SUBTYPE, &subtype_);
    width_ = static_cast<int>(actual_width);
    height_ = static_cast<int>(actual_height);
    if (width_ <= 0 || height_ <= 0) {
      width_ = desired_width;
      height_ = desired_height;
    }
    frame_rgba_.resize(static_cast<size_t>(width_) * height_ * 4);
    std::cout << "[VideoClient] Camera opened: " << width_ << "x" << height_
              << " " << GuidName(subtype_) << std::endl;
    return true;
#endif
  }

  bool SetBestCameraFormat(int desired_width, int desired_height) {
#ifndef _WIN32
    return false;
#else
    int best_score = std::numeric_limits<int>::max();
    DWORD best_index = 0;
    bool found = false;

    for (DWORD index = 0;; ++index) {
      ComPtr<IMFMediaType> native_type;
      HRESULT hr = reader_->GetNativeMediaType(
          MF_SOURCE_READER_FIRST_VIDEO_STREAM, index, native_type.Put());
      if (hr == MF_E_NO_MORE_TYPES) {
        break;
      }
      if (FAILED(hr) || !native_type) {
        continue;
      }

      GUID subtype = GUID_NULL;
      native_type->GetGUID(MF_MT_SUBTYPE, &subtype);
      if (!IsSupportedCameraSubtype(subtype)) {
        continue;
      }

      UINT32 width = 0;
      UINT32 height = 0;
      MFGetAttributeSize(native_type.Get(), MF_MT_FRAME_SIZE, &width, &height);
      if (width == 0 || height == 0) {
        continue;
      }

      const int subtype_penalty =
          subtype == MFVideoFormat_NV12
              ? 0
              : subtype == MFVideoFormat_YUY2
                    ? 100000
                    : subtype == MFVideoFormat_RGB32 ? 200000 : 300000;
      const int score =
          std::abs(static_cast<int>(width) - desired_width) +
          std::abs(static_cast<int>(height) - desired_height) +
          subtype_penalty;
      if (score < best_score) {
        best_score = score;
        best_index = index;
        found = true;
      }
    }

    if (!found) {
      return false;
    }

    ComPtr<IMFMediaType> best_type;
    HRESULT hr = reader_->GetNativeMediaType(
        MF_SOURCE_READER_FIRST_VIDEO_STREAM, best_index, best_type.Put());
    if (FAILED(hr) || !best_type) {
      return false;
    }
    hr = reader_->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                      nullptr, best_type.Get());
    if (FAILED(hr)) {
      return false;
    }
    return true;
#endif
  }

  bool ReadFrame(std::vector<uint8_t>* rgba, int* width, int* height) {
#ifndef _WIN32
    return false;
#else
    if (!reader_) {
      return false;
    }

    DWORD stream_index = 0;
    DWORD flags = 0;
    LONGLONG timestamp = 0;
    ComPtr<IMFSample> sample;
    HRESULT hr = reader_->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0,
                                     &stream_index, &flags, &timestamp,
                                     sample.Put());
    if (FAILED(hr) || !sample || (flags & MF_SOURCE_READERF_STREAMTICK)) {
      return false;
    }

    ComPtr<IMFMediaBuffer> buffer;
    hr = sample->ConvertToContiguousBuffer(buffer.Put());
    if (FAILED(hr)) {
      return false;
    }

    const int pixel_count = width_ * height_;
    if (static_cast<int>(frame_rgba_.size()) < pixel_count * 4) {
      frame_rgba_.resize(static_cast<size_t>(pixel_count) * 4);
    }

    if (subtype_ == MFVideoFormat_NV12 || subtype_ == MFVideoFormat_YUY2) {
      BYTE* data = nullptr;
      DWORD max_length = 0;
      DWORD current_length = 0;
      hr = buffer->Lock(&data, &max_length, &current_length);
      if (FAILED(hr)) {
        return false;
      }

      if (subtype_ == MFVideoFormat_NV12) {
        const DWORD required_length =
            static_cast<DWORD>(width_ * height_ * 3 / 2);
        if (current_length < required_length) {
          buffer->Unlock();
          return false;
        }
        const uint8_t* y_plane = data;
        const uint8_t* uv_plane = data + width_ * height_;
        for (int y = 0; y < height_; ++y) {
          uint8_t* dst_row = frame_rgba_.data() + y * width_ * 4;
          const uint8_t* y_row = y_plane + y * width_;
          const uint8_t* uv_row = uv_plane + (y / 2) * width_;
          for (int x = 0; x < width_; ++x) {
            uint8_t r = 0;
            uint8_t g = 0;
            uint8_t b = 0;
            const uint8_t u = uv_row[(x / 2) * 2 + 0];
            const uint8_t v = uv_row[(x / 2) * 2 + 1];
            YuvToRgb(y_row[x], u, v, &r, &g, &b);
            dst_row[x * 4 + 0] = r;
            dst_row[x * 4 + 1] = g;
            dst_row[x * 4 + 2] = b;
            dst_row[x * 4 + 3] = 255;
          }
        }
      } else {
        const DWORD required_length = static_cast<DWORD>(width_ * height_ * 2);
        if (current_length < required_length) {
          buffer->Unlock();
          return false;
        }
        for (int y = 0; y < height_; ++y) {
          const uint8_t* src_row = data + y * width_ * 2;
          uint8_t* dst_row = frame_rgba_.data() + y * width_ * 4;
          for (int x = 0; x < width_; x += 2) {
            const uint8_t y0 = src_row[x * 2 + 0];
            const uint8_t u = src_row[x * 2 + 1];
            const uint8_t y1 = src_row[x * 2 + 2];
            const uint8_t v = src_row[x * 2 + 3];
            uint8_t r = 0;
            uint8_t g = 0;
            uint8_t b = 0;
            YuvToRgb(y0, u, v, &r, &g, &b);
            dst_row[x * 4 + 0] = r;
            dst_row[x * 4 + 1] = g;
            dst_row[x * 4 + 2] = b;
            dst_row[x * 4 + 3] = 255;
            YuvToRgb(y1, u, v, &r, &g, &b);
            dst_row[(x + 1) * 4 + 0] = r;
            dst_row[(x + 1) * 4 + 1] = g;
            dst_row[(x + 1) * 4 + 2] = b;
            dst_row[(x + 1) * 4 + 3] = 255;
          }
        }
      }

      buffer->Unlock();
      if (kCorrectCameraMirror) {
        FlipRgbaHorizontal(&frame_rgba_, width_, height_);
      }
      *rgba = frame_rgba_;
      *width = width_;
      *height = height_;
      return true;
    }

    if (subtype_ != MFVideoFormat_RGB32 && subtype_ != MFVideoFormat_ARGB32) {
      static bool warned = false;
      if (!warned) {
        std::cerr << "[VideoClient] Unsupported camera subtype: "
                  << GuidName(subtype_) << std::endl;
        warned = true;
      }
      return false;
    }

    ComPtr<IMF2DBuffer> buffer_2d;
    hr = buffer->QueryInterface(IID_PPV_ARGS(buffer_2d.Put()));
    if (SUCCEEDED(hr) && buffer_2d) {
      BYTE* scanline = nullptr;
      LONG pitch = 0;
      hr = buffer_2d->Lock2D(&scanline, &pitch);
      if (FAILED(hr)) {
        return false;
      }
      for (int y = 0; y < height_; ++y) {
        const BYTE* src_row =
            pitch >= 0 ? scanline + y * pitch
                       : scanline + (height_ - 1 - y) * (-pitch);
        uint8_t* dst_row = frame_rgba_.data() + y * width_ * 4;
        for (int x = 0; x < width_; ++x) {
          dst_row[x * 4 + 0] = src_row[x * 4 + 2];
          dst_row[x * 4 + 1] = src_row[x * 4 + 1];
          dst_row[x * 4 + 2] = src_row[x * 4 + 0];
          dst_row[x * 4 + 3] = 255;
        }
      }
      buffer_2d->Unlock2D();
    } else {
      BYTE* data = nullptr;
      DWORD max_length = 0;
      DWORD current_length = 0;
      hr = buffer->Lock(&data, &max_length, &current_length);
      if (FAILED(hr)) {
        return false;
      }
      const int available_pixels = static_cast<int>(current_length / 4);
      const int pixels_to_copy =
          pixel_count < available_pixels ? pixel_count : available_pixels;
      for (int i = 0; i < pixels_to_copy; ++i) {
        const uint8_t b = data[i * 4 + 0];
        const uint8_t g = data[i * 4 + 1];
        const uint8_t r = data[i * 4 + 2];
        frame_rgba_[i * 4 + 0] = r;
        frame_rgba_[i * 4 + 1] = g;
        frame_rgba_[i * 4 + 2] = b;
        frame_rgba_[i * 4 + 3] = 255;
      }
      buffer->Unlock();
    }

    if (kCorrectCameraMirror) {
      FlipRgbaHorizontal(&frame_rgba_, width_, height_);
    }
    *rgba = frame_rgba_;
    *width = width_;
    *height = height_;
    return true;
#endif
  }

  void Shutdown() {
#ifdef _WIN32
    reader_.Reset();
    if (media_source_) {
      media_source_->Shutdown();
      media_source_.Reset();
    }
    if (mf_started_) {
      MFShutdown();
      mf_started_ = false;
    }
    if (com_initialized_) {
      CoUninitialize();
      com_initialized_ = false;
    }
#endif
  }

 private:
  int width_ = 0;
  int height_ = 0;
  std::vector<uint8_t> frame_rgba_;
#ifdef _WIN32
  bool mf_started_ = false;
  bool com_initialized_ = false;
  GUID subtype_ = MFVideoFormat_RGB32;
  ComPtr<IMFMediaSource> media_source_;
  ComPtr<IMFSourceReader> reader_;
#endif
};

class ScreenRenderer {
 public:
  bool Init() {
    const char* vertex_shader_source = R"(
      #version 130
      attribute vec3 aPos;
      attribute vec2 aTexCoord;
      varying vec2 TexCoord;
      void main() {
        gl_Position = vec4(aPos, 1.0);
        TexCoord = aTexCoord;
      }
    )";

    const char* fragment_shader_source = R"(
      #version 130
      varying vec2 TexCoord;
      uniform sampler2D texture1;
      void main() {
        gl_FragColor = texture2D(texture1, TexCoord);
      }
    )";

    GLuint vertex_shader = glCreateShader(GL_VERTEX_SHADER);
    glShaderSource(vertex_shader, 1, &vertex_shader_source, nullptr);
    glCompileShader(vertex_shader);
    if (!CheckShader(vertex_shader, "vertex")) {
      return false;
    }

    GLuint fragment_shader = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(fragment_shader, 1, &fragment_shader_source, nullptr);
    glCompileShader(fragment_shader);
    if (!CheckShader(fragment_shader, "fragment")) {
      return false;
    }

    program_ = glCreateProgram();
    glAttachShader(program_, vertex_shader);
    glAttachShader(program_, fragment_shader);
    glLinkProgram(program_);
    bool ok = CheckShader(program_, "program", true);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    if (!ok) {
      return false;
    }

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    glGenVertexArrays(1, &vao_);
    glGenBuffers(1, &vbo_);
    glGenBuffers(1, &ebo_);
    position_location_ = glGetAttribLocation(program_, "aPos");
    tex_coord_location_ = glGetAttribLocation(program_, "aTexCoord");
    return true;
  }

  void Render(const uint8_t* rgba,
              int image_width,
              int image_height,
              int view_width,
              int view_height) {
    if (!rgba || image_width <= 0 || image_height <= 0) {
      return;
    }

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, view_width, view_height);
    glClearColor(0.06f, 0.07f, 0.07f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glUseProgram(program_);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, image_width, image_height, 0,
                 GL_RGBA, GL_UNSIGNED_BYTE, rgba);

    const float image_aspect = static_cast<float>(image_width) / image_height;
    const float view_aspect = static_cast<float>(view_width) / view_height;
    float scale_x = 1.0f;
    float scale_y = 1.0f;
    if (image_aspect > view_aspect) {
      scale_y = view_aspect / image_aspect;
    } else {
      scale_x = image_aspect / view_aspect;
    }

    float vertices[] = {
        -scale_x, -scale_y, 0.0f, 0.0f, 1.0f,
        scale_x,  -scale_y, 0.0f, 1.0f, 1.0f,
        scale_x,  scale_y,  0.0f, 1.0f, 0.0f,
        -scale_x, scale_y,  0.0f, 0.0f, 0.0f,
    };
    unsigned int indices[] = {0, 1, 2, 2, 3, 0};

    glBindVertexArray(vao_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices,
                 GL_STATIC_DRAW);
    glVertexAttribPointer(position_location_, 3, GL_FLOAT, GL_FALSE,
                          5 * sizeof(float), reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(position_location_);
    glVertexAttribPointer(tex_coord_location_, 2, GL_FLOAT, GL_FALSE,
                          5 * sizeof(float),
                          reinterpret_cast<void*>(3 * sizeof(float)));
    glEnableVertexAttribArray(tex_coord_location_);
    glUniform1i(glGetUniformLocation(program_, "texture1"), 0);
    glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);
  }

  void Shutdown() {
    if (ebo_) {
      glDeleteBuffers(1, &ebo_);
      ebo_ = 0;
    }
    if (vbo_) {
      glDeleteBuffers(1, &vbo_);
      vbo_ = 0;
    }
    if (vao_) {
      glDeleteVertexArrays(1, &vao_);
      vao_ = 0;
    }
    if (texture_) {
      glDeleteTextures(1, &texture_);
      texture_ = 0;
    }
    if (program_) {
      glDeleteProgram(program_);
      program_ = 0;
    }
  }

 private:
  GLuint program_ = 0;
  GLuint texture_ = 0;
  GLuint vao_ = 0;
  GLuint vbo_ = 0;
  GLuint ebo_ = 0;
  GLint position_location_ = 0;
  GLint tex_coord_location_ = 1;
};

struct BeautyState {
  float smoothing = 4.0f;
  float whitening = 2.0f;
  float face_slim = 0.0f;
  float eye_enlarge = 0.0f;
  float mouth_resize = 0.0f;
  float nose_resize = 0.0f;
  float lipstick = 0.0f;
  float eyebrow = 0.0f;
  float blusher = 0.0f;
  bool lip_debug = false;
};

void ApplyLiveParamsFromFile(const fs::path& params_path, BeautyState* state) {
  if (!state || params_path.empty() || !fs::exists(params_path)) {
    return;
  }
  const std::string text = LoadTextFileQuiet(params_path);
  if (text.empty()) {
    return;
  }
  double value = 0.0;
  if (ExtractJsonNumber(text, "smoothing", &value)) {
    state->smoothing = ClampFloatValue(static_cast<float>(value), 0.0f, 10.0f);
  }
  if (ExtractJsonNumber(text, "whitening", &value) ||
      ExtractJsonNumber(text, "brighten", &value)) {
    state->whitening = ClampFloatValue(static_cast<float>(value), 0.0f, 10.0f);
  }
  if (ExtractJsonNumber(text, "faceSlim", &value) ||
      ExtractJsonNumber(text, "face_slim", &value)) {
    state->face_slim =
        ClampFloatValue(static_cast<float>(value), 0.0f, kFaceSlimUiMax);
  }
  if (ExtractJsonNumber(text, "eyeEnlarge", &value) ||
      ExtractJsonNumber(text, "eye_enlarge", &value)) {
    state->eye_enlarge =
        ClampFloatValue(static_cast<float>(value), 0.0f, kEyeEnlargeUiMax);
  }
  if (ExtractJsonNumber(text, "mouthResize", &value) ||
      ExtractJsonNumber(text, "mouth_resize", &value)) {
    state->mouth_resize = ClampFloatValue(static_cast<float>(value),
                                          -kMouthResizeUiMax,
                                          kMouthResizeUiMax);
  }
  if (ExtractJsonNumber(text, "noseResize", &value) ||
      ExtractJsonNumber(text, "nose_resize", &value)) {
    state->nose_resize = ClampFloatValue(static_cast<float>(value),
                                         -kNoseResizeUiMax,
                                         kNoseResizeUiMax);
  }
  if (ExtractJsonNumber(text, "lipstick", &value)) {
    state->lipstick = ClampFloatValue(static_cast<float>(value), 0.0f, 10.0f);
  }
  if (ExtractJsonNumber(text, "eyebrow", &value)) {
    state->eyebrow = ClampFloatValue(static_cast<float>(value), 0.0f, 10.0f);
  }
  if (ExtractJsonNumber(text, "blusher", &value) ||
      ExtractJsonNumber(text, "blush", &value)) {
    state->blusher = ClampFloatValue(static_cast<float>(value), 0.0f, 10.0f);
  }
}

struct GPUPixelPipeline {
  std::shared_ptr<SourceRawData> source;
  std::shared_ptr<LipstickFilter> lipstick;
  std::shared_ptr<BlusherFilter> blusher;
  std::shared_ptr<FaceReshapeFilter> reshape;
  std::shared_ptr<BeautyFaceFilter> beauty;
  std::shared_ptr<SinkRawData> sink;
  std::vector<float> landmarks;

  bool Init(const std::string& landmarks_path) {
    auto resource_path = fs::path(GetExecutablePath()).parent_path();
    std::cout << "[VideoClient] Resource path: " << resource_path << std::endl;
    GPUPixel::SetResourcePath(resource_path.string());

    source = SourceRawData::Create();
    lipstick = LipstickFilter::Create();
    blusher = BlusherFilter::Create();
    reshape = FaceReshapeFilter::Create();
    beauty = BeautyFaceFilter::Create();
    sink = SinkRawData::Create();

    if (!source || !lipstick || !blusher || !reshape || !beauty || !sink) {
      std::cerr << "[VideoClient] Failed to create GPUPixel pipeline"
                << std::endl;
      return false;
    }

    source->AddSink(lipstick)
        ->AddSink(blusher)
        ->AddSink(reshape)
        ->AddSink(beauty)
        ->AddSink(sink);

    landmarks = LoadLandmarksFromTextFile(ResolveInputPath(landmarks_path));
    return true;
  }

  void SetLiveLandmarks(const std::vector<float>& live_landmarks) {
    if (!live_landmarks.empty()) {
      landmarks = live_landmarks;
    }
  }

  void ApplyState(const BeautyState& state) {
    beauty->SetBlurAlpha(state.smoothing / 10.0f);
    beauty->SetWhite(state.whitening / 20.0f);
    reshape->SetFaceSlimLevel(state.face_slim / 200.0f *
                              kFaceSlimStrengthScale);
    reshape->SetEyeZoomLevel(state.eye_enlarge / 100.0f *
                             kEyeEnlargeStrengthScale);
    reshape->SetMouthResizeLevel(state.mouth_resize * kMouthResizeStrength);
    reshape->SetNoseResizeLevel(state.nose_resize * kNoseResizeStrength);
    // Lipstick is applied by the dedicated MP468 lip renderer before GPUPixel.
    lipstick->SetBlendLevel(0.0f);
    blusher->SetBlendLevel(state.blusher / 10.0f);

    if (!landmarks.empty()) {
      lipstick->SetFaceLandmarks(landmarks);
      blusher->SetFaceLandmarks(landmarks);
      reshape->SetFaceLandmarks(landmarks);
    }
  }

  const uint8_t* Process(const uint8_t* rgba,
                         int width,
                         int height,
                         const BeautyState& state,
                         int* output_width,
                         int* output_height) {
    ApplyState(state);
    source->ProcessData(rgba, width, height, width * 4,
                        GPUPIXEL_FRAME_TYPE_RGBA);
    const uint8_t* output = sink->GetRgbaBuffer();
    *output_width = sink->GetWidth();
    *output_height = sink->GetHeight();
    return output;
  }
};

GLFWwindow* main_window = nullptr;

void OnFramebufferResize(GLFWwindow*, int width, int height) {
  glViewport(0, 0, width, height);
}

void ErrorCallback(int, const char* description) {
  std::cerr << "[VideoClient] GLFW error: " << description << std::endl;
}

bool SetupWindow() {
  glfwSetErrorCallback(ErrorCallback);
  if (!glfwInit()) {
    std::cerr << "[VideoClient] Failed to initialize GLFW" << std::endl;
    return false;
  }
  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
  glfwWindowHint(GLFW_VISIBLE, GLFW_TRUE);

  main_window = glfwCreateWindow(kWindowWidth, kWindowHeight,
                                 "GPUPixel Video Client MVP", nullptr,
                                 nullptr);
  if (!main_window) {
    std::cerr << "[VideoClient] Failed to create window" << std::endl;
    glfwTerminate();
    return false;
  }
  glfwMakeContextCurrent(main_window);
  glfwSwapInterval(1);
  if (!gladLoadGLLoader(reinterpret_cast<GLADloadproc>(glfwGetProcAddress))) {
    std::cerr << "[VideoClient] Failed to initialize GLAD" << std::endl;
    glfwDestroyWindow(main_window);
    glfwTerminate();
    return false;
  }
  glfwSetFramebufferSizeCallback(main_window, OnFramebufferResize);
  return true;
}

void SetupImGui() {
  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
  ImGui::StyleColorsDark();
  // Enlarge the control panel: scale font and all widget metrics so the
  // sliders/checkboxes are easier to read and drag.
  io.FontGlobalScale = kUiScale;
  ImGui::GetStyle().ScaleAllSizes(kUiScale);
  ImGui_ImplGlfw_InitForOpenGL(main_window, true);
  ImGui_ImplOpenGL3_Init("#version 130");
}

void DrawControlPanel(BeautyState* state,
                      float fps,
                      bool has_frame,
                      bool has_landmarks,
                      bool has_live_landmarks,
                      bool has_raw_lip_landmarks,
                      bool has_lip_prediction,
                      float lip_lead_ms,
                      float lip_lead_scale,
                      float lip_pred_gap_norm,
                      const BridgeDiagnostics& diagnostics,
                      int published_bridge_frames,
                      int frame_width,
                      int frame_height) {
  ImGui::SetNextWindowPos(ImVec2(16, 16), ImGuiCond_FirstUseEver);
  ImGui::Begin("GPUPixel Video Client", nullptr,
               ImGuiWindowFlags_AlwaysAutoResize);
  ImGui::PushItemWidth(260.0f * kUiScale);
  ImGui::Text("Build: %s", kClientVersion);
  if (has_frame) {
    ImGui::Text("Camera: %dx%d", frame_width, frame_height);
  } else {
    ImGui::Text("Camera: waiting for frame");
  }
  ImGui::Text("Output FPS: %.1f", fps);
  if (has_live_landmarks) {
    ImGui::Text("Landmarks: MediaPipe bridge live");
  } else {
    ImGui::Text("Landmarks: %s", has_landmarks ? "file loaded"
                                               : "waiting for bridge/file");
  }
  ImGui::Text("Lip mode: MP468 live");
  if (has_raw_lip_landmarks && has_lip_prediction) {
    const float gap_px =
        lip_pred_gap_norm * static_cast<float>(frame_width > 0 ? frame_width : 0);
    ImGui::Text("Lip landmarks: live/raw + center lead %.0fms x%.2f",
                lip_lead_ms, lip_lead_scale);
    ImGui::Text("Lip pred gap: %.1f px (avg raw->pred)", gap_px);
  } else {
    ImGui::Text("Lip landmarks: %s",
                has_raw_lip_landmarks ? "live/raw" : "smoothed/fallback");
  }
  ImGui::Text("Bridge frames: %d", published_bridge_frames);
  if (diagnostics.valid) {
    const double now_ms = NowUnixMs();
    const double frame_age_ms =
        diagnostics.cpp_publish_ms > 0.0 ? now_ms - diagnostics.cpp_publish_ms
                                         : 0.0;
    const double detect_age_ms =
        diagnostics.js_detect_end_ms > 0.0 ? now_ms - diagnostics.js_detect_end_ms
                                           : 0.0;
    const double server_age_ms =
        diagnostics.server_write_ms > 0.0 ? now_ms - diagnostics.server_write_ms
                                          : 0.0;
    const double frame_to_landmark_ms =
        diagnostics.cpp_publish_ms > 0.0 && diagnostics.server_write_ms > 0.0
            ? diagnostics.server_write_ms - diagnostics.cpp_publish_ms
            : 0.0;
    const double landmark_fps =
        diagnostics.js_landmark_interval_ms > 1.0
            ? 1000.0 / diagnostics.js_landmark_interval_ms
            : 0.0;
    const bool throttle_suspected =
        landmark_fps > 0.0 && landmark_fps <= 2.0 &&
        diagnostics.js_detect_cost_ms > 0.0 &&
        diagnostics.js_detect_cost_ms < 200.0;
    ImGui::Separator();
    ImGui::Text("Latency: frame age %.0f ms | landmark age %.0f ms",
                frame_age_ms, detect_age_ms);
    ImGui::Text("Bridge: frame->landmark %.0f ms | server age %.0f ms",
                frame_to_landmark_ms, server_age_ms);
    ImGui::Text("Costs: detect %.1f ms | image %.1f ms | http %.1f ms",
                diagnostics.js_detect_cost_ms, diagnostics.js_image_load_ms,
                diagnostics.frame_info_round_trip_ms);
    ImGui::Text("Landmark FPS: %.1f (%.0f ms) | C++ read %.1f ms",
                landmark_fps, diagnostics.js_landmark_interval_ms,
                diagnostics.cpp_read_cost_ms);
    if (throttle_suspected) {
      ImGui::TextColored(ImVec4(1.0f, 0.82f, 0.25f, 1.0f),
                         "Bridge throttle suspected: keep browser foreground.");
    }
  } else {
    ImGui::Separator();
    ImGui::Text("Latency: waiting for diagnostics");
  }
  ImGui::Separator();
  ImGui::SliderFloat("Smoothing", &state->smoothing, 0.0f, 10.0f);
  ImGui::SliderFloat("Whitening", &state->whitening, 0.0f, 10.0f);
  ImGui::SliderFloat("Face slim", &state->face_slim, 0.0f, kFaceSlimUiMax);
  ImGui::SliderFloat("Eye enlarge", &state->eye_enlarge, 0.0f,
                     kEyeEnlargeUiMax);
  ImGui::SliderFloat("Mouth size", &state->mouth_resize, -kMouthResizeUiMax,
                     kMouthResizeUiMax, "%.2f  (-shrink / +enlarge)");
  ImGui::SliderFloat("Nose size", &state->nose_resize, -kNoseResizeUiMax,
                     kNoseResizeUiMax, "%.2f  (-shrink / +enlarge)");
  ImGui::SliderFloat("Lipstick", &state->lipstick, 0.0f, 10.0f);
  ImGui::SliderFloat("Eyebrow", &state->eyebrow, 0.0f, 10.0f);
  ImGui::Checkbox("Lip debug", &state->lip_debug);
  ImGui::SliderFloat("Blusher", &state->blusher, 0.0f, 10.0f);
  ImGui::Text("ESC closes the window.");
  ImGui::PopItemWidth();
  ImGui::End();
}

struct DisplayRect {
  float x = 0.0f;
  float y = 0.0f;
  float width = 0.0f;
  float height = 0.0f;
};

DisplayRect ComputeImageDisplayRect(int image_width,
                                    int image_height,
                                    int view_width,
                                    int view_height) {
  DisplayRect rect;
  if (image_width <= 0 || image_height <= 0 || view_width <= 0 ||
      view_height <= 0) {
    return rect;
  }

  const float image_aspect =
      static_cast<float>(image_width) / static_cast<float>(image_height);
  const float view_aspect =
      static_cast<float>(view_width) / static_cast<float>(view_height);
  if (image_aspect > view_aspect) {
    rect.width = static_cast<float>(view_width);
    rect.height = rect.width / image_aspect;
    rect.x = 0.0f;
    rect.y = (static_cast<float>(view_height) - rect.height) * 0.5f;
  } else {
    rect.height = static_cast<float>(view_height);
    rect.width = rect.height * image_aspect;
    rect.x = (static_cast<float>(view_width) - rect.width) * 0.5f;
    rect.y = 0.0f;
  }
  return rect;
}

ImVec2 DebugPointToScreen(const LipDebugPoint& point,
                          const DisplayRect& rect) {
  return ImVec2(rect.x + point.x * rect.width, rect.y + point.y * rect.height);
}

void DrawClosedDebugPolyline(ImDrawList* draw_list,
                             const std::vector<LipDebugPoint>& points,
                             const DisplayRect& rect,
                             ImU32 color,
                             float thickness) {
  if (!draw_list || points.size() < 2) return;
  for (size_t i = 0; i < points.size(); ++i) {
    const LipDebugPoint& a = points[i];
    const LipDebugPoint& b = points[(i + 1) % points.size()];
    draw_list->AddLine(DebugPointToScreen(a, rect),
                       DebugPointToScreen(b, rect), color, thickness);
  }
}

void DrawLipDebugOverlay(const LipRendererMP468& lip_renderer,
                         const std::vector<float>& landmarks,
                         const std::vector<float>& raw_landmarks,
                         int image_width,
                         int image_height,
                         int view_width,
                         int view_height) {
  LipRenderSettings settings;
  settings.strength = 1.0f;
  LipDebugOverlay overlay;
  if (!lip_renderer.BuildDebugOverlay(image_width, image_height, landmarks,
                                      settings, &overlay) ||
      !overlay.valid) {
    return;
  }

  const DisplayRect rect =
      ComputeImageDisplayRect(image_width, image_height, view_width,
                              view_height);
  if (rect.width <= 0.0f || rect.height <= 0.0f) return;

  ImDrawList* draw_list = ImGui::GetBackgroundDrawList();
  const ImU32 expanded_color = IM_COL32(255, 214, 92, 220);
  const ImU32 raw_color = IM_COL32(65, 220, 255, 235);
  const ImU32 inner_color = IM_COL32(255, 90, 120, 235);
  // v19: draw the un-predicted (raw) lip contour in green so the raw->pred gap
  // is visible. If green and cyan stay close, the lead is conservative; a large
  // gap means the prediction is overshooting and the lead should be reduced.
  const ImU32 raw_input_color = IM_COL32(80, 255, 140, 200);
  LipDebugOverlay raw_overlay;
  const bool has_raw =
      !raw_landmarks.empty() && raw_landmarks.size() == landmarks.size() &&
      lip_renderer.BuildDebugOverlay(image_width, image_height, raw_landmarks,
                                     settings, &raw_overlay) &&
      raw_overlay.valid;
  DrawClosedDebugPolyline(draw_list, overlay.expanded_upper_lip, rect,
                          expanded_color, 2.0f);
  DrawClosedDebugPolyline(draw_list, overlay.expanded_lower_lip, rect,
                          expanded_color, 2.0f);
  if (has_raw) {
    DrawClosedDebugPolyline(draw_list, raw_overlay.upper_lip, rect,
                            raw_input_color, 1.5f);
    DrawClosedDebugPolyline(draw_list, raw_overlay.lower_lip, rect,
                            raw_input_color, 1.5f);
  }
  DrawClosedDebugPolyline(draw_list, overlay.upper_lip, rect, raw_color,
                          1.5f);
  DrawClosedDebugPolyline(draw_list, overlay.lower_lip, rect, raw_color,
                          1.5f);
  DrawClosedDebugPolyline(draw_list, overlay.inner_mouth, rect, inner_color,
                          1.5f);
}

void RenderControlOnlyFrame(BeautyState* state,
                            float fps,
                            bool has_landmarks,
                            bool has_live_landmarks,
                            bool has_raw_lip_landmarks,
                            bool has_lip_prediction,
                            float lip_lead_ms,
                            float lip_lead_scale,
                            float lip_pred_gap_norm,
                            const BridgeDiagnostics& diagnostics,
                            int published_bridge_frames) {
  glfwMakeContextCurrent(main_window);
  int view_width = 0;
  int view_height = 0;
  glfwGetFramebufferSize(main_window, &view_width, &view_height);
  glViewport(0, 0, view_width, view_height);
  glClearColor(0.07f, 0.08f, 0.08f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);

  ImGui_ImplOpenGL3_NewFrame();
  ImGui_ImplGlfw_NewFrame();
  ImGui::NewFrame();
  DrawControlPanel(state, fps, false, has_landmarks, has_live_landmarks,
                   has_raw_lip_landmarks, has_lip_prediction, lip_lead_ms,
                   lip_lead_scale, lip_pred_gap_norm, diagnostics,
                   published_bridge_frames, 0, 0);
  ImGui::Render();
  ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
  glfwSwapBuffers(main_window);
}

void Cleanup(ScreenRenderer* renderer) {
  renderer->Shutdown();
  ImGui_ImplOpenGL3_Shutdown();
  ImGui_ImplGlfw_Shutdown();
  ImGui::DestroyContext();
  if (main_window) {
    glfwDestroyWindow(main_window);
    main_window = nullptr;
  }
  glfwTerminate();
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  std::string exe_path = GetExecutablePath();
  char dll_dir[MAX_PATH];
  sprintf_s(dll_dir, MAX_PATH, "%s\\..\\lib", exe_path.c_str());
  SetDllDirectoryA(dll_dir);
#endif

  std::string landmarks_path;
  if (argc > 1) {
    landmarks_path = argv[1];
  } else {
    fs::path default_landmarks = fs::path(GetExecutablePath()) / "landmarks.txt";
    if (fs::exists(default_landmarks)) {
      landmarks_path = default_landmarks.string();
    }
  }

  if (!SetupWindow()) {
    return 1;
  }
  SetupImGui();

  ScreenRenderer renderer;
  if (!renderer.Init()) {
    Cleanup(&renderer);
    return 1;
  }

  CameraCapture camera;
  if (!camera.Init(kCameraWidth, kCameraHeight)) {
    Cleanup(&renderer);
    return 1;
  }

  GPUPixelPipeline pipeline;
  if (!pipeline.Init(landmarks_path)) {
    Cleanup(&renderer);
    return 1;
  }
  MediaPipeLandmarkBridge bridge;
  bridge.Init();
  MjpegStreamServer stream_server;
  stream_server.Start(kMjpegStreamPort);
  const fs::path live_params_path =
      fs::path(GetExecutablePath()) / "gpupixel_live_params.json";

  BeautyState state;
  std::vector<uint8_t> frame;
  std::vector<uint8_t> lipstick_frame;
  LipRendererMP468 lip_renderer;
  EyebrowRendererMP468 eyebrow_renderer;
  int frame_width = 0;
  int frame_height = 0;
  float fps = 0.0f;
  int frame_count = 0;
  auto fps_timer = std::chrono::steady_clock::now();

  while (!glfwWindowShouldClose(main_window)) {
    if (glfwGetKey(main_window, GLFW_KEY_ESCAPE) == GLFW_PRESS) {
      glfwSetWindowShouldClose(main_window, GLFW_TRUE);
    }

    glfwPollEvents();
    bool got_frame = camera.ReadFrame(&frame, &frame_width, &frame_height);
    if (!got_frame || frame.empty()) {
      RenderControlOnlyFrame(&state, fps, !pipeline.landmarks.empty(),
                             bridge.has_live_landmarks(),
                             bridge.has_raw_mediapipe_landmarks(),
                             bridge.has_lip_prediction(),
                             bridge.lip_lead_ms(), bridge.lip_lead_scale(),
                             bridge.lip_pred_gap_norm(), bridge.diagnostics(),
                             bridge.published_frames());
      std::this_thread::sleep_for(std::chrono::milliseconds(8));
      continue;
    }

    bridge.MaybePublishFrame(frame.data(), frame_width, frame_height);
    if (bridge.MaybeLoadLandmarks()) {
      pipeline.SetLiveLandmarks(bridge.landmarks());
    }
    if (frame_count % 6 == 0) {
      ApplyLiveParamsFromFile(live_params_path, &state);
    }

    int output_width = 0;
    int output_height = 0;
    const uint8_t* output = pipeline.Process(frame.data(), frame_width,
                                             frame_height, state, &output_width,
                                             &output_height);
    const uint8_t* display_output = output;
    const bool want_lipstick = state.lipstick > 0.01f;
    const bool want_eyebrow = state.eyebrow > 0.01f;
    if ((want_lipstick || want_eyebrow) && bridge.has_mediapipe_landmarks() &&
        output && output_width > 0 && output_height > 0) {
      const size_t output_bytes =
          static_cast<size_t>(output_width) * static_cast<size_t>(output_height) *
          4;
      lipstick_frame.assign(output, output + output_bytes);
      bool rendered_any = false;
      if (want_lipstick) {
        LipRenderSettings lip_settings;
        lip_settings.strength = state.lipstick / 10.0f;
        rendered_any |= lip_renderer.Apply(
            &lipstick_frame, output_width, output_height,
            bridge.lip_mediapipe_landmarks(), lip_settings);
      }
      if (want_eyebrow) {
        EyebrowRenderSettings brow_settings;
        brow_settings.strength = state.eyebrow / 10.0f;
        rendered_any |= eyebrow_renderer.Apply(
            &lipstick_frame, output_width, output_height,
            bridge.mediapipe_landmarks(), brow_settings);
      }
      if (rendered_any) {
        display_output = lipstick_frame.data();
      }
    }
    if (display_output && output_width > 0 && output_height > 0) {
      stream_server.PublishFrame(display_output, output_width, output_height);
    }

    glfwMakeContextCurrent(main_window);
    int view_width = 0;
    int view_height = 0;
    glfwGetFramebufferSize(main_window, &view_width, &view_height);
    renderer.Render(display_output, output_width, output_height, view_width,
                    view_height);

    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
    if (state.lip_debug && bridge.has_mediapipe_landmarks()) {
      DrawLipDebugOverlay(lip_renderer, bridge.lip_mediapipe_landmarks(),
                          bridge.raw_lip_mediapipe_landmarks(), output_width,
                          output_height, view_width, view_height);
    }
    DrawControlPanel(&state, fps, true, !pipeline.landmarks.empty(),
                     bridge.has_live_landmarks(),
                     bridge.has_raw_mediapipe_landmarks(),
                     bridge.has_lip_prediction(), bridge.lip_lead_ms(),
                     bridge.lip_lead_scale(), bridge.lip_pred_gap_norm(),
                     bridge.diagnostics(), bridge.published_frames(),
                     frame_width, frame_height);
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

    glfwSwapBuffers(main_window);

    ++frame_count;
    auto now = std::chrono::steady_clock::now();
    float seconds =
        std::chrono::duration_cast<std::chrono::duration<float>>(now -
                                                                 fps_timer)
            .count();
    if (seconds >= 0.5f) {
      fps = frame_count / seconds;
      frame_count = 0;
      fps_timer = now;
    }
  }

  stream_server.Stop();
  camera.Shutdown();
  Cleanup(&renderer);
  return 0;
}
