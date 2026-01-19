# 🧪 Testing Your ADER App Setup

This guide helps you verify that everything is working correctly.

## ✅ Pre-Flight Checks

### 1. Docker Status
```bash
docker ps | grep ader-nodeodm
```
**Expected:** Should show container running on port 3002

### 2. NodeODM API
```bash
curl http://localhost:3002/info
```
**Expected:** JSON response with version info

### 3. Python Environment
```bash
docker exec ader-nodeodm python3 -c "import dateutil.parser; print('OK')"
```
**Expected:** Prints "OK"

---

## 🎯 Processing Test

### Small Test Dataset (10 images)

1. **Prepare Test Images:**
   - Use 10 drone images from your vineyard dataset
   - Or download sample images from: https://github.com/OpenDroneMap/ODMdata

2. **Launch ADER App**

3. **Create New Project:**
   - Click "New Orthomosaic Project"
   - Name: "Test Dataset"
   - Upload 10 images

4. **Process:**
   - Click "Start Processing"
   - Watch progress in real-time
   - Should complete in 5-10 minutes

5. **Verify Success:**
   - Check for orthomosaic output
   - Download and view in QGIS/GIS software
   - Verify no errors in logs

---

## 🔍 What to Expect

### Normal Processing Flow:

```
Uploading images... (0-5%)
  ↓
Feature extraction... (5-30%)
  ↓
Feature matching... (30-50%)
  ↓
Reconstruction... (50-90%)
  ↓
Orthophoto generation... (90-100%)
  ↓
✅ Complete!
```

### Processing Times:

| Images | Expected Time |
|--------|---------------|
| 10 | 5-10 min |
| 50 | 15-30 min |
| 100 | 30-60 min |
| 500 | 2-4 hours |
| 1000 | 6-10 hours |

---

## 🐛 Debugging Failed Tests

### Test 1 Fails (Docker not running)

**Problem:** `Cannot connect to the Docker daemon`

**Solution:**
```bash
# Start Docker Desktop manually
# Wait for it to fully load (whale icon in system tray)
# Then run setup script again
./setup-nodeodm.sh
```

### Test 2 Fails (API not responding)

**Problem:** `curl: (7) Failed to connect`

**Solution:**
```bash
# Check container logs
docker logs ader-nodeodm

# Restart container
docker restart ader-nodeodm

# Wait 30 seconds, then test again
sleep 30
curl http://localhost:3002/info
```

### Test 3 Fails (Python module missing)

**Problem:** `ModuleNotFoundError: No module named 'dateutil'`

**Solution:**
```bash
# Install module manually
docker exec ader-nodeodm pip install python-dateutil

# Restart container
docker restart ader-nodeodm

# Test again
docker exec ader-nodeodm python3 -c "import dateutil.parser; print('OK')"
```

### Processing Test Fails

**Problem:** Processing stops at certain percentage

**Check Logs:**
```bash
# NodeODM logs
docker logs ader-nodeodm --tail 100

# ADER App logs (location varies by OS)
# Linux: ~/.config/ader-app/logs/
# Mac: ~/Library/Application Support/ader-app/logs/
# Windows: %APPDATA%\ader-app\logs\
```

**Common Issues:**

1. **Out of Memory (90% point)**
   ```bash
   # Increase Docker memory limit
   docker update --memory 8g --memory-swap 12g ader-nodeodm
   docker restart ader-nodeodm
   ```

2. **CPU Timeout**
   ```bash
   # Increase CPU allocation
   docker update --cpus 4 ader-nodeodm
   docker restart ader-nodeodm
   ```

3. **Disk Space**
   ```bash
   # Check available space
   df -h
   
   # Clean Docker images
   docker system prune -a
   ```

---

## 📊 Performance Benchmarks

### Expected Resource Usage:

**Small Dataset (10-50 images):**
- RAM: 2-4 GB
- CPU: 50-80%
- Disk: 1-2 GB temp files
- Time: 10-30 min

**Medium Dataset (100-200 images):**
- RAM: 4-8 GB
- CPU: 80-100%
- Disk: 5-10 GB temp files
- Time: 1-2 hours

**Large Dataset (500+ images):**
- RAM: 8-12 GB (uses split-merge)
- CPU: 100%
- Disk: 20-50 GB temp files
- Time: 3-8 hours

### Monitoring Resources:

**Docker Stats:**
```bash
docker stats ader-nodeodm
```

**System Resources:**
```bash
# Linux
htop

# Mac
Activity Monitor (GUI)

# Windows
Task Manager (GUI)
```

---

## ✨ Success Indicators

### ✅ Everything is Working When:

1. All 3 pre-flight checks pass
2. Small test dataset processes completely
3. Orthomosaic output file is created
4. No errors in logs
5. Container restarts automatically with Docker

### 🎉 You're Ready to:

- Process your full 594-image vineyard dataset
- Handle any future drone imagery
- Work completely offline
- Scale to thousands of images

---

## 🔄 Resetting Everything

If you need to start fresh:

```bash
# Stop and remove container
docker rm -f ader-nodeodm

# Remove image (forces re-download)
docker rmi opendronemap/nodeodm:latest

# Clear app data
# Linux: rm -rf ~/.config/ader-app
# Mac: rm -rf ~/Library/Application\ Support/ader-app
# Windows: rmdir /s %APPDATA%\ader-app

# Run setup again
./setup-nodeodm.sh  # or .bat on Windows
```

---

## 📞 Getting Help

### Check These First:

1. **Container Status:** `docker ps -a`
2. **Container Logs:** `docker logs ader-nodeodm --tail 50`
3. **API Response:** `curl http://localhost:3002/info`
4. **Python Modules:** `docker exec ader-nodeodm pip list | grep dateutil`
5. **Disk Space:** `df -h`
6. **Docker Version:** `docker --version`

### Still Stuck?

Include this info when seeking help:
- Output of all commands above
- Your OS and version
- Docker Desktop version
- Number of images being processed
- Error message (if any)
- Stage where it fails (percentage)

---

## 🎯 Next Steps After Testing

1. ✅ All tests pass → Process your full dataset
2. ⚠️ Some tests fail → Follow debugging steps above
3. ❌ Major issues → Try complete reset
4. 💬 Need help → Collect diagnostic info and seek assistance

**Remember:** After successful setup, everything runs offline forever! 🚀
