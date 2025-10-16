const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// CORS configuration
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Create uploads directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ Created uploads directory:', uploadDir);
}

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const filename = Date.now() + path.extname(file.originalname);
        cb(null, filename);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }
});

// Health check
app.get('/api/health', (req, res) => {
    console.log('✅ Health check received');
    res.json({ status: 'Backend running', timestamp: new Date() });
});

// Analyze drone images - Direct Python call
app.post('/api/analyze-drone', upload.array('images', 20), async (req, res) => {
    console.log('\n' + '='.repeat(60));
    console.log('🔥 DRONE ANALYSIS REQUEST');
    console.log('='.repeat(60));

    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        console.log('📸 Processing', req.files.length, 'images');

        // Create a temporary Python script that uses vine.py functions directly
        const tempScript = path.join(__dirname, 'temp_drone_analysis.py');
        const scriptContent = `
import sys
import json
import os
sys.path.insert(0, '${__dirname.replace(/\\/g, '\\\\')}')

from vine import analyze_drone_images_rgb_only

# Get image paths from command line
image_paths = sys.argv[1:]

try:
    result = analyze_drone_images_rgb_only(image_paths)
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

        fs.writeFileSync(tempScript, scriptContent);

        const filePaths = req.files.map(f => path.join(uploadDir, f.filename));

        // Run Python script
        const result = await runPythonScript(tempScript, filePaths);

        // Cleanup
        fs.unlinkSync(tempScript);
        filePaths.forEach(f => {
            try { fs.unlinkSync(f); } catch (err) {}
        });

        console.log('✅ Analysis complete');
        res.json({ success: true, data: result });

    } catch (error) {
        console.error('❌ ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

// Analyze orthophoto - Direct Python call
app.post('/api/analyze-orthophoto', upload.fields([
    { name: 'orthophoto', maxCount: 1 },
    { name: 'rows_geojson', maxCount: 1 }
]), async (req, res) => {
    console.log('\n' + '='.repeat(60));
    console.log('🔥 ORTHOPHOTO ANALYSIS REQUEST');
    console.log('='.repeat(60));

    try {
        if (!req.files?.orthophoto) {
            return res.status(400).json({ error: 'No orthophoto uploaded' });
        }

        const orthophotoPath = path.join(uploadDir, req.files.orthophoto[0].filename);
        console.log('📸 Orthophoto:', orthophotoPath);

        let rowsPath = null;
        if (req.files?.rows_geojson) {
            rowsPath = path.join(uploadDir, req.files.rows_geojson[0].filename);
            console.log('📍 Rows GeoJSON:', rowsPath);
        }

        // Create temporary Python script that modifies vine.py Config and runs analysis
        const tempScript = path.join(__dirname, 'temp_ortho_analysis.py');
        const scriptContent = `
import sys
import json
import os
sys.path.insert(0, '${__dirname.replace(/\\/g, '\\\\')}')

from vine import Config, analyze_orthophoto

# Update Config with uploaded files
Config.ORTHO_PATH = r'${orthophotoPath.replace(/\\/g, '\\\\')}'
${rowsPath ? `Config.ROWS_PATH = r'${rowsPath.replace(/\\/g, '\\\\')}'` : ''}

try:
    # Run the analysis
    result = analyze_orthophoto()
    
    if result is None:
        print(json.dumps({"error": "Analysis returned no results"}))
        sys.exit(1)
    
    # Format output
    output = {
        'detected_gaps': len(result.get('gaps', [])),
        'total_gap_area_m2': sum(g.get('area_sqm', 0) for g in result.get('gaps', [])),
        'rows_analyzed': result.get('total_rows', 0),
        'rows_with_gaps': len(result.get('row_summary', [])),
        'details': [{
            'filename': os.path.basename(Config.ORTHO_PATH),
            'gaps_detected': len(result.get('gaps', [])),
            'gap_area_m2': sum(g.get('area_sqm', 0) for g in result.get('gaps', [])),
            'row_details': result.get('row_summary', [])
        }]
    }
    
    print(json.dumps(output))
    
except Exception as e:
    import traceback
    print(json.dumps({
        "error": str(e),
        "traceback": traceback.format_exc()
    }))
    sys.exit(1)
`;

        fs.writeFileSync(tempScript, scriptContent);

        // Run Python script
        const result = await runPythonScript(tempScript, []);

        // Cleanup
        fs.unlinkSync(tempScript);
        try { fs.unlinkSync(orthophotoPath); } catch (err) {}
        if (rowsPath) {
            try { fs.unlinkSync(rowsPath); } catch (err) {}
        }

        console.log('✅ Analysis complete');
        res.json({ success: true, data: result });

    } catch (error) {
        console.error('❌ ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

function runPythonScript(scriptPath, args) {
    return new Promise((resolve, reject) => {
        console.log('🐍 Running Python:', scriptPath);

        const python = spawn('python3', [scriptPath, ...args]);

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        python.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log('Python stderr:', data.toString());
        });

        python.on('close', (code) => {
            console.log('Python process exited with code:', code);

            if (code !== 0) {
                console.error('Python stderr:', stderr);
                reject(new Error(`Python script failed: ${stderr}`));
                return;
            }

            try {
                // Find the last JSON output (in case there's debug output before it)
                const lines = stdout.trim().split('\n');
                let jsonOutput = null;

                for (let i = lines.length - 1; i >= 0; i--) {
                    try {
                        jsonOutput = JSON.parse(lines[i]);
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!jsonOutput) {
                    throw new Error('No valid JSON found in output');
                }

                if (jsonOutput.error) {
                    reject(new Error(jsonOutput.error));
                } else {
                    resolve(jsonOutput);
                }
            } catch (e) {
                console.error('Failed to parse output:', stdout);
                reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
        });
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ SERVER RUNNING');
    console.log('='.repeat(60));
    console.log(`🌐 Local:    http://localhost:${PORT}`);
    console.log(`🌐 Network:  http://0.0.0.0:${PORT}`);
    console.log('='.repeat(60));
    console.log('\n💡 Waiting for requests...\n');
});