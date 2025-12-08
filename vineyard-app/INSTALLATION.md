# 🚀 Installation Guide - YOLO Auto-Annotation System

## Prerequisites

- **Node.js** 14+ ([Download](https://nodejs.org/))
- **Python** 3.8+ ([Download](https://www.python.org/))
- **npm** or **yarn**
- **Git** (optional)

---

## 📦 Step-by-Step Installation

### 1. Install Python Dependencies

```bash
cd vineyard-app/backend
pip install -r requiremenents.txt
```

**Or install individually:**
```bash
pip install ultralytics>=8.0.0
pip install torch>=2.0.0
pip install torchvision>=0.15.0
pip install opencv-python
pip install numpy
pip install matplotlib
```

**For GPU support (optional, recommended):**
```bash
# CUDA 11.8
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

### 2. Install Node.js Dependencies

**Backend:**
```bash
cd vineyard-app/backend
npm install
```

**Frontend:**
```bash
cd vineyard-app/frontend
npm install
```

### 3. Verify YOLO Installation

```bash
cd vineyard-app/backend
python3 test_yolo.py
```

**Expected output:**
```
============================================================
YOLO DETECTOR TEST
============================================================

Test 1: Agriculture Industry Mode
------------------------------------------------------------
✅ Agriculture detector initialized
   Relevant classes: ['person', 'potted plant', ...]

Test 2: Rescue Industry Mode
------------------------------------------------------------
✅ Rescue detector initialized
   Relevant classes: ['person', 'car', 'truck', ...]

Test 3: General Industry Mode
------------------------------------------------------------
✅ General detector initialized
   Total classes available: 80
   Sample classes: ['person', 'bicycle', 'car', ...]
```

### 4. Download YOLOv8 Model (Automatic)

First run will automatically download YOLOv8n model (~6 MB):
```bash
# Model will be cached at:
~/.cache/torch/hub/ultralytics_yolov8n.pt
```

---

## 🚀 Running the Application

### Option 1: Quick Start Scripts

**Linux/Mac:**
```bash
cd vineyard-app/backend
./start-yolo-server.sh
```

**Windows:**
```cmd
cd vineyard-app\backend
start-yolo-server.bat
```

### Option 2: Manual Start

**Terminal 1 - Backend:**
```bash
cd vineyard-app/backend
npm start
```

**Terminal 2 - Frontend:**
```bash
cd vineyard-app/frontend
npm start
# or
expo start
```

---

## 🧪 Testing the Feature

### 1. Prepare Test Data

You need:
- **DJI Flight Log** (.txt file from DJI drone)
- **Drone Images** (.tif, .jpg, .png)

### 2. Test via App

1. Open app at `http://localhost:19006` (web) or scan QR code (mobile)
2. Click **"Image Annotation"**
3. Upload log file and images
4. Toggle **YOLO ON**
5. Select industry (Agriculture/Rescue/General)
6. Click **"Analyze"**

### 3. Test via API

**Using curl:**
```bash
# Auto-annotate images
curl -X POST http://localhost:5000/api/auto-annotate \
  -F "images=@image1.jpg" \
  -F "images=@image2.jpg" \
  -F "industry=agriculture" \
  -F "confidence=0.25"
```

**Using Python:**
```python
import requests

url = "http://localhost:5000/api/auto-annotate"
files = [
    ('images', open('image1.jpg', 'rb')),
    ('images', open('image2.jpg', 'rb'))
]
data = {
    'industry': 'agriculture',
    'confidence': 0.25
}

response = requests.post(url, files=files, data=data)
print(response.json())
```

---

## 🐛 Troubleshooting

### Issue: ultralytics not found

```bash
pip install ultralytics
# or with specific version
pip install ultralytics==8.0.196
```

### Issue: torch/torchvision installation fails

**Solution 1 - Use CPU version:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

**Solution 2 - Use conda:**
```bash
conda install pytorch torchvision -c pytorch
```

### Issue: YOLO model download fails

**Manual download:**
1. Download from: https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt
2. Place in: `~/.cache/torch/hub/ultralytics_yolov8n.pt`

### Issue: Backend not starting

**Check port 5000:**
```bash
# Linux/Mac
lsof -i :5000

# Windows
netstat -ano | findstr :5000
```

**Use different port:**
```bash
PORT=5001 npm start
```

### Issue: No detections with YOLO

**Solutions:**
1. Lower confidence threshold (0.15-0.2)
2. Try "general" industry mode
3. Verify image quality (not corrupted)
4. Check YOLO model loaded:
   ```python
   from ultralytics import YOLO
   model = YOLO('yolov8n.pt')
   print(model.names)  # Should show 80 classes
   ```

---

## 📊 System Requirements

### Minimum Requirements

- **CPU:** Dual-core 2 GHz+
- **RAM:** 4 GB
- **Storage:** 2 GB free space
- **OS:** Windows 10+, macOS 10.14+, Ubuntu 18.04+

### Recommended Requirements

- **CPU:** Quad-core 3 GHz+
- **RAM:** 8 GB+
- **Storage:** 5 GB+ free space
- **GPU:** NVIDIA GPU with 4GB+ VRAM (optional, for faster processing)
- **OS:** Windows 11, macOS 13+, Ubuntu 20.04+

### Performance Expectations

**Without GPU (CPU only):**
- YOLOv8n: ~10-20 images/minute
- Processing time: 3-6 seconds per image

**With GPU (NVIDIA CUDA):**
- YOLOv8n: ~200-500 images/minute
- Processing time: 0.1-0.3 seconds per image

---

## 🔧 Configuration Options

### Change YOLO Model

Edit `yolo_detector.py`:
```python
# Line ~96
self.model = YOLO('yolov8n.pt')  # Nano (default, fastest)
# self.model = YOLO('yolov8s.pt')  # Small
# self.model = YOLO('yolov8m.pt')  # Medium
# self.model = YOLO('yolov8l.pt')  # Large
# self.model = YOLO('yolov8x.pt')  # Extra Large (slowest, most accurate)
```

### Adjust Backend Port

Edit `server.js`:
```javascript
// Line 22
const PORT = process.env.PORT || 5000;  // Change to your port
```

Or use environment variable:
```bash
PORT=5001 npm start
```

### Modify Industry Classes

Edit `yolo_detector.py`:
```python
# Line 28-50
INDUSTRY_CLASSES = {
    'agriculture': {
        'vine': ['vine', 'grapevine', 'plant'],
        'fruit': ['grape', 'fruit', 'berry'],
        # Add your custom classes here
    }
}
```

---

## 📚 Additional Resources

### Documentation
- Main Guide: `YOLO_ANNOTATION_GUIDE.md`
- Quick Start: `YOLO_QUICK_START.md`
- API Reference: Check backend `server.js` comments

### External Links
- [YOLOv8 Official Docs](https://docs.ultralytics.com/)
- [PyTorch Installation](https://pytorch.org/get-started/locally/)
- [COCO Dataset Format](https://cocodataset.org/#format-data)

### Support
- Check backend logs: `vineyard-app/backend/` (console output)
- Check Python errors: stderr from YOLO detector
- Frontend errors: Browser console / Expo console

---

## ✅ Verification Checklist

Before using the system, verify:

- [ ] Python 3.8+ installed: `python3 --version`
- [ ] Node.js 14+ installed: `node --version`
- [ ] ultralytics package installed: `python3 -c "import ultralytics"`
- [ ] Backend dependencies installed: `ls node_modules` (in backend/)
- [ ] YOLO test passes: `python3 test_yolo.py`
- [ ] Backend starts: `npm start` (port 5000)
- [ ] Frontend connects: Check app backend status badge

---

## 🎉 Ready to Go!

If all steps completed successfully, you're ready to:

1. **Upload drone images** with flight logs
2. **Run YOLO auto-annotation** on multiple industries
3. **Review and correct** detections manually
4. **Export datasets** in COCO/YOLO format
5. **Train custom models** on your annotated data

**Happy Annotating! 🚀🎯**
