@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "worker-config.bat" (
  echo ERROR: Create worker-config.bat from worker-config.bat.example first.
  pause
  exit /b 2
)

set "WORKER_LAUNCHER=%~dp0start-analysis-worker.bat"
schtasks /Create /F /SC ONLOGON /RL LIMITED /TN "ShogiReviewAnalysisWorker" /TR "%WORKER_LAUNCHER%"
if errorlevel 1 (
  echo ERROR: Task Scheduler registration failed.
  pause
  exit /b 1
)

echo Registered ShogiReviewAnalysisWorker. It will start at the next logon.
echo To start it now, double-click start-analysis-worker.bat.
pause
