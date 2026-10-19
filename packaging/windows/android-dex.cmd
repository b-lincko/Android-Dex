@echo off
setlocal
set "HERE=%~dp0"
set "PORT=8787"
if "%DEX_PORT%" NEQ "" set "PORT=%DEX_PORT%"
if "%DEX_DATA_DIR%"=="" set "DEX_DATA_DIR=%LOCALAPPDATA%\Android DEX\data"
if "%DEX_SHARE_DIR%"=="" set "DEX_SHARE_DIR=%USERPROFILE%\Android-DEX-share"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install it from https://nodejs.org and run this shortcut again.
  pause
  exit /b 1
)

rem Start the bridge hidden when invoked with --background, otherwise keep the window.
if /I "%~1"=="--background" (
  start "" /min node "%HERE%server\src\cli.js" serve --host 127.0.0.1 --port %PORT% --data-dir "%DEX_DATA_DIR%" --share-dir "%DEX_SHARE_DIR%"
) else (
  start "" node "%HERE%server\src\cli.js" serve --host 127.0.0.1 --port %PORT% --data-dir "%DEX_DATA_DIR%" --share-dir "%DEX_SHARE_DIR%"
)
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
