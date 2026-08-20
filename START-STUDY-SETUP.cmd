@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  echo Install it, then run this file again.
  pause
  exit /b 2
)

for /f "tokens=1 delims=." %%V in ('node.exe -p "process.versions.node"') do set "POINTABLE_NODE_MAJOR=%%V"
if %POINTABLE_NODE_MAJOR% LSS 24 (
  echo Node.js 24 or newer is required. Current major: %POINTABLE_NODE_MAJOR%
  pause
  exit /b 2
)

node.exe "%~dp0scripts\launch-study-codex.mjs"
if errorlevel 1 (
  pause
  exit /b 2
)

echo.
echo Codex study Host is ready. Open a new setup-only Codex task and use STUDY_SETUP_AGENT.md.
pause
