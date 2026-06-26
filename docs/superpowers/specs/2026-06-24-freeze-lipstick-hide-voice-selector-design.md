# 隐藏音色选择并冻结口红控制设计

## 目标

简化 Beauty Studio 前端，移除播报音色选择控件和口红美颜滑块，同时继续使用当前本地 Piper 华言音色进行语音播报。口红控制暂时冻结，但 GPUPixel 底层 `lipstick` 参数继续保留，便于以后恢复。

## 前端变更

- 删除“播报音色”标签和选择框。
- 删除音色选项填充、选择事件和本地偏好缓存逻辑。
- 保留 TTS adapter 初始化、播放、停止、状态提示和错误处理。
- 删除 GPUPixel 参数面板中的“口红”滑块。
- 其他八个滑块继续使用现有响应式网格自动排版。
- 调整输入框示例，避免暗示当前可以控制口红。

## 控制冻结

- 从服务端 `GPUPIXEL_PARAM_SKILLS` 中移除 `lipstick`。
- “加点口红”“唇色深一点”等文本或语音不再写入 GPUPixel 参数。
- 保留 GPUPixel adapter、参数 JSON 和原生客户端中的 `lipstick` 字段。
- 删除当前网站中不再可达的口红专属反馈文案和测试。

## 验证

- 页面中不存在 `voice-select` 和 `data-gpupixel-param="lipstick"`。
- 前端不再注册音色切换事件，也不再读取音色偏好缓存。
- TTS adapter 仍会创建并能调用本地 `/api/voice/tts/speak`。
- 服务端技能列表不包含 `lipstick`，其他八个美颜参数仍可识别。
- 网站、GPUPixel adapter 和原生视频流健康检查保持正常。
