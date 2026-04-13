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

set "msg=transchat update"

echo.
echo [1/4] Staging changes...
"%GIT_EXE%" add .
if errorlevel 1 (
  echo [ERROR] git add failed.
  pause
  exit /b 1
)

"%GIT_EXE%" diff --cached --quiet
if errorlevel 1 (
  echo [2/4] Creating commit...
  "%GIT_EXE%" commit -m "%msg%"
  if errorlevel 1 (
    echo [ERROR] git commit failed.
    pause
    exit /b 1
  )
) else (
  echo [2/4] No staged changes to commit. Push only.
)

set "BRANCH="
for /f "delims=" %%i in ('"%GIT_EXE%" branch --show-current 2^>nul') do set "BRANCH=%%i"

if "%BRANCH%"=="" (
  echo [ERROR] Could not detect the current branch.
  pause
  exit /b 1
)

echo [3/4] Pushing to remote...
"%GIT_EXE%" push -u origin "%BRANCH%"
if errorlevel 1 (
  echo [ERROR] git push failed.
  echo Check the origin remote and GitHub sign-in.
  pause
  exit /b 1
)

echo [4/4] Done.
echo Branch: %BRANCH%
pause
exit /b 0
