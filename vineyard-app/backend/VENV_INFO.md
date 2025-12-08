# Python Virtual Environment Setup

## ✅ Virtual Environment Installed

A Python virtual environment has been created in `vineyard-app/backend/venv/` with all required YOLO dependencies.

## 📦 Installed Packages

- **ultralytics** (8.3.235) - YOLOv8 framework
- **torch** (2.9.1) - PyTorch deep learning
- **torchvision** (0.24.1) - Computer vision
- **opencv-python** (4.12.0) - Image processing
- **numpy** (2.2.6) - Numerical computing
- Plus all dependencies (matplotlib, pillow, scipy, etc.)

## 🚀 How It Works

The backend server automatically uses Python from the virtual environment:
- Path: `vineyard-app/backend/venv/bin/python3` (Linux/Mac)
- Path: `vineyard-app\backend\venv\Scripts\python.exe` (Windows)

## 🔧 Manual Usage

If you need to run Python commands manually:

```bash
# Activate virtual environment
cd vineyard-app/backend
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate     # Windows

# Run Python scripts
python yolo_detector.py --help
python test_yolo.py

# Deactivate when done
deactivate
```

## 📝 Adding New Dependencies

To install additional Python packages:

```bash
# Activate venv first
source venv/bin/activate

# Install package
pip install package-name

# Update requirements
pip freeze > requiremenents.txt

# Deactivate
deactivate
```

## 🐛 Troubleshooting

### Virtual environment not found
```bash
cd vineyard-app/backend
python3 -m venv venv
./venv/bin/pip install -r requiremenents.txt
```

### Dependencies not installed
```bash
cd vineyard-app/backend
./venv/bin/pip install --upgrade ultralytics torch torchvision opencv-python
```

### YOLO model not downloading
First run will download YOLOv8n model (~6MB) automatically.
Manual download: Place `yolov8n.pt` in backend folder or `~/.cache/torch/hub/`

## ✅ Verification

Check installation:
```bash
cd vineyard-app/backend
./venv/bin/python3 test_yolo.py
```

Expected output:
```
✅ Agriculture detector initialized
✅ Rescue detector initialized
✅ General detector initialized
✅ YOLO detector is properly configured
```

## 🌐 Server Configuration

The server automatically detects and uses the virtual environment:

```javascript
// In server.js
const pythonExecutable = path.join(__dirname, 'venv', 'bin', 'python3');
const pythonCommand = fs.existsSync(pythonExecutable) ? pythonExecutable : 'python3';
```

If venv exists → uses `venv/bin/python3`
If venv missing → falls back to system `python3`

---

**All set! Your YOLO annotation system is ready to use. 🎉**
