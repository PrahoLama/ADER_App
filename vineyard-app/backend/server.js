const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const FormData = require('form-data');
const axios = require('axios');
require('dotenv').config();

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

// ==================== DJI LOG PARSER ENDPOINT ====================

app.post('/api/parse-dji-log', upload.single('logFile'), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🚁 DJI LOG PARSING REQUEST');
  console.log('='.repeat(60));

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No log file uploaded' });
    }

    const logFilePath = path.join(uploadDir, req.file.filename);
    console.log('📄 Log file:', logFilePath);
    console.log('📦 File size:', req.file.size, 'bytes');

    // Read the file buffer
    const fileBuffer = fs.readFileSync(logFilePath);

    // Try multiple parsing methods
    let parsedData = null;
    let parsingMethod = 'unknown';

    // ============================================================
    // METHOD 1: Try Airdata UAV Parser API (If API key available)
    // ============================================================
    if (process.env.AIRDATA_API_KEY && process.env.AIRDATA_API_KEY !== 'your_api_key_here') {
      try {
        console.log('🔍 Trying Airdata UAV API...');

        const formData = new FormData();
        formData.append('file', fileBuffer, {
          filename: req.file.originalname,
          contentType: 'application/octet-stream'
        });

        const airdataResponse = await axios.post(
          'https://api.airdata.com/api/flight_parser/v2/parse',
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'X-API-Key': process.env.AIRDATA_API_KEY
            },
            timeout: 60000
          }
        );

        if (airdataResponse.data && airdataResponse.data.flight_records) {
          parsedData = airdataResponse.data.flight_records;
          parsingMethod = 'airdata-api';
          console.log('✅ Parsed using Airdata UAV API');
        }
      } catch (apiError) {
        console.log('⚠️ Airdata API failed:', apiError.message);
      }
    } else {
      console.log('ℹ️ Airdata API key not configured, skipping API parsing');
    }

    // ============================================================
    // METHOD 2: Try parsing as DJI TXT format (CSV-like)
    // ============================================================
    if (!parsedData || !Array.isArray(parsedData) || parsedData.length === 0) {
      console.log('🔍 Trying TXT/CSV parsing...');

      // Try different encodings
      let textContent = fileBuffer.toString('utf8');

      // If UTF-8 fails, try latin1
      if (!textContent.includes('OSD') && !textContent.includes('latitude')) {
        console.log('🔍 UTF-8 failed, trying latin1 encoding...');
        textContent = fileBuffer.toString('latin1');
      }

      // If still fails, try ascii
      if (!textContent.includes('OSD') && !textContent.includes('latitude')) {
        console.log('🔍 latin1 failed, trying ascii encoding...');
        textContent = fileBuffer.toString('ascii');
      }

      console.log('📋 Text preview:', textContent.substring(0, 200));
      console.log('📋 Contains OSD?', textContent.includes('OSD'));
      console.log('📋 Contains latitude?', textContent.includes('latitude'));

      // Check if it's a CSV/TXT format
      if (textContent.includes('latitude') || textContent.includes('longitude') ||
        textContent.includes('datetime') || textContent.includes('OSD') ||
        textContent.includes('sep=')) {

        let lines = textContent.split('\n').filter(line => line.trim());

        // Skip the "sep=," line if present (DJI format)
        if (lines[0] && lines[0].trim().toLowerCase().startsWith('sep=')) {
          console.log('📋 Detected DJI CSV format with separator declaration');
          lines = lines.slice(1);
        }

        if (lines.length > 1) {
          // Parse header
          const header = lines[0].split(',').map(h => h.trim());
          console.log('📋 Found headers:', header.length, 'columns');
          console.log('📋 First 10 headers:', header.slice(0, 10));

          // Parse data rows
          const dataRows = [];
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            // Parse CSV line (handle quoted values)
            const values = [];
            let current = '';
            let inQuotes = false;

            for (let j = 0; j < line.length; j++) {
              const char = line[j];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            values.push(current.trim());

            // Only process rows with matching column count
            if (values.length === header.length) {
              const row = {};
              header.forEach((key, idx) => {
                let value = values[idx];
                // Try to parse as number
                if (value && !isNaN(value) && value !== '') {
                  value = parseFloat(value);
                }
                row[key] = value;
              });
              dataRows.push(row);
            }
          }

          if (dataRows.length > 0) {
            parsedData = dataRows;
            parsingMethod = 'txt-csv';
            console.log('✅ Parsed as TXT/CSV format');
            console.log('📊 Parsed', dataRows.length, 'data rows');
          }
        }
      }
    }

    // ============================================================
    // METHOD 3: Try parsing as JSON
    // ============================================================
    if (!parsedData || !Array.isArray(parsedData) || parsedData.length === 0) {
      console.log('🔍 Trying JSON parsing...');
      try {
        const textContent = fileBuffer.toString('utf8');
        const jsonData = JSON.parse(textContent);

        if (Array.isArray(jsonData)) {
          parsedData = jsonData;
          parsingMethod = 'json-array';
        } else if (jsonData.records) {
          parsedData = jsonData.records;
          parsingMethod = 'json-records';
        } else if (jsonData.data) {
          parsedData = jsonData.data;
          parsingMethod = 'json-data';
        }

        if (parsedData && parsedData.length > 0) {
          console.log('✅ Parsed as JSON format');
        }
      } catch (jsonError) {
        console.log('⚠️ JSON parsing failed:', jsonError.message);
      }
    }

    // ============================================================
    // METHOD 4: Try DJI Binary Format Parser (Enhanced)
    // ============================================================
    if (!parsedData || !Array.isArray(parsedData) || parsedData.length === 0) {
      try {
        console.log('🔍 Trying DJI binary format parser...');
        parsedData = await parseDJIBinaryLog(fileBuffer);
        if (parsedData && parsedData.length > 0) {
          parsingMethod = 'dji-binary';
          console.log('✅ Parsed using DJI binary parser');
        }
      } catch (binError) {
        console.log('⚠️ Binary parser failed:', binError.message);
      }
    }

    // Validate final parsed data
    if (!parsedData || !Array.isArray(parsedData) || parsedData.length === 0) {
      console.error('❌ All parsing methods failed');

      // Provide helpful error message
      const textPreview = fileBuffer.toString('utf8', 0, 500);
      const hexPreview = fileBuffer.slice(0, 20).toString('hex');

      // Cleanup file
      try {
        fs.unlinkSync(logFilePath);
      } catch (err) {}

      throw new Error(
        '❌ Unable to parse DJI log file. The file format may not be supported.\n\n' +
        '📋 Supported formats:\n' +
        '  • DJI TXT logs (CSV format with headers)\n' +
        '  • DJI DAT logs (requires conversion)\n' +
        '  • JSON flight logs\n\n' +
        '💡 Solutions:\n' +
        '  1. Convert your log using https://www.djiflightlogviewer.com/\n' +
        '  2. Use Airdata UAV (https://app.airdata.com/) to export as CSV\n' +
        '  3. Get Airdata API key and add to .env file: AIRDATA_API_KEY=your_key\n' +
        '  4. Use DJI Assistant 2 to export flight logs\n\n' +
        `📊 File info:\n` +
        `  • Size: ${req.file.size} bytes\n` +
        `  • Hex preview: ${hexPreview}\n` +
        `  • Text preview: ${textPreview.substring(0, 100).replace(/[^\x20-\x7E]/g, '.')}...`
      );
    }

    console.log('✅ Parsing successful using method:', parsingMethod);
    console.log('📊 Valid records found:', parsedData.length);
    if (parsedData.length > 0) {
      console.log('📋 Sample record keys:', Object.keys(parsedData[0]));
      console.log('📋 Sample record:', JSON.stringify(parsedData[0], null, 2));
    }

    // Extract useful flight information
    const flightInfo = {
      fileName: req.file.originalname,
      fileSize: req.file.size,
      parsedAt: new Date().toISOString(),
      parsingMethod: parsingMethod,

      // Flight summary
      summary: {
        totalRecords: parsedData.length,
        duration: calculateFlightDuration(parsedData),
        startTime: extractTime(parsedData[0]) || null,
        endTime: extractTime(parsedData[parsedData.length - 1]) || null,
      },

      // Flight path data (GPS coordinates)
      flightPath: parsedData.map(record => ({
        timestamp: extractTime(record),
        latitude: extractLatitude(record),
        longitude: extractLongitude(record),
        altitude: extractAltitude(record),
        relativeAltitude: extractRelativeAltitude(record),
      })).filter(point => point.latitude && point.longitude),

      // Flight statistics
      statistics: calculateFlightStats(parsedData),

      // Raw data (limited to first 100 records to avoid huge responses)
      rawDataSample: parsedData.slice(0, 100),

      // Full dataset available flag
      hasMoreData: parsedData.length > 100
    };

    // Clean up uploaded file
    try {
      fs.unlinkSync(logFilePath);
    } catch (err) {
      console.error('Failed to delete temp file:', err);
    }

    console.log('📊 Flight records:', flightInfo.summary.totalRecords);
    console.log('⏱️  Flight duration:', flightInfo.summary.duration);
    console.log('🗺️  GPS points:', flightInfo.flightPath.length);

    res.json({
      success: true,
      data: flightInfo
    });

  } catch (error) {
    console.error('❌ ERROR:', error);
    console.error('Stack:', error.stack);

    // Clean up on error
    if (req.file) {
      try {
        fs.unlinkSync(path.join(uploadDir, req.file.filename));
      } catch (err) {}
    }

    res.status(500).json({
      error: 'Failed to parse DJI log file',
      details: error.message,
      hint: 'Try converting your log file at https://www.djiflightlogviewer.com/ or get an Airdata API key'
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

// Enhanced DJI Binary Log Format Parser
async function parseDJIBinaryLog(fileBuffer) {
  try {
    const header = fileBuffer.slice(0, 4).toString('hex');
    console.log('🔍 Binary header:', header);
    console.log('📦 File size:', fileBuffer.length, 'bytes');

    const records = [];

    // DJI Format Detection
    const isDJIFormat = header.startsWith('29') || header.startsWith('55') || header.startsWith('66');

    if (!isDJIFormat) {
      throw new Error(`Not a recognized DJI binary format (header: ${header})`);
    }

    console.log('✅ Detected DJI binary format');

    // ============================================================
    // ENHANCED METHOD 1: Parse DJI Record Structure
    // ============================================================
    console.log('🔍 Parsing DJI record structure...');

    let offset = 0;
    let recordCount = 0;

    while (offset < fileBuffer.length - 100) {
      try {
        // Look for record markers (0x29 is common DJI record marker)
        if (fileBuffer[offset] === 0x29 && offset + 60 < fileBuffer.length) {

          // Read potential record header
          const recordType = fileBuffer[offset + 1];
          const recordLength = fileBuffer.readUInt16LE(offset + 2);

          // Validate record length
          if (recordLength > 0 && recordLength < 1000 && offset + recordLength < fileBuffer.length) {

            // Try to extract GPS data from various offset positions
            const gpsOffsets = [8, 12, 16, 20, 24, 28, 32, 36, 40];

            for (const gpsOffset of gpsOffsets) {
              if (offset + gpsOffset + 16 <= fileBuffer.length) {

                // Try reading as double (8 bytes each for lat/lon)
                const lat1 = readSafeDouble(fileBuffer, offset + gpsOffset);
                const lon1 = readSafeDouble(fileBuffer, offset + gpsOffset + 8);

                if (isValidCoordinate(lat1, lon1)) {
                  const altitude = readSafeFloat(fileBuffer, offset + gpsOffset + 16) || 0;

                  // Try to find timestamp
                  let timestamp = null;
                  for (let ts = offset; ts < offset + 40 && ts + 4 < fileBuffer.length; ts += 4) {
                    const possibleTime = fileBuffer.readUInt32LE(ts);
                    if (possibleTime > 1420070400 && possibleTime < 1893456000) {
                      timestamp = new Date(possibleTime * 1000).toISOString();
                      break;
                    }
                  }

                  records.push({
                    latitude: lat1,
                    longitude: lon1,
                    altitude: altitude,
                    relativeAltitude: altitude,
                    timestamp: timestamp || new Date().toISOString()
                  });

                  recordCount++;
                  break;
                }

                // Try reading as float (4 bytes each for lat/lon)
                const lat2 = readSafeFloat(fileBuffer, offset + gpsOffset);
                const lon2 = readSafeFloat(fileBuffer, offset + gpsOffset + 4);

                if (isValidCoordinate(lat2, lon2)) {
                  const altitude = readSafeFloat(fileBuffer, offset + gpsOffset + 8) || 0;

                  records.push({
                    latitude: lat2,
                    longitude: lon2,
                    altitude: altitude,
                    relativeAltitude: altitude,
                    timestamp: new Date().toISOString()
                  });

                  recordCount++;
                  break;
                }
              }
            }

            offset += recordLength;
          } else {
            offset++;
          }
        } else {
          offset++;
        }
      } catch (e) {
        offset++;
      }
    }

    console.log(`📊 Method 1 found ${recordCount} GPS records`);

    // ============================================================
    // METHOD 2: Scan for GPS coordinate patterns
    // ============================================================
    if (records.length < 10) {
      console.log('🔍 Scanning for GPS coordinate patterns...');

      for (let i = 0; i < fileBuffer.length - 32; i += 1) {
        try {
          // Try reading as doubles (64-bit floats)
          if (i + 16 < fileBuffer.length) {
            const lat = fileBuffer.readDoubleLE(i);
            const lon = fileBuffer.readDoubleLE(i + 8);

            if (isValidCoordinate(lat, lon)) {
              const alt = readSafeFloat(fileBuffer, i + 16) || 0;

              records.push({
                latitude: lat,
                longitude: lon,
                altitude: alt,
                relativeAltitude: alt,
                timestamp: new Date().toISOString()
              });

              i += 16; // Skip ahead
            }
          }

          // Try reading as floats (32-bit)
          if (i + 12 < fileBuffer.length) {
            const lat = fileBuffer.readFloatLE(i);
            const lon = fileBuffer.readFloatLE(i + 4);

            if (isValidCoordinate(lat, lon)) {
              const alt = readSafeFloat(fileBuffer, i + 8) || 0;

              records.push({
                latitude: lat,
                longitude: lon,
                altitude: alt,
                relativeAltitude: alt,
                timestamp: new Date().toISOString()
              });

              i += 12; // Skip ahead
            }
          }
        } catch (e) {
          // Continue scanning
        }
      }
    }

    // ============================================================
    // METHOD 3: Look for embedded CSV/text data
    // ============================================================
    if (records.length < 10) {
      console.log('🔍 Searching for embedded text data...');
      const textContent = fileBuffer.toString('utf8', 0, Math.min(fileBuffer.length, 50000));

      // Look for coordinate patterns in text
      const coordRegex = /(-?\d+\.\d{4,})\s*[,;|\s]\s*(-?\d+\.\d{4,})/g;
      let match;

      while ((match = coordRegex.exec(textContent)) !== null) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);

        if (isValidCoordinate(lat, lon)) {
          records.push({
            latitude: lat,
            longitude: lon,
            altitude: 0,
            relativeAltitude: 0,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Remove duplicates
    const uniqueRecords = removeDuplicateCoordinates(records);

    console.log('📊 Total GPS points found:', uniqueRecords.length);

    if (uniqueRecords.length >= 5) {
      console.log('✅ Successfully extracted GPS data from binary format');
      return uniqueRecords;
    } else {
      throw new Error(
        `Not enough valid GPS data found (found ${uniqueRecords.length} points, need at least 5).\n\n` +
        `This appears to be an encrypted or proprietary DJI format.\n\n` +
        `📋 Recommended solutions:\n` +
        `1. Use DJI Flight Log Viewer (https://www.phantomhelp.com/logviewer/upload/) to convert your log\n` +
        `2. Export as CSV from DJI GO/Fly app\n` +
        `3. Use Airdata UAV (https://app.airdata.com/) for professional parsing\n` +
        `4. Try CsvView (https://datfile.net/) for DAT file conversion`
      );
    }
  } catch (error) {
    throw error;
  }
}

// Helper function to safely read doubles
function readSafeDouble(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  try {
    const value = buffer.readDoubleLE(offset);
    return (isNaN(value) || !isFinite(value)) ? null : value;
  } catch (e) {
    return null;
  }
}

// Helper function to safely read floats
function readSafeFloat(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  try {
    const value = buffer.readFloatLE(offset);
    return (isNaN(value) || !isFinite(value)) ? null : value;
  } catch (e) {
    return null;
  }
}

// Validate GPS coordinates
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
    (Math.abs(lat) > 0.001 || Math.abs(lon) > 0.001) // Not null island
  );
}

// Remove duplicate coordinates that are very close together
function removeDuplicateCoordinates(records) {
  if (records.length === 0) return [];

  const unique = [records[0]];
  const threshold = 0.00001; // ~1 meter

  for (let i = 1; i < records.length; i++) {
    const current = records[i];
    const last = unique[unique.length - 1];

    const latDiff = Math.abs(current.latitude - last.latitude);
    const lonDiff = Math.abs(current.longitude - last.longitude);

    // Only add if significantly different from last point
    if (latDiff > threshold || lonDiff > threshold) {
      unique.push(current);
    }
  }

  return unique;
}

function extractTime(record) {
  if (!record) return null;
  return record.dateTime ||
    record.timestamp ||
    record.time ||
    record['OSD.dateTime'] ||
    record.datetime ||
    record.Date ||
    record.offsetTime ||
    record['General.offsetTime'] ||
    record['OSD.time'] ||
    null;
}

function extractLatitude(record) {
  if (!record) return null;
  const lat = record.latitude ||
    record.lat ||
    record['OSD.latitude'] ||
    record.Latitude ||
    record['Home.latitude'] ||
    record['GPS.latitude'] ||
    null;

  return lat && !isNaN(lat) ? parseFloat(lat) : null;
}

function extractLongitude(record) {
  if (!record) return null;
  const lon = record.longitude ||
    record.lon ||
    record.lng ||
    record['OSD.longitude'] ||
    record.Longitude ||
    record['Home.longitude'] ||
    record['GPS.longitude'] ||
    null;

  return lon && !isNaN(lon) ? parseFloat(lon) : null;
}

function extractAltitude(record) {
  if (!record) return null;
  const alt = record.altitude ||
    record.alt ||
    record['OSD.altitude'] ||
    record.Altitude ||
    record['OSD.height'] ||
    record['GPS.altitude'] ||
    0;

  return alt && !isNaN(alt) ? parseFloat(alt) : 0;
}

function extractRelativeAltitude(record) {
  if (!record) return null;
  const relAlt = record.relativeAltitude ||
    record.height ||
    record['OSD.height'] ||
    record.RelativeAltitude ||
    record['OSD.relativeHeight'] ||
    record['GPS.heightMSL'] ||
    0;

  return relAlt && !isNaN(relAlt) ? parseFloat(relAlt) : 0;
}

function calculateFlightDuration(parsedData) {
  if (!parsedData || parsedData.length < 2) return '0s';

  try {
    const startTime = extractTime(parsedData[0]);
    const endTime = extractTime(parsedData[parsedData.length - 1]);

    if (!startTime || !endTime) {
      return 'Unknown';
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 'Unknown';
    }

    const durationMs = end - start;

    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  } catch (err) {
    console.error('Duration calc error:', err);
    return 'Unknown';
  }
}

function calculateFlightStats(parsedData) {
  if (!parsedData || parsedData.length === 0) {
    return {
      maxAltitude: 0,
      maxSpeed: 0,
      totalDistance: 0,
      avgSpeed: 0,
    };
  }

  let maxAltitude = 0;
  let maxSpeed = 0;
  let totalDistance = 0;
  let speedSum = 0;
  let speedCount = 0;

  for (let i = 0; i < parsedData.length; i++) {
    const record = parsedData[i];

    // Max altitude
    const altitude = extractAltitude(record);
    if (altitude > maxAltitude) {
      maxAltitude = altitude;
    }

    // Speed tracking
    const speed = record.speed ||
      record.velocity ||
      record['OSD.speed'] ||
      record['OSD.hSpeed'] ||
      record['GPS.speed'] ||
      null;

    if (speed !== undefined && speed !== null && !isNaN(speed)) {
      const speedVal = parseFloat(speed);
      if (speedVal > maxSpeed) {
        maxSpeed = speedVal;
      }
      speedSum += speedVal;
      speedCount++;
    }

    // Calculate distance between consecutive points
    if (i > 0) {
      const lat = extractLatitude(record);
      const lon = extractLongitude(record);
      const prevLat = extractLatitude(parsedData[i - 1]);
      const prevLon = extractLongitude(parsedData[i - 1]);

      if (lat && lon && prevLat && prevLon) {
        totalDistance += calculateDistance(prevLat, prevLon, lat, lon);
      }
    }
  }

  return {
    maxAltitude: Math.round(maxAltitude * 100) / 100,
    maxSpeed: Math.round(maxSpeed * 100) / 100,
    totalDistance: Math.round(totalDistance * 100) / 100,
    avgSpeed: speedCount > 0 ? Math.round((speedSum / speedCount) * 100) / 100 : 0,
  };
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// ==================== EXISTING ENDPOINTS ====================

// Analyze drone images - Direct Python call
app.post('/api/analyze-drone', upload.array('images', 20), async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('📥 DRONE ANALYSIS REQUEST');
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
  console.log('📥 ORTHOPHOTO ANALYSIS REQUEST');
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