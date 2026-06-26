# OpenHarness 自主视觉工具与等待状态设计

## 目标

让 OpenHarness 根据用户问题的语义，自主决定是否需要查看当前画面。当用户询问脸型、当前妆效或其他依赖视觉证据的问题时，OpenHarness 调用视觉工具，读取 GPUPixel 美颜后的最新画面，交给豆包视觉分析，再根据分析结果生成温柔、口语化的回答。

普通聊天和纯参数调整不截图，不使用本地关键词路由。

## OpenHarness 工具

新增只读工具 `inspect_current_beauty_frame`，由 OpenHarness 模型自行决定是否调用。

工具参数：

- `question`：用户当前问题。
- `analysis_focus`：希望豆包重点观察的内容，例如脸型、眉形或整体妆效。
- `request_id`：本轮视觉请求标识，由系统提示词提供，供后端关联进度事件。

工具行为：

1. 调用 Beauty Studio 本地视觉接口。
2. 从 GPUPixel `http://127.0.0.1:8791/latest.jpg` 读取最新美颜帧。
3. 将图片和用户问题发送给豆包视觉模型。
4. 返回结构化文字观察，包括可见性、脸型倾向、当前妆效、依据、置信度和建议。
5. OpenHarness 使用工具结果生成最终回复。

工具说明明确要求：

- 仅在缺少当前视觉证据时调用。
- 同一轮最多调用一次。
- 不把工具用于普通知识问题或无需画面的参数调整。
- 视觉失败时不得猜测用户外观。

## 插件位置

视觉工具作为 OpenHarness 插件存放在单一项目目录内：

`D:\work\makeup\.ohmo-beauty-studio\plugins\beauty-vision`

一键启动脚本为 OpenHarness 设置：

`OHMO_WORKSPACE=D:\work\makeup\.ohmo-beauty-studio`

该 workspace 只服务 Beauty Studio。初始化时不保留通用首次使用引导，避免干扰魔镜人格。

## 后端视觉接口

新增本地接口：

`POST /api/vision/inspect-current-frame`

请求包含 `question`、`analysisFocus` 和 `requestId`。

接口处理：

1. 验证请求来自本机。
2. 通知当前对话“正在读取当前画面”。
3. 获取 GPUPixel 最新 JPEG；不写入磁盘。
4. 通知当前对话“正在分析脸型和妆容特点”。
5. 调用已有 Ark Responses API 和 `doubao-seed-1-6-vision-250815`。
6. 解析并返回结构化 JSON。
7. 图片仅保存在请求内存中，请求结束后释放。

限制：

- 单张图片大小设上限。
- 视觉接口设置独立超时。
- 同一 `requestId` 只允许成功执行一次。
- 接口只监听现有本地站点，不对外暴露额外端口。

## 对话流程

```text
用户语音或文字
  -> Beauty Studio 提交给 OpenHarness
  -> OpenHarness 判断是否需要视觉证据
     -> 不需要：直接回答
     -> 需要：调用 inspect_current_beauty_frame
        -> 获取 GPUPixel latest.jpg
        -> 豆包视觉分析
        -> 结构化观察返回 OpenHarness
        -> OpenHarness 生成最终回答
  -> Piper 华言播报
```

图片不会直接加入 OpenHarness 对话上下文。OpenHarness 接收豆包视觉返回的结构化文字观察。

## 方案 A 等待界面

等待状态显示在当前对话线程内，作为临时的魔镜回复气泡，不遮挡右侧镜面。

气泡内容：

- 标题：`魔镜正在看看你`
- 三个轻量跳动圆点。
- 不确定长度的循环进度条，不显示百分比。
- 当前真实阶段文字。

阶段由真实后端事件驱动：

1. `正在理解你的问题`
2. `正在读取当前画面 · 请保持自然正脸`
3. `正在分析脸型和妆容特点`
4. `已经看清啦，正在整理建议`

收到首段正式回答后移除思考气泡。若 OpenHarness 判断不需要视觉工具，则只短暂显示第一阶段，不展示视觉相关措辞。

## 流式事件

Beauty Studio 服务端在现有 NDJSON 流中新增：

```json
{
  "type": "vision-progress",
  "stage": "capturing",
  "message": "正在读取当前画面 · 请保持自然正脸"
}
```

阶段值：

- `deciding`
- `capturing`
- `analyzing`
- `composing`
- `failed`

Node 桥接层开始处理问题时发送 `deciding`。OpenHarness 的 `tool_started`、本地视觉接口内部进度以及 `tool_completed` 驱动后续阶段。

## 失败回退

- GPUPixel 无最新帧：提示“我暂时没看清画面，可以调整一下镜头再试试哦。”
- 豆包视觉超时或失败：OpenHarness 收到明确错误结果，不得编造脸型结论。
- OpenHarness 未调用工具：按普通对话回复。
- 用户中断或开始新一轮语音：取消当前视觉请求并清除思考气泡。
- TTS 只播报最终回答，不播报等待阶段。

## 验证

- “看看我的脸型怎么样”由 OpenHarness 调用视觉工具，豆包收到 GPUPixel 美颜后画面。
- “什么是圆脸”不需要当前画面时，OpenHarness 可以直接回答且不截图。
- “帮我提亮一点”只调整参数，不触发视觉工具。
- NDJSON 阶段顺序与真实工具执行一致，不显示虚假百分比。
- 视觉结果返回后，OpenHarness 给出基于画面的温柔回答。
- 图片不落盘，同一轮最多分析一次。
- 视觉失败时不猜测用户外观。
