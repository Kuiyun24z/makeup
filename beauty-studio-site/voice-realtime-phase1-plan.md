# 实时语音通话 Phase 1 详细技术设计

- 文档版本：`v1.0.0`
- 最后更新：`2026-06-15`
- 适用目录：`D:\work\makeup\beauty-studio-site`
- 目标阶段：`Phase 1 - 语音通话底座`

本文档描述“对标豆包手机版语音通话体验”的第一阶段详细设计。第一阶段不追求一步到位把所有能力都做成最终态，而是先把最影响体感的实时通话底座搭起来：

- 让用户开口时系统能立即感知
- 让系统说话时可以被立即打断
- 让语音链路具备统一状态机
- 为后续流式 ASR / 流式 TTS / 视频抽帧优化预留标准接口

## 1. Phase 1 的目标与边界

### 1.1 目标

Phase 1 的核心目标是先做出“像在打电话”的基础对话感，而不是继续维持现在这种“像网页按钮触发问答”的交互形态。

这一阶段完成后，系统要达到以下体验目标：

- 用户一开口，前端能在毫秒级感知到“有人开始说话了”
- 如果系统正在播报，用户开口时系统能立即闭嘴
- 如果系统正在等待模型返回，用户开口时上一轮请求能立即取消
- 左侧对话区能够显示实时状态和增量字幕
- 后续接火山流式 ASR、豆包流式 LLM、流式 TTS 时，不需要再重做整套状态管理

### 1.2 暂不在 Phase 1 强行完成的内容

Phase 1 故意不把所有事情一次做满，避免战线过长。

这一阶段暂不强求：

- 最终版火山引擎流式 ASR
- 最终版流式 TTS 音频播放
- 最终版视频抽帧与视觉附图优化
- OpenHarness 与复杂工具调用的深度路由
- Electron / Tauri 客户端化

这些能力都要为后续阶段预留接口，但不在第一阶段全部落地。

## 2. 为什么要先做这一阶段

当前代码里，语音链路的主要问题不是“模型不够聪明”，而是“链路不够实时”：

1. 前端主要还是基于 `Web Speech API` 的整句返回模式  
   用户说完后才拿到完整文本，系统天然慢半拍。

2. 没有独立端侧 VAD  
   当前更多依赖识别结果回调推进流程，无法做到真正的“开口即打断”。

3. 打断逻辑还不是统一状态机驱动  
   现在有 `abort fetch` 和 `speechSynthesis.cancel()`，但还没有形成完整会话控制器。

4. 语音、文本、播报、请求、镜像分析共享前端主逻辑  
   需要拆出更清晰的实时语音通话子系统。

所以，Phase 1 的价值是先把“通话底座”从当前站点逻辑中抽出来，变成一个可维护、可扩展、可监控的实时会话层。

## 3. 总体架构

Phase 1 完成后的语音主链路分成 5 层：

1. 音频采集层  
   负责麦克风接入、AEC/降噪/增益控制、AudioContext 初始化。

2. VAD 检测层  
   负责判断“是否开始说话”“是否结束说话”，不依赖 ASR 终结事件。

3. 会话控制层  
   负责统一状态机、统一打断、统一请求取消、统一播报停止。

4. 转写与回复层  
   负责接入 ASR、接入 `/api/advice?stream=1`、接收增量文本。

5. 播报输出层  
   负责当前浏览器 TTS 的统一封装，并为后续流式 TTS 保留接口。

Phase 1 的设计原则：

- 不让每个模块互相直接调用对方内部逻辑
- 所有状态变化都经过会话控制器
- 所有“开口打断”都只认 VAD 事件
- 所有“停止上一轮”都走统一的 `interruptCurrentSession()`

## 4. 模块拆分设计

建议在当前项目里新增以下模块文件。

### 4.1 前端模块

- `public/audio/audio-input-manager.js`
- `public/audio/vad-manager.js`
- `public/audio/conversation-orchestrator.js`
- `public/audio/asr-adapter.js`
- `public/audio/tts-adapter.js`
- `public/audio/debug-metrics.js`

### 4.2 后端模块

- `server/voice-session-controller.js`
- `server/chat-stream-service.js`

说明：

- 第一阶段可以先不急着把 `server.js` 完全拆散
- 但新增逻辑建议以独立模块写，再由 `server.js` 引入
- 这样后面做 Phase 2 / Phase 3 时不会继续把 `server.js` 堆成更大的单文件

## 5. 前端模块职责

### 5.1 `audio-input-manager.js`

职责：

- 统一申请麦克风权限
- 创建 `MediaStream`
- 创建 `AudioContext`
- 输出给 VAD / ASR 使用的音频输入
- 开启浏览器内建音频增强

必开参数：

```js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
});
```

补充要求：

- 只在用户明确点击“开启语音通话”后初始化，避免浏览器自动播放/权限策略问题
- 统一暴露：
  - `start()`
  - `stop()`
  - `getStream()`
  - `getAudioContext()`

### 5.2 `vad-manager.js`

职责：

- 基于端侧 VAD 检测“开始说话 / 结束说话”
- 作为会话控制器最重要的实时触发源

建议方案：

- 首选：`@ricky0123/vad`
- 运行方式：浏览器端 ONNX / WebAudio

建议事件：

- `speechStart`
- `speechEnd`
- `speechProbability`
- `misfire`

防抖要求：

- 连续检测到 `100ms - 150ms` 的有效语音才认定为 `speechStart`
- 连续静音达到阈值才认定为 `speechEnd`
- 避免键盘声、桌面碰撞音、TTS 回声导致误触发

### 5.3 `conversation-orchestrator.js`

职责：

- 管理整个实时语音对话生命周期
- 接收 VAD、ASR、LLM、TTS 的事件
- 决定何时开始识别、何时停止播报、何时取消上一轮、何时提交请求

这是 Phase 1 的核心模块。

### 5.4 `asr-adapter.js`

Phase 1 先做适配层，不把具体 ASR 方案绑死。

职责：

- 提供统一的转写接口
- 兼容当前 `Web Speech API`
- 为后续切换火山流式 ASR保留统一事件模型

统一输出事件建议：

- `partial`
- `final`
- `error`
- `started`
- `stopped`

第一阶段的现实做法：

- 先把当前 `SpeechRecognition / webkitSpeechRecognition` 封装进 `asr-adapter`
- 让业务代码不再直接碰浏览器识别对象

### 5.5 `tts-adapter.js`

Phase 1 先统一播报控制。

职责：

- 包装当前 `speechSynthesis`
- 实现统一的：
  - `speak(text)`
  - `stopNow()`
  - `clearQueue()`
  - `isSpeaking()`

后续 Phase 3 再把这里替换成真正的流式 TTS，不动会话控制层。

### 5.6 `debug-metrics.js`

职责：

- 埋点记录关键时延
- 为后续性能调优提供实时观测

第一阶段建议至少记录：

- `vadStartAt`
- `vadEndAt`
- `asrFirstPartialAt`
- `llmRequestStartAt`
- `llmFirstDeltaAt`
- `ttsSpeakStartAt`
- `interruptAt`

## 6. 会话状态机设计

### 6.1 状态定义

第一阶段建议统一使用以下状态：

- `idle`
  系统空闲，未进入会话

- `listening`
  已进入语音通话模式，正在等待用户开口

- `capturing`
  用户正在说话，正在实时收集语音与转写

- `thinking`
  用户说完了，系统已提交请求，正在等待模型回复

- `speaking`
  系统正在播报回复

- `interrupted`
  当前轮已被用户新开口打断，正在切换到下一轮

- `error`
  音频、ASR、请求或播报失败

### 6.2 状态转移

```text
idle
  -> listening

listening
  -> capturing      (VAD speechStart)

capturing
  -> thinking       (VAD speechEnd)
  -> interrupted    (用户主动取消/异常)

thinking
  -> speaking       (LLM 首句或首段可播报文本到达)
  -> interrupted    (VAD speechStart)

speaking
  -> interrupted    (VAD speechStart)
  -> listening      (播报结束)

interrupted
  -> capturing      (开始新一轮说话)
  -> listening      (中断完成但用户未继续说)

任意状态
  -> error
```

## 7. 核心打断逻辑

### 7.1 设计原则

Phase 1 最重要的目标不是“说得更聪明”，而是“打断必须干脆”。

一旦检测到用户重新开口，必须并行触发以下动作：

1. 立即停止 TTS 播报
2. 立即取消当前 LLM 请求
3. 清空上一轮待处理文本缓存
4. 开始新一轮语音采集与转写

### 7.2 标准中断函数

建议由 `conversation-orchestrator` 提供统一中断入口：

```js
async function interruptCurrentSession(reason) {
  state.status = "interrupted";

  ttsAdapter.stopNow();
  ttsAdapter.clearQueue();

  currentChatAbortController?.abort();
  currentChatAbortController = null;

  asrAdapter.resetBuffer();
  pendingSentenceBuffer = "";
  pendingTranscript = "";

  metrics.mark("interrupt", { reason });
}
```

说明：

- 前端任何地方都不要各自写一套中断逻辑
- 所有“闭嘴 / 取消 / 清空”统一走这里

## 8. Phase 1 的前后端接口设计

### 8.1 前端到后端

当前阶段保留已有 `/api/advice?stream=1`，但增加更清晰的会话字段。

建议请求结构：

```json
{
  "sessionId": "voice-session-uuid",
  "turnId": "turn-uuid",
  "source": "voice-realtime",
  "userRequest": "用户当前轮最终文本",
  "partialTranscript": "可选，调试或上下文使用",
  "conversationMode": "realtime-voice",
  "imageBase64": "",
  "imageMimeType": "",
  "clientMetrics": {
    "vadStartAt": 0,
    "vadEndAt": 0,
    "asrFirstPartialAt": 0
  }
}
```

### 8.2 后端到前端

继续使用 NDJSON 流式返回，但事件语义要更稳定。

建议事件类型：

- `status`
- `delta`
- `sentence`
- `complete`
- `error`

示例：

```json
{"type":"status","message":"正在思考"}
{"type":"delta","text":"你今天"}
{"type":"delta","text":"适合走自然一点的妆感。"}
{"type":"sentence","text":"你今天适合走自然一点的妆感。"}
{"type":"complete","result":{"ok":true}}
```

说明：

- `delta` 继续给前端打字机显示
- `sentence` 为后续 TTS 分句播放预留
- Phase 1 可以先不真正播 `sentence`
- 但后端协议现在就要预留出来

## 9. 与 OpenHarness 的关系

### 9.1 第一阶段的架构原则

第一阶段必须明确：

- `OpenHarness` 不再作为实时语音通话热路径的唯一核心
- 实时通话链路优先追求低延迟
- OpenHarness 保留为复杂对话、工具编排、扩展能力入口

### 9.2 第一阶段的接法

第一阶段先不彻底拆掉现有 OpenHarness 链路，而是做“会话控制层前置”：

1. 用户语音先进入 `VAD + 会话控制器`
2. 会话控制器决定什么时候真正发起 `/api/advice?stream=1`
3. 现有服务端仍然可以继续走 OpenHarness
4. 但前端已经具备：
   - 秒级打断
   - 秒级停止播报
   - 统一状态切换

也就是说：

- Phase 1 先把“前端通话体验底座”做好
- Phase 2 / Phase 3 再把后端热路径逐步替换成真正适合实时语音的流式能力

## 10. UI 与交互改造

Phase 1 左侧对话区要新增或强化以下 UI 元素。

### 10.1 语音通话入口

必须有一个明确按钮，例如：

- `开启语音通话`
- `结束语音通话`

用途：

- 满足浏览器音频权限与自动播放策略
- 让用户知道自己已进入实时语音模式

### 10.2 实时状态提示

建议显示状态：

- `等待你开口`
- `正在听`
- `正在思考`
- `正在回答`
- `已被打断`

### 10.3 实时字幕区

需要两行或两块内容：

- 用户当前实时转写
- 系统当前流式回复

### 10.4 调试面板

建议先做隐藏面板，不面向普通用户，但开发调试必须有。

显示：

- VAD 触发时间
- ASR 首字时间
- LLM 首字时间
- TTS 启动时间
- 当前状态机状态

## 11. 视频与视觉链路在 Phase 1 的处理方式

Phase 1 不做最终版视频对话，但必须预留接口。

建议：

- 仍然保留当前 `captureFrame()` 逻辑作为兼容方案
- 但新增 `frameProvider` 抽象

前端统一通过：

- `getLatestFrame()`
- `getLatestFaceRoiFrame()`

去拿图像，而不是业务代码直接自己截 `canvas`

这样后续 Phase 4 改成：

- 定时抽帧
- 人脸 ROI 裁剪
- WebP 预编码

时，不需要再改会话控制层。

## 12. 实施顺序

Phase 1 推荐按以下顺序落地。

### 12.1 第一步：抽离会话控制器

先做：

- `conversation-orchestrator`
- `tts-adapter`
- 当前 `/api/advice?stream=1` 的统一接入

先把“统一中断”和“统一状态切换”做起来。

### 12.2 第二步：抽离 ASR 适配层

先把当前 `Web Speech API` 封成 `asr-adapter`，让业务代码不直接依赖浏览器原生对象。

### 12.3 第三步：接入 VAD

再把 `@ricky0123/vad` 接进来，让 VAD 驱动：

- 开口即打断
- 停嘴即提交

### 12.4 第四步：埋点与调试面板

把关键时延都记录下来，便于后面继续调优。

## 13. Phase 1 验收标准

第一阶段完成后，至少要满足以下验收标准：

1. 用户点击“开启语音通话”后，浏览器能正常进入监听状态
2. 用户开口时，状态能从 `listening` 切到 `capturing`
3. 系统播报时，用户重新开口能在可感知极短时间内打断播报
4. 系统思考中，用户重新开口能取消上一轮请求
5. 左侧对话区能看到当前状态和当前轮字幕
6. 所有中断都走统一控制器，而不是散落在多个回调里
7. 现有文本对话和 OpenHarness 流式文字能力不被破坏

## 14. 风险与注意事项

### 14.1 浏览器兼容性

`Web Speech API` 在不同浏览器上的表现差异较大，第一阶段必须接受：

- Chrome 优先
- Edge 次优
- Safari / Firefox 可能需要降级提示

### 14.2 回声消除不完全可靠

浏览器自带 `echoCancellation` 有帮助，但不是万能。

第一阶段先做：

- AEC 开启
- VAD 防抖
- TTS 中断优先级提高

后续再考虑更深的麦克风侧链压制。

### 14.3 不能让旧逻辑和新逻辑互相抢状态

当前 `public/app.js` 里已有：

- `recognition`
- `requestAdvice(...)`
- `speechSynthesis`
- 打断逻辑

第一阶段改造时，必须避免：

- 旧逻辑还在直接改状态
- 新逻辑也在改状态

正确做法是：

- 新控制器成为唯一入口
- 旧逻辑逐步退化为适配层

## 15. 后续阶段如何承接

Phase 1 完成后，后续阶段顺滑接入如下：

- Phase 2：把 `asr-adapter` 的实现从 `Web Speech API` 换成火山流式 ASR
- Phase 3：把 `tts-adapter` 的实现从 `speechSynthesis` 换成流式 TTS
- Phase 4：把 `frameProvider` 从临时截图换成后台抽帧 + ROI + 预编码
- Phase 5：把复杂请求路由给 OpenHarness，把高频短对话保留在实时热路径

## 16. 本阶段产出清单

本设计文档对应的第一批实际代码产出建议包括：

1. 前端新增音频子模块目录
2. 新增实时语音会话控制器
3. 新增 VAD 接入
4. 新增 ASR 适配层
5. 新增 TTS 适配层
6. 新增实时调试指标
7. 左侧对话区新增实时通话 UI 状态
8. 服务端为实时语音会话补充会话字段与更稳定的流式事件语义

## 17. 版本记录

### v1.0.0 - 2026-06-15

- 新增实时语音通话 `Phase 1` 详细技术设计。
- 明确第一阶段以 `VAD + 会话控制器 + 统一打断` 为核心。
- 明确 `OpenHarness` 在实时链路中不再承担唯一热路径角色。
- 明确前后端模块拆分、状态机、接口和验收标准。
