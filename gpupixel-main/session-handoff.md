# GPUPixel v21 Eyebrow Darken Handoff

## 当前状态

源码升级到 **v21**：在 v20（嘴/鼻 reshape + 放大 UI，已验收）基础上新增眉毛加深特效。

- 工作目录：`C:\Users\huaweiuser\Desktop\GPUPixel`
- 预期面板版本：`Build: v21 eyebrow darken`
- 启动命令：`.\start_video_client_mediapipe.cmd`（优先 v21.exe，未构建时回退 v20/v19）
- 客户端产物：`gpupixel_video_client_v21.exe` **需在 Windows 上 cmake 构建后才会生成**。本轮新增了源文件 `eyebrow_renderer_mp468.cc`，**建议让 CMake 重新配置**（删 `build\windows-nmake` 重配，或确保 configure 重跑），否则新文件可能不被编译进去。
- 本会话未执行 `git add` / `git commit`。

## 重要：git 状态

HEAD 仍在 `8e11753`（v18）。**v19 + v20 + v21 全部改动至今未提交。** 建议尽快在本机提交存档：

```powershell
cd C:\Users\huaweiuser\Desktop\GPUPixel
git add -A
git commit -m "Add v19 lipstick lead, v20 mouth/nose reshape, v21 eyebrow darken"
```

## 功能状态

- `reshape-mouth-nose-001`：**passing**（用户已构建 v20 验收；强度 0.30→0.15）。
- `eyebrow-darken-001`：**in_progress**（当前唯一活动功能，待用户构建 v21 人眼验收）。
- `lipstick-002`：**blocked**（用户主动冻结，v19 代码已保留未回退）。

## v21 改了什么

新增 `demo/desktop/eyebrow_renderer_mp468.h/.cc`（`EyebrowRendererMP468`），和口红渲染同一套做法（基于关键点的像素效果，GPUPixel 输出后处理）：
- 用 MP468 眉毛点构左右眉多边形（右眉 70/63/105/66/107/55/65/52/53/46，左眉 300/293/334/296/336/285/295/282/283/276）。
- 区域内做乘法变暗，按 `BrowConfidence` 加权：暗发丝加深更多，眉间亮皮肤少压暗；边缘 `edge_feather_px` 羽化、小幅 `expand_px` 外扩。
- 面板加 `Eyebrow` 滑块（0..10）；后处理块现在口红和眉毛写入同一 frame。
- 强度初值 `darkness=0.55`、`edge_feather_px=6`。

## 已验证 / 未验证

- 已过：Grep/Read 核对客户端接入（include/using/BeautyState/后处理/滑块/实例化）、CMake 源文件、版本号脚本一致；眉毛渲染几何严格镜像已验证的 lip_renderer。
- 未做（需用户 Windows）：cmake 构建（沙箱无 MSVC）+ 摄像头人眼验收。
- 注意：沙箱挂载对 `feature_list.json` 是过期快照，`json.tool` 不可信，已改用 Read 核对。

## 验证建议（用户 Windows PowerShell）

```powershell
cd C:\Users\huaweiuser\Desktop\GPUPixel

# 新增了源文件，建议重新配置一次（首次或加文件后）：
& cmd.exe /c 'call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 && cmake -S . -B build\windows-nmake -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release -DGPUPIXEL_BUILD_DESKTOP_DEMO=ON -DGPUPIXEL_ENABLE_FACE_DETECTOR=OFF && cmake --build build\windows-nmake --config Release --target gpupixel_video_client'

dir build\windows-nmake\out\bin\gpupixel_video_client_v21.exe
.\start_video_client_mediapipe.cmd
```

面板应显示 `Build: v21 eyebrow darken`，有 `Eyebrow` 滑块。拉高看眉毛加深。

## 下一步建议

1. 眉毛太重/太轻：调 `eyebrow_renderer_mp468.h` 的 `darkness`（当前 0.55）。边缘生硬：调 `edge_feather_px`。压到眉间皮肤：调 `BrowConfidence` 的亮度阈值或 `expand_px`。
2. 嘴/鼻力度调整：`demo\desktop\video_client_mp468.cc` 的 `kMouthResizeStrength`/`kNoseResizeStrength`（当前 0.15）。
3. UI 大小：`kUiScale`（当前 1.6）。
4. 口红解冻后回到 `lipstick-002`。
5. 尽快 commit（见上）。
