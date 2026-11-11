@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not defined LINZHI_PORT set "LINZHI_PORT=8900"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Screen Beyond] Node.js 18 or newer is required for standalone chat.
  echo Download: https://nodejs.org/
  echo After installing Node.js, run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo [Screen Beyond] Starting standalone chat...
echo URL: http://127.0.0.1:%LINZHI_PORT%/
echo Data folder (default): %USERPROFILE%\.dsh-companion
echo Close this window to stop.
echo.

if not defined PURE_CHAT_NO_BROWSER start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%LINZHI_PORT%/'"
node "%~dp0runtime\server.mjs"
