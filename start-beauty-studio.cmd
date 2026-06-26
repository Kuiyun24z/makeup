@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-beauty-studio.ps1" -StartOpenHarness %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Beauty Studio failed to start. Press any key to close.
  pause >nul
)

exit /b %EXIT_CODE%
