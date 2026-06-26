# OpenHarness 模块说明

- 文档版本：`v1.2.0`
- 最后更新：`2026-06-15`
- 模块目录：`D:\work\makeup\OpenHarness-main`
- 站点桥接文件：`D:\work\makeup\beauty-studio-site\server.js`

## 1. 模块是什么

OpenHarness 是当前系统左侧“魔镜对话”能力的核心对话模块。它不负责右侧镜像美颜渲染，但负责：

- 接住用户文本诉求
- 接住语音转文字后的诉求
- 生成回复
- 作为站点智能体后端参与整体交互

## 2. 它的原理

当前项目里，它不是以前端 SDK 的方式运行，而是由站点服务端以子进程方式拉起。

整体思路是：

1. Node 服务启动或首次需要时拉起 OpenHarness。
2. 站点服务构造 prompt。
3. 通过 stdin/stdout 或约定协议和 OpenHarness 交换消息。
4. 收到回复后再返回给前端。

这种方式的优点是：

- 前端比较轻
- 对话逻辑集中在服务端
- 以后更容易替换模型、拼接更多上下文

## 3. 它在项目里的用途

当前主要承担：

- 左侧对话框问答
- 语音唤醒后的对话回复
- 与镜像状态相关的引导建议
- 与图片上传、镜像截图配合的整体建议输出

## 4. 当前是怎么结合到系统里的

关键逻辑主要在：

- `submitToOpenHarness(...)`
- `buildOpenHarnessPrompt(...)`
- `/api/advice`

当前链路如下：

1. 前端调用 `requestAdvice(...)`
2. 请求到达 `server.js`
3. 服务端根据来源构造 prompt
4. 服务端把 prompt 发送给 OpenHarness
5. OpenHarness 返回文本
6. 服务端把结果整合后回传前端

## 5. 语音是怎么接到它这里的

当前语音链路不是 OpenHarness 直接监听麦克风，而是：

1. 浏览器用 `SpeechRecognition` 或 `webkitSpeechRecognition` 做前端语音识别。
2. 前端识别到热词“魔镜魔镜”。
3. 前端把识别出来的文本诉求发给 `/api/advice`。
4. 服务端再把文本诉求转给 OpenHarness。

所以它拿到的其实是：

- 语音转文字后的内容

而不是：

- 原始音频流

## 6. 它和 Ark（豆包）的关系

当前系统里，OpenHarness 和 Ark 不是完全重复的两个东西。

更准确地说：

- OpenHarness 偏对话、编排、回复生成
- Ark 偏视觉模型调用和图像理解

服务端会根据不同场景决定谁是主通道：

- 文本/语音咨询，更偏 OpenHarness
- 图片分析，更偏 Ark 视觉模型

## 7. 环境变量与启动

当前相关环境变量包括：

- `OPENHARNESS_RUNTIME`
- `OPENHARNESS_COMMAND`
- `OPENHARNESS_MODEL`
- `OPENHARNESS_API_FORMAT`
- `OPENHARNESS_BASE_URL`
- `OPENHARNESS_API_KEY`
- `OPENHARNESS_UV_EXE`
- `OPENHARNESS_UV_CACHE_DIR`
- `OPENHARNESS_READY_TIMEOUT_MS`
- `OPENHARNESS_REQUEST_TIMEOUT_MS`

同时，一键启动脚本已支持把 Ark 部分变量映射到 OpenHarness 侧，减少重复配置。

## 8. 当前限制

- 是否能稳定工作，依赖本地 OpenHarness 环境是否可运行。
- 是否能产出理想回复，依赖底层模型 API 是否可用。
- 浏览器若不支持语音识别，前端就无法完成热词唤醒输入。

## 9. 本次稳定性优化

这次优化的重点不是把 OpenHarness 替换成本地固定话术，而是修正站点和 OpenHarness 之间的桥接层。

之前出现“一会成功、一会失败”的主要原因，不是 OpenHarness 本体一定不稳定，而是桥接逻辑有几个明显问题：

1. 服务端在 OpenHarness 还没真正 `ready` 时，就可能提前写入请求。
2. 页面侧之前只等最终回复，没有把等待态和增量输出展示给用户，所以看起来像“没听到”。
3. 新问题发出后，旧问题没有真正中断 OpenHarness，只是前端自己切界面，导致旧回复可能延迟很久后突然返回。

## 10. 2026-06-15 对话链路升级

这次又补了一轮更贴近真实产品体验的升级，重点是“让用户知道系统听到了，并且让回复尽量原样显示”。

当前实际行为变成了：

1. 前端文本发送或语音转文字后，立即进入等待态。
2. 页面先显示“我听到了，正在回答，请稍等...”之类的反馈。
3. 服务端请求 `OpenHarness` 时，开始接收 `assistant_delta` 增量文本。
4. 增量文本会实时透传到前端对话区，而不是必须等整段结束。
5. 整段完成后，再返回完整 `replyText`。

这意味着：

- 用户不会再只看到静止界面然后怀疑没听到。
- 对话区显示的是更接近 OpenHarness 原始输出的内容。
- 页面不再把 OpenHarness 整段回复强行塞成固定模板文案。

## 11. 打断机制

这次也补了真正的中断链路。

以前的问题是：

- 用户重新输入了新问题；
- 页面虽然视觉上切到新问题；
- 但 OpenHarness 旧轮推理其实还在后台继续；
- 所以过很久旧回复还可能冒出来。

现在改成三层联动：

1. 前端重新输入时会取消当前 `fetch`。
2. Node 服务端收到请求中断后，会向 OpenHarness 发送 `interrupt`。
3. OpenHarness 停止当前活跃请求，旧轮回复不会继续顶回来。

## 12. 当前真实边界

需要特别说明的是：

- 当前页面展示的是 OpenHarness 的增量文本和最终文本。
- 这不等于暴露底层模型的完整内部 chain-of-thought。

也就是说，当前能展示的是：

- 等待态
- 增量生成中的可见回复文本
- 最终完整回复

而不是：

- 模型内部完整思维链

这样做的原因是：

- 用户体验上足够解决“是不是没听见”的问题；
- 同时也避免把不适合直接暴露的内部推理过程误当成产品能力。
2. 启动期任何 `stderr` 输出都可能被误判为启动失败。
3. 单次请求没有超时控制，遇到卡住时前端会一直等。
4. 进程退出后的恢复和队列清理不够彻底。

当前 `server.js` 已经做了这些修正：

- `startOpenHarnessBridge()` 改为真正等待 `ready` 事件后才视为启动成功。
- 增加 `OPENHARNESS_READY_TIMEOUT_MS`，防止后台启动卡死。
- `stderr` 改为记录到 `lastStderr`，不再默认把普通日志当失败。
- `submitToOpenHarness(...)` 改为先 `await startOpenHarnessBridge()`，避免抢跑。
- 增加 `OPENHARNESS_REQUEST_TIMEOUT_MS`，防止单次对话无限挂起。
- 请求超时、stdin 写入失败、子进程退出时，都会清理 pending 队列并正确返回错误。
- 健康探测只触发后台自恢复，不再把启动失败变成未处理 Promise。

## 10. 后续可优化方向

1. 把对话上下文管理做得更稳。
2. 在前端增加更明确的语音状态与失败原因提示。
3. 把镜像参数、图像分析结论、用户偏好更结构化地喂给 OpenHarness。

## 11. 版本记录

### v1.1.0 - 2026-06-15

- 保留 OpenHarness 作为主对话链路，不再使用“本地建议优先”替代真实问答。
- 修复站点桥接层未等待 `ready`、误判 `stderr`、缺少请求超时、恢复不彻底等稳定性问题。
- 补充桥接超时配置项与稳定性说明。

### v1.0.0 - 2026-06-15

- 新建 OpenHarness 模块说明。
- 说明其在当前系统里的对话职责和桥接方式。
