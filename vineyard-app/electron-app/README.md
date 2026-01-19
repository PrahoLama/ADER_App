# ADER App - Electron Application

## 🎯 Professional Orthomosaic Processing - Offline & Universal

ADER App provides professional-grade drone image processing that works **completely offline** on **any hardware** with **zero external dependencies**.

---

## ⚡ Quick Start (3 Steps)

### 1. Install Docker Desktop

**Download:** https://www.docker.com/products/docker-desktop

- **Windows/Mac:** Run installer and start Docker Desktop
- **Linux:** See installation commands below

### 2. Run Setup Script

**Windows:**
```cmd
setup-nodeodm.bat
```

**Linux/Mac:**
```bash
./setup-nodeodm.sh
```

This downloads and configures the processing engine (one-time, ~2GB).

### 3. Launch ADER App

```bash
npm install
npm start
```

That's it! Process unlimited drone imagery offline.

---

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 3 minutes
- **[SOLUTION.md](SOLUTION.md)** - Technical details of what was fixed
- **[OFFLINE_SETUP.md](OFFLINE_SETUP.md)** - Complete offline deployment guide
- **[TESTING.md](TESTING.md)** - Verify your setup works
- **[DOCKER_ALTERNATIVE.md](DOCKER_ALTERNATIVE.md)** - Alternative deployment options
- **[BUILD_GUIDE.md](BUILD_GUIDE.md)** - Building distributable app

---

## 🎯 What Makes This Special

### ✅ Truly Offline
- Process in remote locations
- No internet required after setup
- All data stays local
- Transfer Docker image via USB for air-gapped systems

### ✅ Universal Hardware Support
- **Windows:** 10/11 (x64, ARM64)
- **macOS:** 10.15+ (Intel, Apple Silicon M1/M2/M3)
- **Linux:** Ubuntu, Debian, Fedora, Arch, etc.
- **Minimum:** 2-core CPU, 8GB RAM
- **Recommended:** 4-core CPU, 16GB RAM

### ✅ No Installation Required (for users)
- One-time Docker setup
- Auto-configured processing engine
- Python dependencies auto-installed
- Container manages itself

### ✅ Professional Quality
- OpenDroneMap processing engine
- Handles 10-10,000 images
- Split-merge for large datasets
- GeoTIFF orthomosaic output

---

## 🔧 Features

### Drone Image Analysis
- ✅ DJI flight log parsing
- ✅ GPS track visualization
- ✅ Image metadata extraction
- ✅ Flight path mapping

### Orthomosaic Generation
- ✅ Feature extraction and matching
- ✅ 3D point cloud reconstruction
- ✅ Bundle adjustment optimization
- ✅ Orthophoto rendering
- ✅ Split-merge for large datasets

### Vineyard Analysis (YOLO-based)
- ✅ Vine detection and counting
- ✅ Gap identification
- ✅ Row analysis
- ✅ Health assessment

### UI/UX
- ✅ Modern Electron interface
- ✅ Real-time progress tracking
- ✅ Visual result preview
- ✅ Export capabilities

---

## 🐛 Troubleshooting

### "Docker not installed"
Install Docker Desktop from link above, restart computer.

### "Cannot connect to NodeODM"
Run the setup script to configure the processing engine.

### "Processing fails at 100%"
**This is already fixed!** The setup script auto-installs missing Python modules.

### Container won't start
```bash
docker logs ader-nodeodm
docker restart ader-nodeodm
```

### Need complete reset
```bash
docker rm -f ader-nodeodm
./setup-nodeodm.sh  # or .bat on Windows
```

See [TESTING.md](TESTING.md) for comprehensive troubleshooting.

---

## 📊 Performance

### Expected Processing Times:

| Images | Hardware | Time |
|--------|----------|------|
| 10 | 2-core, 8GB | ~10 min |
| 50 | 4-core, 16GB | ~20 min |
| 100 | 4-core, 16GB | ~45 min |
| 500 | 4-core, 16GB | ~3 hours |
| 1000 | 8-core, 32GB | ~8 hours |

### Resource Usage:
- **Small (10-50 imgs):** 2-4 GB RAM, 1-2 GB disk
- **Medium (100-200 imgs):** 4-8 GB RAM, 5-10 GB disk
- **Large (500+ imgs):** 8-12 GB RAM, 20-50 GB disk

---

## 🔧 Development

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker Desktop

### Setup Development Environment
```bash
npm install
```

### Run Development Mode
```bash
npm start
```

### Build Distributable
```bash
npm run build
```

See [BUILD_GUIDE.md](BUILD_GUIDE.md) for detailed build instructions.

---

## 📁 Project Structure

```
electron-app/
├── main.js                 # Electron main process (auto-fixes NodeODM)
├── preload.js             # Preload scripts
├── setup-app.js           # Initial setup wizard
├── package.json           # Dependencies
├── setup-nodeodm.sh       # Linux/Mac setup script
├── setup-nodeodm.bat      # Windows setup script
├── server/
│   └── server.js          # Backend API server
├── frontend-build/        # React frontend (built)
├── models/                # YOLO models
└── docs/
    ├── QUICKSTART.md      # Quick start guide
    ├── SOLUTION.md        # What was fixed
    ├── OFFLINE_SETUP.md   # Offline deployment
    ├── TESTING.md         # Testing guide
    └── DOCKER_ALTERNATIVE.md  # Alternative setups
```

---

## 🎓 Use Cases

### Agricultural Monitoring
- Vineyard row analysis
- Crop health assessment
- Gap detection
- Growth tracking over time

### Construction & Surveying
- Site mapping
- Progress monitoring
- Volume calculations
- As-built documentation

### Environmental Studies
- Habitat mapping
- Erosion monitoring
- Vegetation analysis
- Change detection

### Research & Education
- Photogrammetry learning
- Computer vision projects
- Remote sensing studies
- Data science applications

---

## 🌟 Key Advantages

### vs. Cloud Services (Pix4D, DroneDeploy, etc.)
- ✅ **No subscription costs**
- ✅ **Unlimited processing**
- ✅ **Complete privacy**
- ✅ **Works offline**

### vs. Native ODM Installation
- ✅ **Easier setup** (automated scripts)
- ✅ **Auto-configured** (no manual deps)
- ✅ **Cross-platform** (same process everywhere)
- ✅ **Self-healing** (auto-fixes environment)

### vs. WebODM
- ✅ **Integrated UI** (single app)
- ✅ **Automated management** (no manual container control)
- ✅ **Additional features** (YOLO analysis, DJI logs)
- ✅ **Simpler deployment** (one setup script)

---

## 📞 Support

### Before Seeking Help:

1. Run all tests in [TESTING.md](TESTING.md)
2. Check logs: `docker logs ader-nodeodm`
3. Verify Docker: `docker ps`
4. Check API: `curl http://localhost:3002/info`

### Include in Support Request:
- OS and version
- Docker version
- Output of commands above
- Error messages
- Stage where failure occurs

---

## 🔐 Privacy & Security

- ✅ **All processing local** - Images never leave your machine
- ✅ **No telemetry** - App doesn't phone home
- ✅ **No cloud uploads** - Data stays with you
- ✅ **No accounts required** - No sign-up, no tracking
- ✅ **Open source components** - Auditable codebase

---

## 📜 License

Check individual component licenses:
- OpenDroneMap: AGPL-3.0
- NodeODM: AGPL-3.0
- Electron: MIT
- Your application code: [Your License]

---

## 🙏 Credits

Built with:
- **OpenDroneMap** - Open-source photogrammetry toolkit
- **NodeODM** - REST API for ODM processing
- **Electron** - Cross-platform desktop framework
- **YOLO** - Object detection for vine analysis
- **Docker** - Containerization platform

---

## 🚀 Getting Started Right Now

```bash
# 1. Setup (one-time)
./setup-nodeodm.sh        # Linux/Mac
# or
setup-nodeodm.bat         # Windows

# 2. Install dependencies
npm install

# 3. Launch app
npm start

# 4. Process your drone images!
```

**See [QUICKSTART.md](QUICKSTART.md) for step-by-step guide.**

---

## ✨ Summary

ADER App provides:
- 🚀 **Professional photogrammetry** without expensive software
- 🌍 **Works anywhere** - offline, any hardware
- 🔒 **Complete privacy** - all local processing
- 💰 **Zero ongoing costs** - no subscriptions
- 🎯 **Easy deployment** - one setup script
- 📈 **Scalable** - 10 to 10,000 images

Perfect for **agricultural monitoring, construction surveying, environmental studies, and any drone photogrammetry needs**! 🚁📸

---

**Ready to process your vineyard images?** Run the setup script and get started! 🍇
