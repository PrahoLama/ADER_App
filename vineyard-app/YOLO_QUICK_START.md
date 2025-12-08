# 🎯 YOLO Auto-Annotation Feature - Quick Reference

## 🚀 Quick Start

### Linux/Mac:
```bash
cd vineyard-app/backend
./start-yolo-server.sh
```

### Windows:
```cmd
cd vineyard-app\backend
start-yolo-server.bat
```

### Manual Start:
```bash
# Install dependencies
pip install ultralytics torch torchvision
cd vineyard-app/backend
npm install

# Start server
npm start
```

---

## 📱 How to Use in App

1. **Open App** → Select **"Image Annotation"**

2. **Upload Files:**
   - DJI Flight Log (.txt)
   - Drone Images (.tif, .jpg, .png)

3. **Enable YOLO** (Toggle ON)

4. **Select Industry:**
   - 🌾 **Agriculture** → vines, fruits, trees, gaps, diseases
   - 🚁 **Rescue** → people, vehicles, animals, lost objects  
   - 🔍 **General** → all COCO classes (80+ objects)

5. **Set Confidence:** 0.1 (more detections) → 0.9 (fewer, more confident)

6. **Click "Analyze"**

7. **Review Results:**
   - View images with bounding boxes
   - Check detected objects: class, confidence, coordinates
   - Edit manually (add/delete/modify boxes)

8. **Export Dataset:**
   - COCO format (.json)
   - YOLO format (.txt per image)

---

## 🏭 Industries & Use Cases

### 🌾 Agriculture
**Detects:** vines, fruits, trees, gaps, diseases, weeds, bare soil

**Use case:** 
- Monitor vineyard health
- Detect missing plants
- Identify disease areas
- Count fruit clusters

### 🚁 Rescue Operations
**Detects:** people, vehicles, animals, structures, lost objects

**Use case:**
- Search for missing persons
- Locate vehicles in forest
- Find lost equipment
- Emergency response

### 🔍 General Purpose
**Detects:** All 80 COCO classes (person, vehicle, animal, everyday objects)

**Use case:**
- Create custom training datasets
- General object detection
- Multi-purpose annotation

---

## 📊 API Endpoints

### Auto-Annotate with YOLO
```http
POST /api/auto-annotate
Content-Type: multipart/form-data

Body:
  - images: [files]
  - industry: "agriculture" | "rescue" | "general"
  - confidence: 0.25

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
      }
    }
  ]
}
```

### Get Annotations
```http
GET /api/annotations/:imageName

Response:
{
  "image": "DJI_0001.jpg",
  "timestamp": "2025-12-06T10:30:00Z",
  "industry": "agriculture",
  "detections": [...],
  "manual_corrections": [],
  "status": "auto_annotated"
}
```

### Update Annotations
```http
POST /api/annotations/:imageName/update
Content-Type: application/json

Body:
{
  "detections": [...],
  "manual_corrections": [
    {
      "class": "gap",
      "bbox": { "x1": 500, "y1": 600, "x2": 650, "y2": 750 },
      "isManual": true
    }
  ]
}
```

### Export Dataset
```http
GET /api/export-annotations?format=coco

Downloads: annotations_coco.json (COCO format)

GET /api/export-annotations?format=yolo

Downloads: JSON with YOLO format annotations
```

---

## 🎛️ Configuration

### Adjust Confidence Threshold

**Lower (0.15-0.3):** More detections, more false positives
**Medium (0.3-0.5):** Balanced
**Higher (0.5-0.9):** Fewer detections, higher accuracy

### Change YOLO Model

In `yolo_detector.py`:
```python
# Faster, less accurate
self.model = YOLO('yolov8n.pt')  # Nano (default)

# Balanced
self.model = YOLO('yolov8s.pt')  # Small
self.model = YOLO('yolov8m.pt')  # Medium

# Slower, more accurate
self.model = YOLO('yolov8l.pt')  # Large
self.model = YOLO('yolov8x.pt')  # Extra Large
```

### Use Custom Model

```python
detector = MultiIndustryDetector(
    model_path='/path/to/your/custom_model.pt',
    industry='agriculture',
    confidence=0.25
)
```

---

## 🐛 Troubleshooting

### No detections
- Lower confidence threshold (try 0.15-0.2)
- Switch to "general" industry
- Check image quality

### Too many false positives
- Increase confidence (0.5+)
- Review and delete manually
- Use custom trained model

### Timeout errors
- Reduce batch size (fewer images)
- Increase timeout in App.js
- Use faster model (yolov8n)

### Python errors
```bash
pip install --upgrade ultralytics torch torchvision
```

---

## 📈 Performance

**YOLOv8n:**
- Speed: ~100 FPS (GPU), ~10-20 FPS (CPU)
- Accuracy: 37.3% mAP on COCO
- Size: 6 MB

**Recommendations:**
- CPU only: YOLOv8n (fastest)
- GPU available: YOLOv8m or YOLOv8l (better accuracy)
- Production: YOLOv8l or custom trained model

---

## 📂 File Structure

```
vineyard-app/backend/
├── yolo_detector.py          # YOLO detection engine
├── server.js                 # API endpoints
├── start-yolo-server.sh      # Quick start (Linux/Mac)
├── start-yolo-server.bat     # Quick start (Windows)
├── uploads/                  # Uploaded images
├── annotations/              # JSON annotations per image
│   ├── image1_annotations.json
│   └── image2_annotations.json
└── requiremenents.txt        # Python dependencies

vineyard-app/frontend/
├── App.js                    # Main app with YOLO UI
└── FlightPathMap.js          # Map component
```

---

## 🎓 Next Steps

1. **Test the feature:** Upload images and run YOLO detection
2. **Try different industries:** Compare agriculture vs rescue vs general
3. **Adjust confidence:** Find optimal threshold for your use case
4. **Export dataset:** Use COCO/YOLO format for training
5. **Train custom model:** Fine-tune YOLO on your annotated data

---

## 📚 Resources

- [YOLOv8 Documentation](https://docs.ultralytics.com/)
- [COCO Dataset Format](https://cocodataset.org/#format-data)
- [YOLO Format Specification](https://github.com/ultralytics/yolov5/wiki/Train-Custom-Data)

---

**Ready to annotate! 🚀** Check `YOLO_ANNOTATION_GUIDE.md` for detailed documentation.
