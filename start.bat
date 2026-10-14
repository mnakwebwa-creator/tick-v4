@echo off
title Tick - school attendance
cd /d "%~dp0"
echo.
echo  Tick - school attendance
echo  ========================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org
  goto fail
)

if not exist "node_modules" (
  echo Installing - first time only, this can take a few minutes...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto fail
)
if not exist "web\dist\index.html" (
  echo Building the app - first time only. Downloads the 38 MB face model if needed...
  call npm run build
  if errorlevel 1 goto fail
)

start "" /min cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:4000"
echo.
echo  Tick opens in your browser at http://localhost:4000
echo  First time? Choose "Set up your school" to create the administrator account.
echo  Keep this window open while using Tick. Close it to stop.
echo.
call npm start
goto end

:fail
echo.
echo Something went wrong - see the message above.
pause
exit /b 1

:end
pause
