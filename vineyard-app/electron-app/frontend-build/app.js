/**
 * ADER Drone Analyzer - Complete Frontend
 * Features: Drone Analysis, Gap Detection, Orthomosaic Generation, Image Annotation
 */

const API_BASE = 'http://localhost:8080/api';

// Global state
const state = {
    currentScreen: 'home',
    droneImages: [],
    orthophoto: null,
    geojsonFile: null,
    orthomosaicImages: [],
    orthomosaicProjects: [],
    results: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 ADER Drone Analyzer starting...');
    checkBackendHealth();
    setupEventListeners();
    
    // Check health periodically
    setInterval(checkBackendHealth, 30000);
});

async function checkBackendHealth() {
    try {
        const response = await fetch(`${API_BASE}/health`, { timeout: 3000 });
        const data = await response.json();
        
        document.getElementById('statusDot').classList.add('connected');
        document.getElementById('statusText').textContent = 'Connected';
        
        console.log('✅ Backend connected:', data);
    } catch (error) {
        document.getElementById('statusDot').classList.remove('connected');
        document.getElementById('statusText').textContent = 'Disconnected';
        console.error('❌ Backend connection failed:', error);
    }
}

function setupEventListeners() {
    // Drone Analysis
    document.getElementById('droneImageInput').addEventListener('change', handleDroneImageSelect);
    document.getElementById('droneUploadArea').addEventListener('drop', handleDroneDrop);
    document.getElementById('droneUploadArea').addEventListener('dragover', handleDragOver);
    document.getElementById('droneUploadArea').addEventListener('dragleave', handleDragLeave);
    
    // Gap Detection
    document.getElementById('orthophotoInput').addEventListener('change', handleOrthophotoSelect);
    document.getElementById('geojsonInput').addEventListener('change', handleGeojsonSelect);
    
    // Orthomosaic
    document.getElementById('orthomosaicImagesInput').addEventListener('change', handleOrthomosaicImagesSelect);

    // Row Digitizer
    document.getElementById('digitizerOrthophotoInput').addEventListener('change', loadDigitizerOrthophoto);
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

function handleDroneDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files).filter(f => 
        f.type.startsWith('image/') && !f.name.endsWith('.tif') && !f.name.endsWith('.tiff')
    );
    
    if (files.length > 0) {
        state.droneImages.push(...files);
        updateDroneImageList();
    }
}

// ============================================================================
// SCREEN NAVIGATION
// ============================================================================

function showScreen(screenName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    event?.target.closest('.nav-item')?.classList.add('active');
    
    // Hide all screens
    document.querySelectorAll('.home-screen, .analysis-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show selected screen
    document.getElementById(`screen-${screenName}`).classList.add('active');
    
    // Update header
    const titles = {
        'home': ['ADER Drone Analyzer', 'Select an analysis mode to get started'],
        'drone': ['Drone Analysis', 'RGB vegetation health analysis'],
        'orthophoto-gaps': ['Gap Detection', 'Detect missing plants in vineyard rows'],
        'orthomosaic': ['Generate Orthomosaic', 'Create georeferenced maps from drone images'],
        'annotation': ['Image Annotation', 'Add metadata and object detection to images'],
        'manual-editor': ['Manual Annotation Editor', 'Draw and edit bounding boxes on images'],
        'digitizer': ['Manual Row Digitizer', 'Draw vineyard rows and export to GeoJSON']
    };
    
    const [title, subtitle] = titles[screenName] || titles['home'];
    document.getElementById('headerTitle').textContent = title;
    document.getElementById('headerSubtitle').textContent = subtitle;
    
    state.currentScreen = screenName;
}

// ============================================================================
// DRONE ANALYSIS
// ============================================================================

function handleDroneImageSelect(e) {
    const files = Array.from(e.target.files);
    state.droneImages.push(...files);
    updateDroneImageList();
}

function updateDroneImageList() {
    const container = document.getElementById('droneImageList');
    const btn = document.getElementById('analyzeDroneBtn');
    
    if (state.droneImages.length === 0) {
        container.innerHTML = '';
        btn.disabled = true;
        return;
    }
    
    btn.disabled = false;
    
    container.innerHTML = state.droneImages.map((file, index) => `
        <div class="file-item">
            <img src="${URL.createObjectURL(file)}" alt="${file.name}">
            <div class="file-name">${file.name}</div>
            <button class="remove-btn" onclick="removeDroneImage(${index})">×</button>
        </div>
    `).join('');
}

function removeDroneImage(index) {
    state.droneImages.splice(index, 1);
    updateDroneImageList();
}

function clearDroneImages() {
    state.droneImages = [];
    updateDroneImageList();
    document.getElementById('droneResults').innerHTML = '';
}

async function analyzeDroneImages() {
    if (state.droneImages.length === 0) {
        showToast('Please select images first', 'error');
        return;
    }
    
    showLoading('Uploading images...', 0, state.droneImages.length);
    
    try {
        const formData = new FormData();
        state.droneImages.forEach(file => {
            formData.append('images', file, file.name);
        });
        
        updateLoading('Analyzing RGB vegetation health...', 50);
        
        const response = await fetch(`${API_BASE}/analyze-drone`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Analysis failed');
        }
        
        const data = await response.json();
        console.log('✅ Drone analysis complete:', data);
        
        updateLoading('Complete!', 100);
        
        setTimeout(() => {
            hideLoading();
            displayDroneResults(data);
        }, 500);
        
    } catch (error) {
        console.error('❌ Analysis error:', error);
        hideLoading();
        showToast(error.message, 'error');
    }
}

function displayDroneResults(data) {
    const container = document.getElementById('droneResults');
    
    if (!data.results || data.results.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">😕</div>
                <div class="empty-state-text">No Results</div>
            </div>
        `;
        return;
    }
    
    // Calculate average health
    const validResults = data.results.filter(r => !r.error && r.analysis);
    const avgHealthy = validResults.reduce((sum, r) => sum + r.analysis.health_analysis.healthy_percent, 0) / validResults.length;
    const avgStressed = validResults.reduce((sum, r) => sum + r.analysis.health_analysis.stressed_percent, 0) / validResults.length;
    const avgBareSoil = validResults.reduce((sum, r) => sum + r.analysis.health_analysis.bare_soil_percent, 0) / validResults.length;
    
    container.innerHTML = `
        <div class="section">
            <div class="section-title">Analysis Results</div>
            <div class="section-desc">${data.processed} images analyzed successfully</div>
            
            <div class="stats-grid">
                <div class="stat-card" style="border-left: 4px solid #48bb78;">
                    <div class="stat-label">Healthy Vegetation</div>
                    <div class="stat-value" style="color: #48bb78;">${avgHealthy.toFixed(1)}%</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #f6ad55;">
                    <div class="stat-label">Stressed Vegetation</div>
                    <div class="stat-value" style="color: #f6ad55;">${avgStressed.toFixed(1)}%</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #a0aec0;">
                    <div class="stat-label">Bare Soil</div>
                    <div class="stat-value" style="color: #a0aec0;">${avgBareSoil.toFixed(1)}%</div>
                </div>
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-primary" onclick="downloadDroneJSON()">📥 Download JSON</button>
                <button class="btn btn-secondary" onclick="downloadDroneCSV()" style="margin-left: 10px;">📄 Download CSV</button>
                <button class="btn btn-secondary" onclick="downloadDroneReport()" style="margin-left: 10px;">📋 Download Report</button>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Detailed Results</div>
            <div class="results-grid">
                ${validResults.map(result => `
                    <div class="result-card">
                        <img src="${API_BASE.replace('/api', '')}/uploads/${result.image}" 
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23ddd%22 width=%22200%22 height=%22150%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23999%22 text-anchor=%22middle%22>Image</text></svg>'">
                        <div class="result-card-content">
                            <div class="result-card-title">${result.image}</div>
                            <div class="result-card-meta">
                                🌿 Healthy: ${result.analysis.health_analysis.healthy_percent}%<br>
                                ⚠️ Stressed: ${result.analysis.health_analysis.stressed_percent}%<br>
                                🟤 Bare: ${result.analysis.health_analysis.bare_soil_percent}%
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    state.results = { type: 'drone', data };
}

function downloadDroneJSON() {
    if (!state.results || state.results.type !== 'drone') return;
    
    const json = JSON.stringify(state.results.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drone_analysis_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('JSON downloaded', 'success');
}

function downloadDroneCSV() {
    if (!state.results || state.results.type !== 'drone') return;
    
    let csv = 'Filename,Healthy %,Stressed %,Bare Soil %,Total Vegetation %,VARI,ExG,ExGR\n';
    
    state.results.data.results.forEach(img => {
        if (!img.error && img.analysis) {
            const h = img.analysis.health_analysis;
            const i = img.analysis.indices;
            csv += `"${img.image}",${h.healthy_percent},${h.stressed_percent},${h.bare_soil_percent},${h.vegetation_cover},${i.vari_mean},${i.exg_mean},${i.exgr_mean}\n`;
        }
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drone_analysis_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('CSV downloaded', 'success');
}

function downloadDroneReport() {
    if (!state.results || state.results.type !== 'drone') return;
    
    const timestamp = new Date().toLocaleString();
    let report = '╔══════════════════════════════════════════════════════════╗\n';
    report += '           VINEYARD DRONE ANALYSIS REPORT\n';
    report += '╚══════════════════════════════════════════════════════════╝\n\n';
    report += `Generated: ${timestamp}\n`;
    report += `Total Images Analyzed: ${state.results.data.processed}\n\n`;
    report += '────────────────────────────────────────────────────────────\n';
    report += 'RGB VEGETATION HEALTH ANALYSIS\n';
    report += '────────────────────────────────────────────────────────────\n\n';
    
    state.results.data.results.forEach((img, idx) => {
        if (!img.error && img.analysis) {
            report += `${idx + 1}. ${img.image}\n`;
            report += `   Health Analysis:\n`;
            report += `     - Healthy Vegetation: ${img.analysis.health_analysis.healthy_percent}%\n`;
            report += `     - Stressed Vegetation: ${img.analysis.health_analysis.stressed_percent}%\n`;
            report += `     - Bare Soil: ${img.analysis.health_analysis.bare_soil_percent}%\n`;
            report += `     - Total Vegetation Cover: ${img.analysis.health_analysis.vegetation_cover}%\n`;
            report += `   Vegetation Indices:\n`;
            report += `     - VARI: ${img.analysis.indices.vari_mean}\n`;
            report += `     - ExG: ${img.analysis.indices.exg_mean}\n`;
            report += `     - ExGR: ${img.analysis.indices.exgr_mean}\n\n`;
        }
    });
    
    report += '╔══════════════════════════════════════════════════════════╗\n';
    report += 'END OF REPORT\n';
    report += '╚══════════════════════════════════════════════════════════╝\n';
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drone_report_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('Report downloaded', 'success');
}

// ============================================================================
// GAP DETECTION
// ============================================================================

function handleOrthophotoSelect(e) {
    const file = e.target.files[0];
    if (file) {
        state.orthophoto = file;
        document.getElementById('orthophotoList').innerHTML = `
            <div class="file-item">
                <div style="width: 60px; height: 60px; background: #e2e8f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                    🗺️
                </div>
                <div class="file-name">${file.name}</div>
                <button class="remove-btn" onclick="clearOrthophoto()">×</button>
            </div>
        `;
        document.getElementById('analyzeGapsBtn').disabled = false;
    }
}

function handleGeojsonSelect(e) {
    const file = e.target.files[0];
    if (file) {
        state.geojsonFile = file;
        document.getElementById('geojsonList').innerHTML = `
            <div class="file-item">
                <div style="width: 60px; height: 60px; background: #e2e8f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                    📍
                </div>
                <div class="file-name">${file.name}</div>
                <button class="remove-btn" onclick="clearGeojson()">×</button>
            </div>
        `;
    }
}

function clearOrthophoto() {
    state.orthophoto = null;
    document.getElementById('orthophotoList').innerHTML = '';
    document.getElementById('analyzeGapsBtn').disabled = true;
}

function clearGeojson() {
    state.geojsonFile = null;
    document.getElementById('geojsonList').innerHTML = '';
}

async function analyzeGaps() {
    if (!state.orthophoto) {
        showToast('Please select an orthophoto image', 'error');
        return;
    }
    
    showLoading('Uploading orthophoto...', 0, 100);
    
    try {
        const formData = new FormData();
        formData.append('orthophoto', state.orthophoto, state.orthophoto.name);
        formData.append('method', document.getElementById('clusteringMethod').value);
        
        if (state.geojsonFile) {
            formData.append('rows_geojson', state.geojsonFile, state.geojsonFile.name);
        }
        
        updateLoading('Analyzing gaps...', 50);
        
        const response = await fetch(`${API_BASE}/analyze-orthophoto`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Analysis failed');
        }
        
        const responseData = await response.json();
        console.log('✅ Gap analysis complete:', responseData);
        
        // Extract the actual data - server returns { success: true, data: {...} }
        const data = responseData.data || responseData;
        
        updateLoading('Complete!', 100);
        
        setTimeout(() => {
            hideLoading();
            displayGapResults(data);
        }, 500);
        
    } catch (error) {
        console.error('❌ Analysis error:', error);
        hideLoading();
        showToast(error.message, 'error');
    }
}

function displayGapResults(data) {
    const container = document.getElementById('gapResults');
    
    container.innerHTML = `
        <div class="section">
            <div class="section-title">Gap Detection Results</div>
            <div class="section-desc">Analysis complete using ${data.method || 'clustering'} method</div>
            
            <div class="stats-grid">
                <div class="stat-card" style="border-left: 4px solid #f56565;">
                    <div class="stat-label">Total Gaps Detected</div>
                    <div class="stat-value" style="color: #f56565;">${data.detected_gaps || 0}</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #ed8936;">
                    <div class="stat-label">Total Gap Area</div>
                    <div class="stat-value" style="color: #ed8936;">${Math.round(data.total_gap_area_m2 || 0)} m²</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #667eea;">
                    <div class="stat-label">Rows Analyzed</div>
                    <div class="stat-value" style="color: #667eea;">${data.rows_analyzed || 0}</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #f6ad55;">
                    <div class="stat-label">Rows with Gaps</div>
                    <div class="stat-value" style="color: #f6ad55;">${data.rows_with_gaps || 0}</div>
                </div>
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-primary" onclick="downloadGapJSON()">📥 Download JSON</button>
                <button class="btn btn-secondary" onclick="downloadGapCSV()" style="margin-left: 10px;">📄 Download CSV</button>
            </div>
        </div>
    `;
    
    state.results = { type: 'orthophoto', data };
}

function downloadGapJSON() {
    if (!state.results || state.results.type !== 'orthophoto') return;
    
    const json = JSON.stringify(state.results.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gap_analysis_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('JSON downloaded', 'success');
}

function downloadGapCSV() {
    if (!state.results || state.results.type !== 'orthophoto') return;
    
    const data = state.results.data;
    let csv = 'Metric,Value\n';
    csv += `Gaps Detected,${data.detected_gaps || 0}\n`;
    csv += `Gap Area (m²),${data.total_gap_area_m2 || 0}\n`;
    csv += `Rows Analyzed,${data.rows_analyzed || 0}\n`;
    csv += `Rows with Gaps,${data.rows_with_gaps || 0}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gap_analysis_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('CSV downloaded', 'success');
}

// ============================================================================
// ORTHOMOSAIC GENERATION
// ============================================================================

function handleOrthomosaicImagesSelect(e) {
    const files = Array.from(e.target.files);
    state.orthomosaicImages.push(...files);
    updateOrthomosaicImageList();
}

function updateOrthomosaicImageList() {
    const container = document.getElementById('orthomosaicImageList');
    const btn = document.getElementById('generateOrthomosaicBtn');
    
    if (state.orthomosaicImages.length === 0) {
        container.innerHTML = '';
        btn.disabled = true;
        return;
    }
    
    btn.disabled = false;
    
    // Calculate hardware requirements based on image count
    const imageCount = state.orthomosaicImages.length;
    let ramReq, cpuReq, diskReq, warningLevel;
    
    if (imageCount < 100) {
        ramReq = '8GB'; cpuReq = '4-core'; diskReq = '10GB';
        warningLevel = 'info';
    } else if (imageCount < 300) {
        ramReq = '12GB'; cpuReq = '6-core'; diskReq = '20GB';
        warningLevel = 'info';
    } else if (imageCount < 500) {
        ramReq = '16GB'; cpuReq = '8-core'; diskReq = '40GB';
        warningLevel = 'warning';
    } else {
        ramReq = '16GB+'; cpuReq = '8-core'; diskReq = '50GB';
        warningLevel = 'warning';
    }
    
    const warningColor = warningLevel === 'warning' ? '#f59e0b' : '#3b82f6';
    const warningBg = warningLevel === 'warning' ? '#fef3c7' : '#dbeafe';
    
    container.innerHTML = `
        <div style="padding: 12px; background: #f7fafc; border-radius: 8px; margin-top: 16px;">
            <div style="margin-bottom: 10px;">
                <strong>${state.orthomosaicImages.length}</strong> images selected
                <button class="btn btn-secondary" onclick="clearOrthomosaicImages()" style="float: right; padding: 6px 12px;">Clear All</button>
            </div>
            <div style="padding: 10px; background: ${warningBg}; border-left: 3px solid ${warningColor}; border-radius: 4px; font-size: 13px;">
                <strong style="color: ${warningColor};">📊 Hardware Requirements for ${imageCount} images:</strong><br>
                <span style="color: #374151; margin-top: 5px; display: block;">
                    • RAM: ${ramReq} | CPU: ${cpuReq} | Disk: ${diskReq}<br>
                    ${imageCount >= 500 ? '⚠️ Large dataset - processing may take 1-3 hours' : ''}
                    ${imageCount >= 300 && imageCount < 500 ? '⏱️ Processing time: 30-60 minutes' : ''}
                </span>
            </div>
        </div>
    `;
}

function clearOrthomosaicImages() {
    state.orthomosaicImages = [];
    updateOrthomosaicImageList();
}

async function generateOrthomosaic() {
    const projectName = document.getElementById('projectName').value.trim();
    
    if (!projectName) {
        showToast('Please enter a project name', 'error');
        return;
    }
    
    if (state.orthomosaicImages.length < 5) {
        showToast('Please select at least 5 images (20+ recommended)', 'error');
        return;
    }
    
    const quality = document.getElementById('orthomosaicQuality').value;
    const featureQuality = document.getElementById('featureQuality').value;
    
    try {
        // Step 1: Create project
        showLoading('Creating project...', 5, 100);
        
        const createResponse = await fetch(`${API_BASE}/orthomosaic/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_name: projectName })
        });
        
        if (!createResponse.ok) {
            const err = await createResponse.json();
            throw new Error(err.error || 'Failed to create project');
        }
        
        const createData = await createResponse.json();
        const projectId = createData.project_id;
        console.log('✅ Project created:', projectId);
        
        // Step 2: Upload images in small chunks to prevent memory issues
        const chunkSize = 10; // Small chunks for reliability on any hardware
        const totalImages = state.orthomosaicImages.length;
        let uploaded = 0;
        
        for (let i = 0; i < totalImages; i += chunkSize) {
            const chunk = state.orthomosaicImages.slice(i, i + chunkSize);
            const chunkNum = Math.floor(i / chunkSize) + 1;
            const totalChunks = Math.ceil(totalImages / chunkSize);
            
            showLoading(`Uploading batch ${chunkNum}/${totalChunks} (${chunk.length} images)...`, 
                        10 + Math.floor((i / totalImages) * 50), 100);
            
            const formData = new FormData();
            formData.append('project_id', projectId);
            
            for (const file of chunk) {
                formData.append('images', file, file.name);
            }
            
            // Upload with retry on failure
            let uploadSuccess = false;
            let retries = 3;
            
            while (!uploadSuccess && retries > 0) {
                try {
                    const uploadResponse = await fetch(`${API_BASE}/orthomosaic/upload`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!uploadResponse.ok) {
                        const err = await uploadResponse.json();
                        throw new Error(err.error || 'Upload failed');
                    }
                    
                    const result = await uploadResponse.json();
                    uploaded += result.images_uploaded || chunk.length;
                    uploadSuccess = true;
                    console.log(`✅ Uploaded ${uploaded}/${totalImages} images`);
                    
                    // Small delay for memory cleanup between batches
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (uploadError) {
                    retries--;
                    console.warn(`⚠️ Upload attempt failed, ${retries} retries left:`, uploadError.message);
                    
                    if (retries === 0) {
                        throw new Error(`Upload failed after 3 attempts: ${uploadError.message}`);
                    }
                    
                    // Wait 2 seconds before retry
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        // Step 3: Start processing
        showLoading('Starting orthomosaic processing...', 65, 100);
        
        const processResponse = await fetch(`${API_BASE}/orthomosaic/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                options: {
                    quality: quality,
                    feature_quality: featureQuality,
                    dsm: true,
                    dtm: true,
                    orthophoto_resolution: quality === 'ultra' ? 2 : quality === 'high' ? 5 : 10,
                    use_3dmesh: true
                }
            })
        });
        
        if (!processResponse.ok) {
            const err = await processResponse.json();
            hideLoading();
            
            // Special handling for Docker/NodeODM not available
            if (processResponse.status === 503) {
                alert('Docker Required\n\n' + 
                      (err.details || 'WebODM processing requires Docker Desktop.') + 
                      '\n\nDownload from: https://www.docker.com/products/docker-desktop\n\n' +
                      'After installation, restart this application.');
                showToast('⚠️ Docker Required - See instructions', 'error');
                return;
            }
            
            throw new Error(err.error || 'Failed to start processing');
        }
        
        const processData = await processResponse.json();
        console.log('✅ Processing started:', processData);
        
        showLoading('Processing started! This may take 15-60 minutes...', 70, 100);
        
        // Store project for status polling
        state.currentOrthomosaicProject = projectId;
        
        // Start polling for status
        pollOrthomosaicStatus(projectId, projectName);
        
    } catch (error) {
        console.error('❌ Orthomosaic error:', error);
        hideLoading();
        showToast(error.message, 'error');
    }
}

async function pollOrthomosaicStatus(projectId, projectName) {
    try {
        const response = await fetch(`${API_BASE}/orthomosaic/status/${projectId}`);
        const data = await response.json();
        
        // Handle nested status object from server
        const statusInfo = data.status || data;
        const status = statusInfo.status || 'unknown';
        const progress = statusInfo.progress || 0;
        const error = statusInfo.error;
        
        console.log('📊 Status:', status, 'Progress:', progress + '%');
        
        if (status === 'completed' || status === 'done') {
            updateLoading('Complete!', 100);
            setTimeout(() => {
                hideLoading();
                showToast('🎉 Orthomosaic generated successfully!', 'success');
                displayOrthomosaicResult(projectId, projectName, statusInfo);
            }, 500);
        } else if (status === 'failed' || status === 'error') {
            hideLoading();
            showToast('Orthomosaic generation failed: ' + (error || 'Unknown error'), 'error');
        } else {
            // Still processing
            const displayProgress = Math.min(progress, 95);
            updateLoading(`Processing orthomosaic (${displayProgress}%)`, displayProgress);
            setTimeout(() => pollOrthomosaicStatus(projectId, projectName), 5000);
        }
    } catch (error) {
        console.error('Error polling status:', error);
        hideLoading();
        showToast('Error checking status: ' + error.message, 'error');
    }
}

function displayOrthomosaicResult(projectId, projectName, data) {
    const container = document.getElementById('orthomosaicResults');
    
    container.innerHTML = `
        <div class="section" style="margin-top: 20px;">
            <div class="section-title">✅ Orthomosaic Generated</div>
            <div class="section-desc">Project: ${projectName}</div>
            
            <div class="stats-grid">
                <div class="stat-card" style="border-left: 4px solid #48bb78;">
                    <div class="stat-label">Status</div>
                    <div class="stat-value" style="color: #48bb78;">Complete</div>
                </div>
                <div class="stat-card" style="border-left: 4px solid #667eea;">
                    <div class="stat-label">Project ID</div>
                    <div class="stat-value" style="color: #667eea; font-size: 14px;">${projectId}</div>
                </div>
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-primary" onclick="downloadOrthomosaic('${projectId}')">📥 Download Orthomosaic (TIF)</button>
            </div>
        </div>
    `;
}

async function downloadOrthomosaic(projectId) {
    showLoading('Preparing download...', 50, 100);
    
    try {
        const response = await fetch(`${API_BASE}/orthomosaic/download/${projectId}`);
        
        if (!response.ok) {
            throw new Error('Download failed');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `orthomosaic_${projectId}.tif`;
        link.click();
        URL.revokeObjectURL(url);
        
        hideLoading();
        showToast('Download started', 'success');
    } catch (error) {
        hideLoading();
        showToast('Download failed: ' + error.message, 'error');
    }
}

async function loadOrthomosaicProjects() {
    try {
        const response = await fetch(`${API_BASE}/orthomosaic/projects`);
        const data = await response.json();
        
        displayOrthomosaicProjects(data.projects || []);
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function displayOrthomosaicProjects(projects) {
    const container = document.getElementById('orthomosaicProjects');
    
    if (!projects || projects.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = `
        <div class="section">
            <div class="section-title">Your Projects</div>
            <div class="results-grid">
                ${projects.map(project => `
                    <div class="result-card">
                        <div style="width: 100%; height: 150px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; font-size: 48px;">
                            🌍
                        </div>
                        <div class="result-card-content">
                            <div class="result-card-title">${project.name || project.project_name}</div>
                            <div class="result-card-meta">
                                Status: ${project.status}<br>
                                Created: ${new Date(project.created_at || project.created).toLocaleDateString()}
                            </div>
                            ${project.status === 'completed' || project.status === 'done' ? `
                                <button class="btn btn-primary" onclick="downloadOrthomosaic('${project.project_id}')" style="margin-top: 10px;">
                                    📥 Download
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ============================================================================
// LOADING & TOAST
// ============================================================================

function showLoading(text, progress = 0, total = 100) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingSubtext').textContent = '';
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = total > 0 ? `${progress}%` : '';
    document.getElementById('loadingOverlay').classList.add('visible');
}

function updateLoading(text, progress) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${progress}%`;
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('visible');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================================
// MANUAL ROW DIGITIZER
// ============================================================================

const digitizer = {
    canvas: null,
    ctx: null,
    orthophoto: null,
    image: null,
    geoBounds: null,
    drawnRows: [],
    currentRow: [],
    isDrawing: false,
    zoomLevel: 1,
    panOffset: { x: 0, y: 0 },
    isPanning: false,
    lastPanPoint: null,
    lastClickTime: 0
};

function loadDigitizerOrthophoto(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading('Loading orthophoto...');
    
    // Update filename display
    document.getElementById('digitizerFileName').textContent = `✓ ${file.name}`;
    
    // Check if it's a TIF/TIFF file - needs server conversion
    const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');
    
    if (isTiff) {
        // Send to backend for conversion
        const formData = new FormData();
        formData.append('tiff', file);
        
        fetch(`${API_BASE}/convert-tiff`, {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                digitizer.image = new Image();
                digitizer.image.onload = () => {
                    initializeCanvas();
                    hideLoading();
                    
                    // Show canvas container
                    document.getElementById('digitizerCanvasContainer').style.display = 'block';
                    
                    // Check if we have geospatial bounds
                    if (data.bounds) {
                        digitizer.geoBounds = data.bounds;
                        document.getElementById('geoBoundsInfo').style.display = 'block';
                        document.getElementById('noGeoBoundsWarning').style.display = 'none';
                        
                        // Display bounds
                        document.getElementById('geoBoundsValues').innerHTML = `
                            <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                                <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">Min Lng</div>
                                <div style="color: #e2e8f0;">${data.bounds.minLng.toFixed(6)}</div>
                            </div>
                            <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                                <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">Min Lat</div>
                                <div style="color: #e2e8f0;">${data.bounds.minLat.toFixed(6)}</div>
                            </div>
                            <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                                <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">Max Lng</div>
                                <div style="color: #e2e8f0;">${data.bounds.maxLng.toFixed(6)}</div>
                            </div>
                            <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                                <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">Max Lat</div>
                                <div style="color: #e2e8f0;">${data.bounds.maxLat.toFixed(6)}</div>
                            </div>
                        `;
                        showToast('GeoTIFF loaded with coordinates', 'success');
                    } else {
                        document.getElementById('noGeoBoundsWarning').style.display = 'block';
                        document.getElementById('geoBoundsInfo').style.display = 'none';
                        showToast('TIFF converted (no georeference found)', 'info');
                    }
                };
                
                digitizer.image.onerror = () => {
                    hideLoading();
                    showToast('Failed to load converted image', 'error');
                };
                
                digitizer.image.src = data.base64;
                digitizer.orthophoto = { name: file.name, data: data.base64 };
            } else {
                hideLoading();
                showToast('Failed to convert TIFF: ' + (data.error || 'Unknown error'), 'error');
                document.getElementById('digitizerFileName').textContent = 'Drop orthophoto here or click to select';
            }
        })
        .catch(error => {
            hideLoading();
            showToast('Error converting TIFF: ' + error.message, 'error');
            document.getElementById('digitizerFileName').textContent = 'Drop orthophoto here or click to select';
        });
        return;
    }
    
    // For PNG/JPG, load directly
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            digitizer.image = new Image();
            
            // Set timeout in case image never loads
            const loadTimeout = setTimeout(() => {
                hideLoading();
                showToast('Image loading timed out. Try a smaller file.', 'error');
                document.getElementById('digitizerFileName').textContent = 'Drop orthophoto here or click to select';
            }, 10000);
            
            digitizer.image.onload = () => {
                clearTimeout(loadTimeout);
                initializeCanvas();
                showToast('Orthophoto loaded successfully', 'success');
                hideLoading();
                
                // Show canvas container
                document.getElementById('digitizerCanvasContainer').style.display = 'block';
                
                // Show non-georeferenced warning for PNG/JPG
                document.getElementById('noGeoBoundsWarning').style.display = 'block';
                document.getElementById('geoBoundsInfo').style.display = 'none';
            };
            
            digitizer.image.onerror = () => {
                clearTimeout(loadTimeout);
                hideLoading();
                showToast('Failed to load image. Unsupported format.', 'error');
                document.getElementById('digitizerFileName').textContent = 'Drop orthophoto here or click to select';
            };
            
            digitizer.image.src = e.target.result;
            digitizer.orthophoto = { name: file.name, data: e.target.result };
        } catch (error) {
            console.error('Error loading orthophoto:', error);
            showToast('Error loading orthophoto: ' + error.message, 'error');
            hideLoading();
        }
    };
    
    reader.onerror = () => {
        hideLoading();
        showToast('Failed to read file', 'error');
        document.getElementById('digitizerFileName').textContent = 'Drop orthophoto here or click to select';
    };
    
    reader.readAsDataURL(file);
}

function initializeCanvas() {
    digitizer.canvas = document.getElementById('digitizerCanvas');
    digitizer.ctx = digitizer.canvas.getContext('2d');
    
    // Set canvas size to match image (maintain aspect ratio)
    const maxWidth = 1920;
    const maxHeight = 1080;
    let canvasWidth = digitizer.image.width;
    let canvasHeight = digitizer.image.height;
    
    // Scale down if too large
    if (canvasWidth > maxWidth || canvasHeight > maxHeight) {
        const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight);
        canvasWidth = Math.floor(canvasWidth * scale);
        canvasHeight = Math.floor(canvasHeight * scale);
    }
    
    digitizer.canvas.width = canvasWidth;
    digitizer.canvas.height = canvasHeight;
    
    // Set display size maintaining aspect ratio
    const containerWidth = digitizer.canvas.parentElement.offsetWidth - 32;
    const aspectRatio = canvasHeight / canvasWidth;
    const displayWidth = Math.min(containerWidth, canvasWidth);
    digitizer.canvas.style.width = `${displayWidth}px`;
    digitizer.canvas.style.height = `${displayWidth * aspectRatio}px`;
    
    // Reset state
    digitizer.drawnRows = [];
    digitizer.currentRow = [];
    digitizer.isDrawing = false;
    digitizer.zoomLevel = 1;
    digitizer.panOffset = { x: 0, y: 0 };
    
    // Add event listeners
    addCanvasEventListeners();
    
    // Initial render
    renderCanvas();
    updateButtons();
}

function addCanvasEventListeners() {
    const canvas = digitizer.canvas;
    
    // Click to add points
    canvas.addEventListener('click', handleCanvasClick);
    
    // Zoom with mouse wheel
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    // Pan with drag
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function handleCanvasClick(e) {
    if (!digitizer.isDrawing) return;
    
    const rect = digitizer.canvas.getBoundingClientRect();
    const scaleX = digitizer.canvas.width / rect.width;
    const scaleY = digitizer.canvas.height / rect.height;
    
    // Transform to canvas coordinates
    const x = ((e.clientX - rect.left) * scaleX - digitizer.panOffset.x) / digitizer.zoomLevel;
    const y = ((e.clientY - rect.top) * scaleY - digitizer.panOffset.y) / digitizer.zoomLevel;
    
    // Check for double-click
    const now = Date.now();
    if (now - digitizer.lastClickTime < 300 && digitizer.currentRow.length >= 2) {
        // Finish row
        finishCurrentRow();
        return;
    }
    digitizer.lastClickTime = now;
    
    // Add point
    digitizer.currentRow.push({ x, y });
    renderCanvas();
    updateButtons();
}

function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    digitizer.zoomLevel = Math.min(Math.max(0.1, digitizer.zoomLevel * delta), 10);
    
    document.getElementById('zoomLevel').textContent = `${Math.round(digitizer.zoomLevel * 100)}%`;
    renderCanvas();
}

function handleMouseDown(e) {
    if (e.button === 0 && !digitizer.isDrawing) {
        digitizer.isPanning = true;
        digitizer.lastPanPoint = { x: e.clientX, y: e.clientY };
        digitizer.canvas.style.cursor = 'grabbing';
    }
}

function handleMouseMove(e) {
    if (digitizer.isPanning && digitizer.lastPanPoint) {
        const dx = e.clientX - digitizer.lastPanPoint.x;
        const dy = e.clientY - digitizer.lastPanPoint.y;
        digitizer.panOffset.x += dx;
        digitizer.panOffset.y += dy;
        digitizer.lastPanPoint = { x: e.clientX, y: e.clientY };
        renderCanvas();
    }
}

function handleMouseUp() {
    if (digitizer.isPanning) {
        digitizer.isPanning = false;
        digitizer.lastPanPoint = null;
        digitizer.canvas.style.cursor = digitizer.isDrawing ? 'crosshair' : 'grab';
    }
}

function renderCanvas() {
    if (!digitizer.ctx || !digitizer.image) return;
    
    const ctx = digitizer.ctx;
    const canvas = digitizer.canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Save context
    ctx.save();
    
    // Apply transformations
    ctx.translate(digitizer.panOffset.x, digitizer.panOffset.y);
    ctx.scale(digitizer.zoomLevel, digitizer.zoomLevel);
    
    // Draw image
    ctx.drawImage(digitizer.image, 0, 0, canvas.width, canvas.height);
    
    // Draw finished rows
    digitizer.drawnRows.forEach((row, index) => {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3 / digitizer.zoomLevel;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        row.points.forEach((point, i) => {
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        
        // Draw points
        row.points.forEach((point) => {
            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#FFD700';
            ctx.lineWidth = 2 / digitizer.zoomLevel;
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6 / digitizer.zoomLevel, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        });
        
        // Draw row number
        if (row.points.length > 0) {
            const firstPoint = row.points[0];
            ctx.fillStyle = '#FFD700';
            ctx.font = `${16 / digitizer.zoomLevel}px Arial`;
            ctx.fillText(`Row ${row.number}`, firstPoint.x + 10 / digitizer.zoomLevel, firstPoint.y - 10 / digitizer.zoomLevel);
        }
    });
    
    // Draw current row being drawn
    if (digitizer.currentRow.length > 0) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3 / digitizer.zoomLevel;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        digitizer.currentRow.forEach((point, i) => {
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        
        // Draw points
        digitizer.currentRow.forEach((point) => {
            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#10b981';
            ctx.lineWidth = 2 / digitizer.zoomLevel;
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6 / digitizer.zoomLevel, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        });
    }
    
    ctx.restore();
}

function toggleDrawing() {
    digitizer.isDrawing = !digitizer.isDrawing;
    
    const btn = document.getElementById('startDrawingBtn');
    const indicator = document.getElementById('modeIndicator');
    
    if (digitizer.isDrawing) {
        btn.textContent = '⏸️ Stop Drawing';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        indicator.style.display = 'block';
        digitizer.canvas.style.cursor = 'crosshair';
        showToast('Drawing mode activated - click to add points', 'info');
    } else {
        btn.textContent = '✏️ Draw New Row';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        indicator.style.display = 'none';
        digitizer.canvas.style.cursor = 'grab';
        
        // Save current row if it has points
        if (digitizer.currentRow.length >= 2) {
            finishCurrentRow();
        } else if (digitizer.currentRow.length > 0) {
            digitizer.currentRow = [];
            renderCanvas();
        }
    }
    
    updateButtons();
}

function finishCurrentRow() {
    if (digitizer.currentRow.length < 2) {
        showToast('Row needs at least 2 points', 'error');
        return;
    }
    
    digitizer.drawnRows.push({
        id: `row_${digitizer.drawnRows.length + 1}`,
        number: digitizer.drawnRows.length + 1,
        points: [...digitizer.currentRow]
    });
    
    digitizer.currentRow = [];
    digitizer.isDrawing = false;
    
    // Update UI
    document.getElementById('startDrawingBtn').textContent = '✏️ Draw New Row';
    document.getElementById('startDrawingBtn').classList.remove('btn-primary');
    document.getElementById('startDrawingBtn').classList.add('btn-secondary');
    document.getElementById('modeIndicator').style.display = 'none';
    digitizer.canvas.style.cursor = 'grab';
    
    renderCanvas();
    updateButtons();
    showToast(`Row ${digitizer.drawnRows.length} saved`, 'success');
}

function undoLastPoint() {
    if (digitizer.currentRow.length > 0) {
        digitizer.currentRow.pop();
        renderCanvas();
        updateButtons();
    }
}

function clearCurrentRow() {
    digitizer.currentRow = [];
    renderCanvas();
    updateButtons();
}

function deleteLastRow() {
    if (digitizer.drawnRows.length > 0) {
        digitizer.drawnRows.pop();
        renderCanvas();
        updateButtons();
        showToast('Last row deleted', 'info');
    }
}

function zoomIn() {
    digitizer.zoomLevel = Math.min(digitizer.zoomLevel * 1.2, 10);
    document.getElementById('zoomLevel').textContent = `${Math.round(digitizer.zoomLevel * 100)}%`;
    renderCanvas();
}

function zoomOut() {
    digitizer.zoomLevel = Math.max(digitizer.zoomLevel * 0.8, 0.1);
    document.getElementById('zoomLevel').textContent = `${Math.round(digitizer.zoomLevel * 100)}%`;
    renderCanvas();
}

function resetView() {
    digitizer.zoomLevel = 1;
    digitizer.panOffset = { x: 0, y: 0 };
    document.getElementById('zoomLevel').textContent = '100%';
    renderCanvas();
}

function updateButtons() {
    const hasCurrentPoints = digitizer.currentRow.length > 0;
    const hasRows = digitizer.drawnRows.length > 0;
    
    document.getElementById('undoBtn').disabled = !hasCurrentPoints;
    document.getElementById('clearRowBtn').disabled = !hasCurrentPoints;
    document.getElementById('deleteRowBtn').disabled = !hasRows;
    document.getElementById('exportBtn').disabled = !hasRows;
    
    // Update rows counter
    if (hasRows) {
        document.getElementById('rowsCounter').style.display = 'block';
        document.getElementById('rowsCount').textContent = digitizer.drawnRows.length;
    } else {
        document.getElementById('rowsCounter').style.display = 'none';
    }
}

function exportRowsGeoJSON() {
    if (digitizer.drawnRows.length === 0) {
        showToast('No rows to export', 'error');
        return;
    }
    
    // Detect coordinate system from bounds
    let crsName = 'urn:ogc:def:crs:OGC:1.3:CRS84'; // Default WGS84
    let isProjected = false;
    
    if (digitizer.geoBounds) {
        // Check if coordinates are projected (UTM/meters) vs geographic (degrees)
        // UTM coordinates are typically > 180 and in the range of hundreds of thousands
        if (Math.abs(digitizer.geoBounds.minLng) > 180 || Math.abs(digitizer.geoBounds.maxLng) > 180) {
            isProjected = true;
            // For UTM coordinates around 720000, that's Zone 34
            crsName = 'EPSG:32634'; // UTM Zone 34N - WGS84
            console.log('Detected UTM Zone 34N coordinates, using EPSG:32634');
        }
    }
    
    console.log('Image bounds:', digitizer.geoBounds);
    console.log('Canvas size:', digitizer.canvas.width, 'x', digitizer.canvas.height);
    console.log('Image size:', digitizer.image.width, 'x', digitizer.image.height);
    
    // Convert pixel coordinates to geographic/projected coordinates
    const features = digitizer.drawnRows.map(row => {
        let coordinates;
        
        if (digitizer.geoBounds) {
            // Transform pixel to geo coordinates
            // Scale based on canvas size (which may be scaled down)
            const scaleX = digitizer.image.width / digitizer.canvas.width;
            const scaleY = digitizer.image.height / digitizer.canvas.height;
            
            console.log('Scale factors:', scaleX, scaleY);
            
            coordinates = row.points.map(point => {
                // Scale point back to original image coordinates
                const imgX = point.x * scaleX;
                const imgY = point.y * scaleY;
                
                // Convert to geographic/projected coordinates
                const x = digitizer.geoBounds.minLng + (imgX / digitizer.image.width) * 
                            (digitizer.geoBounds.maxLng - digitizer.geoBounds.minLng);
                const y = digitizer.geoBounds.maxLat - (imgY / digitizer.image.height) * 
                            (digitizer.geoBounds.maxLat - digitizer.geoBounds.minLat);
                
                console.log(`Point pixel (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) -> img (${imgX.toFixed(2)}, ${imgY.toFixed(2)}) -> geo (${x.toFixed(2)}, ${y.toFixed(2)})`);
                return [x, y];
            });
        } else {
            // Use pixel coordinates
            coordinates = row.points.map(point => [point.x, point.y]);
        }
        
        return {
            type: 'Feature',
            properties: {
                id: row.id,
                row_number: row.number,
                points_count: row.points.length,
                description: `Vineyard Row ${row.number}`
            },
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            }
        };
    });
    
    const geojson = {
        type: 'FeatureCollection',
        name: 'vineyard_rows',
        crs: digitizer.geoBounds ? {
            type: 'name',
            properties: { name: crsName }
        } : undefined,
        features: features
    };
    
    console.log('Exported GeoJSON:', geojson);
    
    // Download as file
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `digitized_rows_${Date.now()}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
    
    const coordType = isProjected ? 'UTM Zone 34N (EPSG:32634)' : 'geographic (WGS84)';
    showToast(`Exported ${digitizer.drawnRows.length} rows with ${coordType} coordinates`, 'success');
}

// ==================== IMAGE ANNOTATION FUNCTIONS ====================

const annotation = {
    logFiles: [],
    imageFiles: [],
    enableYolo: false,
    yoloIndustry: 'agriculture',
    yoloConfidence: 0.50
};

// Initialize annotation inputs
document.getElementById('annotation-log-input').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    annotation.logFiles = files;
    
    const logText = document.getElementById('annotation-log-text');
    const logsList = document.getElementById('annotation-logs-list');
    const logsCount = document.getElementById('annotation-logs-count');
    const logsItems = document.getElementById('annotation-logs-items');
    
    if (files.length > 0) {
        logText.textContent = `✓ ${files.length} Log File${files.length > 1 ? 's' : ''} Selected`;
        logsCount.textContent = `${files.length} Log File${files.length > 1 ? 's' : ''}`;
        
        // Show file list
        logsList.style.display = 'block';
        logsItems.innerHTML = '';
        
        files.slice(0, 10).forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <span style="font-size: 20px;">📄</span>
                <span class="file-name">${file.name}</span>
                <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
                <button class="remove-file-btn" onclick="removeAnnotationLog(${index})">✕</button>
            `;
            logsItems.appendChild(fileItem);
        });
        
        if (files.length > 10) {
            const more = document.createElement('div');
            more.style.cssText = 'text-align: center; padding: 10px; color: #666; font-size: 13px;';
            more.textContent = `+ ${files.length - 10} more log files`;
            logsItems.appendChild(more);
        }
    } else {
        logText.textContent = 'Select Log Files (up to 50)';
        logsList.style.display = 'none';
    }
    
    updateAnnotationButton();
});

document.getElementById('annotation-images-input').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    annotation.imageFiles = files;
    
    const imagesText = document.getElementById('annotation-images-text');
    const imagesList = document.getElementById('annotation-images-list');
    const imagesCount = document.getElementById('annotation-images-count');
    const imagesItems = document.getElementById('annotation-images-items');
    
    if (files.length > 0) {
        imagesText.textContent = `${files.length} Images Selected`;
        imagesCount.textContent = `${files.length} Image${files.length > 1 ? 's' : ''}`;
        
        // Show file list
        imagesList.style.display = 'block';
        imagesItems.innerHTML = '';
        
        files.slice(0, 10).forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            
            const isTif = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');
            
            fileItem.innerHTML = `
                <span style="font-size: 20px;">${isTif ? '🗺️' : '🖼️'}</span>
                <span class="file-name">${file.name}</span>
                <span class="file-size">${(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                <button class="remove-file-btn" onclick="removeAnnotationImage(${index})">✕</button>
            `;
            imagesItems.appendChild(fileItem);
        });
        
        if (files.length > 10) {
            const more = document.createElement('div');
            more.style.cssText = 'text-align: center; padding: 10px; color: #666; font-size: 13px;';
            more.textContent = `+ ${files.length - 10} more images`;
            imagesItems.appendChild(more);
        }
    } else {
        imagesText.textContent = 'Select Images';
        imagesList.style.display = 'none';
    }
    
    updateAnnotationButton();
});

function removeAnnotationLog(index) {
    annotation.logFiles.splice(index, 1);
    document.getElementById('annotation-log-input').value = '';
    const event = new Event('change');
    document.getElementById('annotation-log-input').dispatchEvent(event);
}

function removeAnnotationImage(index) {
    annotation.imageFiles.splice(index, 1);
    document.getElementById('annotation-images-input').value = '';
    const event = new Event('change');
    document.getElementById('annotation-images-input').dispatchEvent(event);
}

function clearAnnotationLogs() {
    annotation.logFiles = [];
    document.getElementById('annotation-log-input').value = '';
    document.getElementById('annotation-log-text').textContent = 'Select Log Files (up to 50)';
    document.getElementById('annotation-logs-list').style.display = 'none';
    updateAnnotationButton();
}

function clearAnnotationImages() {
    annotation.imageFiles = [];
    document.getElementById('annotation-images-input').value = '';
    document.getElementById('annotation-images-text').textContent = 'Select Images';
    document.getElementById('annotation-images-list').style.display = 'none';
    updateAnnotationButton();
}

function toggleYoloSettings() {
    const enabled = document.getElementById('enable-yolo').checked;
    annotation.enableYolo = enabled;
    document.getElementById('yolo-settings').style.display = enabled ? 'block' : 'none';
}

function selectIndustry(mode) {
    annotation.yoloIndustry = mode;
    document.querySelectorAll('.industry-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.industry-btn[data-mode="${mode}"]`).classList.add('active');
}

function updateAnnotationButton() {
    const btn = document.getElementById('annotation-process-btn');
    const hasLogs = annotation.logFiles.length > 0;
    const hasImages = annotation.imageFiles.length > 0;
    
    btn.disabled = !hasLogs || !hasImages;
    btn.style.opacity = btn.disabled ? '0.5' : '1';
    btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
}

async function processAnnotation() {
    const progressDiv = document.getElementById('annotation-progress');
    const progressFill = document.getElementById('annotation-progress-fill');
    const progressText = document.getElementById('annotation-progress-text');
    const resultsDiv = document.getElementById('annotation-results');
    const processBtn = document.getElementById('annotation-process-btn');
    
    // Validate
    if (annotation.logFiles.length === 0) {
        showToast('Please select at least one DJI log file', 'error');
        return;
    }
    
    if (annotation.imageFiles.length === 0) {
        showToast('Please select at least one image', 'error');
        return;
    }
    
    try {
        processBtn.disabled = true;
        processBtn.textContent = '⏳ Processing...';
        progressDiv.style.display = 'block';
        resultsDiv.style.display = 'none';
        
        // Create FormData
        const formData = new FormData();
        
        // Add log files
        annotation.logFiles.forEach(file => {
            formData.append('logFile', file);
        });
        
        // Add image files
        annotation.imageFiles.forEach(file => {
            formData.append('images', file);
        });
        
        // Add YOLO settings if enabled
        if (annotation.enableYolo) {
            const confidence = parseFloat(document.getElementById('confidence-slider').value);
            formData.append('enableYolo', 'true');
            formData.append('yoloIndustry', annotation.yoloIndustry);
            formData.append('yoloConfidence', confidence.toString());
        }
        
        progressText.textContent = 'Uploading files...';
        progressFill.style.width = '10%';
        
        // Make request
        const response = await fetch('http://localhost:8080/api/annotate-images', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || error.error || 'Annotation failed');
        }
        
        progressText.textContent = 'Processing complete!';
        progressFill.style.width = '100%';
        
        const result = await response.json();
        
        // Display results
        setTimeout(() => {
            displayAnnotationResults(result);
            progressDiv.style.display = 'none';
            processBtn.disabled = false;
            processBtn.textContent = '⚡ Annotate Images';
        }, 1000);
        
    } catch (error) {
        console.error('Annotation error:', error);
        showToast('Annotation failed: ' + error.message, 'error');
        progressDiv.style.display = 'none';
        processBtn.disabled = false;
        processBtn.textContent = '⚡ Annotate Images';
    }
}

function displayAnnotationResults(result) {
    const resultsDiv = document.getElementById('annotation-results');
    
    const yoloSection = result.data.yoloEnabled ? `
        <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">🤖 YOLO Detections</div>
            <div style="font-size: 28px; font-weight: bold; color: #1976d2;">${result.data.yoloDetectionCount || 0}</div>
        </div>
    ` : '';
    
    const html = `
        <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); padding: 24px; border-radius: 12px; margin-top: 20px; border: 2px solid #2e7d32;">
            <h3 style="margin: 0 0 20px 0; color: #1b5e20; display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 28px;">✅</span>
                Annotation Complete
            </h3>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Total Images</div>
                    <div style="font-size: 28px; font-weight: bold; color: #2e7d32;">${result.data.totalImages}</div>
                </div>
                
                <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Successfully Annotated</div>
                    <div style="font-size: 28px; font-weight: bold; color: #2e7d32;">${result.data.successfulAnnotations}</div>
                </div>
                
                <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Log Files Processed</div>
                    <div style="font-size: 28px; font-weight: bold; color: #2e7d32;">${result.data.processedLogFiles}</div>
                </div>
                
                <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Flight Records</div>
                    <div style="font-size: 28px; font-weight: bold; color: #2e7d32;">${result.data.totalFlightRecords.toLocaleString()}</div>
                </div>
                
                ${yoloSection}
            </div>
            
            ${result.data.flightSummary ? `
                <div style="background: rgba(255,255,255,0.7); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <strong style="display: block; margin-bottom: 8px; color: #1b5e20;">📅 Flight Summary:</strong>
                    <div style="font-size: 14px; line-height: 1.8; color: #2d3748;">
                        <strong>Start:</strong> ${new Date(result.data.flightSummary.startTime).toLocaleString()}<br>
                        <strong>End:</strong> ${new Date(result.data.flightSummary.endTime).toLocaleString()}<br>
                        <strong>Records:</strong> ${result.data.flightSummary.recordCount.toLocaleString()}
                    </div>
                </div>
            ` : ''}
            
            ${result.data.yoloEnabled ? `
                <div style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 2px solid #2196f3;">
                    <strong style="display: block; margin-bottom: 8px; color: #0d47a1;">🤖 YOLO Auto-Annotation Results:</strong>
                    <div style="font-size: 14px; line-height: 1.8; color: #1565c0;">
                        <strong>Mode:</strong> ${result.data.yoloResults?.[0]?.image ? result.data.yoloResults.length + ' images processed' : 'No detections'}<br>
                        <strong>Total Objects Detected:</strong> ${result.data.yoloDetectionCount || 0}<br>
                        <strong>Status:</strong> ${result.data.yoloDetectionCount > 0 ? '✅ Objects detected and annotated' : '⚠️ No objects detected'}
                    </div>
                </div>
            ` : ''}
            
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button class="btn-primary" onclick="downloadAnnotationCSV()" style="flex: 1; min-width: 200px;">
                    📥 Download CSV Report
                </button>
                <button class="btn-primary" onclick="downloadAnnotationJSON()" style="flex: 1; min-width: 200px;">
                    📦 Download JSON
                </button>
                ${result.data.annotatedImages && result.data.annotatedImages.length > 0 ? `
                    <button class="btn-primary" onclick="downloadAnnotatedImages()" style="flex: 1; min-width: 200px;">
                        🖼️ Download Images (${result.data.annotatedImages.length})
                    </button>
                ` : ''}
            </div>
        </div>
    `;
    
    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
    
    // Store result for download functions
    window.annotationResult = result;
    
    const message = result.data.yoloEnabled 
        ? `Successfully annotated ${result.data.successfulAnnotations} images with ${result.data.yoloDetectionCount} YOLO detections!`
        : `Successfully annotated ${result.data.successfulAnnotations} images!`;
    showToast(message, 'success');
}

function downloadAnnotationCSV() {
    if (!window.annotationResult) return;
    
    const csvData = window.annotationResult.data.csvData;
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotation_report_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('CSV report downloaded', 'success');
}

function downloadAnnotationJSON() {
    if (!window.annotationResult) return;
    
    const jsonData = JSON.stringify(window.annotationResult.data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotation_results_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('JSON results downloaded', 'success');
}

async function downloadAnnotatedImages() {
    if (!window.annotationResult || !window.annotationResult.data.annotatedImages) return;
    
    showToast('Preparing ZIP download...', 'info');
    
    try {
        // Get all filenames for ZIP download
        const filenames = window.annotationResult.data.annotatedImages.map(img => img.filename);
        
        // Request ZIP from server
        const response = await fetch('http://localhost:8080/api/download-zip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filenames: filenames })
        });
        
        if (!response.ok) {
            throw new Error('Failed to create ZIP');
        }
        
        // Download the ZIP file
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `annotated_images_${Date.now()}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        
        showToast(`Downloaded ${filenames.length} images as ZIP`, 'success');
    } catch (error) {
        console.error('ZIP download error:', error);
        showToast('Failed to download ZIP: ' + error.message, 'error');
    }
}

// ==================== MANUAL ANNOTATION EDITOR ====================

const editorState = {
    imageLoaded: false,
    imageSrc: null,
    imageName: '',
    originalImageName: '',
    imageWidth: 0,
    imageHeight: 0,
    detections: [],
    selectedIndex: null,
    isDrawing: false,
    isDragging: false,
    isResizing: false,
    resizeHandle: null, // 'nw', 'ne', 'sw', 'se'
    dragOffset: { x: 0, y: 0 },
    drawStart: null,
    drawEnd: null,
    availableLabels: ['vine', 'grape', 'diseased', 'healthy', 'missing', 'person', 'car', 'other'],
    currentLabel: 'vine',
    yoloResultsIndex: 0, // Index for navigating through YOLO results
    zoom: 1.0, // Zoom level (1.0 = 100%)
    minZoom: 0.25,
    maxZoom: 4.0,
    zoomStep: 0.25
};

// Load image from file input
function loadEditorImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Reset zoom when loading new image
    editorState.zoom = 1.0;
    updateZoomDisplay();
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = document.getElementById('editor-image');
        img.src = e.target.result;
        
        img.onload = function() {
            editorState.imageLoaded = true;
            editorState.imageSrc = e.target.result;
            editorState.imageName = file.name;
            editorState.originalImageName = file.name;
            editorState.imageWidth = img.naturalWidth;
            editorState.imageHeight = img.naturalHeight;
            editorState.detections = [];
            editorState.selectedIndex = null;
            
            // Show image info
            document.getElementById('editor-current-image').style.display = 'block';
            document.getElementById('editor-image-name').textContent = file.name;
            document.getElementById('editor-image-size').textContent = `${img.naturalWidth} x ${img.naturalHeight}px`;
            
            // Show canvas container
            document.getElementById('editor-canvas-container').style.display = 'block';
            
            // Hide navigation bar for single file uploads
            const navBar = document.getElementById('editor-navigation-bar');
            if (navBar) navBar.style.display = 'none';
            
            // Setup SVG and events
            setTimeout(() => {
                setupEditorSVG();
                setupEditorEvents();
                updateEditorUI();
            }, 100);
            
            showToast('Image loaded successfully', 'success');
        };
    };
    reader.readAsDataURL(file);
}

// Load from previous annotation results - show selector if multiple images
function loadFromAnnotationResults() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        showToast('No annotation results available', 'error');
        return;
    }
    
    const yoloResults = window.annotationResult.data.yoloResults;
    if (yoloResults.length === 0) {
        showToast('No images with YOLO results', 'error');
        return;
    }
    
    // Show image selector modal
    showImageSelectorModal(yoloResults);
}

// Show modal to select which image to edit
function showImageSelectorModal(yoloResults) {
    // Remove existing modal if any
    const existingModal = document.getElementById('image-selector-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'image-selector-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 24px;
        max-width: 800px; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    `;
    
    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; color: #1a472a;">📋 Select Image to Edit (${yoloResults.length} images)</h3>
            <button onclick="document.getElementById('image-selector-modal').remove()" 
                style="background: #ef4444; color: white; border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 18px;">✕</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;">
            ${yoloResults.map((result, idx) => `
                <div onclick="loadSpecificYoloResult(${idx})" 
                    style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s; text-align: center;"
                    onmouseover="this.style.borderColor='#22c55e'; this.style.background='#f0fdf4';"
                    onmouseout="this.style.borderColor='#e5e7eb'; this.style.background='white';">
                    <div style="font-size: 40px; margin-bottom: 8px;">🖼️</div>
                    <div style="font-size: 12px; font-weight: 600; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${result.originalImage || result.image}
                    </div>
                    <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">
                        ${result.detection_count || result.detections?.length || 0} detections
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Close on backdrop click
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
}

// Load a specific YOLO result by index
function loadSpecificYoloResult(idx) {
    const modal = document.getElementById('image-selector-modal');
    if (modal) modal.remove();
    
    const yoloResults = window.annotationResult.data.yoloResults;
    const result = yoloResults[idx];
    
    if (!result) {
        showToast('Invalid selection', 'error');
        return;
    }
    
    editorState.yoloResultsIndex = idx;
    
    // Reset zoom when loading new image
    editorState.zoom = 1.0;
    updateZoomDisplay();
    
    // Use ORIGINAL image (not the annotated one with boxes burned in)
    const originalImageName = result.originalImage || result.image.replace(/^annotated_/, '');
    const imageUrl = `http://localhost:8080/uploads/${originalImageName}`;
    
    console.log('📥 Loading original image:', originalImageName);
    console.log('📥 Detections:', result.detections);
    
    fetch(imageUrl)
        .then(response => {
            if (!response.ok) {
                // Fallback to current image if original not found
                console.log('⚠️ Original not found, trying:', result.image);
                return fetch(`http://localhost:8080/uploads/${result.image}`);
            }
            return response;
        })
        .then(response => response.blob())
        .then(blob => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById('editor-image');
                img.src = e.target.result;
                
                img.onload = function() {
                    editorState.imageLoaded = true;
                    editorState.imageSrc = e.target.result;
                    editorState.imageName = result.image;
                    editorState.originalImageName = originalImageName;
                    editorState.imageWidth = img.naturalWidth;
                    editorState.imageHeight = img.naturalHeight;
                    
                    // Convert YOLO detections to editor format
                    editorState.detections = (result.detections || []).map((det, i) => ({
                        id: i + 1,
                        class: det.class || det.label || 'unknown',
                        confidence: det.confidence || 1.0,
                        bbox: {
                            x1: det.bbox?.x1 ?? det.x1 ?? 0,
                            y1: det.bbox?.y1 ?? det.y1 ?? 0,
                            x2: det.bbox?.x2 ?? det.x2 ?? 100,
                            y2: det.bbox?.y2 ?? det.y2 ?? 100
                        },
                        isManual: false,
                        isModified: false
                    }));
                    
                    editorState.selectedIndex = null;
                    
                    // Show image info
                    document.getElementById('editor-current-image').style.display = 'block';
                    document.getElementById('editor-image-name').textContent = originalImageName;
                    document.getElementById('editor-image-size').textContent = `${img.naturalWidth} x ${img.naturalHeight}px`;
                    
                    // Show canvas container
                    document.getElementById('editor-canvas-container').style.display = 'block';
                    
                    // Setup SVG and events
                    setTimeout(() => {
                        setupEditorSVG();
                        setupEditorEvents();
                        updateEditorUI();
                        updateNavigationUI(); // Update navigation after loading
                    }, 100);
                    
                    showToast(`Loaded ${editorState.detections.length} detections`, 'success');
                };
            };
            reader.readAsDataURL(blob);
        })
        .catch(error => {
            console.error('Failed to load image:', error);
            showToast('Failed to load image from results', 'error');
        });
}

// Navigate between YOLO images (like LabelImg)
function navigateImage(direction) {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        showToast('No YOLO results to navigate', 'error');
        return;
    }
    
    const yoloResults = window.annotationResult.data.yoloResults;
    const totalImages = yoloResults.length;
    
    if (totalImages === 0) return;
    
    // Save current detections before navigating
    saveCurrentDetections();
    
    // Calculate new index
    const newIndex = editorState.yoloResultsIndex + direction;
    
    // Boundary check
    if (newIndex < 0) {
        showToast('Already at first image', 'info');
        return;
    }
    if (newIndex >= totalImages) {
        showToast('Already at last image', 'info');
        return;
    }
    
    // Load the new image
    loadSpecificYoloResult(newIndex);
    
    // Update navigation UI
    updateNavigationUI();
}

// Save current detections back to YOLO results
function saveCurrentDetections() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) return;
    
    const yoloResults = window.annotationResult.data.yoloResults;
    const currentIdx = editorState.yoloResultsIndex;
    
    if (currentIdx < 0 || currentIdx >= yoloResults.length) return;
    
    // Convert editor detections back to YOLO format
    const updatedDetections = editorState.detections.map(det => ({
        class: det.class,
        label: det.class,
        confidence: det.confidence,
        bbox: {
            x1: det.bbox.x1,
            y1: det.bbox.y1,
            x2: det.bbox.x2,
            y2: det.bbox.y2
        },
        x1: det.bbox.x1,
        y1: det.bbox.y1,
        x2: det.bbox.x2,
        y2: det.bbox.y2,
        isManual: det.isManual,
        isModified: det.isModified
    }));
    
    // Update the YOLO results
    yoloResults[currentIdx].detections = updatedDetections;
    yoloResults[currentIdx].detection_count = updatedDetections.length;
    
    console.log(`💾 Auto-saved ${updatedDetections.length} detections for image ${currentIdx + 1}`);
    
    // Show brief save indicator
    const indicator = document.getElementById('autoSaveIndicator');
    if (indicator) {
        indicator.textContent = '✅ Saved!';
        indicator.style.color = '#22c55e';
        setTimeout(() => {
            indicator.textContent = '💾 Changes auto-saved when navigating';
            indicator.style.color = '#6b7280';
        }, 1000);
    }
}

// Update navigation UI (counter, buttons)
function updateNavigationUI() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        // Hide navigation bar if no results
        const navBar = document.getElementById('editor-navigation-bar');
        if (navBar) navBar.style.display = 'none';
        return;
    }
    
    const yoloResults = window.annotationResult.data.yoloResults;
    const totalImages = yoloResults.length;
    const currentIdx = editorState.yoloResultsIndex;
    
    // Show navigation bar
    const navBar = document.getElementById('editor-navigation-bar');
    if (navBar) navBar.style.display = 'flex';
    
    // Update counter
    const currentNum = document.getElementById('currentImageNum');
    const totalNum = document.getElementById('totalImageNum');
    const imageName = document.getElementById('navImageName');
    
    if (currentNum) currentNum.textContent = currentIdx + 1;
    if (totalNum) totalNum.textContent = totalImages;
    if (imageName) {
        const result = yoloResults[currentIdx];
        imageName.textContent = result?.originalImage || result?.image || '';
    }
    
    // Update button states
    const prevBtn = document.getElementById('prevImageBtn');
    const nextBtn = document.getElementById('nextImageBtn');
    
    if (prevBtn) {
        prevBtn.disabled = currentIdx <= 0;
    }
    if (nextBtn) {
        nextBtn.disabled = currentIdx >= totalImages - 1;
    }
    
    // Update export all section visibility
    updateExportAllSection();
}

// Add keyboard shortcuts for editor
document.addEventListener('keydown', function(e) {
    // Only handle if on manual editor screen and not typing in an input
    const editorScreen = document.getElementById('screen-manual-editor');
    if (!editorScreen || editorScreen.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    // Zoom shortcuts work even without image loaded
    // + or = to zoom in
    if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        zoomEditor(1);
        return;
    }
    // - to zoom out
    if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        zoomEditor(-1);
        return;
    }
    // 0 to reset zoom
    if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        resetZoom();
        return;
    }
    // Ctrl+Plus/Minus for zoom (like browser)
    if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        zoomEditor(1);
        return;
    }
    if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        zoomEditor(-1);
        return;
    }
    
    // Rest of shortcuts require image loaded
    if (!editorState.imageLoaded) return;
    
    // Navigation shortcuts require YOLO results
    const hasYoloResults = window.annotationResult && 
                           window.annotationResult.data && 
                           window.annotationResult.data.yoloResults && 
                           window.annotationResult.data.yoloResults.length > 0;
    
    // Left arrow = previous image (only with YOLO results)
    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && hasYoloResults) {
        e.preventDefault();
        navigateImage(-1);
    }
    // Right arrow = next image (only with YOLO results)
    else if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && hasYoloResults) {
        e.preventDefault();
        navigateImage(1);
    }
    // S = Save current (manual save) - only with YOLO results
    else if (e.key === 's' && (e.ctrlKey || e.metaKey) && hasYoloResults) {
        e.preventDefault();
        saveCurrentDetections();
        showToast('Detections saved', 'success');
    }
    // D = Toggle draw mode
    else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleDrawMode();
    }
    // Delete = Delete selected box
    else if ((e.key === 'Delete' || e.key === 'Backspace') && editorState.selectedIndex !== null) {
        e.preventDefault();
        deleteSelectedBox();
    }
    // Escape = Deselect / Exit draw mode
    else if (e.key === 'Escape') {
        if (editorState.isDrawing) {
            toggleDrawMode();
        } else if (editorState.selectedIndex !== null) {
            editorState.selectedIndex = null;
            renderDetections();
            updateEditorUI();
        }
    }
});

// Zoom functions
function zoomEditor(direction) {
    const newZoom = editorState.zoom + (direction * editorState.zoomStep);
    setZoom(Math.max(editorState.minZoom, Math.min(editorState.maxZoom, newZoom)));
}

function setZoom(level) {
    editorState.zoom = level;
    applyZoom();
    updateZoomDisplay();
}

function resetZoom() {
    editorState.zoom = 1.0;
    applyZoom();
    updateZoomDisplay();
    showToast('Zoom reset to 100%', 'info');
}

function applyZoom() {
    const zoomContainer = document.getElementById('editor-zoom-container');
    if (!zoomContainer) return;
    
    // Apply transform to the container (which holds both image and SVG)
    zoomContainer.style.transform = `scale(${editorState.zoom})`;
    zoomContainer.style.transformOrigin = 'top left';
}

function updateZoomDisplay() {
    const display = document.getElementById('zoom-level-display');
    if (display) {
        display.textContent = `${Math.round(editorState.zoom * 100)}%`;
    }
}

// Mouse wheel zoom on editor canvas
document.addEventListener('wheel', function(e) {
    // Check if we're over the editor canvas
    const wrapper = document.getElementById('editor-canvas-wrapper');
    if (!wrapper) return;
    
    const rect = wrapper.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || 
        e.clientY < rect.top || e.clientY > rect.bottom) {
        return;
    }
    
    // Only zoom with Ctrl/Cmd held (to allow normal scrolling)
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : -1;
        zoomEditor(direction);
    }
}, { passive: false });

// Update the button state when results are available
function checkAnnotationResultsAvailable() {
    const btn = document.getElementById('loadFromAnnotationBtn');
    if (btn) {
        const hasResults = window.annotationResult && 
                          window.annotationResult.data.yoloResults && 
                          window.annotationResult.data.yoloResults.length > 0;
        btn.disabled = !hasResults;
        if (hasResults) {
            btn.textContent = `📋 Load from YOLO Results (${window.annotationResult.data.yoloResults.length})`;
        }
    }
}

// Call this after annotation results are set
const originalDisplayAnnotationResults = displayAnnotationResults;
displayAnnotationResults = function(result) {
    originalDisplayAnnotationResults(result);
    checkAnnotationResultsAvailable();
};

// Setup SVG overlay
function setupEditorSVG() {
    const img = document.getElementById('editor-image');
    const svg = document.getElementById('editor-svg');
    const zoomContainer = document.getElementById('editor-zoom-container');
    
    if (!img || !svg || !zoomContainer) return;
    
    // Wait for image to be rendered
    if (img.naturalWidth === 0) {
        setTimeout(setupEditorSVG, 100);
        return;
    }
    
    // SVG covers the entire image (they're in the same container now)
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = img.naturalWidth + 'px';
    svg.style.height = img.naturalHeight + 'px';
    svg.setAttribute('viewBox', `0 0 ${editorState.imageWidth} ${editorState.imageHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    
    // Set image size explicitly
    img.style.width = img.naturalWidth + 'px';
    img.style.height = img.naturalHeight + 'px';
    
    renderDetections();
}

// Setup all editor events (draw, drag, resize)
function setupEditorEvents() {
    const svg = document.getElementById('editor-svg');
    if (!svg) return;
    
    // Remove existing listeners by cloning
    const newSvg = svg.cloneNode(true);
    svg.parentNode.replaceChild(newSvg, svg);
    
    // Re-render detections on the new SVG
    renderDetections();
}

// Get SVG coordinates from mouse event (accounting for zoom)
function getSVGCoordinates(e, svg) {
    const rect = svg.getBoundingClientRect();
    
    // Account for zoom: the rect is already scaled, so we need to divide by zoom
    // to get the actual SVG coordinates
    const visibleWidth = rect.width;
    const visibleHeight = rect.height;
    
    // The SVG's internal coordinate system is the image's natural size
    const scaleX = editorState.imageWidth / visibleWidth;
    const scaleY = editorState.imageHeight / visibleHeight;
    
    return {
        x: Math.max(0, Math.min((e.clientX - rect.left) * scaleX, editorState.imageWidth)),
        y: Math.max(0, Math.min((e.clientY - rect.top) * scaleY, editorState.imageHeight))
    };
}

// Toggle draw mode
function toggleDrawMode() {
    editorState.isDrawing = !editorState.isDrawing;
    editorState.isDragging = false;
    editorState.isResizing = false;
    
    const btn = document.getElementById('drawModeBtn');
    const indicator = document.getElementById('editor-mode-indicator');
    
    if (editorState.isDrawing) {
        btn.classList.add('active');
        btn.innerHTML = '❌ Cancel Drawing';
        indicator.style.display = 'block';
        editorState.selectedIndex = null;
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '✏️ Draw Box';
        indicator.style.display = 'none';
        editorState.drawStart = null;
        editorState.drawEnd = null;
    }
    
    renderDetections();
    updateSelectedPanel();
}

// Render all detections on SVG with drag/resize handles
function renderDetections() {
    const svg = document.getElementById('editor-svg');
    if (!svg) return;
    
    svg.innerHTML = '';
    
    // Create a group for all elements
    const mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Render existing detections
    editorState.detections.forEach((det, idx) => {
        const isSelected = idx === editorState.selectedIndex;
        const strokeColor = isSelected ? '#22c55e' : (det.isManual ? '#f59e0b' : '#ef4444');
        const strokeWidth = isSelected ? 4 : 2;
        
        const x1 = det.bbox.x1;
        const y1 = det.bbox.y1;
        const x2 = det.bbox.x2;
        const y2 = det.bbox.y2;
        const width = x2 - x1;
        const height = y2 - y1;
        
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-index', idx);
        
        // Bounding box (draggable when selected)
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x1);
        rect.setAttribute('y', y1);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', isSelected ? 'rgba(34, 197, 94, 0.1)' : 'transparent');
        rect.setAttribute('stroke', strokeColor);
        rect.setAttribute('stroke-width', strokeWidth);
        rect.style.cursor = isSelected ? 'move' : 'pointer';
        
        // Click to select
        rect.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!editorState.isDrawing) {
                selectDetection(idx);
            }
        });
        
        // Drag functionality for selected box
        if (isSelected) {
            rect.addEventListener('mousedown', (e) => {
                if (editorState.isDrawing) return;
                e.stopPropagation();
                
                const coords = getSVGCoordinates(e, svg);
                editorState.isDragging = true;
                editorState.dragOffset = {
                    x: coords.x - x1,
                    y: coords.y - y1
                };
            });
        }
        
        group.appendChild(rect);
        
        // Label background
        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const labelWidth = Math.max(100, det.class.length * 9 + 60);
        labelBg.setAttribute('x', x1);
        labelBg.setAttribute('y', Math.max(0, y1 - 28));
        labelBg.setAttribute('width', labelWidth);
        labelBg.setAttribute('height', 26);
        labelBg.setAttribute('fill', strokeColor);
        labelBg.setAttribute('rx', 4);
        group.appendChild(labelBg);
        
        // Label text
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x1 + 6);
        label.setAttribute('y', Math.max(18, y1 - 8));
        label.setAttribute('fill', 'white');
        label.setAttribute('font-size', '16');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('font-family', 'system-ui, sans-serif');
        label.textContent = `${det.class} (${Math.round(det.confidence * 100)}%)`;
        group.appendChild(label);
        
        // Resize handles for selected box
        if (isSelected) {
            const handleSize = 14;
            const handles = [
                { name: 'nw', x: x1 - handleSize/2, y: y1 - handleSize/2 },
                { name: 'ne', x: x2 - handleSize/2, y: y1 - handleSize/2 },
                { name: 'sw', x: x1 - handleSize/2, y: y2 - handleSize/2 },
                { name: 'se', x: x2 - handleSize/2, y: y2 - handleSize/2 }
            ];
            
            handles.forEach(h => {
                const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                handle.setAttribute('x', h.x);
                handle.setAttribute('y', h.y);
                handle.setAttribute('width', handleSize);
                handle.setAttribute('height', handleSize);
                handle.setAttribute('fill', '#22c55e');
                handle.setAttribute('stroke', 'white');
                handle.setAttribute('stroke-width', 2);
                handle.setAttribute('rx', 2);
                handle.style.cursor = `${h.name}-resize`;
                
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    editorState.isResizing = true;
                    editorState.resizeHandle = h.name;
                });
                
                group.appendChild(handle);
            });
        }
        
        mainGroup.appendChild(group);
    });
    
    // Render drawing preview
    if (editorState.isDrawing && editorState.drawStart && editorState.drawEnd) {
        const x1 = Math.min(editorState.drawStart.x, editorState.drawEnd.x);
        const y1 = Math.min(editorState.drawStart.y, editorState.drawEnd.y);
        const width = Math.abs(editorState.drawEnd.x - editorState.drawStart.x);
        const height = Math.abs(editorState.drawEnd.y - editorState.drawStart.y);
        
        const previewRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        previewRect.setAttribute('x', x1);
        previewRect.setAttribute('y', y1);
        previewRect.setAttribute('width', width);
        previewRect.setAttribute('height', height);
        previewRect.setAttribute('fill', 'rgba(34, 197, 94, 0.2)');
        previewRect.setAttribute('stroke', '#22c55e');
        previewRect.setAttribute('stroke-width', 3);
        previewRect.setAttribute('stroke-dasharray', '10,5');
        mainGroup.appendChild(previewRect);
    }
    
    svg.appendChild(mainGroup);
    
    // Add SVG-level event listeners
    svg.onmousedown = (e) => {
        if (editorState.isDrawing) {
            const coords = getSVGCoordinates(e, svg);
            editorState.drawStart = coords;
            editorState.drawEnd = coords;
        }
    };
    
    svg.onmousemove = (e) => {
        const coords = getSVGCoordinates(e, svg);
        
        if (editorState.isDrawing && editorState.drawStart) {
            editorState.drawEnd = coords;
            renderDetections();
        } else if (editorState.isDragging && editorState.selectedIndex !== null) {
            const det = editorState.detections[editorState.selectedIndex];
            const width = det.bbox.x2 - det.bbox.x1;
            const height = det.bbox.y2 - det.bbox.y1;
            
            let newX1 = coords.x - editorState.dragOffset.x;
            let newY1 = coords.y - editorState.dragOffset.y;
            
            // Keep within bounds
            newX1 = Math.max(0, Math.min(newX1, editorState.imageWidth - width));
            newY1 = Math.max(0, Math.min(newY1, editorState.imageHeight - height));
            
            det.bbox.x1 = newX1;
            det.bbox.y1 = newY1;
            det.bbox.x2 = newX1 + width;
            det.bbox.y2 = newY1 + height;
            det.isModified = true;
            
            renderDetections();
        } else if (editorState.isResizing && editorState.selectedIndex !== null) {
            const det = editorState.detections[editorState.selectedIndex];
            
            switch (editorState.resizeHandle) {
                case 'nw':
                    det.bbox.x1 = Math.min(coords.x, det.bbox.x2 - 20);
                    det.bbox.y1 = Math.min(coords.y, det.bbox.y2 - 20);
                    break;
                case 'ne':
                    det.bbox.x2 = Math.max(coords.x, det.bbox.x1 + 20);
                    det.bbox.y1 = Math.min(coords.y, det.bbox.y2 - 20);
                    break;
                case 'sw':
                    det.bbox.x1 = Math.min(coords.x, det.bbox.x2 - 20);
                    det.bbox.y2 = Math.max(coords.y, det.bbox.y1 + 20);
                    break;
                case 'se':
                    det.bbox.x2 = Math.max(coords.x, det.bbox.x1 + 20);
                    det.bbox.y2 = Math.max(coords.y, det.bbox.y1 + 20);
                    break;
            }
            
            // Keep within bounds
            det.bbox.x1 = Math.max(0, det.bbox.x1);
            det.bbox.y1 = Math.max(0, det.bbox.y1);
            det.bbox.x2 = Math.min(editorState.imageWidth, det.bbox.x2);
            det.bbox.y2 = Math.min(editorState.imageHeight, det.bbox.y2);
            
            det.isModified = true;
            renderDetections();
        }
    };
    
    svg.onmouseup = (e) => {
        if (editorState.isDrawing && editorState.drawStart && editorState.drawEnd) {
            const x1 = Math.min(editorState.drawStart.x, editorState.drawEnd.x);
            const y1 = Math.min(editorState.drawStart.y, editorState.drawEnd.y);
            const x2 = Math.max(editorState.drawStart.x, editorState.drawEnd.x);
            const y2 = Math.max(editorState.drawStart.y, editorState.drawEnd.y);
            
            if ((x2 - x1) > 20 && (y2 - y1) > 20) {
                const label = document.getElementById('editor-label-select').value;
                
                editorState.detections.push({
                    id: Date.now(),
                    class: label,
                    confidence: 1.0,
                    bbox: { x1, y1, x2, y2 },
                    isManual: true,
                    isModified: false
                });
                
                editorState.selectedIndex = editorState.detections.length - 1;
                showToast(`Added "${label}" bounding box`, 'success');
            }
            
            editorState.drawStart = null;
            editorState.drawEnd = null;
            toggleDrawMode();
            updateEditorUI();
        }
        
        if (editorState.isDragging) {
            editorState.isDragging = false;
            updateDetectionList();
        }
        
        if (editorState.isResizing) {
            editorState.isResizing = false;
            editorState.resizeHandle = null;
            updateDetectionList();
        }
    };
    
    svg.onmouseleave = () => {
        if (editorState.isDrawing) {
            editorState.drawStart = null;
            editorState.drawEnd = null;
            renderDetections();
        }
        editorState.isDragging = false;
        editorState.isResizing = false;
    };
}

// Select a detection
function selectDetection(idx) {
    if (editorState.isDrawing) return;
    
    editorState.selectedIndex = idx;
    renderDetections();
    updateSelectedPanel();
    updateDetectionList();
}

// Update the selected box panel
function updateSelectedPanel() {
    const panel = document.getElementById('selected-box-panel');
    
    if (editorState.selectedIndex === null || editorState.selectedIndex >= editorState.detections.length) {
        panel.style.display = 'none';
        return;
    }
    
    const det = editorState.detections[editorState.selectedIndex];
    
    panel.style.display = 'block';
    document.getElementById('selected-box-number').textContent = editorState.selectedIndex + 1;
    document.getElementById('selected-box-label').textContent = det.class;
    document.getElementById('selected-box-confidence').textContent = Math.round(det.confidence * 100) + '%';
    document.getElementById('selected-box-type').textContent = det.isManual ? 'Manual' : (det.isModified ? 'Edited' : 'YOLO Detection');
    
    // Render label buttons
    const container = document.getElementById('label-buttons-container');
    container.innerHTML = editorState.availableLabels.map(label => `
        <button class="label-btn ${det.class === label ? 'active' : ''}" onclick="changeSelectedLabel('${label}')">
            ${label}
        </button>
    `).join('');
}

// Change the label of selected detection
function changeSelectedLabel(newLabel) {
    if (editorState.selectedIndex === null) return;
    
    const det = editorState.detections[editorState.selectedIndex];
    det.class = newLabel;
    det.isModified = true;
    
    renderDetections();
    updateSelectedPanel();
    updateDetectionList();
    
    showToast(`Changed label to "${newLabel}"`, 'success');
}

// Delete selected detection
function deleteSelectedBox() {
    if (editorState.selectedIndex === null) return;
    
    const det = editorState.detections[editorState.selectedIndex];
    editorState.detections.splice(editorState.selectedIndex, 1);
    editorState.selectedIndex = null;
    
    renderDetections();
    updateSelectedPanel();
    updateDetectionList();
    updateBoxCount();
    
    showToast(`Deleted "${det.class}" box`, 'success');
}

// Update detection list
function updateDetectionList() {
    const container = document.getElementById('editor-detection-list');
    
    if (editorState.detections.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #9ca3af;">
                <span style="font-size: 40px; display: block; margin-bottom: 12px;">📦</span>
                <span>No bounding boxes yet. Draw some boxes or load from YOLO results!</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = editorState.detections.map((det, idx) => `
        <div class="detection-item ${idx === editorState.selectedIndex ? 'selected' : ''} ${det.isManual ? 'manual' : ''}" onclick="selectDetection(${idx})">
            <div class="detection-index">${idx + 1}</div>
            <div class="detection-class">${det.class}</div>
            <div class="detection-confidence">${Math.round(det.confidence * 100)}%</div>
            ${det.isManual ? '<span class="detection-badge manual">Manual</span>' : ''}
            ${det.isModified && !det.isManual ? '<span class="detection-badge edited">Edited</span>' : ''}
        </div>
    `).join('');
}

// Update box count
function updateBoxCount() {
    const el = document.getElementById('editor-box-count');
    if (el) el.textContent = editorState.detections.length;
}

// Update all editor UI elements
function updateEditorUI() {
    renderDetections();
    updateDetectionList();
    updateSelectedPanel();
    updateBoxCount();
}

// Add custom label
function addCustomLabel() {
    const input = document.getElementById('editor-custom-label');
    const label = input.value.trim();
    
    if (!label) {
        showToast('Please enter a label name', 'error');
        return;
    }
    
    if (editorState.availableLabels.includes(label)) {
        showToast('Label already exists', 'error');
        return;
    }
    
    editorState.availableLabels.push(label);
    
    // Update dropdown
    const select = document.getElementById('editor-label-select');
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    select.appendChild(option);
    select.value = label;
    
    input.value = '';
    
    showToast(`Added label "${label}"`, 'success');
}

// Export annotated image as PNG
function exportAnnotatedPNG() {
    if (!editorState.imageLoaded) {
        showToast('No image loaded', 'error');
        return;
    }
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = editorState.imageWidth;
    canvas.height = editorState.imageHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw image
    const img = document.getElementById('editor-image');
    ctx.drawImage(img, 0, 0);
    
    // Draw detections
    editorState.detections.forEach(det => {
        const x1 = det.bbox.x1;
        const y1 = det.bbox.y1;
        const width = det.bbox.x2 - det.bbox.x1;
        const height = det.bbox.y2 - det.bbox.y1;
        
        // Box
        ctx.strokeStyle = det.isManual ? '#f59e0b' : '#ef4444';
        ctx.lineWidth = 4;
        ctx.strokeRect(x1, y1, width, height);
        
        // Label background
        const labelText = `${det.class} (${Math.round(det.confidence * 100)}%)`;
        ctx.font = 'bold 18px system-ui, sans-serif';
        const textWidth = ctx.measureText(labelText).width + 14;
        ctx.fillStyle = det.isManual ? '#f59e0b' : '#ef4444';
        ctx.fillRect(x1, Math.max(0, y1 - 28), textWidth, 26);
        
        // Label text
        ctx.fillStyle = 'white';
        ctx.fillText(labelText, x1 + 6, Math.max(18, y1 - 8));
    });
    
    // Download
    const link = document.createElement('a');
    link.download = `annotated_${editorState.originalImageName || 'image'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    showToast('Annotated image exported', 'success');
}

// Export annotations as JSON
function exportAnnotationJSONFile() {
    const exportData = {
        image: editorState.originalImageName || editorState.imageName,
        width: editorState.imageWidth,
        height: editorState.imageHeight,
        exported_at: new Date().toISOString(),
        detection_count: editorState.detections.length,
        detections: editorState.detections.map(det => ({
            class: det.class,
            confidence: det.confidence,
            bbox: det.bbox,
            is_manual: det.isManual,
            is_modified: det.isModified
        }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotations_${editorState.originalImageName?.replace(/\.[^/.]+$/, '') || 'image'}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast('Annotations exported as JSON', 'success');
}

// Export in YOLO format
function exportYOLOFormat() {
    if (editorState.detections.length === 0) {
        showToast('No detections to export', 'error');
        return;
    }
    
    // Get unique classes
    const classes = [...new Set(editorState.detections.map(d => d.class))];
    
    // Create YOLO format annotations
    let yoloContent = '';
    
    editorState.detections.forEach(det => {
        const classId = classes.indexOf(det.class);
        const xCenter = ((det.bbox.x1 + det.bbox.x2) / 2) / editorState.imageWidth;
        const yCenter = ((det.bbox.y1 + det.bbox.y2) / 2) / editorState.imageHeight;
        const width = (det.bbox.x2 - det.bbox.x1) / editorState.imageWidth;
        const height = (det.bbox.y2 - det.bbox.y1) / editorState.imageHeight;
        
        yoloContent += `${classId} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}\n`;
    });
    
    // Download annotation file
    const annotBlob = new Blob([yoloContent], { type: 'text/plain' });
    const annotUrl = URL.createObjectURL(annotBlob);
    const annotLink = document.createElement('a');
    annotLink.href = annotUrl;
    annotLink.download = `${editorState.originalImageName?.replace(/\.[^/.]+$/, '') || 'image'}.txt`;
    annotLink.click();
    URL.revokeObjectURL(annotUrl);
    
    // Download classes file
    const classesContent = classes.join('\n');
    const classesBlob = new Blob([classesContent], { type: 'text/plain' });
    const classesUrl = URL.createObjectURL(classesBlob);
    const classesLink = document.createElement('a');
    classesLink.href = classesUrl;
    classesLink.download = 'classes.txt';
    setTimeout(() => classesLink.click(), 500);
    URL.revokeObjectURL(classesUrl);
    
    showToast('YOLO format files exported', 'success');
}

// ==================== EXPORT ALL FUNCTIONS ====================

// Show/hide "Export All" section based on YOLO results availability
function updateExportAllSection() {
    const section = document.getElementById('export-all-section');
    const countSpan = document.getElementById('export-all-count');
    
    if (!section) return;
    
    const hasResults = window.annotationResult && 
                      window.annotationResult.data && 
                      window.annotationResult.data.yoloResults && 
                      window.annotationResult.data.yoloResults.length > 1;
    
    if (hasResults) {
        section.style.display = 'block';
        if (countSpan) {
            countSpan.textContent = window.annotationResult.data.yoloResults.length;
        }
    } else {
        section.style.display = 'none';
    }
}

// Export all images as annotated PNGs in a ZIP file
async function exportAllAnnotatedPNGs() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        showToast('No YOLO results to export', 'error');
        return;
    }
    
    const yoloResults = window.annotationResult.data.yoloResults;
    showToast(`Creating ZIP with ${yoloResults.length} images...`, 'info');
    
    // Save current detections first
    saveCurrentDetections();
    
    // Create ZIP
    const zip = new JSZip();
    const imagesFolder = zip.folder('annotated_images');
    
    let processed = 0;
    
    for (let i = 0; i < yoloResults.length; i++) {
        const result = yoloResults[i];
        const originalImageName = result.originalImage || result.image.replace(/^annotated_/, '');
        
        try {
            // Fetch original image
            const response = await fetch(`http://localhost:8080/uploads/${originalImageName}`);
            if (!response.ok) continue;
            
            const blob = await response.blob();
            const imageBitmap = await createImageBitmap(blob);
            
            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            const ctx = canvas.getContext('2d');
            
            // Draw image
            ctx.drawImage(imageBitmap, 0, 0);
            
            // Draw detections
            const detections = result.detections || [];
            detections.forEach(det => {
                const x1 = det.bbox?.x1 ?? det.x1 ?? 0;
                const y1 = det.bbox?.y1 ?? det.y1 ?? 0;
                const x2 = det.bbox?.x2 ?? det.x2 ?? 100;
                const y2 = det.bbox?.y2 ?? det.y2 ?? 100;
                const width = x2 - x1;
                const height = y2 - y1;
                
                // Box
                ctx.strokeStyle = det.isManual ? '#f59e0b' : '#ef4444';
                ctx.lineWidth = 4;
                ctx.strokeRect(x1, y1, width, height);
                
                // Label background
                const labelText = `${det.class || det.label || 'object'} (${Math.round((det.confidence || 1) * 100)}%)`;
                ctx.font = 'bold 18px system-ui, sans-serif';
                const textWidth = ctx.measureText(labelText).width + 14;
                ctx.fillStyle = det.isManual ? '#f59e0b' : '#ef4444';
                ctx.fillRect(x1, Math.max(0, y1 - 28), textWidth, 26);
                
                // Label text
                ctx.fillStyle = 'white';
                ctx.fillText(labelText, x1 + 6, Math.max(18, y1 - 8));
            });
            
            // Convert canvas to blob and add to ZIP
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const fileName = `annotated_${originalImageName.replace(/\.[^/.]+$/, '')}.png`;
            imagesFolder.file(fileName, pngBlob);
            
            processed++;
            
        } catch (err) {
            console.error(`Failed to process ${originalImageName}:`, err);
        }
    }
    
    // Generate and download ZIP
    showToast('Generating ZIP file...', 'info');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `annotated_images_${new Date().toISOString().slice(0,10)}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showToast(`Exported ${processed} annotated images in ZIP`, 'success');
}

// Export all annotations as JSON files in a ZIP
async function exportAllAnnotationsJSON() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        showToast('No YOLO results to export', 'error');
        return;
    }
    
    // Save current detections first
    saveCurrentDetections();
    
    const yoloResults = window.annotationResult.data.yoloResults;
    
    // Create ZIP
    const zip = new JSZip();
    
    // Add combined JSON file
    const combinedData = {
        project: 'Vineyard Annotation Export',
        exported_at: new Date().toISOString(),
        total_images: yoloResults.length,
        images: yoloResults.map(result => ({
            image: result.originalImage || result.image,
            detection_count: result.detections?.length || 0,
            detections: (result.detections || []).map(det => ({
                class: det.class || det.label,
                confidence: det.confidence,
                bbox: {
                    x1: det.bbox?.x1 ?? det.x1,
                    y1: det.bbox?.y1 ?? det.y1,
                    x2: det.bbox?.x2 ?? det.x2,
                    y2: det.bbox?.y2 ?? det.y2
                },
                is_manual: det.isManual || false,
                is_modified: det.isModified || false
            }))
        }))
    };
    
    zip.file('all_annotations.json', JSON.stringify(combinedData, null, 2));
    
    // Add individual JSON files in a folder
    const jsonFolder = zip.folder('individual_annotations');
    yoloResults.forEach(result => {
        const imageName = (result.originalImage || result.image).replace(/\.[^/.]+$/, '');
        const imageData = {
            image: result.originalImage || result.image,
            detection_count: result.detections?.length || 0,
            detections: (result.detections || []).map(det => ({
                class: det.class || det.label,
                confidence: det.confidence,
                bbox: {
                    x1: det.bbox?.x1 ?? det.x1,
                    y1: det.bbox?.y1 ?? det.y1,
                    x2: det.bbox?.x2 ?? det.x2,
                    y2: det.bbox?.y2 ?? det.y2
                },
                is_manual: det.isManual || false,
                is_modified: det.isModified || false
            }))
        };
        jsonFolder.file(`${imageName}.json`, JSON.stringify(imageData, null, 2));
    });
    
    // Generate and download ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `annotations_json_${new Date().toISOString().slice(0,10)}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showToast(`Exported JSON annotations for ${yoloResults.length} images`, 'success');
}

// Export all annotations in YOLO format as a ZIP
async function exportAllYOLOFormat() {
    if (!window.annotationResult || !window.annotationResult.data.yoloResults) {
        showToast('No YOLO results to export', 'error');
        return;
    }
    
    // Save current detections first
    saveCurrentDetections();
    
    const yoloResults = window.annotationResult.data.yoloResults;
    
    // Collect all unique classes across all images
    const allClasses = new Set();
    yoloResults.forEach(result => {
        (result.detections || []).forEach(det => {
            allClasses.add(det.class || det.label || 'object');
        });
    });
    const classes = [...allClasses];
    
    // Create ZIP
    const zip = new JSZip();
    const labelsFolder = zip.folder('labels');
    
    // Add classes.txt
    zip.file('classes.txt', classes.join('\n'));
    
    // Add YOLO annotation files
    yoloResults.forEach(result => {
        const imageName = (result.originalImage || result.image).replace(/\.[^/.]+$/, '');
        const detections = result.detections || [];
        
        // Get image dimensions
        const imgWidth = result.imageWidth || 4000;
        const imgHeight = result.imageHeight || 3000;
        
        let yoloContent = '';
        detections.forEach(det => {
            const classId = classes.indexOf(det.class || det.label || 'object');
            const x1 = det.bbox?.x1 ?? det.x1 ?? 0;
            const y1 = det.bbox?.y1 ?? det.y1 ?? 0;
            const x2 = det.bbox?.x2 ?? det.x2 ?? 100;
            const y2 = det.bbox?.y2 ?? det.y2 ?? 100;
            
            const xCenter = ((x1 + x2) / 2) / imgWidth;
            const yCenter = ((y1 + y2) / 2) / imgHeight;
            const width = (x2 - x1) / imgWidth;
            const height = (y2 - y1) / imgHeight;
            
            yoloContent += `${classId} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}\n`;
        });
        
        labelsFolder.file(`${imageName}.txt`, yoloContent);
    });
    
    // Generate and download ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `yolo_annotations_${new Date().toISOString().slice(0,10)}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showToast(`Exported YOLO annotations for ${yoloResults.length} images`, 'success');
}

// Handle window resize for SVG
window.addEventListener('resize', () => {
    if (editorState.imageLoaded) {
        setTimeout(setupEditorSVG, 100);
    }
});
