@echo off
setlocal
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" if exist "node_modules\cytoscape\dist\cytoscape.min.js" goto launch

echo Installing Graf Desktop dependencies for first launch...
call npm install
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and Node.js installation.
  pause
  exit /b 1
)

:launch
call npm run dev
if errorlevel 1 pause
