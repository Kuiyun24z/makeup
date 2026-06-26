# GPUPixel 模块说明

- 模块目录：`D:\work\makeup\gpupixel-main`
- 适配层目录：`D:\work\makeup\gpupixel-service`
- 当前版本来源：桌面 `GPUPixel` 合并后的 v21 构建

## 当前定位

GPUPixel 是当前项目唯一保留的美颜主引擎。旧的 Beauty Studio 侧 PixelFree 控制层、浏览器 face parsing、3DDFA 说明与旧源码目录已经清理出主项目路径。

## 启动方式

- 主项目一键启动：`D:\work\makeup\start-beauty-studio.ps1`
- 原生 GPUPixel 客户端：`D:\work\makeup\start-gpupixel-native.cmd`

主项目启动脚本默认会停止已有 `gpupixel_video_client*` 进程，避免网页摄像头和原生客户端同时抢摄像头。

## 需要保留的 GPUPixel 内部桥

`D:\work\makeup\gpupixel-main\desktop_mediapipe_bridge` 属于 GPUPixel v21 自身的 landmark 桥接链路，不是旧 Beauty Studio 网页模块。清理旧模块时不要删除它。

## 构建产物

优先使用：

`D:\work\makeup\gpupixel-main\build\windows-nmake\out\bin\gpupixel_video_client_v21.exe`

`gpupixel-service` 的健康检查会优先检测 v21，并保留旧版本回退路径。
