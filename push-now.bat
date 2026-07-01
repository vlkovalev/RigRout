@echo off
title RigRout — Pushing to GitHub
cd /d "%~dp0"
echo Pushing to github.com/heliu/rigrout...
git remote remove origin 2>nul
git remote add origin https://github.com/heliu/rigrout.git
git push -u origin main
echo.
if errorlevel 1 (
  echo Push failed - you may need to sign in to GitHub.
  echo Use a Personal Access Token as your password.
) else (
  echo SUCCESS: https://github.com/heliu/rigrout
)
pause
