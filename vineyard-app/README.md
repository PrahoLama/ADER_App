# 🍇 ADER Vineyard Analysis & Annotation Platform

A comprehensive drone image analysis platform with **YOLO-powered automatic annotation** for agriculture, rescue operations, and general object detection.

## ✨ Features

### 🎯 **NEW: YOLO Auto-Annotation System**
- **Multi-Industry Detection:**
  - 🌾 **Agriculture:** Vines, fruits, trees, gaps, diseases, weeds
  - 🚁 **Rescue:** People, vehicles, animals, lost objects
  - 🔍 **General:** 80+ COCO object classes
- **Automatic bounding box detection** with confidence scores
- **Manual annotation correction** interface
- **Export to COCO/YOLO format** for ML training
- **GPS metadata integration** with telemetry data

### 📸 Core Features
- **Drone Image Analysis:** RGB-based vegetation health detection
- **Orthophoto Gap Detection:** Large-scale vineyard monitoring
- **DJI Flight Log Parser:** Extract GPS, altitude, orientation, speed
- **Interactive Flight Path Maps:** Visualize drone trajectories
- **Annotated Image Export:** Images with metadata overlay

---

## 🚀 Quick Start

### Installation

```bash
# 1. Install dependencies
cd vineyard-app/backend
pip install -r requiremenents.txt
npm install

cd ../frontend
npm install

# 2. Test YOLO setup
cd ../backend
python3 test_yolo.py

# 3. Start servers
# Terminal 1 - Backend
npm start

# Terminal 2 - Frontend
cd ../frontend
npm start
```

### Quick Start Scripts

**Linux/Mac:**
```bash
cd backend
./start-yolo-server.sh
```

**Windows:**
```cmd
cd backend
start-yolo-server.bat
```

---

## 📖 Documentation

- **[Installation Guide](INSTALLATION.md)** - Complete setup instructions
- **[YOLO Annotation Guide](YOLO_ANNOTATION_GUIDE.md)** - Detailed feature documentation
- **[Quick Start](YOLO_QUICK_START.md)** - Get started in 5 minutes

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│           React Native Frontend (App.js)        │
│  - Image Upload & Selection                    │
│  - Industry Mode Selection                     │
│  - YOLO Configuration (confidence, classes)    │
│  - Annotation Review & Manual Editing          │
│  - Dataset Export (COCO/YOLO)                  │
└─────────────────┬───────────────────────────────┘
                  │ REST API
                  ▼
┌─────────────────────────────────────────────────┐
│          Node.js Backend (server.js)            │
│  /api/annotate-images      - GPS metadata      │
│  /api/auto-annotate        - YOLO detection    │
│  /api/annotations/:name    - Get annotations   │
│  /api/export-annotations   - Export dataset    │
└─────────────────┬───────────────────────────────┘
                  │ Child Process
                  ▼
┌─────────────────────────────────────────────────┐
│        Python YOLO Detector (yolo_detector.py) │
│  - YOLOv8n pretrained model                    │
│  - Multi-industry class filtering              │
│  - Bounding box generation                     │
│  - JSON output with coordinates                │
└─────────────────────────────────────────────────┘
```

---

## 🎯 Use Cases

### 1. Agriculture - Vineyard Monitoring
**Goal:** Detect gaps, diseases, and monitor vine health

```
1. Upload drone images from vineyard
2. Select Industry: Agriculture
3. YOLO detects: vines, gaps, diseases
4. Review & mark additional issues manually
5. Export dataset for training custom model
```

**Output:** GPS-tagged annotations for precision agriculture

### 2. Rescue Operations - Search & Rescue
**Goal:** Locate missing persons, vehicles, equipment

```
1. Upload aerial search images
2. Select Industry: Rescue
3. YOLO detects: people, vehicles, structures
4. Review false positives (trees ≠ people)
5. Export coordinates for field teams
```

**Output:** GPS locations of detected objects for SAR teams

### 3. General - Custom Dataset Creation
**Goal:** Build training dataset for custom ML model

```
1. Upload diverse images
2. Select Industry: General
3. YOLO detects 80+ object classes
4. Add/edit annotations manually
5. Export in YOLO/COCO format
```

**Output:** Annotated dataset ready for model training

---

## 📊 API Endpoints

### Auto-Annotate with YOLO
```http
POST /api/auto-annotate
Content-Type: multipart/form-data

Body:
  - images: [file1.jpg, file2.jpg, ...]
  - industry: "agriculture" | "rescue" | "general"
  - confidence: 0.25 (0.1-0.9)

Response:
{
  "success": true,
  "processed": 10,
  "results": [
    {
      "image": "DJI_0001.jpg",
      "annotations": {
        "detection_count": 5,
        "detections": [
          {
            "class": "vine",
            "confidence": 0.87,
            "bbox": { "x1": 100, "y1": 150, "x2": 300, "y2": 330 }
          }
        ]
      },
      "annotated_image": "uploads/yolo_annotated_DJI_0001.jpg"
    }
  ]
}
```

### Export Annotations
```http
GET /api/export-annotations?format=coco
# Downloads: annotations_coco.json

GET /api/export-annotations?format=yolo
# Downloads: YOLO format annotations
```

---

## 🛠️ Technology Stack

### Frontend
- **React Native** / **Expo** - Cross-platform mobile/web
- **Axios** - HTTP client
- **React Native Maps** - Flight path visualization

### Backend
- **Node.js** + **Express** - REST API server
- **Multer** - File upload handling
- **Sharp** - Image processing
- **Python subprocess** - YOLO integration

### AI/ML
- **YOLOv8** (Ultralytics) - Object detection
- **PyTorch** - Deep learning framework
- **OpenCV** - Computer vision

---

## 📁 Project Structure

```
vineyard-app/
├── backend/
│   ├── server.js                    # API endpoints
│   ├── yolo_detector.py             # YOLO detection engine
│   ├── test_yolo.py                 # Test script
│   ├── start-yolo-server.sh         # Quick start (Linux/Mac)
│   ├── start-yolo-server.bat        # Quick start (Windows)
│   ├── requiremenents.txt           # Python dependencies
│   ├── package.json                 # Node dependencies
│   ├── uploads/                     # Uploaded images
│   └── annotations/                 # JSON annotations
├── frontend/
│   ├── App.js                       # Main application
│   ├── FlightPathMap.js             # Map component
│   └── package.json                 # Frontend dependencies
├── INSTALLATION.md                  # Setup guide
├── YOLO_ANNOTATION_GUIDE.md         # Detailed documentation
├── YOLO_QUICK_START.md              # Quick reference
└── README.md                        # This file
```

---

## 🎓 Workflow Example

### Complete Annotation Pipeline

```bash
# 1. Prepare Data
drone_images/
├── DJI_0001.jpg
├── DJI_0002.jpg
└── flight_log.txt

# 2. Upload & Process
- Open app → Image Annotation
- Upload log + images
- Enable YOLO: ON
- Industry: Agriculture
- Confidence: 0.25
- Click "Analyze"

# 3. Review Results
- View bounding boxes on images
- Check detections: vine, fruit, gap
- Edit manually: add missed objects, delete false positives

# 4. Export Dataset
- Format: COCO JSON
- Use for: Training custom model, dataset sharing

# 5. Train Custom Model (optional)
yolo train data=vineyard.yaml model=yolov8n.pt epochs=100
```

---

## 🐛 Troubleshooting

### YOLO not detecting objects
- Lower confidence threshold (0.15-0.2)
- Switch to "general" industry
- Verify image quality

### Backend connection failed
```bash
# Check if backend is running
curl http://localhost:5000/api/health

# Expected: {"status":"Backend running"}
```

### Python dependencies error
```bash
pip install --upgrade ultralytics torch torchvision
```

See [Installation Guide](INSTALLATION.md) for detailed troubleshooting.

---

## 📈 Performance

**Hardware Recommendations:**
- **CPU only:** 4+ cores, 8GB RAM → ~10-20 images/min
- **With GPU:** NVIDIA GPU 4GB+ VRAM → ~200-500 images/min

**Model Options:**
- **YOLOv8n** (default): Fastest, 37.3% mAP
- **YOLOv8s/m:** Balanced speed/accuracy
- **YOLOv8l/x:** Highest accuracy, slower

---

## 📚 Resources

- [YOLOv8 Documentation](https://docs.ultralytics.com/)
- [COCO Dataset Format](https://cocodataset.org/#format-data)
- [Expo Documentation](https://docs.expo.dev/)

---

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Manual annotation drag & drop editor
- Multi-user annotation workflow
- SAM (Segment Anything) integration
- Custom model training pipeline

---

## 📄 License

MIT License - See LICENSE file for details

---

## 👥 Authors

**ADER Team** - Precision Agriculture & Rescue Technology

---

**Ready to annotate! 🚀🎯**

For detailed instructions, see [YOLO_QUICK_START.md](YOLO_QUICK_START.md)
