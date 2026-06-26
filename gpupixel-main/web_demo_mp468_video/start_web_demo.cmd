@echo off
setlocal
cd /d "%~dp0\.."

set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%CODEX_PYTHON%" (
  "%CODEX_PYTHON%" web_demo_mp468_video\processor_server.py
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python web_demo_mp468_video\processor_server.py
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py web_demo_mp468_video\processor_server.py
  exit /b %ERRORLEVEL%
)

echo Python was not found.
exit /b 1
