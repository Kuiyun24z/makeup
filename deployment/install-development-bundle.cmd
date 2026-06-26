@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-development-bundle.ps1" %*
exit /b %ERRORLEVEL%

