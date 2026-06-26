# Face-to-Face Beauty

ComfyUI 工作流包：在原本人脸上进行瘦脸、美肤、美妆（face-to-face，非换脸）。

## 目录

```
face-to-face-beauty/
├── manifest.json
├── SKILL.md              # Agent 使用说明
├── reference.md          # 参数与 API 参考
├── workflow/
├── params/
└── scripts/
    ├── run.py
    └── pack.sh
```

## 前置条件

1. `custom_nodes/ComfyUI-RealtimeBeauty`
2. `models/detection/mediapipe_face_fp32.safetensors`
3. ComfyUI 运行中（`https://127.0.0.1:8188`）

## 快速运行

```bash
bash start_remote.sh
python face-to-face-beauty/scripts/run.py --image input/your-photo.png
python face-to-face-beauty/scripts/run.py --image photo.png --preset natural --json
```

## Agent

见 [SKILL.md](SKILL.md)

## 打包

```bash
bash face-to-face-beauty/scripts/pack.sh
# 输出: face-to-face-beauty-bundle.tar.gz
```
