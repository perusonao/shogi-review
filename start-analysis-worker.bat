@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if exist "worker-config.bat" call "worker-config.bat"

if "%SHOGI_QUEUE_URL%"=="" (
  echo ERROR: SHOGI_QUEUE_URL is not configured.
  echo Copy worker-config.bat.example to worker-config.bat and edit it locally.
  exit /b 2
)
if "%SHOGI_WORKER_SECRET%"=="" (
  echo ERROR: SHOGI_WORKER_SECRET is not configured.
  exit /b 2
)

set "PYTHONUTF8=1"
python "tools\analysis_worker.py"
exit /b %errorlevel%
