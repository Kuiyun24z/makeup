# GPUPixel 复现与 Windows 人脸点位分析

## 1. 结论摘要

`gpupixel-main` 本体不是一个 Windows 人脸点位库，而是一个基于 C++/OpenGL 的跨平台 GPU 图像与视频滤镜框架。它负责滤镜渲染，例如磨皮、美白、口红、腮红、瘦脸和大眼。

当前目录中的可运行复现，并不是依赖 GPUPixel 在 Windows/Linux 上内置检测人脸点位，而是采用了外部点位方案：

1. `smart-mirror` 用 MediaPipe FaceLandmarker 检测 478 个人脸关键点。
2. `beauty_web/beauty_server.py` 把 MediaPipe 的 478 点粗略转换成 GPUPixel 期望的 106 点格式。
3. `beauty_processor.cc` 通过 `--landmarks` 读入 106 点 JSON。
4. GPUPixel 的 `FaceReshapeFilter` 只负责根据这些点位在 GPU shader 中做瘦脸和大眼变形。

所以，“人家能做”的核心原因是：他们没有真正解决“GPUPixel Windows 内置点位库”的问题，而是绕开了这个问题，把点位检测放到 GPUPixel 外部完成。

## 2. GPUPixel 本体在做什么

GPUPixel 的主要职责是图像滤镜管线：

```text
SourceImage / SourceRawData
  -> Filter
  -> Filter
  -> SinkRawData / SinkRender
```

在这份代码里，典型的美颜处理链路出现在 `beauty_processor.cc`：

```text
SourceImage
  -> LipstickFilter
  -> BlusherFilter
  -> FaceReshapeFilter
  -> BeautyFaceFilter
  -> SinkRawData
```

相关文件：

- `beauty_processor.cc`
- `src/filter/beauty_face_filter.cc`
- `src/filter/face_reshape_filter.cc`
- `src/filter/lipstick_filter.cc`
- `src/filter/blusher_filter.cc`

其中 `FaceReshapeFilter` 是瘦脸/大眼的关键模块。它的 shader 接收：

```cpp
uniform float facePoints[106 * 2];
```

也就是说，GPUPixel 的瘦脸/大眼滤镜不自己“理解脸”，它只需要一组归一化后的人脸关键点，然后根据固定索引做局部纹理扭曲。

## 3. 官方人脸点位方案：MarsFace

GPUPixel 源码中确实存在 `FaceDetector`：

- `include/gpupixel/face_detector/face_detector.h`
- `src/face_detector/face_detector.cc`

它内部调用的是：

```cpp
mars_vision::MarsFaceLandmarker::Create()
```

模型路径来自 GPUPixel resource 目录下的 `models`：

```text
models/face_det.mars_model
models/face_align.mars_model
```

相关资源位置：

- `third_party/mars-face-kit/models/face_det.mars_model`
- `third_party/mars-face-kit/models/face_align.mars_model`
- `output/models/face_det.mars_model`
- `output/models/face_align.mars_model`

但是这里有一个关键限制：MarsFace 不是源码形式的人脸点位算法，而是预编译 SDK 加模型。`third_party/CMakeLists.txt` 中按平台引用 MarsFace 动态库或静态库。

## 4. Windows/Linux 为什么不是官方内置点位

仓库里的 `CHANGELOG.md` 明确写到：

```text
Windows and Linux platforms no longer provide built-in face detection,
please integrate vnn if needed
```

对应中文意思是：Windows 和 Linux 不再提供内置人脸检测，如有需要请自行集成 vnn。

构建脚本也印证了这一点：

- `script/build_windows.bat`
- `script/build_linux.sh`

两者都把人脸检测关掉：

```cmake
-DGPUPIXEL_ENABLE_FACE_DETECTOR=OFF
```

这说明官方桌面端构建默认并不打包 GPUPixel 内置人脸检测。

另外，`third_party/CMakeLists.txt` 里虽然写了 Windows MarsFace 路径：

```cmake
third_party/mars-face-kit/libs/windows/msvc-x64/mars-face-kit.dll
third_party/mars-face-kit/libs/windows/msvc-x64/mars-face-kit.lib
```

但当前目录实际看到的 `third_party/mars-face-kit/libs` 里主要是 Android、iOS、macOS 相关库，没有完整的 Windows `dll/lib` 文件。因此当前工作区并不具备“原生 Windows + GPUPixel 内置 MarsFace 点位”的完整条件。

## 5. 当前复现链路

当前复现由两部分组成：

### 5.1 C++ 侧：GPUPixel 负责滤镜渲染

`beauty_processor.cc` 是一个无界面的图片处理器。它做几件事：

1. 读取输入图片。
2. 设置 GPUPixel resource path。
3. 创建滤镜链。
4. 如果传入 `--landmarks`，读取 106 点 JSON。
5. 调用 `FaceReshapeFilter::SetFaceLandmarks()`。
6. 渲染并输出 PNG。

关键代码：

```cpp
if (!landmarks_file.empty()) {
  std::vector<float> lms = LoadLandmarks(landmarks_file);
  if (lms.size() >= 106 * 2) {
    g_reshape_filter->SetFaceLandmarks(lms);
  }
}
```

### 5.2 Python 侧：Web UI + 外部点位检测

`beauty_web/beauty_server.py` 提供 Web UI，并通过 subprocess 调用 `output/bin/beauty_processor`。

它还写死了 `smart-mirror` 的路径：

```python
SMART_MIRROR_DIR = Path("/home/guo/work-gyt/smart-mirror")
```

这说明当前复现更接近 Linux/WSL 环境下的组合方案，而不是纯 Windows 原生链路。

当用户开启瘦脸/大眼或眼袋、泪沟、法令纹修正时，`beauty_server.py` 会：

1. 调用 `smart-mirror` 的 MediaPipe pipeline。
2. 取得 MediaPipe 478 点。
3. 通过 `_mediapipe_to_106()` 转成 106 点。
4. 写入临时 JSON 文件。
5. 把该文件路径追加到 C++ 参数：

```python
args.append("--landmarks")
args.append(landmarks_file)
```

## 6. smart-mirror 在这里扮演什么角色

`smart-mirror` 是当前复现中真正做“人脸理解”的部分。

它的 `pipeline.py` 使用：

```python
from mediapipe.tasks.python import vision
```

并加载：

```text
mediapipe-face-landmarker/models/face_landmarker.task
```

然后输出：

```python
landmarks_px = [[int(l.x * width), int(l.y * height)] for l in landmarks]
```

也就是 MediaPipe 的 478 点像素坐标。

此外，`smart-mirror` 还集成了：

- MediaPipe FaceLandmarker：人脸检测与 478 点。
- face-parsing / BiSeNet：19 类面部分割 mask。
- 3DDFA-V2：可选 3D 人脸重建。
- facial_correction.py：黑眼圈、眼袋、泪沟、法令纹等局部修正。

因此，这个复现并不是“GPUPixel 单独完成全部美颜”，而是：

```text
smart-mirror 做人脸检测/分割/局部修正
GPUPixel 做 GPU 滤镜与纹理变形
```

## 7. 478 点转 106 点的质量问题

当前 `_mediapipe_to_106()` 是粗略映射，不是严格的 106 点标注体系转换。

尤其要注意，GPUPixel 的 `FaceReshapeFilter` shader 中瘦脸和大眼使用的是固定索引：

瘦脸使用：

```text
3 -> 44
29 -> 44
7 -> 45
25 -> 45
10 -> 46
22 -> 46
14 -> 49
18 -> 49
16 -> 49
```

大眼使用：

```text
74 -> 72
77 -> 75
```

但 `beauty_server.py` 中 `_mediapipe_to_106()` 并没有完整、准确地填好这些点。代码里甚至有：

```python
for target_idx in [44, 45, 46, 49]:
    pass
```

我抽查了 `output/temp` 里已生成的一个 `lm_*.json`，发现一些关键点是 `0,0`：

```text
44 = 0,0
46 = 0,0
72 = 0,0
74 = 0,0
75 = 0,0
77 = 0,0
81 = 0,0
82 = 0,0
```

这意味着当前瘦脸/大眼的点位输入并不可靠。它能跑通流程，但效果质量不等于官方 MarsFace 或完整 106 点模型。

## 8. 为什么我们之前一直卡在 Windows 点位库

原因不是 GPUPixel 不能做美颜，而是 Windows 上缺的是稳定、可分发、能输出匹配 GPUPixel 106 点格式的人脸关键点检测器。

之前找 Windows 面部点位库，实际是在找这部分：

```text
输入图片/视频帧
  -> 检测人脸
  -> 输出稳定关键点
  -> 坐标格式匹配 GPUPixel shader
```

GPUPixel 自己的滤镜层不难跑；难点是：

1. 官方 MarsFace Windows 库当前工作区不完整。
2. 官方桌面脚本默认关闭 `GPUPIXEL_ENABLE_FACE_DETECTOR`。
3. GPUPixel 的变形 shader 期望 106 点格式。
4. MediaPipe 输出的是 478 点，两者索引体系不同。
5. 如果转换不准，瘦脸/大眼会变形错误或效果不明显。

## 9. 后续建议

如果目标是快速可用：

1. 继续采用 MediaPipe 做点位检测。
2. 不再强行转换成 GPUPixel 106 点。
3. 直接改 `FaceReshapeFilter` 的 shader，让它使用 MediaPipe 478 点索引。
4. 这样可以避免 478 -> 106 映射误差。

如果目标是接近官方 GPUPixel 效果：

1. 找到可用的 Windows MarsFace 或 VNN SDK。
2. 保证输出点位与 GPUPixel 106 点索引完全一致。
3. 打开 `GPUPIXEL_ENABLE_FACE_DETECTOR` 并补齐 Windows `dll/lib`。
4. 统一模型、资源路径和运行时 dll 复制逻辑。

如果目标是跨平台产品化：

1. 把“点位检测接口”和“GPUPixel 渲染接口”拆开。
2. 定义统一 landmark adapter。
3. 支持多个后端：
   - MediaPipe 478 点
   - MarsFace/VNN 106 或 111 点
   - 其他 ONNX 人脸点位模型
4. 每个后端只负责输出统一结构，GPUPixel 只消费统一结构。

## 10. 最终判断

当前 `gpupixel-main` 的复现价值在于：它证明 GPUPixel 的 GPU 美颜滤镜可以和外部人脸检测方案组合使用。

但它没有证明 GPUPixel 在 Windows 上已经自带可用的人脸点位库。真正的复现方式是：

```text
MediaPipe / smart-mirror 负责点位
GPUPixel 负责美颜滤镜
```

所以我们之前找 Windows 面部点位库的方向没有错。只是这份复现换了一条路：不找 GPUPixel 内置 Windows 点位库，而是用外部点位模型把数据喂进去。
