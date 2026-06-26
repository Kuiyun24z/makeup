@echo off
setlocal

set "ROOT=%~dp0"
set "GPUPIXEL_SCRIPT=%ROOT%gpupixel-main\start_video_client_mediapipe.cmd"

if not exist "%GPUPIXEL_SCRIPT%" (
  echo Missing %GPUPIXEL_SCRIPT%
  echo Please make sure gpupixel-main has been merged and built.
  pause
  exit /b 1
)

call "%GPUPIXEL_SCRIPT%" %*
exit /b %ERRORLEVEL%
