# Face-to-Face Beauty — Reference

## FaceToFaceBeauty 参数 (0.0–1.0)

### 塑形

| 参数 | 默认 | 说明 |
|------|------|------|
| slim_face | 0.25 | 瘦脸 |
| v_face | 0.10 | V脸 |
| jawline | 0.10 | 下颌线 |
| eye_enlarge | 0.15 | 大眼 |
| nose_slim | 0.10 | 瘦鼻 |
| chin_slim | 0.10 | 收下巴 |

### 美肤

| 参数 | 默认 | 说明 |
|------|------|------|
| smooth_skin | 0.40 | 磨皮（频率分离，保留纹理） |
| whiten | 0.15 | 美白 |
| ruddy | 0.12 | 红润 |
| sharpen_eyes | 0.20 | 眼部锐化 |

### 美妆

| 参数 | 默认 | 说明 |
|------|------|------|
| lip_color | 0.45 | 口红 |
| eye_shadow | 0.30 | 眼影 |
| eyebrow | 0.20 | 眉妆 |
| blush | 0.25 | 腮红 |
| eyeliner | 0.15 | 眼线 |
| lip_gloss | 0.15 | 唇釉光泽 |
| lip_style | rose | natural / coral / red / rose / nude / berry |
| shadow_style | natural | natural / smoky / warm / pink |

### 身份

| 参数 | 默认 | 说明 |
|------|------|------|
| preserve_identity | 0.35 | 越高越保留原脸毛孔/特征 |

## ComfyUI API 手动调用

```python
import json, ssl, uuid, urllib.request

BASE = "https://127.0.0.1:8188"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

with open("face-to-face-beauty/workflow/face-to-face-beauty.api.json") as f:
    prompt = json.load(f)
prompt["1"]["inputs"]["image"] = "your-photo.png"
prompt["5"]["inputs"]["filename_prefix"] = "result"

body = json.dumps({"prompt": prompt, "client_id": str(uuid.uuid4())}).encode()
req = urllib.request.Request(BASE + "/prompt", data=body,
                             headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, context=ctx)
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| COMFYUI_HOST | 127.0.0.1 | 服务器地址 |
| COMFYUI_PORT | 8188 | 端口 |

## 相关源码

| 文件 | 作用 |
|------|------|
| `custom_nodes/ComfyUI-RealtimeBeauty/face_beauty_core.py` | face_to_face 合成、形变、美肤 |
| `custom_nodes/ComfyUI-RealtimeBeauty/makeup_core.py` | 分区域美妆 |
| `custom_nodes/ComfyUI-RealtimeBeauty/nodes_makeup.py` | FaceToFaceBeauty 节点 |

## 技术要点（face-to-face）

1. 软遮罩：效果仅在人脸区域内，背景像素不变
2. 局部 MLS 形变：瘦脸/大眼不拉扯背景
3. 频率分离磨皮：平滑肤色，保留毛孔
4. preserve_identity：叠回原图高频细节
5. 唇妆亮度保留：改色调不抹掉唇纹
