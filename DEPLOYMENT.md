# Beauty Studio Windows 开发副本部署

这份项目副本同时支持：

- 直接运行当前已验证版本
- 修改网页、Node 服务和 OpenHarness
- 修改并重新编译 GPUPixel C++
- 离线恢复 FunASR、Whisper 和 Piper 模型

## 1. 固定目录

将交付包中的 `makeup` 文件夹放到：

```text
D:\work\makeup
```

不要修改目录名。现有启动脚本和本地配置以这个路径为标准。

## 2. Windows 前置软件

以管理员身份安装：

1. Visual Studio 2022 或 Build Tools 2022
   - Desktop development with C++
   - MSVC v143
   - Windows 10/11 SDK
   - CMake tools for Windows
2. CMake，建议安装在 `C:\Program Files\CMake`
3. Node.js 24
4. Git for Windows
5. Miniconda，安装在：

```text
C:\ProgramData\miniconda3
```

6. Microsoft Edge 或 Google Chrome

先运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\check-prerequisites.ps1
```

## 3. 安装开发环境

以管理员 PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\install-development-bundle.ps1
```

安装脚本会：

- 创建或更新 `openharness` Conda 环境
- 安装锁定的 Python 依赖
- 以 editable 模式安装当前 `OpenHarness-main`
- 将离线 FunASR 模型恢复到 `%USERPROFILE%\.cache\modelscope`
- 检查 GPUPixel v21、Piper 音色和本地模型

## 4. 首次启动

双击：

```text
D:\work\makeup\start-beauty-studio.cmd
```

或运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\start-beauty-studio.ps1
```

浏览器地址：

```text
http://127.0.0.1:4173
```

## 5. 验收

服务启动后运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\verify-deployment.ps1
```

页面需要满足：

- 显示 GPUPixel 美颜后视频
- 滑块可以调整磨皮、提亮、瘦脸、大眼、嘴型、鼻型、眉毛和腮红
- 语音可以控制美颜参数
- 说“看看我的脸型怎么样”时出现读取画面和分析进度
- 魔镜使用视觉结果回答，不显示内部工具协议

## 6. 修改网页与 Node 服务

主要目录：

```text
beauty-studio-site
gpupixel-service
local-asr-service
local-tts-service
```

修改后重新运行 `start-beauty-studio.cmd`。

Node 测试：

```powershell
cd D:\work\makeup\beauty-studio-site
node --test *.test.js
node --check server.js
node --check public\app.js
```

## 7. 修改 OpenHarness

当前项目对 OpenHarness 做过重要修改：

- 豆包 PLHD 内联工具协议解析
- `FunctionCallEnd` 内联工具协议解析
- Beauty Studio 专用工具白名单
- 当前 GPUPixel 画面视觉工具

修改位置：

```text
OpenHarness-main
.ohmo-beauty-studio
```

回归测试：

```powershell
cd D:\work\makeup\OpenHarness-main
$env:UV_CACHE_DIR = "D:\work\makeup\.uv-cache"
uv run python tests\repro_plhd_inline_tool.py
uv run python tests\repro_tool_allowlist.py
uv run python D:\work\makeup\.ohmo-beauty-studio\plugins\beauty-vision\tests\test_inspect_current_beauty_frame.py -v
```

## 8. 修改和重新编译 GPUPixel

在 Visual Studio Developer PowerShell 中运行：

```powershell
cd D:\work\makeup\gpupixel-main
cmake -S . -B build\windows-nmake -G "NMake Makefiles" `
  -DCMAKE_BUILD_TYPE=Release `
  -DGPUPIXEL_BUILD_DESKTOP_DEMO=ON `
  -DGPUPIXEL_ENABLE_FACE_DETECTOR=OFF

cmake --build build\windows-nmake --config Release --target gpupixel_video_client
```

目标程序：

```text
gpupixel-main\build\windows-nmake\out\bin\gpupixel_video_client_v21.exe
```

重新编译后再次运行 `start-beauty-studio.cmd`。

## 9. 共享密钥

以下文件包含临时共享的 Ark Key：

```text
beauty-studio.local.ps1
.ohmo-beauty-studio\settings.json
```

禁止将它们上传到公共 Git 仓库。共享结束后应更换 Ark Key。

## 10. 常见问题

### 摄像头显示 Device in use

关闭其他摄像头软件，然后重新运行一键脚本。脚本会终止旧的 GPUPixel 客户端，只保留一个摄像头进程。

### OpenHarness 启动失败

确认：

```text
C:\ProgramData\miniconda3\envs\openharness\Scripts\uv.exe
```

存在，并重新运行安装脚本。

### FunASR 第一次启动下载模型

说明离线模型缓存没有恢复成功。重新运行安装脚本，或检查：

```text
%USERPROFILE%\.cache\modelscope
```

### 网页有视频但视觉分析失败

检查 `8791/latest.jpg`、Ark Key 和网络连接。视觉分析本身使用豆包在线接口。

