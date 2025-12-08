@echo off
REM Quick Start Script - YOLO Annotation System (Windows)

echo ╔══════════════════════════════════════════════════════════╗
echo ║     ADER App - YOLO Auto-Annotation Quick Start         ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

REM Step 1: Check/Create virtual environment
echo 📦 Step 1: Checking Python virtual environment...
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    echo ✅ Virtual environment created
)

REM Install dependencies in venv
echo Installing Python dependencies in venv...
call venv\Scripts\pip install opencv-python numpy ultralytics torch torchvision -q
if errorlevel 0 (
    echo ✅ Python dependencies installed
) else (
    echo ⚠️  Some dependencies may need updating
)

REM Step 2: Check Node.js dependencies
echo.
echo 📦 Step 2: Checking Node.js dependencies...
cd "%~dp0backend"
if not exist "node_modules\" (
    echo ❌ node_modules not found. Installing...
    call npm install
    echo ✅ Dependencies installed!
) else (
    echo ✅ node_modules already installed
)

REM Step 3: Create directories
echo.
echo 📁 Step 3: Creating directories...
if not exist "uploads\" mkdir uploads
if not exist "annotations\" mkdir annotations
if not exist "cache\" mkdir cache
echo ✅ Directories created

REM Step 4: Start server
echo.
echo 🚀 Step 4: Starting backend server...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo Backend will start on http://localhost:5000
echo.
echo Available endpoints:
echo   POST /api/annotate-images     - Metadata annotation
echo   POST /api/auto-annotate        - YOLO detection
echo   GET  /api/annotations/:name    - Get annotations
echo   POST /api/annotations/:name/update - Update annotations
echo   GET  /api/export-annotations   - Export dataset
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo Press Ctrl+C to stop the server
echo.

call npm start
