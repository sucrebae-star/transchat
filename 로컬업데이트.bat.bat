@echo off
setlocal

cd /d "%~dp0"

set "GIT_EXE=git"
where git >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Git\cmd\git.exe" (
    set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
  ) else if exist "C:\Program Files\Git\bin\git.exe" (
    set "GIT_EXE=C:\Program Files\Git\bin\git.exe"
  ) else (
    echo [ERROR] Git was not found.
    echo Install Git for Windows or add git to PATH.
    pause
    exit /b 1
  )
)

"%GIT_EXE%" rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [ERROR] This folder is not a Git repository.
  pause
  exit /b 1
)

set "BRANCH="
for /f "delims=" %%i in ('"%GIT_EXE%" branch --show-current 2^>nul') do set "BRANCH=%%i"

if "%BRANCH%"=="" (
  echo [ERROR] Could not detect the current branch.
  pause
  exit /b 1
)

echo [1/3] Fetching remote updates...
"%GIT_EXE%" fetch origin
if errorlevel 1 (
  echo [ERROR] git fetch failed.
  pause
  exit /b 1
)

echo [2/3] Pulling latest changes for %BRANCH%...
"%GIT_EXE%" pull origin "%BRANCH%"
if errorlevel 1 (
  echo [ERROR] git pull failed.
  echo Check for local conflicts, remote setup, or GitHub sign-in.
  pause
  exit /b 1
)

echo [3/3] Local update complete.
echo Branch: %BRANCH%
pause
exit /b 0
