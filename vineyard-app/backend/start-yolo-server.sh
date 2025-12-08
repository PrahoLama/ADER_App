#!/bin/bash

# 🚀 Quick Start Script - YOLO Annotation System
# This script helps you quickly test the YOLO annotation feature

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ADER App - YOLO Auto-Annotation Quick Start         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check/Create virtual environment
echo "📦 Step 1: Checking Python virtual environment..."
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
fi

# Activate virtual environment and install dependencies
echo "Installing Python dependencies in venv..."
./venv/bin/pip install opencv-python numpy ultralytics torch torchvision -q
if [ $? -eq 0 ]; then
    echo "✅ Python dependencies installed"
else
    echo "⚠️  Some dependencies may need updating"
fi

# Step 2: Check if Node.js dependencies are installed
echo ""
echo "📦 Step 2: Checking Node.js dependencies..."
cd "$(dirname "$0")/backend"
if [ ! -d "node_modules" ]; then
    echo "❌ node_modules not found. Installing..."
    npm install
    echo "✅ Dependencies installed!"
else
    echo "✅ node_modules already installed"
fi

# Step 3: Test YOLO detector
echo ""
echo "🧪 Step 3: Testing YOLO detector..."
if [ -f "yolo_detector.py" ]; then
    echo "Testing YOLO installation..."
    ./venv/bin/python3 test_yolo.py 2>/dev/null | tail -5
    if [ $? -eq 0 ]; then
        echo "✅ YOLO detector is working!"
    else
        echo "⚠️  YOLO test completed (check output above)"
    fi
else
    echo "❌ yolo_detector.py not found!"
    exit 1
fi

# Step 4: Create necessary directories
echo ""
echo "📁 Step 4: Creating directories..."
mkdir -p uploads
mkdir -p annotations
mkdir -p cache
echo "✅ Directories created"

# Step 5: Start backend server
echo ""
echo "🚀 Step 5: Starting backend server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Backend will start on http://localhost:5000"
echo ""
echo "Available endpoints:"
echo "  POST /api/annotate-images     - Metadata annotation"
echo "  POST /api/auto-annotate        - YOLO detection"
echo "  GET  /api/annotations/:name    - Get annotations"
echo "  POST /api/annotations/:name/update - Update annotations"
echo "  GET  /api/export-annotations   - Export dataset"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
