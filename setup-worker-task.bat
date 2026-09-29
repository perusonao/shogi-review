@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "worker-config.bat" (
  echo ERROR: Create worker-config.bat from worker-config.bat.example first.
  pause
  exit /b 2
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-worker-task.ps1"
if errorlevel 1 (
  echo ERROR: Task Scheduler registration failed.
  pause
  exit /b 1
)

echo Registered ShogiReviewAnalysisWorker. It will start at the next logon.
echo To start it now, double-click start-analysis-worker.bat.
pause
