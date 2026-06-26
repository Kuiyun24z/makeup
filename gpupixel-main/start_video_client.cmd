@echo off
setlocal
cd /d "%~dp0"

set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v21.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v20.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v19.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v18.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v17.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v16.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v15.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v14.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v13.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v12.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v11.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v10.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v9.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v8.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v7.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v6.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v5.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v4.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v3.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client_v2.exe"
if not exist "%APP%" set "APP=build\windows-nmake\out\bin\gpupixel_video_client.exe"
if not exist "%APP%" (
  echo Missing %APP%
  echo Build it first:
  echo   cmake --build build\windows-nmake --config Release --target gpupixel_video_client
  pause
  exit /b 1
)

if "%~1"=="" (
  "%APP%"
) else (
  "%APP%" "%~1"
)
