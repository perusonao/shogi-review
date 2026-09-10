@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "tools\import_new_games.py" (
  echo ERROR: Run this launcher from the shogi-review repository root.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python was not found.
  pause
  exit /b 1
)

set "PYTHONUTF8=1"
python "tools\import_new_games.py" --ask-publish
if errorlevel 1 (
  echo.
  echo The process stopped safely. See the Japanese error above.
  pause
  exit /b 1
)

echo.
echo Completed.
pause
