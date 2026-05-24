@echo off
title RigRout — Git Push to GitHub
cd /d "%~dp0"

echo.
echo  ====================================================
echo   RigRout — Push to github.com/heliu/rigrout
echo  ====================================================
echo.

REM Clean up any partial .git from previous attempts
if exist ".git" (
  echo  Removing previous partial .git folder...
  rmdir /s /q .git
)

REM Initialize fresh
echo  Initializing git repository...
git init
git branch -M main

REM Create .gitignore
echo node_modules/ > .gitignore
echo .DS_Store >> .gitignore
echo *.log >> .gitignore
echo Thumbs.db >> .gitignore

REM Set identity
git config user.email "vl_kovalev@yahoo.com"
git config user.name "heliu"

REM Stage everything
echo.
echo  Staging all files...
git add -A

REM Show summary
echo.
echo  Files staged:
git status --short

REM Commit
echo.
echo  Committing...
git commit -m "RigRout v1.0 — Commercial Route Intelligence

- 24 live road ban feeds (5 Canada + 19 US states)
- Road restriction sources panel with real-time status
- Metric/imperial toggle fixed (no double-conversion)
- Saved favorites moved under route planning
- Multi-stop route planning
- Weather along route, live incidents, POI filters
- Node.js server for proxy + route audit"

echo.
echo  Connecting to GitHub...
git remote add origin https://github.com/heliu/rigrout.git

echo.
echo  Pushing...
git push -u origin main

echo.
if errorlevel 1 (
  echo  !! Push failed.
  echo     If asked for a password, use a GitHub Personal Access Token:
  echo     GitHub.com → Settings → Developer settings → Personal access tokens
  echo     Generate a token with "repo" scope, use it as the password.
) else (
  echo  ====================================================
  echo   SUCCESS! Live at: https://github.com/heliu/rigrout
  echo  ====================================================
)
echo.
pause
