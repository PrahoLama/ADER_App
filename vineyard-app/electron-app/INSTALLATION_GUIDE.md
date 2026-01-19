# ADER Drone Analyzer - Installation Guide

## 🎉 Easy Installation - Automatic Setup!

The ADER Drone Analyzer EXE includes:
- ✅ **Node.js runtime** (via Electron)
- ✅ **YOLO AI model** for object detection
- ✅ **All application code**
- ✅ **Automatic Python setup** on first run (Windows only)

**On first launch, the app will automatically download and install Python with all required AI packages. This takes about 3-5 minutes and only happens once!**

## 📋 System Requirements

- **OS:** Windows 10/11 (64-bit)
- **RAM:** 8 GB minimum, 16 GB recommended
- **Storage:** 2 GB free space (for app + Python + AI models)
- **Internet:** Required for first-time setup only
- **GPU:** Optional (NVIDIA for faster AI processing)

## 🚀 Installation Steps

### Step 1: Download and Install
1. Download `ADER Drone Analyzer-1.0.0-Setup.exe`
2. Double-click to install
3. Follow the installation wizard
4. Launch the application!

### Step 2: First Launch (Automatic)
On first launch, you'll see a setup screen:
1. **"Downloading Python..."** - Downloads Python 3.11 (~25 MB)
2. **"Installing PyTorch..."** - AI engine (~200 MB)
3. **"Installing YOLO..."** - Object detection (~50 MB)
4. **"Installing OpenCV..."** - Image processing (~50 MB)

**Total download: ~400 MB (one-time only)**

After setup completes, the app will start normally. Future launches are instant!

---

## 🐳 Optional: Docker (for Orthomosaic Generation)

The **Orthomosaic Generation** feature requires Docker Desktop.

### When do you need Docker?
- ✅ Drone Flight Analysis - **NO Docker needed**
- ✅ Vineyard Gap Detection - **NO Docker needed**
- ✅ Image Annotation (YOLO) - **NO Docker needed**
- ✅ Manual Annotation Editor - **NO Docker needed**
- ✅ Manual Row Digitizer - **NO Docker needed**
- ⚠️ Orthomosaic Generation - **Docker required**

### Installing Docker (Optional)
1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop
2. Install Docker Desktop
3. Restart your computer
4. Start Docker Desktop (wait for it to fully start)
5. Restart ADER Drone Analyzer

On first use of orthomosaic generation, the app will automatically download the WebODM engine (~2GB).

---

## 🔧 Troubleshooting

### "Setup failed" or download errors
1. Check your internet connection
2. Restart the app to retry
3. If problem persists, manually install Python 3.11 from https://python.org
   Then run: `pip install ultralytics opencv-python numpy pillow torch torchvision`

### "Python not found" error (after auto-setup)
1. Delete the folder: `%APPDATA%\ader-vineyard-app\python`
2. Restart the app to re-run setup

### "Docker not installed" warning
This is normal if you haven't installed Docker. The warning only appears if you try to use orthomosaic generation. Other features work fine.

### Application won't start
1. Make sure you have Windows 10 or 11 (64-bit)
2. Try running as Administrator
3. Check Windows Defender/Antivirus isn't blocking the app

### YOLO detection is slow
The app uses CPU-only PyTorch for compatibility. Detection takes ~1-3 seconds per image.

---

## 📞 Support

For issues or feature requests, contact the ADER team.

---

## 📊 App Size Information

| Component | Size |
|-----------|------|
| Core Application | ~100 MB |
| Python (auto-downloaded) | ~25 MB |
| AI Packages (auto-downloaded) | ~350 MB |
| **Total after first run** | **~500 MB** |

Optional: Docker + WebODM adds ~3 GB if orthomosaic feature is used.
