# ADER Drone Analyzer - Docker Setup Guide

## Why Docker?

The app uses **WebODM** (OpenDroneMap) for professional-grade orthomosaic generation. WebODM requires:
- Complex photogrammetry libraries (OpenSFM, OpenCV, Ceres Solver)
- Pre-compiled binaries for different hardware
- ~15GB of dependencies

**Docker provides a pre-built environment** that works on any computer without compilation!

---

## First-Time Setup (One Time Only)

### 1. Install Docker Desktop

**Windows/Mac:**
1. Download from: https://www.docker.com/products/docker-desktop
2. Run installer
3. Follow setup wizard (default settings are fine)
4. Restart computer if prompted

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install docker.io docker-compose
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
# Log out and log back in
```

### 2. Verify Docker Installation

Open terminal/command prompt:
```bash
docker --version
```

Should show: `Docker version X.X.X`

### 3. Start ADER App

Run the ADER Drone Analyzer app. On first launch:
- App will detect Docker ✅
- Auto-download WebODM engine (~2GB) - **happens once**
- Takes 5-10 minutes on first run

---

## Using the App

### Features That Work WITHOUT Docker:
- ✅ Drone Analysis (RGB vegetation health)
- ✅ Gap Detection (vine row analysis)
- ✅ All other analysis features

### Features That NEED Docker:
- 🌍 **Generate Orthomosaic** (requires WebODM/Docker)

### Generating Orthomosaics:

1. Ensure Docker Desktop is running
2. Click "Generate Orthomosaic"
3. Upload 5+ drone images (20+ recommended)
4. Select quality settings
5. Click "Generate"
6. Processing takes 15-60 minutes (runs in background)
7. Download your orthomosaic TIF file

---

## Offline Usage

After first setup:
- ✅ **Works completely offline**
- Docker image is cached locally
- No internet needed after initial download

---

## Troubleshooting

### "Docker not available" error
- **Solution:** Start Docker Desktop application
- Windows: Check system tray
- Mac: Check menu bar
- Linux: `sudo systemctl start docker`

### "Container failed to start"
- **Solution:** Restart Docker Desktop
- Or restart computer

### "Out of disk space"
- Docker images need ~5GB free space
- Free up space and restart app

### Docker is slow/crashes
- Increase Docker memory in settings:
  - Docker Desktop → Settings → Resources
  - Increase RAM to 4GB+ for best performance

---

## Advanced: Portable Installation

Want to share the app with others?

### Option 1: Include Docker Installer
Bundle `DockerDesktopInstaller.exe` with your app

### Option 2: Pre-download Docker Image
```bash
docker pull opendronemap/nodeodm:latest
docker save opendronemap/nodeodm:latest > nodeodm.tar
```

Include `nodeodm.tar` with app, users load it:
```bash
docker load < nodeodm.tar
```

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 4GB | 8GB+ |
| Disk Space | 10GB | 20GB+ |
| Docker Desktop | Yes | Yes |
| Internet (first run) | Yes | Yes |
| Internet (after setup) | No | No |

---

## Support

If you encounter issues:
1. Check Docker Desktop is running
2. Restart Docker Desktop
3. Restart ADER app
4. Still issues? Restart computer

For more help: https://docs.docker.com/desktop/
