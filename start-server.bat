@echo off
echo ========================================================
echo   Asset Dashboard Server Starting...
echo ========================================================
echo.
echo 1. Opening Chrome...
start chrome "http://localhost:3000"
echo 2. Running Vercel Dev Server...
vercel dev
pause
