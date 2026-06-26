# GPUPixel MP468 视频流 Demo 实施说明

## 目标

在不影响现有图片版 Demo 的前提下，新增一个可运行的视频流原型：

- 浏览器调用摄像头采集视频。
- MediaPipe FaceLandmarker 使用 `VIDEO` 模式持续检测人脸。
- 前端同时生成 GPUPixel 111 点和 MediaPipe 468 点。
- 111 点继续供 GPUPixel 原生滤镜使用，如大眼、口红、腮红。
- 468 点供 MP468 局部算法使用，如瘦脸、法令纹、眼袋、缩鼻翼、嘴巴大小等。
- 前端按指定 FPS 把当前帧发给后端，后端调用 `gpupixel_processor_mp468.exe` 返回处理后的图片。

## 新增文件

- `web_demo_mp468_video/index.html`
  - 视频流 Demo 页面。
  - 左侧显示摄像头输入和 468 点，右侧显示处理后的输出。
  - 右侧保留图片版同类美颜参数，并新增处理 FPS 控件。

- `web_demo_mp468_video/app.js`
  - 调用 `navigator.mediaDevices.getUserMedia` 打开摄像头。
  - 加载 MediaPipe 本地模型，使用 `runningMode: "VIDEO"`。
  - 使用 `detectForVideo(video, timestamp)` 获取每帧关键点。
  - 每帧在输入画布上绘制 468 点。
  - 按目标 FPS 将干净视频帧和两份 landmarks 发送到 `/api/process`。

- `web_demo_mp468_video/processor_server.py`
  - 复用 MP468 图片版后端。
  - 默认端口改为 `8789`。
  - 调用 `build/windows-nmake/out/bin/gpupixel_processor_mp468.exe`。

- `web_demo_mp468_video/start_web_demo.cmd`
  - 启动视频版 Demo。

## 启动方式

```powershell
cd "C:\Users\huaweiuser\Desktop\GPUPixel"
.\web_demo_mp468_video\start_web_demo.cmd
```

浏览器打开：

```text
http://127.0.0.1:8789
```

然后点击“开启摄像头”。

## 当前调用链

```text
Camera
  -> browser video element
  -> MediaPipe FaceLandmarker VIDEO mode
  -> 111-point GPUPixel landmarks
  -> 468-point MediaPipe landmarks
  -> POST /api/process
  -> gpupixel_processor_mp468.exe
  -> output PNG data URL
  -> browser output preview
```

## 当前版本的性能特征

这是原型版，不是最终实时架构。

当前每一帧处理都会：

1. 将视频帧编码成 PNG data URL。
2. 通过 HTTP POST 发给 Python server。
3. Python server 写临时图片和 landmarks 文件。
4. 启动一次 `gpupixel_processor_mp468.exe`。
5. Processor 创建 OpenGL 上下文，跑 GPUPixel pipeline 和 MP468 后处理。
6. 写出 PNG，再由 Python base64 返回浏览器。

这个链路简单、稳定、便于验证效果，但启动进程和 PNG 编解码开销很大，所以默认处理 FPS 是 4。可以调高到 10，但实际速度取决于机器性能。

## 为什么输入画面能实时，输出画面低帧率

输入画面是浏览器直接显示摄像头帧和 MediaPipe 点，走本地前端渲染，所以会比较流畅。

输出画面需要经过后端 GPUPixel 处理，当前原型每帧都会跨进程调用，所以输出会按“处理 FPS”刷新，不等同于摄像头原始帧率。

## 111 点和 468 点的分工

保留 111 点的原因：

- GPUPixel 原生 `FaceReshapeFilter`、`LipstickFilter`、`BlusherFilter` 的 mesh 和 shader 仍然基于它自己的 111 点语义。
- 口红、腮红、大眼暂时继续复用原生滤镜，风险低。

使用 468 点的原因：

- MediaPipe 原始点更密，眼下、鼻翼、嘴角、脸颊、下颌区域定位更细。
- 新增的 MP468 后处理算法可以直接基于这些细点做区域遮罩和局部 warp。

当前 MP468 版已经把瘦脸切到 468 点自定义 warp；大眼、口红、腮红仍走 111 点。

## 下一步优化建议

### 1. 后端改成长驻服务

不要每帧启动 `gpupixel_processor_mp468.exe`。建议改成一个长驻进程：

- 初始化一次 OpenGL context。
- 初始化一次 GPUPixel filter pipeline。
- 每帧只更新输入纹理、landmarks 和参数。

这样能显著降低延迟。

### 2. HTTP 改 WebSocket

当前 HTTP POST 简单但开销大。视频流更适合：

- WebSocket 传帧。
- 返回 JPEG/WebP/RGBA。
- 支持丢帧，只保留最新帧，避免处理队列堆积。

### 3. 减少 PNG 编解码

PNG 编码慢。下一版可以：

- 前端传 JPEG/WebP。
- 或传缩放后的 raw RGBA。
- 后端返回 JPEG/WebP。

### 4. ROI 化 CPU 后处理

当前 MP468 局部算法里有部分全图循环。视频版应按区域处理：

- 眼袋只处理眼下 ROI。
- 法令纹只处理鼻翼到嘴角 ROI。
- 颈纹只处理脖子 ROI。
- 泛红、暗沉、毛孔只处理脸部椭圆 ROI。

### 5. GPU shader 化

最终实时版本建议把局部 warp 和肤色处理迁移到 GPU shader，避免 CPU 全图逐像素处理。

### 6. 点位时间平滑

视频关键点会抖。建议加入：

- landmarks EMA 平滑。
- 参数变化平滑。
- 检测失败时短时间沿用上一帧点位。

这样瘦脸、鼻翼、嘴巴大小会更稳。

## 当前版本定位

这版适合验证：

- 摄像头输入是否能跑通。
- MediaPipe VIDEO 模式是否稳定。
- 468 点能否持续传给 GPUPixel 后端。
- 美颜参数在视频帧上是否方向正确。

它不是最终 30 FPS 实时美颜架构。要做生产级视频流，需要继续做长驻后端、WebSocket、ROI/GPU 优化。
