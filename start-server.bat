@echo off
title RigRout Server
cd /d "%~dp0"
echo.
echo  Starting RigRout server...
echo  Open Chrome and go to: http://localhost:3001/rigrout.html
echo.
node rigrout-server.js
pause
