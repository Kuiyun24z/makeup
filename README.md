# Makeup / Beauty Studio

本仓库是一个本地运行的美妆助手项目，整合了网页交互界面、GPUPixel 美颜引擎、本地语音服务和 OpenHarness 智能体流程。

核心目标是：在 Windows 本地启动一个 Beauty Studio，通过摄像头画面、语音/文字交互和美颜参数控制，完成实时美妆建议与效果调节。

## 项目结构

```text
D:\work\makeup
├─ beauty-studio-site/          # Web 页面与 Node 服务入口
├─ gpupixel-main/               # GPUPixel 原生美颜引擎
├─ gpupixel-service/            # GPUPixel 本地 HTTP 适配服务
├─ local-asr-service/           # 本地语音识别服务
├─ local-tts-service/           # 本地语音合成服务
├─ OpenHarness-main/            # OpenHarness 智能体运行环境
├─ deployment/                  # 开发包安装、构建、验收脚本
├─ docs/                        # 项目文档
├─ start-beauty-studio.ps1      # 一键启动脚本
├─ start-beauty-studio.cmd      # Windows 双击启动入口
└─ beauty-studio.local.example.ps1
```

## 快速启动

推荐在 Windows PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\start-beauty-studio.ps1
```

或者双击：

```text
start-beauty-studio.cmd
```

默认访问地址：

```text
http://127.0.0.1:4173
```

## 本地配置

复制示例配置：

```powershell
Copy-Item .\beauty-studio.local.example.ps1 .\beauty-studio.local.ps1
```

然后按需要填写本地环境变量，例如 Ark Vision API、端口、本地服务地址等。

注意：`beauty-studio.local.ps1` 是本机私有配置，不能提交到 GitHub。

## 常用命令

检查前置环境：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\check-prerequisites.ps1
```

安装或恢复开发环境：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\install-development-bundle.ps1
```

验收本地部署：

```powershell
powershell -ExecutionPolicy Bypass -File D:\work\makeup\deployment\verify-deployment.ps1
```

检查 Node 代码：

```powershell
node --check D:\work\makeup\beauty-studio-site\server.js
node --check D:\work\makeup\beauty-studio-site\public\app.js
node --check D:\work\makeup\gpupixel-service\server.js
```

## Git 说明

本仓库会忽略本地运行状态、模型文件、构建产物和私有配置，例如：

- `models/`
- `dist/`
- `.logs/`
- `.ohmo-beauty-studio/`
- `beauty-studio.local.ps1`
- `VoxCPM-Demo/`

如果需要上传大模型或二进制资源，建议使用 Git LFS 或单独的下载/恢复脚本管理。

## 更多文档

- [部署说明](./DEPLOYMENT.md)
- [Beauty Studio Site](./beauty-studio-site/README.md)
- [GPUPixel Service](./gpupixel-service/README.md)
- [OpenHarness](./OpenHarness-main/README.md)

