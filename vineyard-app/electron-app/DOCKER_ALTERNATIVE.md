# Running ADER App Without Docker Desktop

This guide helps you run ADER App's orthomosaic generation **without Docker Desktop** on systems where Docker is not available or desired.

## Option 1: Docker Desktop (Recommended)

**Best for: Windows, Mac, Linux Desktop**

1. Download [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install Docker Desktop
3. Start Docker Desktop
4. Launch ADER App - it will auto-configure everything

**Advantages:**
- ✅ Fully automatic setup
- ✅ Works offline after first download
- ✅ Guaranteed compatibility
- ✅ No manual configuration needed

---

## Option 2: Docker Engine (Linux Only)

**Best for: Linux servers and headless systems**

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (avoid sudo)
sudo usermod -aG docker $USER

# Log out and back in, then start NodeODM
docker run -d --name ader-nodeodm \
  -p 3002:3000 \
  --restart unless-stopped \
  --memory 4g \
  --memory-swap 6g \
  --cpus 2 \
  opendronemap/nodeodm:latest

# Fix Python environment
docker exec ader-nodeodm pip install python-dateutil
```

**Advantages:**
- ✅ Lighter than Docker Desktop
- ✅ Works on servers
- ✅ Better performance

---

## Option 3: Podman (Docker Alternative)

**Best for: Systems where Docker is restricted**

```bash
# Install Podman
# Ubuntu/Debian:
sudo apt-get install podman

# Fedora/RHEL:
sudo dnf install podman

# Create podman-docker symlink
sudo ln -s /usr/bin/podman /usr/bin/docker

# Start NodeODM with Podman
podman run -d --name ader-nodeodm \
  -p 3002:3000 \
  --restart unless-stopped \
  --memory 4g \
  --cpus 2 \
  docker.io/opendronemap/nodeodm:latest

# Fix Python environment
podman exec ader-nodeodm pip install python-dateutil
```

---

## Option 4: Native NodeODM Installation

**Best for: Advanced users who want full control**

### Prerequisites
- Node.js 18+ 
- Python 3.8+
- Git

### Installation Steps

```bash
# Clone NodeODM
git clone https://github.com/OpenDroneMap/NodeODM
cd NodeODM

# Install dependencies
npm install

# Create config
cat > config.json << EOF
{
  "port": 3000,
  "maxConcurrency": 2,
  "maxImages": 5000,
  "logLevel": "info"
}
EOF

# Start NodeODM
node index.js --port 3000
```

### Update ADER App Configuration

Edit `electron-app/server/server.js`:

```javascript
// Change from:
const NODEODM_URL = 'http://localhost:3002';

// To:
const NODEODM_URL = 'http://localhost:3000';
```

**Advantages:**
- ✅ No Docker required
- ✅ Full control over configuration
- ✅ Can customize processing

**Disadvantages:**
- ❌ Manual setup required
- ❌ Needs system Python and ODM dependencies
- ❌ More complex troubleshooting

---

## Option 5: Cloud Processing (WebODM Lightning)

**Best for: Users without local processing power**

1. Sign up for [WebODM Lightning](https://webodm.net)
2. Get API token
3. Update `server.js` to use cloud endpoint

**Advantages:**
- ✅ No local installation
- ✅ Process on powerful cloud hardware
- ✅ Works on any device

**Disadvantages:**
- ❌ Requires internet connection
- ❌ Costs per processing task
- ❌ Data uploaded to cloud

---

## Hardware Requirements

### Minimum (Docker-based)
- **CPU:** 2 cores
- **RAM:** 8 GB
- **Storage:** 20 GB free
- **OS:** Windows 10+, macOS 10.15+, Ubuntu 20.04+

### Recommended
- **CPU:** 4+ cores
- **RAM:** 16+ GB
- **Storage:** 50+ GB SSD
- **GPU:** NVIDIA/AMD for faster processing

---

## Troubleshooting

### Docker Container Won't Start

```bash
# Check Docker status
docker ps -a

# View container logs
docker logs ader-nodeodm

# Remove and recreate
docker rm -f ader-nodeodm
docker run -d --name ader-nodeodm -p 3002:3000 opendronemap/nodeodm:latest
```

### Python Module Errors

```bash
# Fix missing dateutil in container
docker exec ader-nodeodm pip install python-dateutil

# Or rebuild with all dependencies
docker exec ader-nodeodm pip install python-dateutil pillow gdal numpy scipy
```

### Port Already in Use

```bash
# Find what's using port 3002
lsof -i :3002

# Kill the process
kill -9 <PID>

# Or use different port in config
```

### Memory Issues

Edit Docker Desktop settings or container limits:

```bash
docker update --memory 8g --memory-swap 12g ader-nodeodm
docker restart ader-nodeodm
```

---

## Performance Optimization

### For Large Datasets (500+ images)

1. **Increase container resources:**
   ```bash
   docker rm -f ader-nodeodm
   docker run -d --name ader-nodeodm \
     -p 3002:3000 \
     --memory 12g \
     --memory-swap 16g \
     --cpus 4 \
     opendronemap/nodeodm:latest
   ```

2. **Enable split-merge** (already enabled in ADER App for 100+ images)

3. **Use SSD storage** for better I/O performance

### For Low-End Hardware

1. **Reduce concurrent tasks:**
   ```bash
   docker run -d --name ader-nodeodm \
     -p 3002:3000 \
     -e MAX_CONCURRENT_TASKS=1 \
     --memory 4g \
     --cpus 2 \
     opendronemap/nodeodm:latest
   ```

2. **Process in smaller batches** (50-100 images at a time)

---

## Keeping Everything Offline

Once Docker image is downloaded, ADER App works **completely offline**:

```bash
# 1. Download image while online
docker pull opendronemap/nodeodm:latest

# 2. Save image to file
docker save opendronemap/nodeodm:latest > nodeodm.tar

# 3. Transfer to offline machine
# (via USB drive, network, etc.)

# 4. Load image on offline machine
docker load < nodeodm.tar

# 5. Start container (fully offline)
docker run -d --name ader-nodeodm -p 3002:3000 opendronemap/nodeodm:latest
docker exec ader-nodeodm pip install python-dateutil
```

Now ADER App runs completely offline! 🎉

---

## Support

For issues with:
- **ADER App:** Check logs in `~/.config/ader-app/` or `%APPDATA%/ader-app/`
- **Docker:** `docker logs ader-nodeodm`
- **NodeODM:** Check console output when running native installation

---

## Summary

| Method | Ease | Offline | Performance |
|--------|------|---------|-------------|
| Docker Desktop | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐ |
| Docker Engine | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ |
| Podman | ⭐⭐⭐ | ✅ | ⭐⭐⭐⭐ |
| Native NodeODM | ⭐⭐ | ✅ | ⭐⭐⭐ |
| Cloud | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐⭐ |

**Recommendation:** Use Docker Desktop for easiest setup and best offline experience.
