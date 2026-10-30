@echo off
setlocal
cd /d "%~dp0skill\chaoxing-answer"

if not exist "config.local.json" (
  echo [ERROR] config.local.json not found:
  echo         %CD%
  echo         Copy config.example.json and fill in your API key.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js 18+ first.
  pause
  exit /b 1
)

echo ============================================
echo  chaoxing-answer bridge
echo  Health: http://127.0.0.1:8765/health
echo  Keep this window open while studying.
echo  Press Ctrl+C to stop.
echo ============================================
echo.

node server.mjs

echo.
echo Bridge stopped.
pause
