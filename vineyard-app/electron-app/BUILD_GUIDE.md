# ADER Drone Analyzer - Windows Desktop App Build Guide

## 🎯 Overview

This guide explains how to build the ADER Drone Analyzer as a standalone Windows desktop application (.exe) that works **completely offline** without internet.

## ✅ Features Included in the Desktop App

All features from the web version work in the desktop app:

- 📷 **Image Upload & Processing** - Upload drone images
- 📄 **DJI Flight Log Parsing** - Parse multiple DJI flight logs  
- 🛰️ **GPS Annotation** - Annotate images with GPS data from logs
- 🤖 **YOLO Detection** - Automatic object detection (vines, grapes, people, etc.)
- ✏️ **Annotation Editor** - Interactive bounding box editing
  - Click to select boxes
  - Change labels
  - Delete boxes
  - Draw new bounding boxes
  - Custom label support
- 💾 **Save Annotations** - Save corrections back to server
- 📥 **Download Features**:
  - Download single annotated image (PNG)
  - Download JSON annotations
  - Download all modified (ZIP with images + JSON)
- 🗺️ **Flight Path Map** - View GPS flight path on map

---

## 📋 Prerequisites

### 1. Node.js (Required)
- Download from: https://nodejs.org/
- Version 18.x or later (LTS)
- Verify: `node --version`

### 2. Python 3.8+ (Required for YOLO)
- Download from: https://www.python.org/
- **IMPORTANT**: Check "Add Python to PATH" during installation!
- Verify: `python --version`

### 3. Python Libraries
```bash
pip install ultralytics opencv-python numpy pillow
```

---

## 🚀 Building the Windows App

### Quick Start (Automated)

```bash
cd vineyard-app/electron-app
npm run build
```

This will:
1. Copy all backend files
2. Install dependencies
3. Build for Windows

### Manual Build Steps

1. **Setup files:**
```bash
cd vineyard-app/electron-app
node setup-app.js
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build for Windows:**
```bash
npm run build:win
```

4. **Find output in:**
```
electron-app/dist/
├── ADER Drone Analyzer-1.0.0-Setup.exe
└── ADER Drone Analyzer-1.0.0-Portable.exe
```

---

## 📁 Project Structure

```
electron-app/
├── main.js              # Electron main process
├── preload.js           # Context bridge
├── package.json         # Build configuration
├── setup-app.js         # Setup script
├── build/               # Build assets (icons)
├── frontend-build/      # HTML/CSS/JS frontend
│   ├── index.html
│   └── app.js
├── server/              # Backend server (copied from backend/)
│   ├── server.js
│   ├── yolo_detector.py
│   ├── draw_annotations.py
│   └── yolov8n.pt
└── models/              # AI models
    └── yolov8n.pt
```

---

## 🧪 Testing Locally

Before building, test locally:

```bash
# In electron-app folder
npm start
```

This opens the app in development mode.

---

## ⚙️ Configuration

### Environment Variables

The app reads from `.env` in the server directory:

```env
PORT=5000
DJI_API_KEY=your_api_key
```

### Data Storage

User data is stored in:
- **Windows**: `%APPDATA%/ADER Drone Analyzer/data/`
- **Linux**: `~/.config/ader-vineyard-app/data/`

---

## ⚠️ Troubleshooting

### "Python not found"
1. Reinstall Python with "Add to PATH"
2. Set `PYTHON_PATH` environment variable
3. The app will search common Python locations

### "YOLO detection not working"
Install Python libraries:
```bash
pip install ultralytics opencv-python numpy
```

### "Server won't start"
1. Check port 5000 is not in use
2. Check server/server.js exists
3. Check node_modules installed

### "Build fails"
```bash
rm -rf node_modules package-lock.json
npm install
npm run build:win
```

---

## 💻 System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows 10 | Windows 11 |
| RAM | 4 GB | 8+ GB |
| Storage | 500 MB | 2+ GB |
| CPU | 2 cores | 4+ cores |

---

## 🔄 Updating

To update with new backend features:

1. Pull latest code
2. Run `node setup-app.js`
3. Run `npm run build:win`

---

## 📝 Notes

- The app runs an embedded Express server on port 5000
- Python is used for YOLO detection and image annotation
- All processing happens locally - no internet required
- Data is persisted between sessions
