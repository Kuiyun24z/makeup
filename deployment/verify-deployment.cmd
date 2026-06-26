@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-deployment.ps1" %*
exit /b %ERRORLEVEL%

