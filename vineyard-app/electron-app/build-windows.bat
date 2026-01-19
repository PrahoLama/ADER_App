@echo off
REM ADER Drone Analyzer - Windows Build Script
REM This script builds the Electron app for Windows

echo ============================================================
echo   ADER Drone Analyzer - Windows Build Script
echo ============================================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found! Please install Node.js first.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/6] Checking Node.js version...
node --version

REM Navigate to electron-app directory
cd /d "%~dp0"

echo.
echo [2/6] Installing Electron dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [3/6] Copying backend files...
if not exist "server" mkdir server

REM Copy server files
copy /Y "..\backend\server.js" "server\server-full.js" 2>nul
copy /Y "..\backend\yolo_detector.py" "server\" 2>nul
copy /Y "..\backend\draw_annotations.py" "server\" 2>nul
copy /Y "..\backend\dji_log_analyzer.py" "server\" 2>nul
copy /Y "..\backend\vine_analysis.py" "server\" 2>nul

echo.
echo [4/6] Building frontend for production...
cd ..\frontend
call npm install
call npx expo export:web --output-dir ..\electron-app\frontend-build 2>nul
if %ERRORLEVEL% neq 0 (
    echo WARNING: Expo web build failed, will use development server
)
cd ..\electron-app

echo.
echo [5/6] Creating models directory...
if not exist "models" mkdir models
copy /Y "..\backend\yolov8n.pt" "models\" 2>nul

echo.
echo [6/6] Building Windows executable...
call npm run build:win
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   BUILD COMPLETE!
echo ============================================================
echo.
echo Output files are in: dist\
echo.
echo Look for:
echo   - ADER Drone Analyzer-1.0.0-Setup.exe (Installer)
echo   - ADER Drone Analyzer-1.0.0-Portable.exe (Portable)
echo.
pause
