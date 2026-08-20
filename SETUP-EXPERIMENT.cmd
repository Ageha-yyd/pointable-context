@echo off
setlocal
cd /d "%~dp0"

set "POINTABLE_LANGUAGE=%~1"
if /i "%POINTABLE_LANGUAGE%"=="zh-CN" goto language_ok
if /i "%POINTABLE_LANGUAGE%"=="en-US" goto language_ok

echo Select experiment language:
echo   1. Chinese zh-CN
echo   2. English en-US
set /p "POINTABLE_LANGUAGE_CHOICE=Enter 1 or 2: "
if "%POINTABLE_LANGUAGE_CHOICE%"=="1" set "POINTABLE_LANGUAGE=zh-CN"
if "%POINTABLE_LANGUAGE_CHOICE%"=="2" set "POINTABLE_LANGUAGE=en-US"

:language_ok
if /i not "%POINTABLE_LANGUAGE%"=="zh-CN" if /i not "%POINTABLE_LANGUAGE%"=="en-US" (
  echo Invalid language. Use zh-CN or en-US.
  exit /b 64
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  exit /b 2
)
for /f "tokens=1 delims=." %%V in ('node.exe -p "process.versions.node"') do set "POINTABLE_NODE_MAJOR=%%V"
if %POINTABLE_NODE_MAJOR% LSS 24 (
  echo Node.js 24 or newer is required. Current major: %POINTABLE_NODE_MAJOR%
  exit /b 2
)

where git.exe >nul 2>nul
if errorlevel 1 (
  echo Git for Windows is required.
  exit /b 2
)

if exist "package.json" (
  where pnpm.cmd >nul 2>nul
  if errorlevel 1 (
    where npx.cmd >nul 2>nul
    if errorlevel 1 (
      echo pnpm is unavailable and npx cannot install the pinned runner.
      exit /b 2
    )
    call npx.cmd --yes pnpm@11.19.0 install --frozen-lockfile
    if errorlevel 1 exit /b 2
    call npx.cmd --yes pnpm@11.19.0 run build:study-v2:bundle
    if errorlevel 1 exit /b 2
    call npx.cmd --yes pnpm@11.19.0 run study-v2:validate
    if errorlevel 1 exit /b 2
  ) else (
    call pnpm.cmd install --frozen-lockfile
    if errorlevel 1 exit /b 2
    call pnpm.cmd run build:study-v2:bundle
    if errorlevel 1 exit /b 2
    call pnpm.cmd run study-v2:validate
    if errorlevel 1 exit /b 2
  )
) else (
  if not exist "bin\pointable-study.mjs" (
    echo Neither a source checkout nor a built study release was found.
    exit /b 2
  )
  node.exe "bin\pointable-study.mjs" validate-pack --repository-root . --json
  if errorlevel 1 exit /b 2
)

> ".pointable-study-language" echo %POINTABLE_LANGUAGE%
echo.
echo Prepared language: %POINTABLE_LANGUAGE%
echo Pack validation passed. No measured trial has started.
echo Next: run START-STUDY-SETUP.cmd, then follow docs\evaluation\study-v2\STUDY_SETUP_AGENT.md.
exit /b 0
