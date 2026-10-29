@echo off
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)
echo Open http://localhost:3210 in your browser when the server is ready.
call npm.cmd start
pause
