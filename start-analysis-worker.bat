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

if "%SHOGI_WORKER_ROOT%"=="" set "SHOGI_WORKER_ROOT=%LOCALAPPDATA%\shogi-review-worker"

set "PYTHONUTF8=1"
python "tools\prepare_worker_workspace.py" --source "%~dp0" --workspace "%SHOGI_WORKER_ROOT%"
if errorlevel 1 exit /b %errorlevel%

python "%SHOGI_WORKER_ROOT%\tools\analysis_worker.py" --root "%SHOGI_WORKER_ROOT%"
exit /b %errorlevel%
