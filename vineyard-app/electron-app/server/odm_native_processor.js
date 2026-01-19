/**
 * Native ODM Processor - Run OpenDroneMap without Docker
 * This allows the app to work standalone without requiring Docker installation
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Path to the bundled ODM engine
const ODM_PATH = path.join(__dirname, '..', '..', 'backend', 'odm-engine');
const ODM_VENV_PYTHON = path.join(ODM_PATH, 'venv', 'bin', 'python3');
const ODM_PYTHON = fs.existsSync(ODM_VENV_PYTHON) ? ODM_VENV_PYTHON : 'python3';
const ODM_RUN_SCRIPT = path.join(ODM_PATH, 'run.py');

/**
 * Process images using native ODM engine
 * @param {string} projectName - Name of the project
 * @param {string} imagesPath - Path to input images
 * @param {object} options - Processing options
 * @returns {Promise<string>} - Path to output orthophoto
 */
async function processWithNativeODM(projectName, imagesPath, options = {}) {
  return new Promise((resolve, reject) => {
    console.log('🔧 Starting Native ODM Processing (No Docker Required)');
    console.log(`   Project: ${projectName}`);
    console.log(`   Images: ${imagesPath}`);
    
    // Create ODM project directory
    const odmProjectPath = path.join(ODM_PATH, 'projects', projectName);
    const odmImagesPath = path.join(odmProjectPath, 'images');
    
    // Ensure project directories exist
    if (!fs.existsSync(odmProjectPath)) {
      fs.mkdirSync(odmProjectPath, { recursive: true });
    }
    
    if (!fs.existsSync(odmImagesPath)) {
      fs.mkdirSync(odmImagesPath, { recursive: true });
    }
    
    // Copy images to ODM project folder
    console.log('📂 Copying images to ODM project folder...');
    const images = fs.readdirSync(imagesPath);
    let copiedCount = 0;
    
    for (const img of images) {
      const srcPath = path.join(imagesPath, img);
      const dstPath = path.join(odmImagesPath, img);
      
      if (fs.statSync(srcPath).isFile() && /\.(jpg|jpeg|png|tif|tiff)$/i.test(img)) {
        fs.copyFileSync(srcPath, dstPath);
        copiedCount++;
      }
    }
    
    console.log(`✅ Copied ${copiedCount} images`);
    
    // Prepare ODM arguments
    const quality = options.quality || 'medium';
    const featureQuality = options.feature_quality || 'medium';
    
    // Map quality settings to ODM parameters
    const qualityMap = {
      ultra: { resize: 2048, quality: 'ultra', features: 32000 },
      high: { resize: 3072, quality: 'high', features: 16000 },
      medium: { resize: 4096, quality: 'medium', features: 10000 },
      low: { resize: 5120, quality: 'low', features: 8000 }
    };
    
    const qSettings = qualityMap[quality] || qualityMap.medium;
    
    const odmArgs = [
      ODM_RUN_SCRIPT,
      projectName,
      '--project-path', path.join(ODM_PATH, 'projects'),
      '--resize-to', qSettings.resize.toString(),
      '--feature-quality', featureQuality,
      '--feature-type', 'sift',
      '--matcher-type', 'flann',
      '--min-num-features', qSettings.features.toString(),
      '--orthophoto-resolution', (options.orthophoto_resolution || 5).toString(),
      '--dem-resolution', '9',
      '--pc-quality', qSettings.quality,
      '--ignore-gsd',
      '--fast-orthophoto',
      '--skip-3dmodel', // Skip 3D model to save time and memory
      '--verbose'
    ];
    
    console.log('🚀 Running ODM with args:', odmArgs.join(' '));
    console.log('   This will take 15-60 minutes depending on image count and quality...');
    
    // Start ODM process
    const odmProcess = spawn(ODM_PYTHON, odmArgs, {
      cwd: ODM_PATH,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: ODM_PATH,
        PATH: `${path.join(ODM_PATH, 'SuperBuild', 'install', 'bin')}:${process.env.PATH}`
      }
    });
    
    let stdoutData = '';
    let stderrData = '';
    let lastProgress = 0;
    
    odmProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutData += text;
      
      // Log progress
      console.log('[ODM]', text.trim());
      
      // Track progress from log messages
      if (text.includes('Running dataset stage')) {
        lastProgress = 20;
      } else if (text.includes('Running feature extraction')) {
        lastProgress = 30;
      } else if (text.includes('Running matching')) {
        lastProgress = 40;
      } else if (text.includes('Reconstructing')) {
        lastProgress = 50;
      } else if (text.includes('Running mesh')) {
        lastProgress = 60;
      } else if (text.includes('Running odm_orthophoto')) {
        lastProgress = 80;
      } else if (text.includes('Completed')) {
        lastProgress = 95;
      }
    });
    
    odmProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;
      console.error('[ODM Error]', text.trim());
    });
    
    odmProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Native ODM processing completed successfully');
        
        // Find the generated orthophoto
        const orthophotoPath = path.join(odmProjectPath, 'odm_orthophoto', 'odm_orthophoto.tif');
        
        if (fs.existsSync(orthophotoPath)) {
          const stats = fs.statSync(orthophotoPath);
          console.log(`📥 Orthophoto generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          resolve(orthophotoPath);
        } else {
          reject(new Error('ODM completed but orthophoto file not found'));
        }
      } else {
        console.error(`❌ Native ODM failed with code ${code}`);
        console.error('Last stdout:', stdoutData.slice(-500));
        console.error('Last stderr:', stderrData.slice(-500));
        reject(new Error(`ODM processing failed with code ${code}`));
      }
    });
    
    odmProcess.on('error', (err) => {
      console.error('❌ Failed to start ODM:', err);
      reject(err);
    });
  });
}

/**
 * Get progress of a running ODM process
 * @param {string} projectName - Project name
 * @returns {number} - Progress percentage (0-100)
 */
function getODMProgress(projectName) {
  const logPath = path.join(ODM_PATH, 'projects', projectName, 'odm_report', 'log.json');
  
  try {
    if (fs.existsSync(logPath)) {
      const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      // Parse progress from log
      return logData.progress || 50;
    }
  } catch (e) {
    // Ignore errors
  }
  
  return 50; // Default progress
}

/**
 * Check if native ODM is available
 * @returns {boolean} - True if ODM is available
 */
function isNativeODMAvailable() {
  try {
    const checkPaths = [
      fs.existsSync(ODM_PATH),
      fs.existsSync(ODM_RUN_SCRIPT),
      fs.existsSync(path.join(ODM_PATH, 'SuperBuild', 'install', 'bin', 'opensfm'))
    ];
    
    const available = checkPaths.every(check => check === true);
    
    if (available) {
      console.log('✅ Native ODM engine is available (No Docker needed)');
    } else {
      console.warn('⚠️ Native ODM engine not found');
    }
    
    return available;
  } catch (e) {
    console.error('Error checking ODM availability:', e);
    return false;
  }
}

module.exports = {
  processWithNativeODM,
  getODMProgress,
  isNativeODMAvailable
};
