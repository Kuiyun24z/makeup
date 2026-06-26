@echo off
setlocal
set "DEMO_DIR=%~dp0"
for %%I in ("%DEMO_DIR%..") do set "PROJECT_ROOT=%%~fI"
set "PYTHON=%PROJECT_ROOT%\.venv-openharness\Scripts\python.exe"
set "MEDIAPIPE_VENDOR=%PROJECT_ROOT%\web_demo\vendor\mediapipe"

if not exist "%PYTHON%" (
  echo Missing Python runtime: %PYTHON%
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MEDIAPIPE_VENDOR%\check_mediapipe_assets.ps1"
if errorlevel 1 (
  echo MediaPipe local assets are missing. The app will try the CDN fallback until assets are downloaded.
  echo Run .\web_demo\vendor\mediapipe\download_mediapipe_assets.cmd to complete offline mode.
)

powershell.exe -NoProfile -Command "try { $c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction Stop; if ($c) { exit 10 } } catch { exit 0 }"
if %ERRORLEVEL%==10 (
  echo Restarting running Beauty Agent demo to pick up latest code...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DEMO_DIR%stop_demo.ps1"
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
)

start "Beauty Agent Demo" /min powershell.exe -NoProfile -NoExit -Command "Set-Location -LiteralPath '%PROJECT_ROOT%'; .\.venv-openharness\Scripts\python.exe web_demo\server.py"
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"
powershell.exe -NoProfile -Command "$h = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 10; if (-not $h.ok) { exit 1 }"
if errorlevel 1 (
  echo Demo server started, but health check failed.
  exit /b 1
)

echo Beauty Agent demo running at http://127.0.0.1:8765
