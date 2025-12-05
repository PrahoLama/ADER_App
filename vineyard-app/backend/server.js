const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const FormData = require('form-data');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');
const readline = require('readline');
require('dotenv').config();

// Optional: Install exif-parser for better timestamp extraction
let ExifParser;
try {
  ExifParser = require('exif-parser');
} catch (e) {
  console.log('⚠️  exif-parser not installed. Install with: npm install exif-parser');
}

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

// Create uploads and cache directories
const uploadDir = path.join(__dirname, 'uploads');
const cacheDir = path.join(__dirname, 'cache');

[uploadDir, cacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('✅ Created directory:', dir);
  }
});

// Configure multer with increased limits
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const filename = Date.now() + '-' + Math.random().toString(36).substring(7) + path.extname(file.originalname);
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 150 // Support more files
  }
});

// Health check
app.get('/api/health', (req, res) => {
  console.log('✅ Health check received');
  res.json({ status: 'Backend running', timestamp: new Date() });
});

// ==================== STREAMING CSV PARSER ====================

async function parseCSVStreaming(csvPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let header = null;
    const flightData = [];
    let lineCount = 0;

    rl.on('line', (line) => {
      if (!line.trim()) return;

      if (!header) {
        header = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        return;
      }

      lineCount++;
      const values = parseCSVLine(line);

      const record = {};
      header.forEach((col, idx) => {
        let value = values[idx];
        if (value && value !== '' && !isNaN(value)) {
          value = parseFloat(value);
        }
        record[col] = value;
      });

      // Extract GPS coordinates
      const latIdx = findColumnIndex(header, ['OSD.latitude', 'latitude']);
      const lonIdx = findColumnIndex(header, ['OSD.longitude', 'longitude']);

      const lat = latIdx >= 0 ? record[header[latIdx]] : null;
      const lon = lonIdx >= 0 ? record[header[lonIdx]] : null;

      if (isValidCoordinate(lat, lon)) {
        const columnIndices = {
          datetime: findColumnIndex(header, ['datetime', 'time', 'OSD.flyTime']),
          latitude: latIdx,
          longitude: lonIdx,
          altitude: findColumnIndex(header, ['OSD.altitude', 'altitude']),
          height: findColumnIndex(header, ['OSD.height', 'height', 'OSD.relativeHeight']),
          pitch: findColumnIndex(header, ['OSD.pitch', 'pitch']),
          roll: findColumnIndex(header, ['OSD.roll', 'roll']),
          yaw: findColumnIndex(header, ['OSD.yaw', 'yaw']),
          xSpeed: findColumnIndex(header, ['OSD.xSpeed', 'xSpeed', 'OSD.vpsNorthSpeed']),
          ySpeed: findColumnIndex(header, ['OSD.ySpeed', 'ySpeed', 'OSD.vpsEastSpeed']),
          zSpeed: findColumnIndex(header, ['OSD.zSpeed', 'zSpeed', 'OSD.vpsGroundSpeed']),
          hSpeed: findColumnIndex(header, ['OSD.hSpeed', 'hSpeed', 'horizontalSpeed']),
          gimbalPitch: findColumnIndex(header, ['GIMBAL.pitch', 'gimbal.pitch']),
          gimbalRoll: findColumnIndex(header, ['GIMBAL.roll', 'gimbal.roll']),
          gimbalYaw: findColumnIndex(header, ['GIMBAL.yaw', 'gimbal.yaw']),
          batteryLevel: findColumnIndex(header, ['BATTERY.level', 'battery.level', 'OSD.batteryLevel']),
          gpsNum: findColumnIndex(header, ['OSD.gpsNum', 'gpsNum', 'GPS.numSatellites']),
          flightMode: findColumnIndex(header, ['OSD.flycState', 'flightMode']),
        };

        flightData.push({
          timestamp: getValueByIndex(record, header, columnIndices.datetime),
          latitude: lat,
          longitude: lon,
          altitude: getValueByIndex(record, header, columnIndices.altitude) || 0,
          height: getValueByIndex(record, header, columnIndices.height) || 0,
          pitch: getValueByIndex(record, header, columnIndices.pitch) || 0,
          roll: getValueByIndex(record, header, columnIndices.roll) || 0,
          yaw: getValueByIndex(record, header, columnIndices.yaw) || 0,
          xSpeed: getValueByIndex(record, header, columnIndices.xSpeed) || 0,
          ySpeed: getValueByIndex(record, header, columnIndices.ySpeed) || 0,
          zSpeed: getValueByIndex(record, header, columnIndices.zSpeed) || 0,
          hSpeed: getValueByIndex(record, header, columnIndices.hSpeed) || 0,
          gimbalPitch: getValueByIndex(record, header, columnIndices.gimbalPitch) || 0,
          gimbalRoll: getValueByIndex(record, header, columnIndices.gimbalRoll) || 0,
          gimbalYaw: getValueByIndex(record, header, columnIndices.gimbalYaw) || 0,
          batteryLevel: getValueByIndex(record, header, columnIndices.batteryLevel) || 0,
          gpsNum: getValueByIndex(record, header, columnIndices.gpsNum) || 0,
          flightMode: getValueByIndex(record, header, columnIndices.flightMode) || 'Unknown',
        });
      }
    });

    rl.on('close', () => {
      console.log(`✅ Streaming parsed ${flightData.length} valid records from ${lineCount} lines`);
      resolve(flightData);
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

// ==================== PARALLEL IMAGE PROCESSING ====================

async function processImageBatch(images, flightData, batchSize = 5) {
  const results = [];

  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    console.log(`📸 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(images.length / batchSize)} (${batch.length} images)`);

    const batchPromises = batch.map(async (imgInfo, batchIdx) => {
      const globalIdx = i + batchIdx;

      try {
        // Extract timestamp
        const timestamp = await extractTimestampFromImage(imgInfo.originalName, imgInfo.path);

        // Match with flight data
        const imageAnnotation = {
          imageName: imgInfo.originalName,
          matchMethod: 'none',
          flightData: null
        };

        if (timestamp && flightData.length > 0) {
          const closest = findClosestFlightRecord(flightData, timestamp, 600000);
          if (closest) {
            imageAnnotation.matchMethod = 'timestamp';
            imageAnnotation.flightData = closest;
            imageAnnotation.timestampDiff = closest.timeDiff;
          }
        }

        // Fallback to sequential matching
        if (!imageAnnotation.flightData && flightData.length > 0) {
          const dataIndex = Math.floor((globalIdx / images.length) * flightData.length);
          imageAnnotation.matchMethod = 'sequential';
          imageAnnotation.flightData = flightData[Math.min(dataIndex, flightData.length - 1)];
        }

        // Create annotation object
        const fd = imageAnnotation.flightData || {};
        const annotation = {
          imageName: imgInfo.originalName,
          matchMethod: imageAnnotation.matchMethod,
          timestamp: fd.timestamp || null,
          gps: {
            latitude: round(fd.latitude, 8),
            longitude: round(fd.longitude, 8),
            altitude: round(fd.altitude, 2),
            height: round(fd.height, 2),
            satellites: fd.gpsNum || 0
          },
          orientation: {
            pitch: round(fd.pitch, 2),
            roll: round(fd.roll, 2),
            yaw: round(fd.yaw, 2)
          },
          gimbal: {
            pitch: round(fd.gimbalPitch, 2),
            roll: round(fd.gimbalRoll, 2),
            yaw: round(fd.gimbalYaw, 2)
          },
          speed: {
            horizontal: round(fd.hSpeed, 2),
            xSpeed: round(fd.xSpeed, 2),
            ySpeed: round(fd.ySpeed, 2),
            zSpeed: round(fd.zSpeed, 2)
          },
          battery: {
            level: round(fd.batteryLevel, 1)
          },
          flightMode: fd.flightMode
        };

        // Create annotated image
        const outputPath = path.join(uploadDir, `annotated_${imgInfo.filename}`);
        await createAnnotatedImageOptimized(imgInfo.path, annotation, outputPath);

        return {
          annotation,
          imagePath: {
            originalName: imgInfo.originalName,
            annotatedPath: outputPath,
            filename: `annotated_${imgInfo.filename}`
          }
        };
      } catch (err) {
        console.error(`⚠️ Failed to process ${imgInfo.originalName}:`, err.message);
        return {
          annotation: {
            imageName: imgInfo.originalName,
            error: err.message
          },
          imagePath: null,
          error: err.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

// ==================== OPTIMIZED IMAGE ANNOTATION ENDPOINT ====================

app.post('/api/annotate-images', upload.fields([
  { name: 'logFile', maxCount: 1 },
  { name: 'images', maxCount: 150 }
]), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('📸 IMAGE ANNOTATION REQUEST - ULTRA OPTIMIZED VERSION');
  console.log('='.repeat(60));

  const djiLogBinary = path.join(__dirname, 'dji-log');
  let logFilePath = null;
  let csvOutputPath = null;
  const uploadedImagePaths = [];

  try {
    if (!req.files?.logFile || !req.files?.images) {
      return res.status(400).json({
        error: 'Both log file and images are required'
      });
    }

    logFilePath = path.join(uploadDir, req.files.logFile[0].filename);
    console.log('📄 Log file:', logFilePath);
    console.log('📸 Images count:', req.files.images.length);

    // Store image paths
    req.files.images.forEach(img => {
      uploadedImagePaths.push({
        path: path.join(uploadDir, img.filename),
        originalName: img.originalname,
        filename: img.filename
      });
    });

    // Check if dji-log binary exists
    if (!fs.existsSync(djiLogBinary)) {
      throw new Error('dji-log binary not found. Download from https://github.com/lvauvillier/dji-log-parser/releases');
    }

    // ============================================================
    // STEP 1: Parse DJI Log with Caching
    // ============================================================
    console.log('\n🔧 Parsing DJI log file...');

    const logBuffer = fs.readFileSync(logFilePath);
    const logHash = crypto.createHash('md5').update(logBuffer).digest('hex');
    csvOutputPath = path.join(cacheDir, `${logHash}.csv`);

    if (fs.existsSync(csvOutputPath)) {
      console.log('✅ Using cached flight data:', csvOutputPath);
    } else {
      console.log('🔄 No cache found, parsing log...');
      const apiKey = process.env.DJI_API_KEY || '6a1613c4a95bea88c227b4b760e528e';

      await new Promise((resolve, reject) => {
        const djiLogProcess = spawn(djiLogBinary, [
          '--api-key', apiKey,
          logFilePath,
          '--csv', csvOutputPath
        ]);

        let stderr = '';
        let stdout = '';
        let lastOutput = Date.now();

        djiLogProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('dji-log stderr:', data.toString().trim());
          lastOutput = Date.now();
        });

        djiLogProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('dji-log stdout:', data.toString().trim());
          lastOutput = Date.now();
        });

        // Monitor for hanging - kill if no output for 30 seconds
        const checkInterval = setInterval(() => {
          const timeSinceOutput = Date.now() - lastOutput;
          if (timeSinceOutput > 30000) {
            console.error('⚠️  DJI log parsing timeout - no output for 30 seconds');
            clearInterval(checkInterval);
            djiLogProcess.kill('SIGKILL');
            reject(new Error('DJI log parsing timeout - process hung'));
          }
        }, 5000);

        djiLogProcess.on('close', (code) => {
          clearInterval(checkInterval);
          if (code !== 0) {
            reject(new Error(`dji-log failed with code ${code}: ${stderr || stdout}`));
          } else {
            console.log('✅ CSV generated and cached');
            resolve();
          }
        });

        djiLogProcess.on('error', (error) => {
          clearInterval(checkInterval);
          reject(new Error(`Failed to run dji-log: ${error.message}`));
        });
      });
    }

    // Verify CSV exists and is valid
    if (!fs.existsSync(csvOutputPath)) {
      throw new Error('CSV file was not created by dji-log');
    }

    const csvStats = fs.statSync(csvOutputPath);
    if (csvStats.size < 100) {
      throw new Error('CSV file is too small - parsing may have failed');
    }

    console.log(`✅ CSV file ready: ${(csvStats.size / 1024 / 1024).toFixed(2)} MB`);

    // ============================================================
    // STEP 2: Parse CSV using streaming for efficiency
    // ============================================================
    console.log('\n📊 Parsing flight data from CSV (streaming)...');

    const flightData = await parseCSVStreaming(csvOutputPath);

    if (flightData.length === 0) {
      throw new Error('No valid GPS data found in log file');
    }

    console.log(`✅ Parsed ${flightData.length} flight records with GPS data`);

    // ============================================================
    // STEP 3: Process images in optimized batches
    // ============================================================
    console.log('\n📝 Creating annotated images (parallel batches)...');

    const results = await processImageBatch(uploadedImagePaths, flightData, 5);

    const annotations = results.map(r => r.annotation);
    const annotatedImagePaths = results.filter(r => r.imagePath).map(r => r.imagePath);

    console.log(`✅ Successfully annotated ${annotatedImagePaths.length}/${annotations.length} images`);

    // Generate CSV output
    const csvOutput = generateAnnotationCSV(annotations);

    // ============================================================
    // STEP 4: Cleanup original uploaded files
    // ============================================================
    console.log('\n🧹 Cleaning up original files...');
    try {
      if (logFilePath && fs.existsSync(logFilePath)) fs.unlinkSync(logFilePath);
      uploadedImagePaths.forEach(img => {
        if (fs.existsSync(img.path)) fs.unlinkSync(img.path);
      });
    } catch (e) {
      console.error('Cleanup error:', e.message);
    }

    // ============================================================
    // STEP 5: Return results
    // ============================================================
    console.log('\n✅ Annotation complete!');

    res.json({
      success: true,
      data: {
        totalImages: annotations.length,
        totalFlightRecords: flightData.length,
        successfulAnnotations: annotatedImagePaths.length,
        annotations: annotations,
        csvData: csvOutput,
        annotatedImages: annotatedImagePaths.map(img => ({
          originalName: img.originalName,
          downloadUrl: `/api/download/${img.filename}`,
          filename: img.filename
        })),
        flightSummary: {
          startTime: flightData[0]?.timestamp,
          endTime: flightData[flightData.length - 1]?.timestamp,
          recordCount: flightData.length
        }
      }
    });

  } catch (error) {
    console.error('❌ ANNOTATION ERROR:', error.message);
    console.error(error.stack);

    // Cleanup on error
    try {
      if (logFilePath && fs.existsSync(logFilePath)) fs.unlinkSync(logFilePath);
      uploadedImagePaths.forEach(img => {
        if (fs.existsSync(img.path)) fs.unlinkSync(img.path);
      });
    } catch (e) {}

    res.status(500).json({
      error: 'Failed to annotate images',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==================== COMPATIBILITY CHECK ENDPOINT (MULTI-LOG SUPPORT) ====================

app.post('/api/check-compatibility', upload.fields([
  { name: 'logFiles', maxCount: 50 },
  { name: 'images', maxCount: 100 }
]), async (req, res) => {
  console.log('\n🔍 COMPATIBILITY CHECK - MULTI-LOG VERSION');

  const logFilePaths = [];
  const imagePaths = [];

  try {
    req.files.logFiles?.forEach(log => {
      logFilePaths.push({
        path: path.join(uploadDir, log.filename),
        originalName: log.originalname
      });
    });

    req.files.images?.forEach(img => {
      imagePaths.push({
        path: path.join(uploadDir, img.filename),
        originalName: img.originalname
      });
    });

    console.log(`📄 Checking ${logFilePaths.length} log files`);
    console.log(`📸 Against ${imagePaths.length} images`);

    const allLogTimestamps = [];

    // Parse all logs
    for (const logInfo of logFilePaths) {
      const logBuffer = fs.readFileSync(logInfo.path);
      const logHash = crypto.createHash('md5').update(logBuffer).digest('hex');
      const cachedCSV = path.join(cacheDir, `${logHash}.csv`);

      if (!fs.existsSync(cachedCSV)) {
        res.json({
          compatible: 'unknown',
          message: 'Logs not yet cached. Run annotation first, then check compatibility.',
          suggestion: 'Upload logs and images to /api/annotate-images endpoint'
        });

        // Cleanup
        logFilePaths.forEach(log => fs.existsSync(log.path) && fs.unlinkSync(log.path));
        imagePaths.forEach(img => fs.existsSync(img.path) && fs.unlinkSync(img.path));
        return;
      }

      // Quick parse cached CSV using streaming
      const fileStream = fs.createReadStream(cachedCSV);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let header = null;
      const logTimestamps = [];
      let linesParsed = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;

        if (!header) {
          header = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          continue;
        }

        if (linesParsed >= 100) break; // Only parse first 100 for speed

        const values = parseCSVLine(line);
        const timeIdx = findColumnIndex(header, ['datetime', 'time', 'OSD.flyTime']);
        const timestamp = values[timeIdx];

        if (timestamp) {
          logTimestamps.push(new Date(timestamp));
        }
        linesParsed++;
      }

      if (logTimestamps.length > 0) {
        allLogTimestamps.push({
          filename: logInfo.originalName,
          startTime: new Date(Math.min(...logTimestamps.map(t => t.getTime()))),
          endTime: new Date(Math.max(...logTimestamps.map(t => t.getTime()))),
          recordCount: logTimestamps.length
        });
      }
    }

    // Extract image timestamps
    const imageTimestamps = [];
    for (const imgInfo of imagePaths) {
      const timestamp = await extractTimestampFromImage(imgInfo.originalName, imgInfo.path);
      if (timestamp) {
        imageTimestamps.push({
          filename: imgInfo.originalName,
          timestamp
        });
      }
    }

    // Cleanup files
    logFilePaths.forEach(log => fs.existsSync(log.path) && fs.unlinkSync(log.path));
    imagePaths.forEach(img => fs.existsSync(img.path) && fs.unlinkSync(img.path));

    if (allLogTimestamps.length === 0) {
      res.json({
        compatible: false,
        reason: 'No valid timestamps found in log files',
        suggestions: ['Logs may be corrupted or empty']
      });
      return;
    }

    if (imageTimestamps.length === 0) {
      res.json({
        compatible: false,
        reason: 'No timestamps found in images',
        imagesChecked: imagePaths.length,
        suggestions: [
          'Images must have timestamps in filename or EXIF data',
          'Supported formats: IMG_20251115_164300.jpg, DJI_0001.JPG with EXIF',
          'Install exif-parser: npm install exif-parser'
        ]
      });
      return;
    }

    // Check for overlaps
    const matches = [];
    for (const img of imageTimestamps) {
      for (const log of allLogTimestamps) {
        const timeDiff = Math.min(
          Math.abs(img.timestamp - log.startTime),
          Math.abs(img.timestamp - log.endTime)
        ) / 1000 / 60; // minutes

        if (img.timestamp >= log.startTime && img.timestamp <= log.endTime) {
          matches.push({
            image: img.filename,
            log: log.filename,
            match: 'inside_range',
            timeDiff: 0
          });
        } else if (timeDiff < 10) {
          matches.push({
            image: img.filename,
            log: log.filename,
            match: 'close_match',
            timeDiff: Math.round(timeDiff)
          });
        }
      }
    }

    const hasGoodMatches = matches.some(m => m.match === 'inside_range');
    const hasCloseMatches = matches.some(m => m.match === 'close_match');

    res.json({
      compatible: hasGoodMatches || hasCloseMatches,
      logs: allLogTimestamps.map(log => ({
        filename: log.filename,
        startTime: log.startTime.toISOString(),
        endTime: log.endTime.toISOString(),
        duration: `${Math.round((log.endTime - log.startTime) / 1000 / 60)} minutes`
      })),
      images: {
        total: imagePaths.length,
        withTimestamps: imageTimestamps.length,
        timeRange: imageTimestamps.length > 0 ? {
          start: new Date(Math.min(...imageTimestamps.map(i => i.timestamp.getTime()))).toISOString(),
          end: new Date(Math.max(...imageTimestamps.map(i => i.timestamp.getTime()))).toISOString()
        } : null
      },
      matches: {
        perfectMatches: matches.filter(m => m.match === 'inside_range').length,
        closeMatches: matches.filter(m => m.match === 'close_match').length,
        details: matches.slice(0, 10) // Show first 10 matches
      },
      suggestions: hasGoodMatches ? [
        `✅ ${matches.filter(m => m.match === 'inside_range').length} images match perfectly with logs`,
        'Ready for annotation!'
      ] : hasCloseMatches ? [
        `⚠️  ${matches.filter(m => m.match === 'close_match').length} images are close (within 10 min)`,
        'May work but check camera time settings'
      ] : [
        '❌ No time overlap found between images and logs',
        'Images and logs appear to be from different flights',
        'Verify you uploaded the correct files'
      ]
    });

  } catch (error) {
    console.error('❌ COMPATIBILITY CHECK ERROR:', error.message);

    // Cleanup on error
    try {
      logFilePaths.forEach(log => fs.existsSync(log.path) && fs.unlinkSync(log.path));
      imagePaths.forEach(img => fs.existsSync(img.path) && fs.unlinkSync(img.path));
    } catch (e) {}

    res.status(500).json({
      error: 'Compatibility check failed',
      details: error.message
    });
  }
});

// ==================== DJI LOG PARSER ENDPOINT ====================

app.post('/api/parse-dji-log', upload.single('logFile'), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🚁 DJI LOG PARSING REQUEST');
  console.log('='.repeat(60));

  const djiLogBinary = path.join(__dirname, 'dji-log');
  let logFilePath = null;
  let csvOutputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No log file uploaded' });
    }

    logFilePath = path.join(uploadDir, req.file.filename);
    console.log('📄 Log file:', logFilePath);
    console.log('📦 File size:', req.file.size, 'bytes');

    // Check cache
    const logBuffer = fs.readFileSync(logFilePath);
    const logHash = crypto.createHash('md5').update(logBuffer).digest('hex');
    csvOutputPath = path.join(cacheDir, `${logHash}.csv`);

    if (!fs.existsSync(csvOutputPath)) {
      console.log('🔄 Parsing log with dji-log binary...');

      if (!fs.existsSync(djiLogBinary)) {
        throw new Error('dji-log binary not found');
      }

      const apiKey = process.env.DJI_API_KEY || '6a1613c4a95bea88c227b4b760e528e';

      await new Promise((resolve, reject) => {
        const djiLogProcess = spawn(djiLogBinary, [
          '--api-key', apiKey,
          logFilePath,
          '--csv', csvOutputPath
        ]);

        let stderr = '';
        let lastOutput = Date.now();

        djiLogProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('dji-log:', data.toString().trim());
          lastOutput = Date.now();
        });

        djiLogProcess.stdout.on('data', (data) => {
          console.log('dji-log:', data.toString().trim());
          lastOutput = Date.now();
        });

        // Monitor for hanging
        const checkInterval = setInterval(() => {
          if (Date.now() - lastOutput > 30000) {
            clearInterval(checkInterval);
            djiLogProcess.kill('SIGKILL');
            reject(new Error('DJI log parsing timeout'));
          }
        }, 5000);

        djiLogProcess.on('close', (code) => {
          clearInterval(checkInterval);
          if (code !== 0) {
            reject(new Error(`dji-log failed: ${stderr}`));
          } else {
            resolve();
          }
        });

        djiLogProcess.on('error', (error) => {
          clearInterval(checkInterval);
          reject(new Error(`Failed to run dji-log: ${error.message}`));
        });
      });
    } else {
      console.log('✅ Using cached CSV');
    }

    // Parse CSV using streaming
    const parsedData = await parseCSVStreaming(csvOutputPath);

    // Extract flight path (limit to 1000 points for response size)
    const step = Math.max(1, Math.floor(parsedData.length / 1000));
    const flightPath = parsedData.filter((_, i) => i % step === 0).map(record => ({
      timestamp: record.timestamp,
      latitude: record.latitude,
      longitude: record.longitude,
      altitude: record.altitude,
      relativeAltitude: record.height,
    }));

    // Calculate statistics
    let maxAltitude = 0;
    let maxSpeed = 0;
    let totalDistance = 0;

    for (let i = 0; i < parsedData.length; i++) {
      if (parsedData[i].altitude > maxAltitude) maxAltitude = parsedData[i].altitude;
      if (parsedData[i].hSpeed > maxSpeed) maxSpeed = parsedData[i].hSpeed;

      if (i > 0) {
        totalDistance += calculateDistance(
          parsedData[i - 1].latitude,
          parsedData[i - 1].longitude,
          parsedData[i].latitude,
          parsedData[i].longitude
        );
      }
    }

    // Calculate duration
    const startTime = parsedData[0]?.timestamp;
    const endTime = parsedData[parsedData.length - 1]?.timestamp;
    let duration = 'Unknown';

    if (startTime && endTime) {
      try {
        const start = new Date(startTime);
        const end = new Date(endTime);
        const durationMs = end - start;
        const hours = Math.floor(durationMs / 3600000);
        const minutes = Math.floor((durationMs % 3600000) / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        if (hours > 0) duration = `${hours}h ${minutes}m ${seconds}s`;
        else if (minutes > 0) duration = `${minutes}m ${seconds}s`;
        else duration = `${seconds}s`;
      } catch (e) {}
    }

    const flightInfo = {
      fileName: req.file.originalname,
      fileSize: req.file.size,
      parsedAt: new Date().toISOString(),
      summary: {
        totalRecords: parsedData.length,
        duration: duration,
        startTime: startTime,
        endTime: endTime,
      },
      flightPath: flightPath,
      statistics: {
        maxAltitude: Math.round(maxAltitude * 100) / 100,
        maxSpeed: Math.round(maxSpeed * 100) / 100,
        totalDistance: Math.round(totalDistance * 100) / 100,
        avgSpeed: parsedData.length > 0 ? Math.round((totalDistance / (parsedData.length * 0.2)) * 100) / 100 : 0,
      },
      rawDataSample: parsedData.slice(0, 100),
    };

    // Cleanup
    if (logFilePath && fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }

    res.json({ success: true, data: flightInfo });

  } catch (error) {
    console.error('❌ ERROR:', error.message);

    if (logFilePath && fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }

    res.status(500).json({
      error: 'Failed to parse DJI log file',
      details: error.message
    });
  }
});

// ==================== DRONE ANALYSIS ENDPOINT ====================

app.post('/api/analyze-drone', upload.array('images', 20), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('📥 DRONE ANALYSIS REQUEST');
  console.log('='.repeat(60));

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log('📸 Processing', req.files.length, 'images');

    const tempScript = path.join(__dirname, 'temp_drone_analysis.py');
    const scriptContent = `
import sys
import json
import os
sys.path.insert(0, '${__dirname.replace(/\\/g, '\\\\')}')

from vine import analyze_drone_images_rgb_only

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
    const result = await runPythonScript(tempScript, filePaths);

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

// ==================== ORTHOPHOTO ANALYSIS ENDPOINT ====================

app.post('/api/analyze-orthophoto', upload.fields([
  { name: 'orthophoto', maxCount: 1 },
  { name: 'rows_geojson', maxCount: 1 }
]), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('📥 ORTHOPHOTO ANALYSIS REQUEST');
  console.log('='.repeat(60));

  try {
    if (!req.files?.orthophoto) {
      return res.status(400).json({ error: 'No orthophoto uploaded' });
    }

    const method = req.body.method || 'kmeans';
    console.log('🎯 Clustering method:', method);

    const orthophotoPath = path.join(uploadDir, req.files.orthophoto[0].filename);
    let rowsPath = null;

    if (req.files?.rows_geojson) {
      rowsPath = path.join(uploadDir, req.files.rows_geojson[0].filename);
    }

    const tempScript = path.join(__dirname, 'temp_ortho_analysis.py');
    const scriptContent = `
import sys
import json
import os
sys.path.insert(0, '${__dirname.replace(/\\/g, '\\\\')}')

from vine import Config, analyze_orthophoto

Config.ORTHO_PATH = r'${orthophotoPath.replace(/\\/g, '\\\\')}'
${rowsPath ? `Config.ROWS_PATH = r'${rowsPath.replace(/\\/g, '\\\\')}'` : ''}

try:
    result = analyze_orthophoto(method='${method}')
    
    if result is None:
        print(json.dumps({"error": "Analysis returned no results"}))
        sys.exit(1)
    
    output = {
        'method': result.get('method', 'kmeans'),
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
    const result = await runPythonScript(tempScript, []);

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

// ==================== PYTHON SCRIPT RUNNER ====================

function runPythonScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
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
      if (code !== 0) {
        reject(new Error(`Python script failed: ${stderr}`));
        return;
      }

      try {
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
        reject(new Error(`Failed to parse Python output: ${e.message}`));
      }
    });
  });
}

// ==================== HELPER FUNCTIONS ====================

async function extractTimestampFromImage(filename, filepath = null) {
  // Try EXIF first (most reliable if available)
  if (ExifParser && filepath && fs.existsSync(filepath)) {
    try {
      const buffer = fs.readFileSync(filepath);
      const parser = ExifParser.create(buffer);
      const result = parser.parse();

      if (result.tags.DateTimeOriginal) {
        const exifDate = new Date(result.tags.DateTimeOriginal * 1000);
        console.log(`📅 EXIF timestamp: ${filename} -> ${exifDate.toISOString()}`);
        return exifDate;
      }
    } catch (e) {
      // EXIF failed, continue to filename parsing
    }
  }

  // Try multiple filename patterns
  const patterns = [
    { regex: /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/, name: 'Compact' },
    { regex: /(\d{4})-(\d{2})-(\d{2})[_T-](\d{2})[:_-](\d{2})[:_-](\d{2})/, name: 'ISO-like' },
    { regex: /(\d{4})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})/, name: 'Underscore' },
    { regex: /^(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, name: 'Start compact' }
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern.regex);
    if (match) {
      try {
        const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
        if (!isNaN(date.getTime())) {
          console.log(`📅 Filename timestamp: ${filename} (${pattern.name})`);
          return date;
        }
      } catch (e) {}
    }
  }

  console.log(`⚠️  No timestamp found for ${filename}`);
  return null;
}

function findClosestFlightRecord(flightData, targetTime, maxDiffMs = 600000) {
  let closest = null;
  let minDiff = Infinity;

  for (const record of flightData) {
    if (!record.timestamp) continue;

    const recordTime = new Date(record.timestamp);
    if (isNaN(recordTime.getTime())) continue;

    const diff = Math.abs(recordTime.getTime() - targetTime.getTime());
    if (diff < minDiff) {
      minDiff = diff;
      closest = { ...record, timeDiff: diff };
    }
  }

  if (closest && minDiff < maxDiffMs) {
    return closest;
  }
  return null;
}

async function createAnnotatedImageOptimized(inputPath, annotation, outputPath) {
  const textLines = [
    `Image: ${annotation.imageName}`,
    `Match: ${annotation.matchMethod}`,
    ``,
    `GPS:`,
    `  Lat: ${annotation.gps.latitude}`,
    `  Lon: ${annotation.gps.longitude}`,
    `  Alt: ${annotation.gps.altitude}m`,
    `  Height: ${annotation.gps.height}m`,
    `  Sats: ${annotation.gps.satellites}`,
    ``,
    `Orientation:`,
    `  Pitch: ${annotation.orientation.pitch}°`,
    `  Roll: ${annotation.orientation.roll}°`,
    `  Yaw: ${annotation.orientation.yaw}°`,
    ``,
    `Gimbal:`,
    `  Pitch: ${annotation.gimbal.pitch}°`,
    `  Roll: ${annotation.gimbal.roll}°`,
    `  Yaw: ${annotation.gimbal.yaw}°`,
    ``,
    `Speed:`,
    `  H: ${annotation.speed.horizontal} m/s`,
    `  V: ${annotation.speed.zSpeed} m/s`,
    ``,
    `Battery: ${annotation.battery.level}%`,
    `Mode: ${annotation.flightMode}`
  ];

  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    let pipeline = image;
    const maxWidth = 3000;

    if (metadata.width > maxWidth) {
      const scale = maxWidth / metadata.width;
      pipeline = pipeline.resize(maxWidth, Math.round(metadata.height * scale), {
        fit: 'inside',
        withoutEnlargement: true
      });
      metadata.width = maxWidth;
      metadata.height = Math.round(metadata.height * scale);
    }

    const overlayWidth = Math.min(500, Math.floor(metadata.width * 0.35));
    const overlayHeight = Math.min(700, Math.floor(metadata.height * 0.7));

    const textSvg = Buffer.from(`
      <svg width="${overlayWidth}" height="${overlayHeight}">
        <rect width="${overlayWidth}" height="${overlayHeight}" fill="black" opacity="0.7"/>
        ${textLines.map((line, i) => {
      const fontSize = line === '' ? 8 : (line.startsWith(' ') ? 11 : 13);
      const fontWeight = line.startsWith(' ') ? 'normal' : 'bold';
      const y = 18 + i * 22;
      return `<text x="12" y="${y}" font-family="monospace" font-size="${fontSize}" font-weight="${fontWeight}" fill="white">${escapeXml(line)}</text>`;
    }).join('\n')}
      </svg>
    `);

    await pipeline
      .composite([{
        input: textSvg,
        top: 10,
        left: 10
      }])
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(outputPath.replace(/\.(tif|tiff|png)$/i, '.jpg'));

    return outputPath.replace(/\.(tif|tiff|png)$/i, '.jpg');
  } catch (error) {
    console.error('Error creating annotated image:', error);
    throw error;
  }
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findColumnIndex(header, possibleNames) {
  for (const name of possibleNames) {
    const idx = header.findIndex(h =>
      h.toLowerCase() === name.toLowerCase() ||
      h.toLowerCase().includes(name.toLowerCase())
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function getValueByIndex(record, header, index) {
  if (index < 0 || index >= header.length) return null;
  return record[header[index]];
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^"|"$/g, ''));
  return values;
}

function isValidCoordinate(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    isFinite(lat) &&
    isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    (Math.abs(lat) > 0.001 || Math.abs(lon) > 0.001)
  );
}

function round(value, decimals) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function generateAnnotationCSV(annotations) {
  const headers = [
    'Image Name',
    'Match Method',
    'Timestamp',
    'Latitude',
    'Longitude',
    'Altitude (m)',
    'Height (m)',
    'GPS Satellites',
    'Pitch (°)',
    'Roll (°)',
    'Yaw (°)',
    'Gimbal Pitch (°)',
    'Gimbal Roll (°)',
    'Gimbal Yaw (°)',
    'Horizontal Speed (m/s)',
    'X Speed (m/s)',
    'Y Speed (m/s)',
    'Z Speed (m/s)',
    'Battery Level (%)',
    'Flight Mode'
  ];

  let csv = headers.join(',') + '\n';

  for (const ann of annotations) {
    const row = [
      `"${ann.imageName}"`,
      ann.matchMethod,
      ann.timestamp ? `"${ann.timestamp}"` : '',
      ann.gps.latitude,
      ann.gps.longitude,
      ann.gps.altitude,
      ann.gps.height,
      ann.gps.satellites,
      ann.orientation.pitch,
      ann.orientation.roll,
      ann.orientation.yaw,
      ann.gimbal.pitch,
      ann.gimbal.roll,
      ann.gimbal.yaw,
      ann.speed.horizontal,
      ann.speed.xSpeed,
      ann.speed.ySpeed,
      ann.speed.zSpeed,
      ann.battery.level,
      `"${ann.flightMode}"`
    ];
    csv += row.join(',') + '\n';
  }

  return csv;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ==================== DOWNLOAD ENDPOINT ====================

app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  console.log('📥 Download request for:', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download file' });
      }
    } else {
      console.log('✅ File downloaded:', filename);
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🧹 Cleaned up downloaded file:', filename);
          }
        } catch (e) {
          console.error('Cleanup error:', e.message);
        }
      }, 60000);
    }
  });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('✅ SERVER RUNNING - ULTRA OPTIMIZED VERSION');
  console.log('='.repeat(60));
  console.log(`🌐 Local:    http://localhost:${PORT}`);
  console.log(`🌐 Network:  http://0.0.0.0:${PORT}`);
  console.log('='.repeat(60));
  console.log('\n💡 Optimizations enabled:');
  console.log('  ✓ Streaming CSV parser');
  console.log('  ✓ Parallel batch image processing');
  console.log('  ✓ Process timeout monitoring (30s)');
  console.log('  ✓ Smart caching system');
  console.log('  ✓ Optimized image compression');
  console.log('\n💡 Waiting for requests...\n');
});