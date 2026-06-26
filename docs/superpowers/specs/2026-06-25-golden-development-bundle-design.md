# Beauty Studio 黄金开发副本设计

## 目标

为同配置 Windows 电脑制作一份可立即运行、可重新编译、可继续开发的完整副本。目标安装路径固定为 `D:\work\makeup`。

## 交付策略

采用“源码 + 已验证运行产物 + 离线模型 + 环境重建文件”的黄金开发副本：

- 已编译程序用于首次快速验收。
- 完整源码用于后续修改和重新构建。
- 本地模型随包交付，避免首次运行依赖网络下载。
- Conda 环境通过显式依赖文件重建，不复制与本机强绑定的整个环境目录。
- 共享 Ark API Key 放在本地配置文件中，不进入公共版本库；交付后应尽快轮换。

## 包含内容

- `beauty-studio-site`
- `gpupixel-main`
- `gpupixel-service`
- `OpenHarness-main`
- `.ohmo-beauty-studio`
- `local-asr-service`
- `local-tts-service`
- `models`
- FunASR ModelScope 模型缓存
- 根目录启动脚本和配置文件
- 部署、检查、验收和重新打包脚本
- Conda/Python 环境锁定文件

## 排除内容

- `deprecated-old-beauty-modules`
- `gpupixel-main.before-merge`
- `jhx`
- `VoxCPM-Demo`
- `.logs`
- `.uv-cache`
- `.superpowers`
- `.tmp-*`
- `__pycache__`
- 浏览器临时 profile
- GPUPixel CMake 中间文件中不影响运行或重新构建的缓存
- Codex 自带运行时

## 目录布局

交付目录解压后以 `makeup` 为根目录，并最终位于：

```text
D:\work\makeup
```

离线 FunASR 模型先放在：

```text
D:\work\makeup\offline-assets\modelscope
```

安装脚本将其同步到目标用户的：

```text
%USERPROFILE%\.cache\modelscope
```

## 环境要求

- Windows 11，硬件配置与原开发机一致
- Visual Studio 2022 C++ Build Tools
- CMake
- Node.js
- Miniconda，安装到 `C:\ProgramData\miniconda3`
- Edge 或 Chrome
- 摄像头权限已开启

## 安全规则

- `beauty-studio.local.ps1` 和 `.ohmo-beauty-studio\settings.json` 含共享密钥，只允许点对点传输。
- 禁止把上述两个文件提交到公共 Git 仓库。
- 同事完成首次部署后应改用自己的 Ark Key；共享结束后轮换当前 Key。

## 验收标准

1. `start-beauty-studio.cmd` 一键启动成功。
2. `4173`、`9001`、`8791`、`9101`、`9102` 健康检查通过。
3. 仅有一个 `gpupixel_video_client_v21` 摄像头进程。
4. 网页显示 GPUPixel 美颜后画面。
5. 滑块和语音都能调整美颜参数。
6. “看看我的脸型怎么样”触发自动截图和视觉分析。
7. ASR、TTS、OpenHarness 和 Ark 视觉全部可用。
8. Node、Python 和 OpenHarness 回归测试全部通过。

