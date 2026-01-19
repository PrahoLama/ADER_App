/**
 * Setup Portable Python with all dependencies for bundling
 * This script downloads Python embeddable and installs required packages
 * 
 * Run: node setup-python.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');
const os = require('os');

// Configuration
const PYTHON_VERSION = '3.11.7';
const PYTHON_DIR = path.join(__dirname, 'python');
const TEMP_DIR = path.join(os.tmpdir(), 'ader-python-setup');

// Python packages to install
const PACKAGES = [
  'ultralytics',
  'opencv-python-headless',  // headless version is smaller
  'numpy',
  'pillow',
  'torch',
  'torchvision',
  '--no-deps supervision'  // YOLO uses this
];

// URLs
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

// Helper to download file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (res) => {
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Extract ZIP
function extractZip(zipPath, destDir) {
  console.log(`📦 Extracting to: ${destDir}`);
  
  // Use built-in unzip on Linux/Mac, PowerShell on Windows
  if (process.platform === 'win32') {
    execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${destDir}'"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

async function setupPython() {
  console.log('🐍 Setting up Portable Python for ADER Drone Analyzer');
  console.log('=' .repeat(60));
  
  // Create directories
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  // Clean existing python folder
  if (fs.existsSync(PYTHON_DIR)) {
    console.log('🗑️ Removing existing Python directory...');
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PYTHON_DIR, { recursive: true });
  
  const platform = process.platform;
  
  if (platform === 'win32') {
    await setupWindowsPython();
  } else {
    await setupLinuxPython();
  }
  
  console.log('');
  console.log('=' .repeat(60));
  console.log('✅ Python setup complete!');
  console.log('📁 Location:', PYTHON_DIR);
  console.log('');
  console.log('The python folder will be bundled with the app.');
  console.log('Users will NOT need to install Python!');
}

async function setupWindowsPython() {
  const zipPath = path.join(TEMP_DIR, 'python-embed.zip');
  const getPipPath = path.join(TEMP_DIR, 'get-pip.py');
  
  // Step 1: Download Python embeddable
  console.log('\n📥 Step 1: Downloading Python embeddable...');
  await downloadFile(PYTHON_EMBED_URL, zipPath);
  
  // Step 2: Extract
  console.log('\n📦 Step 2: Extracting Python...');
  extractZip(zipPath, PYTHON_DIR);
  
  // Step 3: Enable pip in embeddable Python
  console.log('\n🔧 Step 3: Enabling pip support...');
  const pthFile = path.join(PYTHON_DIR, `python311._pth`);
  if (fs.existsSync(pthFile)) {
    let content = fs.readFileSync(pthFile, 'utf8');
    // Uncomment import site
    content = content.replace('#import site', 'import site');
    // Add Lib/site-packages
    content += '\nLib/site-packages\n';
    fs.writeFileSync(pthFile, content);
    console.log('   ✅ Modified python311._pth');
  }
  
  // Step 4: Download and install pip
  console.log('\n📥 Step 4: Installing pip...');
  await downloadFile(GET_PIP_URL, getPipPath);
  
  const pythonExe = path.join(PYTHON_DIR, 'python.exe');
  execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, { 
    stdio: 'inherit',
    cwd: PYTHON_DIR 
  });
  
  // Step 5: Install packages
  console.log('\n📦 Step 5: Installing Python packages (this may take several minutes)...');
  
  const pipExe = path.join(PYTHON_DIR, 'Scripts', 'pip.exe');
  
  // Install packages one by one with progress
  for (const pkg of PACKAGES) {
    console.log(`   📦 Installing ${pkg}...`);
    try {
      execSync(`"${pipExe}" install ${pkg} --no-warn-script-location`, { 
        stdio: 'inherit',
        cwd: PYTHON_DIR 
      });
    } catch (err) {
      console.log(`   ⚠️ Warning: Failed to install ${pkg}, continuing...`);
    }
  }
  
  // Step 6: Verify installation
  console.log('\n✅ Step 6: Verifying installation...');
  try {
    const result = execSync(`"${pythonExe}" -c "import cv2; from ultralytics import YOLO; import numpy; print('OK')"`, {
      encoding: 'utf8'
    });
    if (result.includes('OK')) {
      console.log('   ✅ All packages verified successfully!');
    }
  } catch (err) {
    console.log('   ⚠️ Some packages may need manual verification');
  }
  
  // Step 7: Calculate size
  const size = getFolderSize(PYTHON_DIR);
  console.log(`\n📊 Total size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  
  // Cleanup
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

async function setupLinuxPython() {
  console.log('\n🐧 Linux detected - creating Python virtual environment...');
  
  // On Linux, we'll create a venv with all packages
  // This is more reliable than embeddable Python
  
  // Check if python3 exists
  try {
    execSync('python3 --version', { stdio: 'pipe' });
  } catch (e) {
    console.error('❌ Python 3 not found. Please install python3 first.');
    process.exit(1);
  }
  
  // Create venv
  console.log('📦 Creating virtual environment...');
  execSync(`python3 -m venv "${PYTHON_DIR}"`, { stdio: 'inherit' });
  
  // Install packages
  const pipPath = path.join(PYTHON_DIR, 'bin', 'pip');
  
  console.log('\n📦 Installing packages...');
  execSync(`"${pipPath}" install --upgrade pip`, { stdio: 'inherit' });
  
  for (const pkg of PACKAGES) {
    console.log(`   📦 Installing ${pkg}...`);
    try {
      execSync(`"${pipPath}" install ${pkg}`, { stdio: 'inherit' });
    } catch (err) {
      console.log(`   ⚠️ Warning: Failed to install ${pkg}`);
    }
  }
  
  // Verify
  const pythonPath = path.join(PYTHON_DIR, 'bin', 'python');
  try {
    execSync(`"${pythonPath}" -c "import cv2; from ultralytics import YOLO; print('OK')"`, { stdio: 'inherit' });
    console.log('✅ Verification successful!');
  } catch (e) {
    console.log('⚠️ Verification failed, but continuing...');
  }
}

function getFolderSize(folderPath) {
  let size = 0;
  const files = fs.readdirSync(folderPath);
  
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      size += getFolderSize(filePath);
    } else {
      size += stat.size;
    }
  }
  
  return size;
}

// Run setup
setupPython().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
