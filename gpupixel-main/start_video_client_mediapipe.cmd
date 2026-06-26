@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHON=%LOCAL_ASR_PYTHON%"
if not defined PYTHON set "PYTHON=C:\ProgramData\miniconda3\envs\openharness\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"
set "BRIDGE_PORT=8790"
set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v21.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v20.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v19.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v18.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v17.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v16.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v15.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v14.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v13.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v12.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v11.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v10.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v9.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v8.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v7.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v6.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v5.exe"
if not exist "%CLIENT%" set "CLIENT=%ROOT%build\windows-nmake\out\bin\gpupixel_video_client_v4.exe"
set "BRIDGE_SCRIPT=%ROOT%desktop_mediapipe_bridge\bridge_server.py"

if not exist "%CLIENT%" (
  echo Missing %CLIENT%
  echo Please build gpupixel_video_client first.
  exit /b 1
)

if not "%PYTHON%"=="python" (
  start "GPUPixel MediaPipe Bridge" cmd /k ""%PYTHON%" "%BRIDGE_SCRIPT%""
) else (
  start "GPUPixel MediaPipe Bridge" cmd /k python "%BRIDGE_SCRIPT%"
)

timeout /t 2 /nobreak >nul
set "BRIDGE_URL=http://127.0.0.1:%BRIDGE_PORT%/"
set "BROWSER_PROFILE=%ROOT%build\windows-nmake\out\mediapipe_bridge_browser_profile"
set "BROWSER_FLAGS=--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER_PROFILE%" mkdir "%BROWSER_PROFILE%"
if exist "%EDGE%" (
  start "GPUPixel MediaPipe Browser" "%EDGE%" --user-data-dir="%BROWSER_PROFILE%" --app="%BRIDGE_URL%" %BROWSER_FLAGS%
) else if exist "%CHROME%" (
  start "GPUPixel MediaPipe Browser" "%CHROME%" --user-data-dir="%BROWSER_PROFILE%" --app="%BRIDGE_URL%" %BROWSER_FLAGS%
) else (
  start "" "%BRIDGE_URL%"
)
"%CLIENT%"
