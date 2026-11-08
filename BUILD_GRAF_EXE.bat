@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BUILD_WINDOWS.ps1"
if errorlevel 1 (
  echo.
  echo Graf Windows installer build failed. Review the PowerShell output above.
  pause
  exit /b 1
)
echo.
echo Graf installer build completed.
pause
