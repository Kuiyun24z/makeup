---
name: comfyui-face-to-face-beauty
description: >-
  Runs ComfyUI Face-to-Face beauty workflow on portrait photos: face slimming,
  skin smoothing, makeup on the original face without identity replacement.
  Use when processing portraits in ComfyUI, face beauty, 美颜, 瘦脸, 美肤,
  美妆, face-to-face, or when the user references face-to-face-beauty.
---

# ComfyUI Face-to-Face Beauty

在原本人脸上做瘦脸、美肤、美妆（**face-to-face**，不换脸、不重绘背景）。

## 何时使用

- 用户要处理 `input/` 人像、美颜、瘦脸、美肤、化妆
- 需要批量/自动化跑 ComfyUI 工作流
- 需要调整 `preserve_identity`、预设（natural / glam / skin_only）

## 工作流包位置

```
face-to-face-beauty/
├── manifest.json
├── workflow/face-to-face-beauty.api.json
├── params/default.json
└── scripts/run.py
```

已安装副本：`user/default/workflows/Image High Quality Makeup.json`

## Agent 执行清单

```
Task Progress:
- [ ] 1. 确认 ComfyUI 运行
- [ ] 2. 确认自定义节点与模型
- [ ] 3. 确认输入图片在 input/
- [ ] 4. 执行 run.py
- [ ] 5. 返回 output 路径给用户
```

### Step 1: 检查 ComfyUI

```bash
python face-to-face-beauty/scripts/run.py --check
```

若失败：

```bash
bash start_remote.sh
```

访问地址：**`https://127.0.0.1:8188`**（必须用 https，http 会失败）。

### Step 2: 依赖

| 项 | 路径 |
|----|------|
| 自定义节点 | `custom_nodes/ComfyUI-RealtimeBeauty` |
| 核心节点 | `FaceToFaceBeauty` |
| MediaPipe 模型 | `models/detection/mediapipe_face_fp32.safetensors` |

模型缺失时：

```bash
/opt/conda/envs/comfyui/bin/python custom_nodes/ComfyUI-RealtimeBeauty/download_mediapipe_model.py
```

### Step 3: 运行

```bash
/opt/conda/envs/comfyui/bin/python face-to-face-beauty/scripts/run.py \
  --image input/PHOTO.png \
  --prefix OUTPUT_PREFIX \
  --json
```

**预设：**

| preset | 效果 |
|--------|------|
| `natural` | 自然轻美颜 |
| `glam` | 浓妆更明显 |
| `skin_only` | 仅美肤，无妆 |

```bash
python face-to-face-beauty/scripts/run.py -i input/photo.png --preset natural
```

**单参数覆盖：**

```bash
python face-to-face-beauty/scripts/run.py -i photo.png --param slim_face=0.3 --param preserve_identity=0.4
```

### Step 4: 输出

- 目录：`output/`
- JSON 模式字段：`outputs[].path`

## 工作流结构

```
LoadImage → MediaPipeFaceLandmarker → FaceToFaceBeauty → SaveImage
```

`FaceToFaceBeauty` 关键参数见 [reference.md](reference.md)。

## 调参速查

| 目标 | 调整 |
|------|------|
| 更像原脸 | ↑ `preserve_identity` (0.4–0.5) |
| 效果更强 | ↓ `preserve_identity` (0.2)，↑ `slim_face` / `smooth_skin` |
| 不要妆 | `--preset skin_only` 或 `lip_color=0 eye_shadow=0` |

## 打包分发

```bash
bash face-to-face-beauty/scripts/pack.sh
```

生成 `face-to-face-beauty-bundle.tar.gz`。

## 故障排除

| 现象 | 处理 |
|------|------|
| 连接失败 | 用 `https://`，运行 `start_remote.sh` |
| 节点不存在 | 重启 ComfyUI，检查 `ComfyUI-RealtimeBeauty` |
| 无人脸效果 | 用正脸、光线均匀的照片；检查 MediaPipe 模型 |
| 背景被改 | 确认使用 `FaceToFaceBeauty` |

详细参数与 API 说明见 [reference.md](reference.md).
