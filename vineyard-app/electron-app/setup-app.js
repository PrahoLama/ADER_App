/**
 * ADER Drone Analyzer - Complete Setup Script
 * Prepares the Electron app by copying all required files from backend
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const BACKEND_SOURCE = path.join(ROOT, '..', 'backend');
const FRONTEND_SOURCE = path.join(ROOT, '..', 'frontend');
const SERVER_TARGET = path.join(ROOT, 'server');

console.log('🚀 ADER Drone Analyzer - Complete Setup Script');
console.log('='.repeat(60));

// Backend files to copy
const backendFiles = [
  'server.js',
  'yolo_detector.py',
  'draw_annotations.py',
  'dji_log_analyzer.py',
  'vine_analysis.py',
  'detect_rows_enhanced.py',
  'rgb_analyzer.py',
  'vine.py',
  'yolov8n.pt',
  'package.json',
  '.env'
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('📁 Created:', dir);
  }
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log('✅ Copied:', path.basename(src));
    return true;
  } else {
    console.log('⚠️  Not found:', path.basename(src));
    return false;
  }
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.log('⚠️  Source not found:', src);
    return false;
  }
  
  ensureDir(dest);
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Skip node_modules, cache, and other non-essential directories
    if (entry.name === 'node_modules' || 
        entry.name === '.git' || 
        entry.name === '__pycache__' ||
        entry.name === 'cache' ||
        entry.name === 'uploads' ||
        entry.name === 'tmp' ||
        entry.name === 'orthomosaic_projects' ||
        entry.name === 'odm_projects' ||
        entry.name === 'vineyard_analysis_results') {
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  
  return true;
}

async function main() {
  try {
    // Step 1: Create server directory
    console.log('\n📂 Step 1: Setting up server directory...');
    ensureDir(SERVER_TARGET);
    
    // Step 2: Copy essential backend files
    console.log('\n📋 Step 2: Copying backend files...');
    let copiedCount = 0;
    
    for (const file of backendFiles) {
      const src = path.join(BACKEND_SOURCE, file);
      const dest = path.join(SERVER_TARGET, file);
      if (copyFile(src, dest)) {
        copiedCount++;
      }
    }
    
    console.log(`   Copied ${copiedCount}/${backendFiles.length} essential files`);
    
    // Step 3: Copy dji-log binary (critical for DJI log parsing)
    console.log('\n📋 Step 3: Copying DJI log parser...');
    const djiLogSrc = path.join(BACKEND_SOURCE, 'dji-log');
    const djiLogDest = path.join(SERVER_TARGET, 'dji-log');
    
    if (fs.existsSync(djiLogSrc)) {
      if (fs.statSync(djiLogSrc).isDirectory()) {
        copyDirRecursive(djiLogSrc, djiLogDest);
      } else {
        copyFile(djiLogSrc, djiLogDest);
        // Make executable on Unix systems
        if (process.platform !== 'win32') {
          fs.chmodSync(djiLogDest, '755');
        }
      }
      console.log('✅ DJI log parser copied');
    } else {
      console.log('⚠️  DJI log parser not found - DJI log parsing will not work');
    }
    
    // Step 4: Copy annotations directory structure
    console.log('\n📋 Step 4: Setting up annotations directory...');
    const annotationsSrc = path.join(BACKEND_SOURCE, 'annotations');
    const annotationsDest = path.join(SERVER_TARGET, 'annotations');
    ensureDir(annotationsDest);
    
    // Copy existing annotations if any
    if (fs.existsSync(annotationsSrc)) {
      const annotationFiles = fs.readdirSync(annotationsSrc).filter(f => f.endsWith('.json'));
      for (const file of annotationFiles) {
        fs.copyFileSync(
          path.join(annotationsSrc, file),
          path.join(annotationsDest, file)
        );
      }
      console.log(`✅ Copied ${annotationFiles.length} annotation files`);
    }
    
    // Step 5: Create required directories
    console.log('\n📁 Step 5: Creating required directories...');
    const requiredDirs = ['uploads', 'cache', 'tmp', 'dji-log'];
    for (const dir of requiredDirs) {
      ensureDir(path.join(SERVER_TARGET, dir));
    }
    
    // Step 6: Create models directory and copy YOLO model
    console.log('\n📋 Step 6: Setting up YOLO model...');
    const modelsDir = path.join(ROOT, 'models');
    ensureDir(modelsDir);
    
    const modelSrc = path.join(BACKEND_SOURCE, 'yolov8n.pt');
    const modelDest = path.join(modelsDir, 'yolov8n.pt');
    copyFile(modelSrc, modelDest);
    
    // Also copy to server dir for easier access
    copyFile(modelSrc, path.join(SERVER_TARGET, 'yolov8n.pt'));
    
    // Step 7: Install server dependencies
    console.log('\n📦 Step 7: Installing server dependencies...');
    
    // First install in the server directory
    const serverPackageJsonPath = path.join(SERVER_TARGET, 'package.json');
    if (fs.existsSync(serverPackageJsonPath)) {
      process.chdir(SERVER_TARGET);
      try {
        console.log('   Installing server packages...');
        execSync('npm install --production --no-optional', { stdio: 'inherit' });
        console.log('✅ Server dependencies installed');
      } catch (e) {
        console.log('⚠️  Server npm install failed - trying individual packages...');
        try {
          execSync('npm install express cors multer archiver sharp axios dotenv --save', { stdio: 'inherit' });
          console.log('✅ Core packages installed');
        } catch (e2) {
          console.log('⚠️  Manual package install also failed');
        }
      }
    }
    
    // Step 8: Install Electron dependencies
    console.log('\n📦 Step 8: Installing Electron dependencies...');
    process.chdir(ROOT);
    
    try {
      execSync('npm install', { stdio: 'inherit' });
      console.log('✅ Electron dependencies installed');
    } catch (e) {
      console.log('⚠️  Electron npm install failed');
    }
    
    // Step 9: Build frontend (Expo Web)
    console.log('\n🌐 Step 9: Building frontend for web...');
    
    if (fs.existsSync(FRONTEND_SOURCE)) {
      process.chdir(FRONTEND_SOURCE);
      
      try {
        console.log('   Installing frontend packages...');
        execSync('npm install', { stdio: 'inherit' });
        
        console.log('   Building web version...');
        // Expo export:web outputs to web-build directory
        execSync('npx expo export:web', { stdio: 'inherit' });
        
        const webBuildPath = path.join(FRONTEND_SOURCE, 'web-build');
        const frontendDestPath = path.join(ROOT, 'frontend-build');
        
        if (fs.existsSync(webBuildPath)) {
          copyDirRecursive(webBuildPath, frontendDestPath);
          console.log('✅ Frontend built and copied');
        } else {
          console.log('⚠️  Web build not found - will use development server');
        }
      } catch (e) {
        console.log('⚠️  Frontend build failed:', e.message);
        console.log('   The app will try to connect to a running Expo server in development mode');
      }
    } else {
      console.log('⚠️  Frontend directory not found');
    }
    
    // Step 10: Create build directory with icon
    console.log('\n🎨 Step 10: Setting up build assets...');
    process.chdir(ROOT);
    const buildDir = path.join(ROOT, 'build');
    ensureDir(buildDir);
    
    // Create a PNG icon (electron-builder prefers PNG or ICO)
    const iconPath = path.join(buildDir, 'icon.png');
    if (!fs.existsSync(iconPath)) {
      // Create a simple placeholder - in production you should have a proper icon
      console.log('⚠️  No icon.png found - please add one to build/ for better results');
    }
    
    // Create a .env file for the server if it doesn't exist
    const envPath = path.join(SERVER_TARGET, '.env');
    if (!fs.existsSync(envPath)) {
      const envContent = `# ADER Drone Analyzer Environment Configuration
PORT=5000
NODE_ENV=production
DJI_API_KEY=6a1613c4a95bea88c227b4b760e528e
`;
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Created .env file');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SETUP COMPLETE!');
    console.log('='.repeat(60));
    console.log('\n📋 Summary:');
    console.log('   - Backend server: server/server.js');
    console.log('   - YOLO model: models/yolov8n.pt');
    console.log('   - Python scripts: server/*.py');
    console.log('   - DJI log parser: server/dji-log');
    
    console.log('\n🚀 Next steps:');
    console.log('   1. Test: npm start');
    console.log('   2. Build: npm run build:win');
    
    console.log('\n⚠️  Requirements for YOLO detection:');
    console.log('   pip install ultralytics opencv-python numpy pillow');
    
    console.log('\n📁 Output files will be in: dist/');
    console.log('   - ADER Drone Analyzer-1.0.0-Setup.exe');
    console.log('   - ADER Drone Analyzer-1.0.0-Portable.exe');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
