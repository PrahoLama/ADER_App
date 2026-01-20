/**
 * ADER Drone Analyzer - Electron Main Process
 * Runs the complete application offline with embedded server
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execSync, fork } = require('child_process');
const fs = require('fs');

// Handle EPIPE errors when running in background
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore broken pipe errors
    return;
  }
  throw err;
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore broken pipe errors
    return;
  }
  throw err;
});

// Keep references to prevent garbage collection
let mainWindow = null;
let serverProcess = null;
let nodeODMProcess = null;
let pythonReady = false;
let setupWindow = null;

// Paths
const isDev = !app.isPackaged;
const resourcesPath = isDev ? __dirname : process.resourcesPath;
const userDataPath = app.getPath('userData');
const pythonDir = path.join(userDataPath, 'python');  // Store Python in user data

// Server configuration
const SERVER_PORT = 8080;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const NODEODM_PORT = 3002;
const NODEODM_IMAGE = 'ader-nodeodm-fixed';  // Custom image with python-dateutil pre-installed
const NODEODM_BASE_IMAGE = 'opendronemap/nodeodm:latest';

// Directories for data storage
const dataDir = path.join(userDataPath, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const annotationsDir = path.join(dataDir, 'annotations');
const cacheDir = path.join(dataDir, 'cache');
const logsDir = path.join(dataDir, 'dji-log');
const tmpDir = path.join(dataDir, 'tmp');

// Create necessary directories
function ensureDirectories() {
  const dirs = [dataDir, uploadsDir, annotationsDir, cacheDir, logsDir, tmpDir];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('📁 Created directory:', dir);
    }
  });
}

// Find Python executable
function findPython() {
  // Check user data Python first (auto-installed)
  const userPythonWin = path.join(pythonDir, 'python.exe');
  const userPythonUnix = path.join(pythonDir, 'bin', 'python');
  
  // Check bundled Python (for packaged app)
  const bundledPythonWin = path.join(resourcesPath, 'python', 'python.exe');
  const bundledPythonUnix = path.join(resourcesPath, 'python', 'bin', 'python');
  
  // Also check in development mode (local python folder)
  const devPythonWin = path.join(__dirname, 'python', 'python.exe');
  const devPythonUnix = path.join(__dirname, 'python', 'bin', 'python');
  
  const bundledPaths = [
    userPythonWin,
    userPythonUnix,
    bundledPythonWin,
    bundledPythonUnix,
    devPythonWin,
    devPythonUnix
  ];
  
  for (const pythonPath of bundledPaths) {
    if (fs.existsSync(pythonPath)) {
      console.log('🐍 Using Python:', pythonPath);
      return pythonPath;
    }
  }
  
  // Check for system Python as fallback
  const pythonPaths = [
    'python',
    'python3',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
    'C:\\Python39\\python.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
  ];
  
  for (const pythonPath of pythonPaths) {
    try {
      execSync(`"${pythonPath}" --version`, { stdio: 'pipe' });
      console.log('🐍 Found system Python:', pythonPath);
      return pythonPath;
    } catch (e) {
      // Continue searching
    }
  }
  
  console.error('❌ Python not found!');
  return null;
}

// Show setup progress window
function showSetupWindow(message) {
  if (setupWindow) {
    setupWindow.webContents.send('setup-progress', message);
    return;
  }
  
  setupWindow = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        h1 { margin: 0 0 10px 0; font-size: 24px; }
        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255,255,255,0.3);
          border-top: 4px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 20px 0;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        #status { text-align: center; font-size: 14px; opacity: 0.9; }
        .note { font-size: 12px; opacity: 0.7; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>🚀 ADER Drone Analyzer</h1>
      <div class="spinner"></div>
      <div id="status">${message || 'Setting up AI components...'}</div>
      <div class="note">This only happens once. Please wait...</div>
      <script>
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('setup-progress', (e, msg) => {
          document.getElementById('status').textContent = msg;
        });
      </script>
    </body>
    </html>
  `;
  
  setupWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function closeSetupWindow() {
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }
}

// Auto-install Python and dependencies on Windows
async function autoInstallPython() {
  const https = require('https');
  const http = require('http');
  
  const PYTHON_VERSION = '3.11.7';
  const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
  const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
  
  const zipPath = path.join(userDataPath, 'python-embed.zip');
  const getPipPath = path.join(userDataPath, 'get-pip.py');
  
  // Download helper
  const download = (url, dest) => {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const protocol = url.startsWith('https') ? https : http;
      
      const request = protocol.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          download(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });
      
      request.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  };
  
  try {
    // Step 1: Download Python
    showSetupWindow('Downloading Python (this may take a minute)...');
    console.log('📥 Downloading Python embeddable...');
    await download(PYTHON_URL, zipPath);
    
    // Step 2: Extract Python
    showSetupWindow('Extracting Python...');
    console.log('📦 Extracting Python...');
    
    if (!fs.existsSync(pythonDir)) {
      fs.mkdirSync(pythonDir, { recursive: true });
    }
    
    // Use PowerShell to extract on Windows
    execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${pythonDir}'"`, { stdio: 'pipe' });
    
    // Step 3: Enable pip
    showSetupWindow('Configuring Python...');
    console.log('🔧 Enabling pip support...');
    
    const pthFile = path.join(pythonDir, 'python311._pth');
    if (fs.existsSync(pthFile)) {
      let content = fs.readFileSync(pthFile, 'utf8');
      content = content.replace('#import site', 'import site');
      content += '\nLib\\site-packages\n';
      fs.writeFileSync(pthFile, content);
    }
    
    // Step 4: Install pip
    showSetupWindow('Installing pip...');
    console.log('📥 Installing pip...');
    await download(GET_PIP_URL, getPipPath);
    
    const pythonExe = path.join(pythonDir, 'python.exe');
    execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, { 
      stdio: 'pipe',
      cwd: pythonDir 
    });
    
    // Step 5: Install packages (CPU-only torch for smaller size)
    const packages = [
      { name: 'torch torchvision --index-url https://download.pytorch.org/whl/cpu', display: 'PyTorch (AI engine)' },
      { name: 'ultralytics', display: 'YOLO (object detection)' },
      { name: 'opencv-python-headless', display: 'OpenCV (image processing)' },
      { name: 'numpy pillow', display: 'NumPy & Pillow' }
    ];
    
    const pipExe = path.join(pythonDir, 'Scripts', 'pip.exe');
    
    for (const pkg of packages) {
      showSetupWindow(`Installing ${pkg.display}...`);
      console.log(`📦 Installing ${pkg.name}...`);
      try {
        execSync(`"${pipExe}" install ${pkg.name} --no-warn-script-location`, { 
          stdio: 'pipe',
          cwd: pythonDir,
          timeout: 300000  // 5 minute timeout per package
        });
      } catch (err) {
        console.warn(`⚠️ Warning installing ${pkg.name}:`, err.message);
      }
    }
    
    // Cleanup
    fs.unlinkSync(zipPath);
    fs.unlinkSync(getPipPath);
    
    showSetupWindow('Setup complete! Starting app...');
    console.log('✅ Python auto-install complete!');
    
    return path.join(pythonDir, 'python.exe');
    
  } catch (error) {
    console.error('❌ Auto-install failed:', error);
    closeSetupWindow();
    
    // Show error dialog
    dialog.showErrorBox(
      'Setup Failed',
      `Could not install Python automatically.\n\nPlease install Python 3.9+ manually from python.org and run:\npip install ultralytics opencv-python numpy pillow\n\nError: ${error.message}`
    );
    
    return null;
  }
}

// Check and setup Python on first run
async function ensurePythonSetup() {
  // Only auto-install on Windows
  if (process.platform !== 'win32') {
    const python = findPython();
    if (!python) {
      dialog.showErrorBox(
        'Python Required',
        'Python 3.9+ is required.\n\nPlease install Python and run:\npip install ultralytics opencv-python numpy pillow'
      );
    }
    return python;
  }
  
  // Check if Python already exists
  let python = findPython();
  
  if (python) {
    // Verify dependencies
    const depsOK = await checkPythonDeps(python);
    if (depsOK) {
      return python;
    }
    console.log('⚠️ Python found but missing dependencies');
  }
  
  // Need to install Python
  console.log('🔧 Starting automatic Python setup...');
  return await autoInstallPython();
}

// Check Python dependencies
async function checkPythonDeps(pythonPath) {
  return new Promise((resolve) => {
    const checkScript = `
import sys
try:
    import cv2
    import numpy
    from ultralytics import YOLO
    print("OK")
except ImportError as e:
    print(f"MISSING: {e}")
    sys.exit(1)
`;
    
    const proc = spawn(pythonPath, ['-c', checkScript]);
    let output = '';
    
    proc.stdout.on('data', (data) => output += data.toString());
    proc.stderr.on('data', (data) => output += data.toString());
    
    proc.on('close', (code) => {
      if (code === 0 && output.includes('OK')) {
        console.log('✅ Python dependencies OK');
        resolve(true);
      } else {
        console.warn('⚠️ Python dependencies missing:', output);
        resolve(false);
      }
    });
  });
}

// Ensure custom NodeODM image exists with python-dateutil pre-installed
async function ensureCustomNodeODMImage() {
  return new Promise((resolve) => {
    console.log('🐳 Checking for custom NodeODM image...');
    
    try {
      // Check if custom image already exists
      const result = execSync(`docker images -q ${NODEODM_IMAGE}`, { encoding: 'utf8', stdio: 'pipe' });
      if (result.trim()) {
        console.log('✅ Custom NodeODM image already exists');
        resolve(true);
        return;
      }
    } catch (e) {
      // Image doesn't exist, need to build it
    }
    
    console.log('🔧 Building custom NodeODM image with python-dateutil...');
    
    // Create a temporary Dockerfile
    const tmpDockerfile = path.join(require('os').tmpdir(), 'nodeodm-fix-dockerfile');
    const dockerfileContent = `FROM ${NODEODM_BASE_IMAGE}
RUN /code/venv/bin/pip install python-dateutil pillow
`;
    fs.writeFileSync(tmpDockerfile, dockerfileContent);
    
    try {
      execSync(`docker build -t ${NODEODM_IMAGE} -f "${tmpDockerfile}" "${path.dirname(tmpDockerfile)}"`, {
        stdio: 'inherit',
        timeout: 300000  // 5 minute timeout
      });
      console.log('✅ Custom NodeODM image built successfully');
      resolve(true);
    } catch (error) {
      console.error('❌ Failed to build custom NodeODM image:', error.message);
      console.log('⚠️ Falling back to base image...');
      resolve(false);
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpDockerfile); } catch (e) {}
    }
  });
}

// Fix Python environment in NodeODM container
async function fixNodeODMPythonEnvironment(containerName) {
  return new Promise((resolve) => {
    console.log('🔧 Ensuring Python dependencies in NodeODM container...');
    
    try {
      // Install python-dateutil in the container's venv
      const fixCmd = `docker exec ${containerName} /code/venv/bin/pip install python-dateutil pillow`;
      execSync(fixCmd, { stdio: 'pipe' });
      
      // Verify the installation
      const verifyCmd = `docker exec ${containerName} bash -c 'cd /code && /code/venv/bin/python3 -c "from opendm import log; print(\\"OK\\")"'`; 
      execSync(verifyCmd, { stdio: 'pipe' });
      
      console.log('✅ Python dependencies installed and verified in NodeODM container');
      resolve(true);
    } catch (error) {
      console.warn('⚠️ Could not install Python dependencies:', error.message);
      // Don't fail - the container might already have it
      resolve(false);
    }
  });
}

// Wait for NodeODM to be ready
async function waitForNodeODM(maxWaitSeconds = 120) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`⏳ Waiting for NodeODM to be ready (max ${maxWaitSeconds}s)...`);
    
    const checkInterval = setInterval(() => {
      try {
        const response = execSync(`curl -s http://localhost:${NODEODM_PORT}/info`, { 
          encoding: 'utf8',
          stdio: 'pipe' 
        });
        
        if (response && response.includes('"version"')) {
          clearInterval(checkInterval);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ NodeODM is ready! (took ${elapsed}s)`);
          resolve(true);
        }
      } catch (e) {
        // Not ready yet
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > maxWaitSeconds) {
          clearInterval(checkInterval);
          console.warn('⚠️ NodeODM did not become ready in time');
          resolve(false);
        }
      }
    }, 2000);
  });
}

// Start NodeODM processing node via Docker
function startNodeODM() {
  return new Promise(async (resolve, reject) => {
    console.log('🔧 Starting WebODM Processing Engine (NodeODM via Docker)...');
    
    // Check if Docker is available
    try {
      const dockerVersion = execSync('docker --version', { encoding: 'utf8', stdio: 'pipe' });
      console.log('✅ Docker is available:', dockerVersion.trim());
    } catch (e) {
      console.warn('');
      console.warn('⚠️ ========================================================');
      console.warn('⚠️ DOCKER NOT INSTALLED');
      console.warn('⚠️ ========================================================');
      console.warn('⚠️ Orthomosaic generation requires Docker Desktop.');
      console.warn('⚠️ ');
      console.warn('⚠️ SETUP STEPS:');
      console.warn('⚠️ 1. Download Docker Desktop from:');
      console.warn('⚠️    https://www.docker.com/products/docker-desktop');
      console.warn('⚠️ 2. Install Docker Desktop');
      console.warn('⚠️ 3. Restart this application');
      console.warn('⚠️ 4. First run will auto-download WebODM engine (~2GB)');
      console.warn('⚠️ ');
      console.warn('⚠️ Other features work without Docker.');
      console.warn('⚠️ ========================================================');
      console.warn('');
      
      // Show dialog to user
      dialog.showMessageBox({
        type: 'warning',
        title: 'Docker Not Installed',
        message: 'Orthomosaic generation requires Docker Desktop',
        detail: 'Download Docker Desktop from:\nhttps://www.docker.com/products/docker-desktop\n\nAfter installation, restart this app.\n\nOther features (Drone Analysis, Gap Detection) work without Docker.',
        buttons: ['OK', 'Open Docker Website'],
        defaultId: 0
      }).then(result => {
        if (result.response === 1) {
          require('electron').shell.openExternal('https://www.docker.com/products/docker-desktop');
        }
      });
      
      global.dockerAvailable = false;
      resolve();
      return;
    }
    
    console.log('✅ Docker is installed');
    global.dockerAvailable = true;
    
    // Check if NodeODM container is already running
    try {
      const running = execSync('docker ps --filter "name=ader-nodeodm" --format "{{.Names}}"', { encoding: 'utf8' });
      if (running.includes('ader-nodeodm')) {
        console.log('✅ NodeODM container already running');
        
        // Wait for it to be ready and fix Python environment
        const isReady = await waitForNodeODM(30);
        if (isReady) {
          await fixNodeODMPythonEnvironment('ader-nodeodm');
        }
        
        resolve();
        return;
      }
    } catch (e) {
      // Continue to start container
    }
    
    // Check if container exists but is stopped
    try {
      const exists = execSync('docker ps -a --filter "name=ader-nodeodm" --format "{{.Names}}"', { encoding: 'utf8' });
      if (exists.includes('ader-nodeodm')) {
        console.log('🔄 Updating and starting NodeODM container with memory limits...');
        // Update memory limits on existing container and start
        try {
          execSync('docker update --memory 4g --memory-swap 6g --cpus 2 ader-nodeodm', { stdio: 'pipe' });
        } catch (updateErr) {
          console.log('⚠️ Could not update memory limits, using existing settings');
        }
        execSync('docker start ader-nodeodm', { stdio: 'pipe' });
        
        const isReady = await waitForNodeODM(60);
        if (isReady) {
          await fixNodeODMPythonEnvironment('ader-nodeodm');
        }
        
        resolve();
        return;
      }
    } catch (e) {
      // Continue to create new container
    }
    
    // Start NodeODM container
    console.log('   Creating new NodeODM Docker container on port', NODEODM_PORT);
    
    // Build custom image if needed
    await ensureCustomNodeODMImage();
    
    const dockerArgs = [
      'run', '-d',
      '--name', 'ader-nodeodm',
      '-p', `${NODEODM_PORT}:3000`,
      '--restart', 'unless-stopped',
      '--memory', '4g',        // 4GB RAM limit (safer for split-merge)
      '--memory-swap', '6g',   // Allow 6GB with swap
      '--cpus', '2',           // Use 2 CPU cores
      NODEODM_IMAGE            // Use custom image with python-dateutil
    ];
    
    nodeODMProcess = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    
    nodeODMProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('[NodeODM Docker]', data.toString().trim());
    });
    
    nodeODMProcess.stderr.on('data', (data) => {
      console.error('[NodeODM Docker Error]', data.toString().trim());
    });
    
    nodeODMProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ NodeODM Docker container started');
        
        // Wait for NodeODM to be ready and fix Python environment
        waitForNodeODM(120).then(async (isReady) => {
          if (isReady) {
            await fixNodeODMPythonEnvironment('ader-nodeodm');
          }
          resolve();
        });
      } else {
        console.warn('⚠️ Failed to start NodeODM container. Trying to pull image...');
        // Try to pull the image first
        const pullProcess = spawn('docker', ['pull', 'opendronemap/nodeodm:latest'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        pullProcess.stdout.on('data', (data) => {
          console.log('[Docker Pull]', data.toString().trim());
        });
        
        pullProcess.stderr.on('data', (data) => {
          console.log('[Docker Pull]', data.toString().trim());
        });
        
        pullProcess.on('close', (pullCode) => {
          if (pullCode === 0) {
            // Retry starting container
            console.log('✅ Image pulled, starting container...');
            const retryProcess = spawn('docker', dockerArgs);
            retryProcess.on('close', async (retryCode) => {
              if (retryCode === 0) {
                console.log('✅ NodeODM Docker container started');
                
                const isReady = await waitForNodeODM(120);
                if (isReady) {
                  await fixNodeODMPythonEnvironment('ader-nodeodm');
                }
                resolve();
              } else {
                console.warn('⚠️ Could not start NodeODM container');
                resolve();
              }
            });
          } else {
            console.warn('⚠️ Could not pull NodeODM image. Orthomosaic generation will not work.');
            resolve();
          }
        });
      }
    });
    
    nodeODMProcess.on('error', (err) => {
      console.error('❌ Failed to start NodeODM:', err);
      resolve();
    });
  });
}

// Stop NodeODM Docker container
function stopNodeODM() {
  console.log('🛑 Stopping NodeODM Docker container...');
  try {
    execSync('docker stop ader-nodeodm', { stdio: 'pipe' });
    execSync('docker rm ader-nodeodm', { stdio: 'pipe' });
    console.log('✅ NodeODM container stopped');
  } catch (e) {
    // Ignore errors - container might not exist
  }
}

// Start the embedded Express server
function startServer() {
  return new Promise((resolve, reject) => {
    // Use the embedded server folder - handle both dev and production
    let serverPath;
    let serverCwd;
    
    if (app.isPackaged) {
      // In production, server folder is in extraResources
      const resourcesPath = process.resourcesPath;
      serverPath = path.join(resourcesPath, 'server', 'server.js');
      serverCwd = path.join(resourcesPath, 'server');
    } else {
      // Development mode
      serverPath = path.join(__dirname, 'server', 'server.js');
      serverCwd = path.join(__dirname, 'server');
    }
    
    // Set environment variables for the server
    const env = {
      ...process.env,
      PORT: SERVER_PORT,
      UPLOADS_DIR: uploadsDir,
      ANNOTATIONS_DIR: annotationsDir,
      CACHE_DIR: cacheDir,
      LOGS_DIR: logsDir,
      TMP_DIR: tmpDir,
      PYTHON_PATH: findPython() || 'python',
      NODE_ENV: 'production',
      ELECTRON_APP: 'true',
      DJI_API_KEY: process.env.DJI_API_KEY || '6a1613c4a95bea88c227b4b760e528e'
    };
    
    // Apply env vars to current process for in-process server
    Object.assign(process.env, env);
    
    console.log('🚀 Starting backend server...');
    console.log('   App packaged:', app.isPackaged);
    console.log('   Resources path:', process.resourcesPath);
    console.log('   Server path:', serverPath);
    console.log('   Server CWD:', serverCwd);
    console.log('   Data directory:', dataDir);
    
    // Check if server file exists
    if (!fs.existsSync(serverPath)) {
      console.error('❌ Server file not found:', serverPath);
      reject(new Error('Server files not found: ' + serverPath));
      return;
    }
    
    // Try to run the server in the same process using require()
    // This avoids needing to spawn a separate Node process
    try {
      // Change to server directory for relative requires
      const originalCwd = process.cwd();
      process.chdir(serverCwd);
      
      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve(serverPath)];
      
      // Require the server - it should start listening automatically
      console.log('📡 Loading server module...');
      require(serverPath);
      
      // Restore original directory
      process.chdir(originalCwd);
      
      console.log('✅ Server started successfully on port', SERVER_PORT);
      
      // Give it a moment to fully initialize
      setTimeout(() => resolve(), 1000);
      return;
    } catch (requireError) {
      console.log('⚠️ In-process server failed:', requireError.message);
      console.log('   Falling back to subprocess...');
    }
    
    // Fallback: Find Node.js and spawn subprocess
    let nodePath = 'node';
    
    if (app.isPackaged) {
      const possibleNodePaths = [
        'node',
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\Program Files (x86)\\nodejs\\node.exe',
        path.join(process.env.APPDATA || '', '..', 'Local', 'Programs', 'nodejs', 'node.exe'),
        path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
      ];
      
      for (const np of possibleNodePaths) {
        try {
          execSync(`"${np}" --version`, { stdio: 'pipe' });
          nodePath = np;
          console.log('✅ Found Node.js at:', nodePath);
          break;
        } catch (e) {
          // Continue searching
        }
      }
    }
    
    console.log('   Using Node.js subprocess:', nodePath);
    
    // Use fork with Electron's Node
    try {
      serverProcess = fork(serverPath, [], { 
        env, 
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        cwd: serverCwd,
        execArgv: ['--max-old-space-size=4096']
      });
    } catch (forkError) {
      console.log('Fork failed, trying spawn:', forkError.message);
      serverProcess = spawn(nodePath, [
        '--max-old-space-size=4096',
        serverPath
      ], { 
        env, 
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: serverCwd,
        shell: true
      });
    }
    
    let serverStarted = false;
    
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Server]', output.trim());
      
      if (output.includes('SERVER RUNNING') || output.includes('Waiting for requests')) {
        if (!serverStarted) {
          serverStarted = true;
          console.log('✅ Server started successfully on port', SERVER_PORT);
          resolve();
        }
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });
    
    serverProcess.on('error', (err) => {
      console.error('❌ Failed to start server:', err);
      reject(err);
    });
    
    serverProcess.on('close', (code) => {
      console.log('Server process exited with code:', code);
      serverProcess = null;
    });
    
    // Timeout for server startup
    setTimeout(() => {
      if (!serverStarted) {
        console.log('⏱️ Server startup timeout, assuming it is ready...');
        resolve();
      }
    }, 10000);
  });
}

// Stop the server
function stopServer() {
  if (serverProcess) {
    console.log('🛑 Stopping server...');
    serverProcess.kill();
    serverProcess = null;
  }
  stopNodeODM();
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'ADER Drone Analyzer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false // Allow loading local files
    },
    show: false,
    backgroundColor: '#1a472a'
  });
  
  // Determine frontend path
  const frontendBuildPath = isDev
    ? path.join(__dirname, 'frontend-build')
    : path.join(resourcesPath, 'frontend-build');
  
  const indexPath = path.join(frontendBuildPath, 'index.html');
  
  console.log('📄 Loading frontend from:', indexPath);
  console.log('   File exists:', fs.existsSync(indexPath));
  
  // Load the frontend
  if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else if (isDev) {
    // In development, try Expo dev server as fallback
    console.log('⚠️ Frontend build not found, trying Expo dev server...');
    mainWindow.loadURL('http://localhost:19006');
  } else {
    // Show error if frontend not found in production
    mainWindow.loadURL(`data:text/html,
      <html>
        <body style="font-family:sans-serif;padding:50px;text-align:center;background:#1a472a;color:white;">
          <h1>🚁 ADER Drone Analyzer</h1>
          <p>Frontend files not found. Please rebuild the application.</p>
          <p style="font-size:12px;opacity:0.7;">Expected: ${indexPath}</p>
        </body>
      </html>
    `);
  }
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Open DevTools in development
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });
  
  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Create splash/loading window
function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 500,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  splash.loadURL(`data:text/html;charset=utf-8,
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 40px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #1a472a 0%, #2d5a3d 100%);
          color: white;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: calc(100vh - 80px);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .logo { font-size: 80px; margin-bottom: 20px; }
        .title { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 14px; opacity: 0.8; margin-bottom: 30px; }
        .loader {
          width: 200px;
          height: 4px;
          background: rgba(255,255,255,0.2);
          border-radius: 2px;
          overflow: hidden;
        }
        .loader-bar {
          width: 40%;
          height: 100%;
          background: #4ade80;
          border-radius: 2px;
          animation: loading 1.5s ease-in-out infinite;
        }
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .status { margin-top: 20px; font-size: 12px; opacity: 0.7; }
      </style>
    </head>
    <body>
      <div class="logo">🚁</div>
      <div class="title">ADER Drone Analyzer</div>
      <div class="subtitle">Multi-Industry Analysis Platform</div>
      <div class="loader"><div class="loader-bar"></div></div>
      <div class="status" id="status">Starting application...</div>
      <script>
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('status', (event, message) => {
          document.getElementById('status').textContent = message;
        });
      </script>
    </body>
    </html>
  `);
  
  return splash;
}

// Application startup
app.whenReady().then(async () => {
  console.log('🚁 ADER Drone Analyzer starting...');
  console.log('   App path:', app.getAppPath());
  console.log('   User data:', userDataPath);
  console.log('   Development mode:', isDev);
  
  // Create splash screen
  const splash = createSplashWindow();
  
  try {
    // Step 1: Ensure directories exist
    splash.webContents.send('status', 'Creating data directories...');
    ensureDirectories();
    
    // Step 2: Check/Install Python (auto-install on Windows if needed)
    splash.webContents.send('status', 'Checking Python installation...');
    const pythonPath = await ensurePythonSetup();
    closeSetupWindow();  // Close setup window if it was shown
    
    if (pythonPath) {
      pythonReady = await checkPythonDeps(pythonPath);
    }
    
    // Step 3: Start NodeODM (WebODM processing)
    splash.webContents.send('status', 'Starting WebODM processing engine...');
    await startNodeODM();
    
    // Step 4: Start server
    splash.webContents.send('status', 'Starting backend server...');
    await startServer();
    
    // Step 5: Create main window
    splash.webContents.send('status', 'Loading interface...');
    createWindow();
    
    // Close splash after main window is ready
    setTimeout(() => {
      splash.close();
    }, 1500);
    
  } catch (err) {
    console.error('❌ Startup error:', err);
    closeSetupWindow();
    dialog.showErrorBox('Startup Error', `Failed to start application:\n${err.message}`);
    app.quit();
  }
});

// Handle all windows closed
app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app activation (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle app quit
app.on('before-quit', () => {
  stopServer();
});

// IPC handlers for renderer process
ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    dataPath: dataDir,
    serverUrl: SERVER_URL,
    pythonReady: pythonReady,
    isDev: isDev
  };
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.openPath(folderPath || dataDir);
});

ipcMain.handle('select-files', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

console.log('✅ Electron main process initialized');
