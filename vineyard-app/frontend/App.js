
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import FlightPathMap from './FlightPathMap';

const BACKEND_PORT = 5000;

export default function App() {
  const [backendIP, setBackendIP] = useState('10.209.168.211');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedLogFile, setSelectedLogFile] = useState(null); // Keep for backward compatibility
  const [selectedLogFiles, setSelectedLogFiles] = useState([]); // NEW: Support multiple log files
  const [analysisType, setAnalysisType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [results, setResults] = useState(null);
  const [showIPConfig, setShowIPConfig] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [rowsGeojson, setRowsGeojson] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [clusteringMethod, setClusteringMethod] = useState('kmeans');
  const [annotationImages, setAnnotationImages] = useState([]); // NEW: for image annotation
  const [yoloIndustry, setYoloIndustry] = useState('agriculture'); // YOLO industry mode
  const [yoloConfidence, setYoloConfidence] = useState(0.25); // YOLO confidence threshold
  const [enableAutoAnnotation, setEnableAutoAnnotation] = useState(true); // Toggle YOLO
  const [yoloResults, setYoloResults] = useState(null); // YOLO detection results
  const [currentAnnotationIndex, setCurrentAnnotationIndex] = useState(0); // Current image being reviewed
  
  // Progress tracking for batch processing
  const [processingProgress, setProcessingProgress] = useState({
    current: 0,
    total: 0,
    percentage: 0,
    currentFile: '',
    startTime: null,
    estimatedTimeRemaining: null,
  });

  const BACKEND_URL = `http://${backendIP}:${BACKEND_PORT}/api`;

  useEffect(() => {
    checkBackendHealth();
  }, [backendIP]);

  const checkBackendHealth = async () => {
    console.log('🔍 Checking backend health at:', `http://${backendIP}:${BACKEND_PORT}/api/health`);
    try {
      const response = await axios.get(`http://${backendIP}:${BACKEND_PORT}/api/health`, {
        timeout: 3000,
      });
      console.log('✅ Backend health response:', response.data);
      if (response.data.status === 'Backend running') {
        setBackendStatus('connected');
      } else {
        setBackendStatus('disconnected');
      }
    } catch (error) {
      console.error('❌ Backend health check failed:', error.message);
      setBackendStatus('disconnected');
    }
  };

  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Pick DJI Log File
  const pickDJILogFile = async () => {
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.dat,.log';
        input.multiple = true; // Enable multiple file selection
        input.onchange = (e) => {
          const files = Array.from(e.target.files);
          const processedFiles = files.map(file => ({
            uri: URL.createObjectURL(file),
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            file: file // Keep reference for FormData
          }));
          
          // Also set first as selectedLogFile for backward compatibility
          if (processedFiles.length > 0) {
            setSelectedLogFile(processedFiles[0]);
            setSelectedLogFiles(processedFiles);
          }
        };
        input.click();
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/plain', 'application/octet-stream'],
          copyToCacheDirectory: true,
          multiple: true,
        });

        if (!result.canceled && result.assets) {
          setSelectedLogFile(result.assets[0]); // Backward compatibility
          setSelectedLogFiles(result.assets);
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick log file: ' + error.message);
    }
  };

  // NEW: Pick images for annotation
  const pickAnnotationImages = async () => {
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tif,.tiff,.jpg,.jpeg,.png';
        input.multiple = true;
        input.onchange = (e) => {
          const files = Array.from(e.target.files);
          const processedFiles = files.map(file => ({
            uri: URL.createObjectURL(file),
            name: file.name,
            type: file.type || 'image/tiff',
            file: file // Keep reference to actual file for FormData
          }));
          setAnnotationImages(prev => [...prev, ...processedFiles]);
        };
        input.click();
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 1,
        });

        if (!result.canceled) {
          setAnnotationImages(prev => [...prev, ...result.assets]);
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick images: ' + error.message);
    }
  };

  // NEW: Remove annotation image
  const removeAnnotationImage = (index) => {
    setAnnotationImages(annotationImages.filter((_, i) => i !== index));
  };

  // YOLO AUTO-ANNOTATION FUNCTION
  const runYoloAutoAnnotation = async (metadataAnnotations, annotatedImagePaths) => {
    try {
      console.log('🤖 Running YOLO auto-annotation...');
      console.log(`Industry: ${yoloIndustry}, Confidence: ${yoloConfidence}`);
      console.log(`Annotated images: ${annotatedImagePaths?.length || 0}`);

      // Send image paths instead of files (they're already on server)
      const imagePaths = annotatedImagePaths.map(img => img.filename);
      
      const requestData = {
        imagePaths: imagePaths,
        industry: yoloIndustry,
        confidence: yoloConfidence,
      };

      console.log('📡 Sending to YOLO endpoint:', `${BACKEND_URL}/auto-annotate`);

      // Reset progress for YOLO phase
      setProcessingProgress({
        current: 0,
        total: imagePaths.length,
        percentage: 0,
        currentFile: 'Running YOLO detection...',
        startTime: Date.now(),
        estimatedTimeRemaining: null,
      });

      // Simulate progress during YOLO processing (3 seconds per image estimate)
      const yoloProgressInterval = setInterval(() => {
        setProcessingProgress(prev => {
          if (prev.percentage >= 95) return prev;
          const elapsed = Date.now() - prev.startTime;
          const avgTimePerImage = 3000; // 3 seconds per image for YOLO
          const estimatedTotal = avgTimePerImage * prev.total;
          const remaining = Math.max(0, estimatedTotal - elapsed);
          const estimatedCurrent = Math.min(prev.total, Math.floor(elapsed / avgTimePerImage));
          
          return {
            ...prev,
            current: estimatedCurrent,
            percentage: Math.min(95, Math.floor((estimatedCurrent / prev.total) * 100)),
            currentFile: `YOLO detecting objects (${estimatedCurrent}/${prev.total})...`,
            estimatedTimeRemaining: remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : '< 1s',
          };
        });
      }, 1000);

      const yoloResponse = await axios.post(
        `${BACKEND_URL}/auto-annotate`,
        requestData,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 600000,
        }
      );

      clearInterval(yoloProgressInterval);

      // Complete YOLO progress
      setProcessingProgress(prev => ({
        ...prev,
        current: prev.total,
        percentage: 100,
        currentFile: 'YOLO complete!',
        estimatedTimeRemaining: null,
      }));

      console.log('✅ YOLO auto-annotation complete');
      console.log(`🎯 Detected objects in ${yoloResponse.data.processed} images`);

      // Combine metadata annotations with YOLO results
      const combinedResults = {
        ...metadataAnnotations,
        yoloAnnotations: yoloResponse.data.results,
        yoloSettings: {
          industry: yoloIndustry,
          confidence: yoloConfidence,
        },
      };

      setYoloResults(yoloResponse.data.results);
      setResults({ 
        type: 'image-annotation-with-yolo', 
        data: { 
          annotations: metadataAnnotations,
          yoloResults: yoloResponse.data.results,
          totalImages: metadataAnnotations.length,
        } 
      });
      setSelectedLogFile(null);
      setSelectedLogFiles([]);
      setAnnotationImages([]);
      setLoading(false);

    } catch (error) {
      console.error('❌ YOLO auto-annotation failed:', error);
      showAlert(
        'YOLO Annotation Failed',
        'Failed to run auto-annotation. Continuing with metadata only.\n\n' + 
        (error.response?.data?.error || error.message)
      );
      // Continue with metadata-only results
      setResults({ type: 'image-annotation', data: { annotations: metadataAnnotations } });
      setSelectedLogFile(null);
      setSelectedLogFiles([]);
      setAnnotationImages([]);
      setLoading(false);
    }
  };

  // Update or add manual annotation
  const updateManualAnnotation = async (imageName, detections, manualCorrections) => {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/annotations/${imageName}/update`,
        {
          detections: detections,
          manual_corrections: manualCorrections,
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data.success) {
        showAlert('Success', 'Annotations updated successfully');
        // Update local state
        if (yoloResults) {
          const updated = yoloResults.map(r => 
            r.image === imageName ? { ...r, annotations: response.data.annotations } : r
          );
          setYoloResults(updated);
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to update annotations: ' + error.message);
    }
  };

  // Export annotations
  const exportAnnotations = async (format = 'coco') => {
    try {
      const response = await axios.get(
        `${BACKEND_URL}/export-annotations?format=${format}`,
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `annotations_${format}_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      showAlert('Success', `Annotations exported in ${format.toUpperCase()} format`);
    } catch (error) {
      showAlert('Error', 'Failed to export annotations: ' + error.message);
    }
  };

  const generateTrainingDatasetJSON = async (dataToUse = null) => {
    const data = dataToUse || results?.data;
    
    if (!data?.yoloResults || !data?.annotations) {
      showAlert('Error', 'No annotation data available. Please provide valid annotation results.');
      return;
    }

    try {
      setLoading(true);
      console.log('📦 Generating training dataset JSON...');

      const response = await axios.post(
        `${BACKEND_URL}/generate-training-dataset`,
        {
          yoloResults: data.yoloResults,
          gpsAnnotations: data.annotations,
          totalImages: data.totalImages || data.yoloResults.length,
          industry: data.industry || yoloIndustry,
          confidence: data.confidence || yoloConfidence
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );

      // Download the JSON file
      const jsonStr = JSON.stringify(response.data.dataset, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `training_dataset_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setLoading(false);
      showAlert(
        'Success',
        `Training dataset JSON generated!\n\nTotal images: ${response.data.dataset.image_stats.total_images}\nObjects: ${response.data.dataset.image_stats.total_objects}`
      );
    } catch (error) {
      setLoading(false);
      console.error('❌ Training dataset generation failed:', error);
      showAlert('Error', 'Failed to generate training dataset: ' + error.message);
    }
  };

  // DOWNLOAD FUNCTIONS
  const downloadJSON = () => {
    const jsonStr = JSON.stringify(results.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${results.type}_analysis_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showAlert('Success', 'JSON file downloaded!');
  };

  const downloadCSV = () => {
    let csvContent = '';

    if (results.type === 'drone') {
      csvContent = 'Filename,Healthy %,Stressed %,Bare Soil %,Total Vegetation %,VARI,ExG,ExGR\n';
      results.data.results?.forEach(img => {
        if (!img.error && img.analysis) {
          const h = img.analysis.health_analysis;
          const i = img.analysis.indices;
          csvContent += `"${img.image}",${h.healthy_percent},${h.stressed_percent},${h.bare_soil_percent},${h.vegetation_cover},${i.vari_mean},${i.exg_mean},${i.exgr_mean}\n`;
        }
      });
    } else if (results.type === 'orthophoto') {
      csvContent = 'Filename,Gaps Detected,Gap Area (m²),Rows Analyzed,Rows with Gaps\n';
      if (results.data.details) {
        results.data.details.forEach(detail => {
          csvContent += `"${detail.filename}",${detail.gaps_detected},${detail.gap_area_m2},${results.data.rows_analyzed},${results.data.rows_with_gaps}\n`;
        });
      }
    } else if (results.type === 'dji-log') {
      csvContent = 'Timestamp,Latitude,Longitude,Altitude,Relative Altitude\n';
      results.data.flightPath.forEach(point => {
        csvContent += `"${point.timestamp}",${point.latitude},${point.longitude},${point.altitude},${point.relativeAltitude}\n`;
      });
    } else if (results.type === 'image-annotation') {
      // Use the pre-generated CSV from backend
      csvContent = results.data.csvData;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${results.type}_analysis_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showAlert('Success', 'CSV file downloaded!');
  };

  const downloadReport = () => {
    let reportContent = '';
    const timestamp = new Date().toLocaleString();

    reportContent += '╔══════════════════════════════════════════════════════════╗\n';

    if (results.type === 'dji-log') {
      reportContent += '           DJI FLIGHT LOG ANALYSIS REPORT\n';
    } else if (results.type === 'image-annotation') {
      reportContent += '           IMAGE ANNOTATION REPORT\n';
    } else {
      reportContent += '           VINEYARD ANALYSIS REPORT\n';
    }

    reportContent += '╚══════════════════════════════════════════════════════════╝\n\n';

    if (results.type === 'image-annotation') {
      reportContent += `Generated: ${timestamp}\n`;
      reportContent += `Total Images Annotated: ${results.data.totalImages}\n`;
      reportContent += `Flight Records Used: ${results.data.totalFlightRecords}\n\n`;

      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += 'ANNOTATED IMAGES\n';
      reportContent += '────────────────────────────────────────────────────────────\n\n';

      results.data.annotations.forEach((ann, idx) => {
        reportContent += `${idx + 1}. ${ann.imageName}\n`;
        reportContent += `   Match Method: ${ann.matchMethod}\n`;
        reportContent += `   GPS: ${ann.gps.latitude}, ${ann.gps.longitude}\n`;
        reportContent += `   Altitude: ${ann.gps.altitude}m | Height: ${ann.gps.height}m\n`;
        reportContent += `   Orientation: Pitch=${ann.orientation.pitch}° Roll=${ann.orientation.roll}° Yaw=${ann.orientation.yaw}°\n`;
        reportContent += `   Gimbal: Pitch=${ann.gimbal.pitch}° Roll=${ann.gimbal.roll}° Yaw=${ann.gimbal.yaw}°\n`;
        reportContent += `   Speed: H=${ann.speed.horizontal}m/s V=${ann.speed.zSpeed}m/s\n`;
        reportContent += `   Battery: ${ann.battery.level}%\n\n`;
      });
    } else if (results.type === 'dji-log') {
      reportContent += `File Name: ${results.data.fileName}\n`;
      reportContent += `Generated: ${timestamp}\n\n`;

      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += 'FLIGHT SUMMARY\n';
      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += `Total Records: ${results.data.summary.totalRecords}\n`;
      reportContent += `Duration: ${results.data.summary.duration}\n`;
      reportContent += `Start Time: ${results.data.summary.startTime}\n`;
      reportContent += `End Time: ${results.data.summary.endTime}\n\n`;

      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += 'FLIGHT STATISTICS\n';
      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += `Max Altitude: ${results.data.statistics.maxAltitude}m\n`;
      reportContent += `Max Speed: ${results.data.statistics.maxSpeed}m/s\n`;
      reportContent += `Total Distance: ${results.data.statistics.totalDistance}m\n`;
      reportContent += `Average Speed: ${results.data.statistics.avgSpeed}m/s\n\n`;

      reportContent += '────────────────────────────────────────────────────────────\n';
      reportContent += 'FLIGHT PATH SAMPLE (First 10 points)\n';
      reportContent += '────────────────────────────────────────────────────────────\n';
      results.data.flightPath.slice(0, 10).forEach((point, idx) => {
        reportContent += `${idx + 1}. ${point.timestamp}\n`;
        reportContent += `   Lat: ${point.latitude}, Lon: ${point.longitude}\n`;
        reportContent += `   Alt: ${point.altitude}m, Rel Alt: ${point.relativeAltitude}m\n\n`;
      });
    } else {
      reportContent += `Analysis Type: ${results.type === 'drone' ? 'Drone Image Analysis' : 'Orthophoto Gap Detection'}\n`;
      reportContent += `Generated: ${timestamp}\n\n`;

      if (results.type === 'drone') {
        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += 'RGB VEGETATION HEALTH ANALYSIS\n';
        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += `Total Images Analyzed: ${results.data.processed}\n\n`;

        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += 'DETAILED RESULTS\n';
        reportContent += '────────────────────────────────────────────────────────────\n\n';

        results.data.results?.forEach((img, idx) => {
          if (!img.error && img.analysis) {
            reportContent += `${idx + 1}. ${img.image}\n`;
            reportContent += `   Health Analysis:\n`;
            reportContent += `     - Healthy Vegetation: ${img.analysis.health_analysis.healthy_percent}%\n`;
            reportContent += `     - Stressed Vegetation: ${img.analysis.health_analysis.stressed_percent}%\n`;
            reportContent += `     - Bare Soil: ${img.analysis.health_analysis.bare_soil_percent}%\n`;
            reportContent += `     - Total Vegetation Cover: ${img.analysis.health_analysis.vegetation_cover}%\n`;
            reportContent += `   Vegetation Indices:\n`;
            reportContent += `     - VARI: ${img.analysis.indices.vari_mean}\n`;
            reportContent += `     - ExG: ${img.analysis.indices.exg_mean}\n`;
            reportContent += `     - ExGR: ${img.analysis.indices.exgr_mean}\n`;
            reportContent += `   Image Size: ${img.analysis.image_size.width}x${img.analysis.image_size.height}\n\n`;
          }
        });
      } else {
        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += 'SUMMARY\n';
        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += `Total Gaps Detected: ${results.data.detected_gaps}\n`;
        reportContent += `Total Gap Area: ${Math.round(results.data.total_gap_area_m2)} m²\n`;
        reportContent += `Rows Analyzed: ${results.data.rows_analyzed}\n`;
        reportContent += `Rows with Gaps: ${results.data.rows_with_gaps}\n\n`;

        if (results.data.details && results.data.details.length > 0) {
          reportContent += '────────────────────────────────────────────────────────────\n';
          reportContent += 'DETAILED RESULTS\n';
          reportContent += '────────────────────────────────────────────────────────────\n\n';

          results.data.details.forEach((detail, idx) => {
            reportContent += `${idx + 1}. ${detail.filename}\n`;
            reportContent += `   Gaps Detected: ${detail.gaps_detected}\n`;
            reportContent += `   Gap Area: ${Math.round(detail.gap_area_m2)} m²\n\n`;
          });
        }
      }
    }

    reportContent += '╔══════════════════════════════════════════════════════════╗\n';
    reportContent += 'END OF REPORT\n';
    reportContent += '╚══════════════════════════════════════════════════════════╝\n';

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${results.type}_report_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showAlert('Success', 'Report downloaded!');
  };

  const pickImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: analysisType === 'drone',
        quality: 0.8,
        base64: Platform.OS === 'web',
      });

      if (!result.canceled) {
        if (analysisType === 'drone') {
          setSelectedImages([...selectedImages, ...result.assets]);
        } else {
          setSelectedImages(result.assets);
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick images: ' + error.message);
    }
  };

  const pickRowsGeojson = async () => {
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.geojson,.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              setRowsGeojson({
                uri: event.target.result,
                name: file.name,
                type: 'application/geo+json'
              });
            };
            reader.readAsDataURL(file);
          }
        };
        input.click();
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 1,
        });

        if (!result.canceled) {
          setRowsGeojson(result.assets[0]);
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick GeoJSON file: ' + error.message);
    }
  };

  const removeImage = (index) => {
    setSelectedImages(selectedImages.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🔥 ANALYZE BUTTON CLICKED');
    console.log('='.repeat(60));

    // Validation checks
    if (analysisType === 'dji-log' && !selectedLogFile) {
      showAlert('Error', 'Please select a DJI log file');
      return;
    }

    // NEW: Validation for image annotation
    if (analysisType === 'image-annotation') {
      if (selectedLogFiles.length === 0) {
        showAlert('Error', 'Please select at least one DJI log file');
        return;
      }
      if (annotationImages.length === 0) {
        showAlert('Error', 'Please select at least one image to annotate');
        return;
      }
    }

    if (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && selectedImages.length === 0) {
      showAlert('Error', 'Please select at least one image');
      return;
    }

    if (backendStatus !== 'connected') {
      showAlert(
        'Backend Not Running',
        `Please start the backend server:\n\n` +
        `1. Open terminal in backend folder\n` +
        `2. Run: npm start\n` +
        `3. Wait for "Server running on http://localhost:5000"\n` +
        `4. Return here and try again`
      );
      return;
    }

    setLoading(true);
    
    // Reset and initialize progress tracking
    const totalFiles = analysisType === 'image-annotation' ? annotationImages.length : 
                       (analysisType === 'dji-log' ? 1 : selectedImages.length);
    
    setProcessingProgress({
      current: 0,
      total: totalFiles,
      percentage: 0,
      currentFile: 'Starting...',
      startTime: Date.now(),
      estimatedTimeRemaining: null,
    });

    try {
      const formData = new FormData();

      // ===================================================================
      // IMAGE ANNOTATION - NEW
      // ===================================================================
      if (analysisType === 'image-annotation') {
        console.log('📸 Processing image annotation...');
        console.log('📄 Log files:', selectedLogFiles.length);
        console.log('🖼️ Images:', annotationImages.length);

        // Add ALL log files
        for (let i = 0; i < selectedLogFiles.length; i++) {
          const logFile = selectedLogFiles[i];
          
          if (Platform.OS === 'web') {
            const response = await fetch(logFile.uri);
            const blob = await response.blob();
            formData.append('logFile', blob, logFile.name);
          } else {
            formData.append('logFile', {
              uri: logFile.uri,
              type: logFile.type || 'application/octet-stream',
              name: logFile.name,
            });
          }
        }

        // Add images
        for (let i = 0; i < annotationImages.length; i++) {
          const img = annotationImages[i];
          
          // Update progress
          setProcessingProgress(prev => ({
            ...prev,
            current: i + 1,
            percentage: Math.round(((i + 1) / annotationImages.length) * 50), // 0-50% for upload
            currentFile: img.name || `image_${i}.tif`,
          }));

          if (Platform.OS === 'web') {
            // Use the file reference if available (from input element)
            if (img.file) {
              formData.append('images', img.file, img.name);
            } else {
              const response = await fetch(img.uri);
              const blob = await response.blob();
              formData.append('images', blob, img.name || `image_${i}.tif`);
            }
          } else {
            formData.append('images', {
              uri: img.uri,
              type: img.type || 'image/tiff',
              name: img.name || `image_${i}.tif`,
            });
          }
        }

        console.log('📡 Sending request to:', `${BACKEND_URL}/annotate-images`);
        
        // Update progress: processing phase (50-100%)
        setProcessingProgress(prev => ({
          ...prev,
          percentage: 50,
          currentFile: 'Processing on server...',
        }));
        
        // Start a simulated progress update while waiting for backend
        const progressInterval = setInterval(() => {
          setProcessingProgress(prev => {
            if (prev.percentage >= 95) return prev; // Cap at 95% until complete
            const elapsed = Date.now() - prev.startTime;
            const avgTimePerImage = 2000; // Estimate 2 seconds per image for annotation
            const estimatedTotal = avgTimePerImage * prev.total;
            const remaining = Math.max(0, estimatedTotal - elapsed);
            
            return {
              ...prev,
              percentage: Math.min(95, prev.percentage + 5),
              estimatedTimeRemaining: remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : null,
            };
          });
        }, 2000); // Update every 2 seconds

        const response = await axios.post(
          `${BACKEND_URL}/annotate-images`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 600000, // 10 minutes for large batches
          }
        );
        
        clearInterval(progressInterval);
        
        // Complete progress
        setProcessingProgress(prev => ({
          ...prev,
          percentage: 100,
          currentFile: 'Complete!',
        }));

        console.log('✅ Image annotation complete');
        
        // If YOLO auto-annotation is enabled, run it next
        if (enableAutoAnnotation && response.data.data.annotations && response.data.data.annotatedImages) {
          console.log('🤖 Starting YOLO auto-annotation...');
          await runYoloAutoAnnotation(response.data.data.annotations, response.data.data.annotatedImages);
        } else {
          setResults({ type: 'image-annotation', data: response.data.data });
          setSelectedLogFile(null);
          setSelectedLogFiles([]);
          setAnnotationImages([]);
        }

        // ===================================================================
        // DJI LOG PARSING
        // ===================================================================
      } else if (analysisType === 'dji-log') {
        console.log('📄 Processing DJI log file...');

        if (Platform.OS === 'web') {
          const response = await fetch(selectedLogFile.uri);
          const blob = await response.blob();
          formData.append('logFile', blob, selectedLogFile.name);
        } else {
          formData.append('logFile', {
            uri: selectedLogFile.uri,
            type: selectedLogFile.type || 'application/octet-stream',
            name: selectedLogFile.name,
          });
        }

        console.log('📡 Sending request to:', `${BACKEND_URL}/parse-dji-log`);

        const response = await axios.post(
          `${BACKEND_URL}/parse-dji-log`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
          }
        );

        console.log('✅ DJI log parsed successfully');
        setResults({ type: 'dji-log', data: response.data.data });
        setSelectedLogFile(null);

        // ===================================================================
        // DRONE IMAGE ANALYSIS
        // ===================================================================
      } else if (analysisType === 'drone') {
        console.log('📷 Processing', selectedImages.length, 'drone images...');

        for (let i = 0; i < selectedImages.length; i++) {
          const img = selectedImages[i];
          
          // Extract original filename - try multiple sources
          let fileName = img.fileName || img.name;
          
          // Fallback: extract from URI if available
          if (!fileName && img.uri) {
            const uriParts = img.uri.split('/');
            fileName = uriParts[uriParts.length - 1].split('#')[0].split('?')[0];
          }
          
          // Clean filename - keep original structure
          const cleanName = fileName || `drone_image_${i + 1}.jpg`;
          
          console.log(`📸 Image ${i + 1}: ${cleanName}`);
          
          // Update progress
          setProcessingProgress(prev => {
            const percentage = Math.round(((i + 1) / selectedImages.length) * 50); // 0-50% for upload
            return {
              ...prev,
              current: i + 1,
              percentage,
              currentFile: cleanName,
            };
          });

          if (Platform.OS === 'web') {
            const response = await fetch(img.uri);
            const blob = await response.blob();
            formData.append('images', blob, cleanName);
          } else {
            formData.append('images', {
              uri: img.uri,
              type: img.type || 'image/jpeg',
              name: cleanName,
            });
          }
        }

        console.log('📡 Sending request to:', `${BACKEND_URL}/analyze-drone`);
        
        // Update progress: processing phase (50-100%)
        setProcessingProgress(prev => ({
          ...prev,
          percentage: 50,
          currentFile: 'Analyzing RGB vegetation health...',
        }));
        
        // Start a simulated progress update while waiting for backend
        const progressInterval = setInterval(() => {
          setProcessingProgress(prev => {
            if (prev.percentage >= 95) return prev; // Cap at 95% until complete
            const elapsed = Date.now() - prev.startTime;
            const avgTimePerImage = 3000; // Estimate 3 seconds per image
            const estimatedTotal = avgTimePerImage * prev.total;
            const remaining = Math.max(0, estimatedTotal - elapsed);
            
            return {
              ...prev,
              percentage: Math.min(95, prev.percentage + 5),
              estimatedTimeRemaining: remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : null,
            };
          });
        }, 2000); // Update every 2 seconds

        const response = await axios.post(
          `${BACKEND_URL}/analyze-drone`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
          }
        );
        
        clearInterval(progressInterval);
        
        // Complete progress
        setProcessingProgress(prev => ({
          ...prev,
          percentage: 100,
          currentFile: 'Complete!',
          estimatedTimeRemaining: null,
        }));

        console.log('✅ Drone images analyzed successfully');
        console.log('Response data:', response.data);
        setResults({ type: 'drone', data: response.data });
        setSelectedImages([]);

        // ===================================================================
        // ORTHOPHOTO ANALYSIS
        // ===================================================================
      } else {
        console.log('🗺️ Processing orthophoto...');

        const img = selectedImages[0];

        // Append orthophoto image
        if (Platform.OS === 'web') {
          const response = await fetch(img.uri);
          const blob = await response.blob();
          formData.append('orthophoto', blob, `orthophoto_${Date.now()}.tif`);
        } else {
          formData.append('orthophoto', {
            uri: img.uri,
            type: 'image/tiff',
            name: `orthophoto_${Date.now()}.tif`,
          });
        }

        // *** CRITICAL: ADD CLUSTERING METHOD ***
        formData.append('method', clusteringMethod);
        console.log('🎯 Clustering method selected:', clusteringMethod);

        // Append rows GeoJSON if provided
        if (rowsGeojson) {
          console.log('📍 Adding rows GeoJSON...');

          if (Platform.OS === 'web') {
            const response = await fetch(rowsGeojson.uri);
            const blob = await response.blob();
            formData.append('rows_geojson', blob, rowsGeojson.name || 'rows.geojson');
          } else {
            formData.append('rows_geojson', {
              uri: rowsGeojson.uri,
              type: 'application/geo+json',
              name: rowsGeojson.name || 'rows.geojson',
            });
          }
        } else {
          console.log('ℹ️ No rows GeoJSON provided (using default path)');
        }

        console.log('📡 Sending request to:', `${BACKEND_URL}/analyze-orthophoto`);
        console.log('📤 FormData contents:');
        console.log('   - orthophoto: included');
        console.log('   - method:', clusteringMethod);
        console.log('   - rows_geojson:', rowsGeojson ? 'included' : 'not included');

        const response = await axios.post(
          `${BACKEND_URL}/analyze-orthophoto`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
          }
        );

        console.log('✅ Orthophoto analyzed successfully');
        console.log('📊 Method used:', response.data.data.method);

        setResults({ type: 'orthophoto', data: response.data.data });
        setSelectedImages([]);
        setRowsGeojson(null);
      }

    } catch (error) {
      console.error('❌ ANALYSIS ERROR:', error);

      if (error.response) {
        console.error('Server response:', error.response.data);
        console.error('Status code:', error.response.status);
      } else if (error.request) {
        console.error('No response received from server');
      } else {
        console.error('Error setting up request:', error.message);
      }

      showAlert(
        'Analysis Failed',
        error.response?.data?.error ||
        error.response?.data?.details ||
        error.message ||
        'Connection failed. Please check if the backend is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  const resetApp = () => {
    setResults(null);
    setAnalysisType(null);
    setSelectedImages([]);
    setSelectedLogFile(null);
    setRowsGeojson(null);
    setAnnotationImages([]);
  };

  const BackendStatusBadge = () => (
    <View style={styles.statusBadge}>
      <View style={[
        styles.statusDot,
        backendStatus === 'connected' && styles.statusDotConnected,
        backendStatus === 'disconnected' && styles.statusDotDisconnected,
        backendStatus === 'checking' && styles.statusDotChecking,
      ]} />
      <Text style={styles.statusText}>
        {backendStatus === 'connected' && 'Backend Online'}
        {backendStatus === 'disconnected' && 'Backend Offline'}
        {backendStatus === 'checking' && 'Checking...'}
      </Text>
      <TouchableOpacity onPress={checkBackendHealth}>
        <Text style={styles.refreshIcon}>🔄</Text>
      </TouchableOpacity>
    </View>
  );

  // Screen 1: Choose Analysis Type
  if (!analysisType) {
    return (
      <View style={styles.container}>
        <ScrollView>
          <View style={styles.header}>
            <Text style={styles.headerEmoji}>🍇</Text>
            <Text style={styles.headerTitle}>Vineyard Analysis</Text>
            <Text style={styles.headerSubtitle}>Monitor your vineyard health & flight logs</Text>
            <BackendStatusBadge />
          </View>

          {backendStatus === 'disconnected' && (
            <View style={styles.warningBox}>
              <Text style={styles.warningEmoji}>⚠️</Text>
              <Text style={styles.warningTitle}>Backend Not Running</Text>
              <Text style={styles.warningText}>
                To use this app, start the backend server:
              </Text>
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>cd backend</Text>
                <Text style={styles.codeText}>npm start</Text>
              </View>
            </View>
          )}

          <View style={styles.cardsContainer}>
            <TouchableOpacity
              style={[styles.card, backendStatus !== 'connected' && styles.cardDisabled]}
              onPress={() => backendStatus === 'connected' && setAnalysisType('drone')}
              disabled={backendStatus !== 'connected'}
            >
              <Text style={styles.cardEmoji}>📷</Text>
              <Text style={styles.cardTitle}>Drone Analysis</Text>
              <Text style={styles.cardDesc}>
                Analyze drone RGB images to detect vegetation health and vines
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.card, backendStatus !== 'connected' && styles.cardDisabled]}
              onPress={() => backendStatus === 'connected' && setAnalysisType('orthophoto')}
              disabled={backendStatus !== 'connected'}
            >
              <Text style={styles.cardEmoji}>🗺️</Text>
              <Text style={styles.cardTitle}>Orthophoto Analysis</Text>
              <Text style={styles.cardDesc}>
                Detect gaps in large-scale orthophoto imagery
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.card, styles.cardDJI, backendStatus !== 'connected' && styles.cardDisabled]}
              onPress={() => backendStatus === 'connected' && setAnalysisType('dji-log')}
              disabled={backendStatus !== 'connected'}
            >
              <Text style={styles.cardEmoji}>🚁</Text>
              <Text style={styles.cardTitle}>DJI Flight Log Parser</Text>
              <Text style={styles.cardDesc}>
                Parse DJI drone flight logs (.txt, .dat) to extract flight data and GPS coordinates
              </Text>
            </TouchableOpacity>

            {/* NEW: Image Annotation Card */}
            <TouchableOpacity
              style={[styles.card, styles.cardAnnotation, backendStatus !== 'connected' && styles.cardDisabled]}
              onPress={() => backendStatus === 'connected' && setAnalysisType('image-annotation')}
              disabled={backendStatus !== 'connected'}
            >
              <Text style={styles.cardEmoji}>🏷️</Text>
              <Text style={styles.cardTitle}>Image Annotation</Text>
              <Text style={styles.cardDesc}>
                Annotate drone images (.tif, .jpg) with flight metadata: GPS, altitude, pitch, roll, yaw, gimbal angles, speed etc.
              </Text>
            </TouchableOpacity>

            {/* Training Dataset JSON Generator */}
            <TouchableOpacity
              style={[styles.card, styles.cardDatasetJSON, backendStatus !== 'connected' && styles.cardDisabled]}
              onPress={() => backendStatus === 'connected' && setAnalysisType('training-dataset')}
              disabled={backendStatus !== 'connected'}
            >
              <Text style={styles.cardEmoji}>📦</Text>
              <Text style={styles.cardTitle}>Training Dataset JSON</Text>
              <Text style={styles.cardDesc}>
                Generate comprehensive training dataset with DJI metadata + YOLO detection boxes in JSON format
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => setShowIPConfig(!showIPConfig)}
          >
            <Text style={styles.settingsBtnText}>⚙️ Backend Configuration</Text>
          </TouchableOpacity>

          {showIPConfig && (
            <View style={styles.configBox}>
              <Text style={styles.configLabel}>Backend Address:</Text>
              <TextInput
                style={styles.configInput}
                placeholder={Platform.OS === 'web' ? 'localhost' : '192.168.1.100'}
                value={backendIP}
                onChangeText={setBackendIP}
              />
              <Text style={styles.configHint}>
                {Platform.OS === 'web'
                  ? 'Use "localhost" when running locally'
                  : 'Enter your computer IP address (find it using ipconfig/ifconfig)'}
              </Text>
              <TouchableOpacity
                style={styles.testConnectionBtn}
                onPress={checkBackendHealth}
              >
                <Text style={styles.testConnectionText}>Test Connection</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // Screen 2: Select Files & Analyze
  if (!results) {
    return (
      <View style={styles.container}>
        <ScrollView>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => { setAnalysisType(null); setAnnotationImages([]); }}>
              <Text style={styles.backBtn}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.topBarTitle}>
              {analysisType === 'drone' ? '📷 Drone' :
                analysisType === 'orthophoto' ? '🗺️ Orthophoto' :
                  analysisType === 'image-annotation' ? '🏷️ Annotation' :
                    analysisType === 'training-dataset' ? '📦 Training Dataset' : '🚁 DJI Log'}
            </Text>
          </View>

          {/* NEW: Image Annotation UI */}
          {analysisType === 'image-annotation' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 1: Select DJI Log File(s)</Text>
                <Text style={styles.sectionDesc}>
                  Upload DJI flight log(s) (.txt) - Supports up to 50 log files
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={pickDJILogFile}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>📄</Text>
                <Text style={styles.uploadText}>
                  {selectedLogFiles.length > 0 
                    ? `✓ ${selectedLogFiles.length} Log File${selectedLogFiles.length > 1 ? 's' : ''} Selected` 
                    : 'Select Log Files (up to 50)'}
                </Text>
              </TouchableOpacity>

              {selectedLogFiles.length > 0 && (
                <View style={styles.imagesList}>
                  <Text style={styles.imagesListTitle}>
                    Selected Log Files ({selectedLogFiles.length})
                  </Text>
                  <FlatList
                    data={selectedLogFiles.slice(0, 5)}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => (
                      <View style={styles.imageRow}>
                        <View style={styles.tifPlaceholder}>
                          <Text style={styles.tifIcon}>📄</Text>
                        </View>
                        <Text style={styles.imageName} numberOfLines={1}>
                          {item.name} ({Math.round((item.size || 0) / 1024)}KB)
                        </Text>
                        <TouchableOpacity onPress={() => {
                          const updated = selectedLogFiles.filter((_, i) => i !== index);
                          setSelectedLogFiles(updated);
                          if (updated.length === 0) {
                            setSelectedLogFile(null);
                          } else {
                            setSelectedLogFile(updated[0]);
                          }
                        }}>
                          <Text style={styles.removeIcon}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    keyExtractor={(_, idx) => idx.toString()}
                  />
                  {selectedLogFiles.length > 5 && (
                    <View style={styles.moreFilesIndicator}>
                      <Text style={styles.moreFilesText}>
                        + {selectedLogFiles.length - 5} more log files
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 2: Select Images to Annotate</Text>
                <Text style={styles.sectionDesc}>
                  Upload drone images (.tif, .jpg, .png) - Supports up to 1000 images for batch processing
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.uploadBtn, styles.uploadBtnSecondary]}
                onPress={pickAnnotationImages}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>🖼️</Text>
                <Text style={styles.uploadText}>
                  {annotationImages.length === 0 ? 'Select Images' : `${annotationImages.length} Images Selected`}
                </Text>
              </TouchableOpacity>

              {annotationImages.length > 0 && (
                <View style={styles.imagesList}>
                  <Text style={styles.imagesListTitle}>
                    Selected Images ({annotationImages.length})
                  </Text>
                  <FlatList
                    data={annotationImages.slice(0, 5)}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => {
                      const isTif = item.name?.toLowerCase().endsWith('.tif') ||
                        item.name?.toLowerCase().endsWith('.tiff');
                      return (
                        <View style={styles.imageRow}>
                          {isTif ? (
                            <View style={styles.tifPlaceholder}>
                              <Text style={styles.tifIcon}>🗺️</Text>
                            </View>
                          ) : (
                            <Image
                              source={{ uri: item.uri }}
                              style={styles.imageThumbnail}
                            />
                          )}
                          <Text style={styles.imageName} numberOfLines={1}>
                            {item.name || `Image ${index + 1}`}
                          </Text>
                          <TouchableOpacity onPress={() => removeAnnotationImage(index)}>
                            <Text style={styles.removeIcon}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    }}
                    keyExtractor={(_, idx) => idx.toString()}
                  />
                  {annotationImages.length > 5 && (
                    <View style={styles.moreFilesIndicator}>
                      <Text style={styles.moreFilesText}>
                        + {annotationImages.length - 5} more images
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* YOLO AUTO-ANNOTATION SETTINGS */}
              <View style={styles.section}>
                <View style={styles.yoloHeaderRow}>
                  <Text style={styles.sectionTitle}>🤖 YOLO Auto-Annotation (Optional)</Text>
                  <TouchableOpacity
                    style={[styles.toggleBtn, enableAutoAnnotation && styles.toggleBtnActive]}
                    onPress={() => setEnableAutoAnnotation(!enableAutoAnnotation)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {enableAutoAnnotation ? 'ON' : 'OFF'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.sectionDesc}>
                  Automatically detect objects (vines, fruits, people, vehicles, etc.) with bounding boxes
                </Text>
              </View>

              {enableAutoAnnotation && (
                <>
                  <View style={styles.yoloSettingsBox}>
                    <Text style={styles.yoloSettingLabel}>Industry Mode:</Text>
                    <View style={styles.industryBtnsRow}>
                      {['agriculture', 'rescue', 'general'].map((ind) => (
                        <TouchableOpacity
                          key={ind}
                          style={[
                            styles.industryBtn,
                            yoloIndustry === ind && styles.industryBtnActive
                          ]}
                          onPress={() => setYoloIndustry(ind)}
                        >
                          <Text style={styles.industryBtnText}>
                            {ind === 'agriculture' ? '🌾 Agriculture' :
                             ind === 'rescue' ? '🚁 Rescue' : '🔍 General'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.yoloSettingLabel}>
                      Confidence Threshold: {yoloConfidence.toFixed(2)}
                    </Text>
                    <View style={styles.sliderContainer}>
                      <Text style={styles.sliderLabel}>0.1</Text>
                      <TextInput
                        style={styles.sliderInput}
                        keyboardType="decimal-pad"
                        value={yoloConfidence.toString()}
                        onChangeText={(val) => {
                          // Allow typing freely, validation on blur
                          if (val === '' || val === '0' || val === '0.') {
                            return; // Allow partial input
                          }
                          const num = parseFloat(val);
                          if (!isNaN(num)) {
                            setYoloConfidence(num);
                          }
                        }}
                        onBlur={() => {
                          // Validate and clamp on blur
                          let num = parseFloat(yoloConfidence);
                          if (isNaN(num) || num < 0.1) num = 0.1;
                          if (num > 0.9) num = 0.9;
                          setYoloConfidence(parseFloat(num.toFixed(2)));
                        }}
                      />
                      <Text style={styles.sliderLabel}>0.9</Text>
                    </View>

                    <View style={styles.yoloInfoBox}>
                      <Text style={styles.yoloInfoText}>
                        <Text style={styles.yoloInfoBold}>Agriculture:</Text> Detects vines, fruits, trees, gaps, diseases
                        {'\n'}
                        <Text style={styles.yoloInfoBold}>Rescue:</Text> Detects people, vehicles, animals, structures
                        {'\n'}
                        <Text style={styles.yoloInfoBold}>General:</Text> Detects all COCO classes (80+ objects)
                      </Text>
                    </View>
                  </View>
                </>
              )}

              <View style={styles.infoBox}>
                <Text style={styles.infoEmoji}>💡</Text>
                <Text style={styles.infoText}>
                  Images will be matched with flight data based on timestamps, then optionally auto-annotated with YOLO for object detection. You can manually correct detections afterward.
                </Text>
              </View>
            </>
          ) : analysisType === 'training-dataset' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Training Dataset JSON Generator</Text>
                <Text style={styles.sectionDesc}>
                  Load previously annotated results to generate comprehensive training dataset
                </Text>
              </View>

              <View style={styles.infoBox}>
                <Text style={styles.infoEmoji}>ℹ️</Text>
                <Text style={styles.infoText}>
                  This feature requires that you have already completed image annotation with GPS metadata and YOLO auto-annotation. 
                  It will generate a comprehensive JSON file combining DJI flight data with object detection bounding boxes.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={() => {
                  if (Platform.OS === 'web') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = async (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const data = JSON.parse(event.target.result);
                            if (data.yoloResults && data.annotations) {
                              generateTrainingDatasetJSON(data);
                            } else {
                              showAlert('Invalid File', 'Please upload a valid annotation results JSON file with yoloResults and annotations.');
                            }
                          } catch (err) {
                            showAlert('Parse Error', 'Could not parse JSON file: ' + err.message);
                          }
                        };
                        reader.readAsText(file);
                      }
                    };
                    input.click();
                  }
                }}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>📂</Text>
                <Text style={styles.uploadText}>
                  Load Annotation Results JSON
                </Text>
              </TouchableOpacity>

              <View style={[styles.infoBox, {backgroundColor: '#E8F5E9', borderColor: '#4CAF50'}]}>
                <Text style={styles.infoEmoji}>💡</Text>
                <Text style={styles.infoText}>
                  <Text style={{fontWeight: 'bold'}}>How to use:</Text>{'\n'}
                  1. Complete image annotation + YOLO detection{'\n'}
                  2. From results, export your annotations{'\n'}
                  3. Load that JSON file here{'\n'}
                  4. Generate comprehensive training dataset
                </Text>
              </View>
            </>
          ) : analysisType === 'dji-log' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Select DJI Log File</Text>
                <Text style={styles.sectionDesc}>
                  Upload your DJI flight log (.txt, .dat, or .log file)
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={pickDJILogFile}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>📄</Text>
                <Text style={styles.uploadText}>
                  {selectedLogFile ? `✓ ${selectedLogFile.name}` : 'Select Log File'}
                </Text>
              </TouchableOpacity>

              {selectedLogFile && (
                <View style={styles.geojsonInfo}>
                  <Text style={styles.geojsonName}>
                    📄 {selectedLogFile.name} ({Math.round(selectedLogFile.size / 1024)}KB)
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedLogFile(null)}>
                    <Text style={styles.removeIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {analysisType === 'drone' ? 'Select Drone Images' : 'Select Orthophoto'}
                </Text>
                <Text style={styles.sectionDesc}>
                  {analysisType === 'drone'
                    ? 'Upload one or more drone images'
                    : 'Upload your orthophoto image (.tif format)'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={pickImages}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>☁️</Text>
                <Text style={styles.uploadText}>
                  {selectedImages.length === 0 ? 'Select Images' : `${selectedImages.length} Selected`}
                </Text>
              </TouchableOpacity>

              {analysisType === 'orthophoto' && (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Clustering Method</Text>
                    <Text style={styles.sectionDesc}>
                      Select the algorithm for detecting bare soil and gaps
                    </Text>
                  </View>

                  <View style={styles.methodSelector}>
                    <TouchableOpacity
                      style={[styles.methodOption, clusteringMethod === 'kmeans' && styles.methodOptionActive]}
                      onPress={() => setClusteringMethod('kmeans')}
                    >
                      <Text style={[styles.methodText, clusteringMethod === 'kmeans' && styles.methodTextActive]}>
                        K-Means
                      </Text>
                      <Text style={styles.methodDesc}>Fast & Balanced</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.methodOption, clusteringMethod === 'dbscan' && styles.methodOptionActive]}
                      onPress={() => setClusteringMethod('dbscan')}
                    >
                      <Text style={[styles.methodText, clusteringMethod === 'dbscan' && styles.methodTextActive]}>
                        DBSCAN
                      </Text>
                      <Text style={styles.methodDesc}>Density-based</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.methodOption, clusteringMethod === 'slic' && styles.methodOptionActive]}
                      onPress={() => setClusteringMethod('slic')}
                    >
                      <Text style={[styles.methodText, clusteringMethod === 'slic' && styles.methodTextActive]}>
                        SLIC
                      </Text>
                      <Text style={styles.methodDesc}>Superpixel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.methodOption, clusteringMethod === 'meanshift' && styles.methodOptionActive]}
                      onPress={() => setClusteringMethod('meanshift')}
                    >
                      <Text style={[styles.methodText, clusteringMethod === 'meanshift' && styles.methodTextActive]}>
                        Mean Shift
                      </Text>
                      <Text style={styles.methodDesc}>Slow but Accurate</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Rows GeoJSON (Optional)</Text>
                    <Text style={styles.sectionDesc}>
                      Upload rows.geojson file, or leave empty to use default path
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.uploadBtn, styles.uploadBtnSecondary]}
                    onPress={pickRowsGeojson}
                    disabled={loading}
                  >
                    <Text style={styles.uploadEmoji}>📍</Text>
                    <Text style={styles.uploadText}>
                      {rowsGeojson ? `✓ ${rowsGeojson.name || 'GeoJSON Selected'}` : 'Select Rows GeoJSON (Optional)'}
                    </Text>
                  </TouchableOpacity>

                  {rowsGeojson && (
                    <View style={styles.geojsonInfo}>
                      <Text style={styles.geojsonName}>📄 {rowsGeojson.name || 'rows.geojson'}</Text>
                      <TouchableOpacity onPress={() => setRowsGeojson(null)}>
                        <Text style={styles.removeIcon}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}

              {selectedImages.length > 0 && (
                <View style={styles.imagesList}>
                  <Text style={styles.imagesListTitle}>
                    Selected Images ({selectedImages.length})
                  </Text>
                  <FlatList
                    data={selectedImages.slice(0, 5)}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => {
                      // Try to get filename from multiple sources
                      let fileName = item.fileName || item.name;
                      
                      // Fallback for web blob URLs
                      if (!fileName) {
                        if (item.uri.startsWith('blob:')) {
                          fileName = `Image ${index + 1}.jpg`;
                        } else {
                          const uriParts = item.uri.split('/');
                          fileName = uriParts[uriParts.length - 1].split('#')[0].split('?')[0];
                        }
                      }
                      
                      const isTif = fileName.toLowerCase().endsWith('.tif') || fileName.toLowerCase().endsWith('.tiff');

                      return (
                        <View style={styles.imageRow}>
                          {isTif ? (
                            <View style={styles.tifPlaceholder}>
                              <Text style={styles.tifIcon}>🗺️</Text>
                            </View>
                          ) : (
                            <Image
                              source={{ uri: item.uri }}
                              style={styles.imageThumbnail}
                            />
                          )}
                          <Text style={styles.imageName} numberOfLines={1}>
                            {fileName}
                          </Text>
                          <TouchableOpacity onPress={() => removeImage(index)}>
                            <Text style={styles.removeIcon}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    }}
                    keyExtractor={(_, idx) => idx.toString()}
                  />
                  {selectedImages.length > 5 && (
                    <View style={styles.moreFilesIndicator}>
                      <Text style={styles.moreFilesText}>
                        + {selectedImages.length - 5} more images
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[
                styles.analyzeBtn,
                (loading ||
                  (analysisType === 'dji-log' && !selectedLogFile) ||
                  (analysisType === 'image-annotation' && (selectedLogFiles.length === 0 || annotationImages.length === 0)) ||
                  (analysisType === 'training-dataset') ||
                  (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && selectedImages.length === 0)
                ) && styles.analyzeBtnDisabled
              ]}
              onPress={handleAnalyze}
              disabled={
                loading ||
                (analysisType === 'dji-log' && !selectedLogFile) ||
                (analysisType === 'image-annotation' && (selectedLogFiles.length === 0 || annotationImages.length === 0)) ||
                (analysisType === 'training-dataset') ||
                (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && selectedImages.length === 0)
              }
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <>
                  <Text style={styles.analyzeBtnEmoji}>⚡</Text>
                  <Text style={styles.analyzeBtnText}>
                    {analysisType === 'dji-log' ? 'Parse Log' :
                      analysisType === 'image-annotation' ? 'Annotate Images' :
                        analysisType === 'training-dataset' ? 'Generate Dataset' : 'Analyze Now'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {loading && (
              <View style={styles.progressContainer}>
                <Text style={styles.analyzingText}>
                  {analysisType === 'dji-log' ? 'Parsing flight log...' :
                    analysisType === 'image-annotation' ? 'Annotating images with flight data...' :
                      analysisType === 'training-dataset' ? 'Generating training dataset...' : 'Processing images...'}
                </Text>
                
                {processingProgress.total > 1 && (
                  <View style={styles.progressDetails}>
                    {/* Progress bar */}
                    <View style={styles.progressBarContainer}>
                      <View 
                        style={[
                          styles.progressBarFill, 
                          { width: `${processingProgress.percentage}%` }
                        ]} 
                      />
                    </View>
                    
                    {/* Progress text */}
                    <Text style={styles.progressText}>
                      {processingProgress.current} / {processingProgress.total} files ({processingProgress.percentage}%)
                    </Text>
                    
                    {/* Current file */}
                    {processingProgress.currentFile && (
                      <Text style={styles.currentFileText} numberOfLines={1}>
                        📁 {processingProgress.currentFile}
                      </Text>
                    )}
                    
                    {/* Estimated time */}
                    {processingProgress.estimatedTimeRemaining && (
                      <Text style={styles.timeRemainingText}>
                        ⏱️ Est. time remaining: {processingProgress.estimatedTimeRemaining}
                      </Text>
                    )}
                    
                    {/* Elapsed time */}
                    {processingProgress.startTime && (
                      <Text style={styles.elapsedTimeText}>
                        ⏰ Elapsed: {Math.round((Date.now() - processingProgress.startTime) / 1000)}s
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  // Screen 3: Show Results with Download Options
  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsEmoji}>✅</Text>
          <Text style={styles.resultsTitle}>
            {results.type === 'dji-log' ? 'Parsing Complete' :
              results.type === 'image-annotation' ? 'Annotation Complete' : 'Analysis Complete'}
          </Text>
        </View>

        {/* DOWNLOAD BUTTONS */}
        {Platform.OS === 'web' && (
          <View style={styles.downloadSection}>
            <Text style={styles.downloadTitle}>📥 Download Results</Text>
            <View style={styles.downloadButtons}>
              <TouchableOpacity style={styles.downloadBtn} onPress={downloadJSON}>
                <Text style={styles.downloadBtnEmoji}>📋</Text>
                <Text style={styles.downloadBtnText}>JSON</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.downloadBtn} onPress={downloadCSV}>
                <Text style={styles.downloadBtnEmoji}>📊</Text>
                <Text style={styles.downloadBtnText}>CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.downloadBtn} onPress={downloadReport}>
                <Text style={styles.downloadBtnEmoji}>📄</Text>
                <Text style={styles.downloadBtnText}>Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.resultsContent}>
          {/* NEW: Image Annotation Results */}
          {results.type === 'image-annotation' ? (
            <>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Images Annotated</Text>
                <Text style={styles.metricValue}>{results.data.totalImages}</Text>
              </View>

              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Log Files Processed</Text>
                <Text style={styles.metricValue}>
                  {results.data.processedLogFiles || 0} / {results.data.totalLogFiles || 0}
                </Text>
              </View>

              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Flight Records Used</Text>
                <Text style={styles.metricValue}>{results.data.totalFlightRecords}</Text>
              </View>

              {/* Download Annotated Images Section */}
              {results.data.annotatedImages && results.data.annotatedImages.length > 0 && Platform.OS === 'web' && (
                <View style={styles.downloadImagesSection}>
                  <Text style={styles.downloadImagesTitle}>📥 Download Annotated Images</Text>
                  {results.data.annotatedImages.map((img, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.downloadImageBtn}
                      onPress={() => {
                        const link = document.createElement('a');
                        link.href = `http://${backendIP}:${BACKEND_PORT}${img.downloadUrl}`;
                        link.download = img.originalName;
                        link.click();
                      }}
                    >
                      <Text style={styles.downloadImageIcon}>⬇️</Text>
                      <Text style={styles.downloadImageText}>{img.originalName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.detailsTitle}>Annotation Details</Text>

              {results.data.annotations.map((ann, idx) => (
                <View key={idx} style={styles.annotationCard}>
                  <Text style={styles.annotationFilename}>{ann.imageName}</Text>
                  <Text style={styles.annotationMatchBadge}>
                    Match: {ann.matchMethod}
                  </Text>

                  <View style={styles.annotationSection}>
                    <Text style={styles.annotationSectionTitle}>📍 GPS</Text>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Latitude:</Text>
                      <Text style={styles.annotationValue}>{ann.gps.latitude}</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Longitude:</Text>
                      <Text style={styles.annotationValue}>{ann.gps.longitude}</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Altitude:</Text>
                      <Text style={styles.annotationValue}>{ann.gps.altitude}m</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Height:</Text>
                      <Text style={styles.annotationValue}>{ann.gps.height}m</Text>
                    </View>
                  </View>

                  <View style={styles.annotationSection}>
                    <Text style={styles.annotationSectionTitle}>🎯 Orientation</Text>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Pitch:</Text>
                      <Text style={styles.annotationValue}>{ann.orientation.pitch}°</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Roll:</Text>
                      <Text style={styles.annotationValue}>{ann.orientation.roll}°</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Yaw:</Text>
                      <Text style={styles.annotationValue}>{ann.orientation.yaw}°</Text>
                    </View>
                  </View>

                  <View style={styles.annotationSection}>
                    <Text style={styles.annotationSectionTitle}>📷 Gimbal</Text>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Pitch:</Text>
                      <Text style={styles.annotationValue}>{ann.gimbal.pitch}°</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Roll:</Text>
                      <Text style={styles.annotationValue}>{ann.gimbal.roll}°</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Yaw:</Text>
                      <Text style={styles.annotationValue}>{ann.gimbal.yaw}°</Text>
                    </View>
                  </View>

                  <View style={styles.annotationSection}>
                    <Text style={styles.annotationSectionTitle}>🚀 Speed</Text>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Horizontal:</Text>
                      <Text style={styles.annotationValue}>{ann.speed.horizontal} m/s</Text>
                    </View>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Vertical (Z):</Text>
                      <Text style={styles.annotationValue}>{ann.speed.zSpeed} m/s</Text>
                    </View>
                  </View>

                  <View style={[styles.annotationSection, { borderBottomWidth: 0 }]}>
                    <Text style={styles.annotationSectionTitle}>🔋 Battery</Text>
                    <View style={styles.annotationRow}>
                      <Text style={styles.annotationLabel}>Level:</Text>
                      <Text style={styles.annotationValue}>{ann.battery.level}%</Text>
                    </View>
                  </View>
                </View>
              ))}
            </>
          ) : results.type === 'image-annotation-with-yolo' ? (
            <>
              {/* YOLO ANNOTATION RESULTS */}
              <View style={styles.yoloSuccessHeader}>
                <View style={styles.yoloSuccessIconContainer}>
                  <Text style={styles.yoloSuccessIcon}>✅</Text>
                </View>
                <Text style={styles.yoloSuccessTitle}>Auto-Annotation Complete</Text>
                <Text style={styles.yoloSuccessSubtitle}>
                  GPS metadata and AI object detection successfully applied
                </Text>
              </View>

              <View style={styles.yoloStatsContainer}>
                <View style={styles.yoloStatCard}>
                  <View style={styles.yoloStatIconBg}>
                    <Text style={styles.yoloStatIcon}>📸</Text>
                  </View>
                  <Text style={styles.yoloStatValue}>{results.data.totalImages}</Text>
                  <Text style={styles.yoloStatLabel}>Images Processed</Text>
                </View>
                <View style={styles.yoloStatCard}>
                  <View style={[styles.yoloStatIconBg, { backgroundColor: '#e8f5e9' }]}>
                    <Text style={styles.yoloStatIcon}>🎯</Text>
                  </View>
                  <Text style={styles.yoloStatValue}>
                    {results.data.yoloResults?.reduce((sum, r) => 
                      sum + (r.annotations?.detection_count || 0), 0
                    )}
                  </Text>
                  <Text style={styles.yoloStatLabel}>Objects Detected</Text>
                </View>
              </View>

              {/* Export and Download Buttons */}
              <View style={styles.exportSection}>
                <View style={styles.exportHeaderRow}>
                  <View style={styles.exportIconBadge}>
                    <Text style={styles.exportIconText}>📊</Text>
                  </View>
                  <View>
                    <Text style={styles.exportSectionTitle}>Export Dataset</Text>
                    <Text style={styles.exportSectionSubtitle}>Download annotations in your preferred format</Text>
                  </View>
                </View>
                
                <View style={styles.exportButtonsRow}>
                  <TouchableOpacity
                    style={styles.exportBtnCoco}
                    onPress={() => exportAnnotations('coco')}
                  >
                    <View style={styles.exportBtnContent}>
                      <Text style={styles.exportBtnIcon}>🎯</Text>
                      <View style={styles.exportBtnTextContainer}>
                        <Text style={styles.exportBtnTitle}>COCO Format</Text>
                        <Text style={styles.exportBtnSubtitle}>Industry standard</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.exportBtnYolo}
                    onPress={() => exportAnnotations('yolo')}
                  >
                    <View style={styles.exportBtnContent}>
                      <Text style={styles.exportBtnIcon}>⚡</Text>
                      <View style={styles.exportBtnTextContainer}>
                        <Text style={styles.exportBtnTitle}>YOLO Format</Text>
                        <Text style={styles.exportBtnSubtitle}>AI training ready</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.downloadAllBtn, downloadingZip && styles.downloadAllBtnDisabled]}
                  disabled={downloadingZip}
                  onPress={async () => {
                    // Download all annotated images as a single ZIP file
                    const annotatedImages = results.data.yoloResults
                      ?.filter(r => r.annotated_image)
                      .map(r => r.annotated_image.replace('uploads/', '')) || [];
                    
                    const count = annotatedImages.length;
                    if (count === 0) {
                      showAlert('No Images', 'No annotated images available to download.');
                      return;
                    }
                    
                    if (Platform.OS === 'web') {
                      try {
                        setDownloadingZip(true);
                        const response = await fetch(`${BACKEND_URL}/download-zip`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ filenames: annotatedImages })
                        });
                        
                        if (!response.ok) throw new Error('Download failed');
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `annotated_images_${Date.now()}.zip`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(url);
                        setDownloadingZip(false);
                        showAlert('Success', `Downloaded ${count} images as ZIP file!`);
                      } catch (error) {
                        setDownloadingZip(false);
                        showAlert('Error', 'Failed to download ZIP: ' + error.message);
                      }
                    } else {
                      showAlert('Download All', `${count} annotated images available. Feature available on web.`);
                    }
                  }}
                >
                  {downloadingZip ? (
                    <View style={styles.downloadAllBtnContent}>
                      <ActivityIndicator color="#fff" size="small" style={styles.downloadSpinner} />
                      <Text style={styles.downloadAllBtnText}>Creating ZIP...</Text>
                    </View>
                  ) : (
                    <Text style={styles.downloadAllBtnText}>
                      📦 Download All as ZIP ({results.data.yoloResults?.filter(r => r.annotated_image).length || 0} images)
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Image Review Section */}
              <Text style={styles.detailsTitle}>Review Detections</Text>
              <Text style={styles.previewNote}>
                📷 Showing first image preview • Total: {results.data.yoloResults?.length || 0} images
              </Text>
              
              {results.data.yoloResults && results.data.yoloResults.slice(0, 1).map((result, idx) => (
                <View key={idx} style={styles.yoloResultCard}>
                  <View style={styles.yoloResultHeader}>
                    <Text style={styles.yoloResultTitle}>{result.image}</Text>
                    <Text style={styles.yoloResultBadge}>
                      {result.annotations?.detection_count || 0} objects
                    </Text>
                  </View>

                  {result.error ? (
                    <Text style={styles.errorText}>Error: {result.error}</Text>
                  ) : (
                    <>
                      {/* Show annotated image if available */}
                      {result.annotated_image && (
                        <>
                          <View style={styles.annotatedImageContainer}>
                            <Image
                              source={{ uri: `${BACKEND_URL.replace('/api', '')}/${result.annotated_image}` }}
                              style={styles.annotatedImage}
                              resizeMode="contain"
                            />
                          </View>
                          
                          {/* Download Annotated Image Button */}
                          <TouchableOpacity
                            style={styles.downloadAnnotatedBtn}
                            onPress={() => {
                              // Backend returns relative path like 'uploads/annotated_xxx.jpg'
                              const imageUrl = `${BACKEND_URL.replace('/api', '')}/${result.annotated_image}`;
                              
                              if (Platform.OS === 'web') {
                                // Web: Download using anchor tag
                                const link = document.createElement('a');
                                link.href = imageUrl;
                                link.download = `annotated_${result.image}`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                showAlert('Success', 'Annotated image downloaded!');
                              } else {
                                // Mobile: Open in browser or use share
                                showAlert('Download', `Image URL: ${imageUrl}\n\nLong press to save or share.`);
                              }
                            }}
                          >
                            <Text style={styles.downloadAnnotatedBtnText}>
                              📥 Download Image with Bounding Boxes
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}

                      {/* Detection List */}
                      <View style={styles.detectionsList}>
                        <Text style={styles.detectionsTitle}>
                          Detected Objects ({result.annotations?.detections?.length || 0}):
                        </Text>
                        {result.annotations?.detections?.map((det, detIdx) => (
                          <View key={detIdx} style={styles.detectionItem}>
                            <View style={[
                              styles.detectionBadge,
                              { backgroundColor: det.confidence > 0.7 ? '#4CAF50' : '#FF9800' }
                            ]}>
                              <Text style={styles.detectionClass}>{det.class}</Text>
                              <Text style={styles.detectionConfidence}>
                                {(det.confidence * 100).toFixed(0)}%
                              </Text>
                            </View>
                            <Text style={styles.detectionCoords}>
                              x:{Math.round(det.bbox.x1)} y:{Math.round(det.bbox.y1)} 
                              w:{Math.round(det.bbox.width)} h:{Math.round(det.bbox.height)}
                            </Text>
                          </View>
                        ))}
                        {(!result.annotations?.detections || result.annotations.detections.length === 0) && (
                          <Text style={styles.noDetectionsText}>
                            No objects detected. Try lowering the confidence threshold.
                          </Text>
                        )}
                      </View>

                      {/* Action Buttons Row */}
                      <View style={styles.annotationActionsRow}>
                        <TouchableOpacity
                          style={[styles.annotationActionBtn, styles.editBtn]}
                          onPress={() => {
                            showAlert('Manual Editor', 
                              'Manual annotation editor will be implemented here. ' +
                              'You can add, delete, or modify bounding boxes.'
                            );
                          }}
                        >
                          <Text style={styles.annotationActionBtnText}>✏️ Edit</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                          style={[styles.annotationActionBtn, styles.previewBtn]}
                          onPress={() => {
                            if (result.annotated_image) {
                              // Backend returns relative path like 'uploads/annotated_xxx.jpg'
                              const imageUrl = `${BACKEND_URL.replace('/api', '')}/${result.annotated_image}`;
                              
                              if (Platform.OS === 'web') {
                                window.open(imageUrl, '_blank');
                              } else {
                                showAlert('Preview', `Image URL: ${imageUrl}`);
                              }
                            }
                          }}
                        >
                          <Text style={styles.annotationActionBtnText}>👁️ Full Preview</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              ))}
            </>
          ) : results.type === 'dji-log' ? (
            <>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>File Name</Text>
                <Text style={styles.metricValue}>{results.data.fileName}</Text>
              </View>

              {/* MAP TOGGLE BUTTON */}
              <TouchableOpacity
                style={styles.mapToggleBtn}
                onPress={() => setShowMap(!showMap)}
              >
                <Text style={styles.mapToggleBtnEmoji}>{showMap ? '📊' : '🗺️'}</Text>
                <Text style={styles.mapToggleBtnText}>
                  {showMap ? 'Show Statistics' : 'View Flight Path Map'}
                </Text>
              </TouchableOpacity>

              {/* CONDITIONAL RENDERING: MAP OR STATS */}
              {showMap ? (
                <View style={styles.mapSection}>
                  <Text style={styles.detailsTitle}>Flight Path Visualization</Text>
                  <View style={{ paddingHorizontal: 16 }}>
                    <FlightPathMap flightPath={results.data.flightPath} />
                  </View>
                  <View style={styles.mapLegend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#27ae60' }]} />
                      <Text style={styles.legendText}>Start</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#3498db' }]} />
                      <Text style={styles.legendText}>Path</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#e74c3c' }]} />
                      <Text style={styles.legendText}>End</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricLabel}>Total Records</Text>
                    <Text style={styles.metricValue}>{results.data.summary.totalRecords}</Text>
                  </View>

                  <View style={styles.metricBox}>
                    <Text style={styles.metricLabel}>Flight Duration</Text>
                    <Text style={styles.metricValue}>{results.data.summary.duration}</Text>
                  </View>

                  <Text style={styles.detailsTitle}>Flight Statistics</Text>
                  <View style={styles.resultDetail}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Max Altitude:</Text>
                      <Text style={styles.detailValue}>{results.data.statistics.maxAltitude}m</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Max Speed:</Text>
                      <Text style={styles.detailValue}>{results.data.statistics.maxSpeed}m/s</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Total Distance:</Text>
                      <Text style={styles.detailValue}>{results.data.statistics.totalDistance}m</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Average Speed:</Text>
                      <Text style={styles.detailValue}>{results.data.statistics.avgSpeed}m/s</Text>
                    </View>
                  </View>

                  <Text style={styles.detailsTitle}>Flight Timeline</Text>
                  <View style={styles.resultDetail}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Start Time:</Text>
                      <Text style={styles.detailValueSmall}>{results.data.summary.startTime}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>End Time:</Text>
                      <Text style={styles.detailValueSmall}>{results.data.summary.endTime}</Text>
                    </View>
                  </View>

                  <Text style={styles.detailsTitle}>Flight Path Sample (First 5 Points)</Text>
                  {results.data.flightPath.slice(0, 5).map((point, idx) => (
                    <View key={idx} style={styles.resultDetail}>
                      <Text style={styles.detailFilename}>Point {idx + 1}</Text>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Latitude:</Text>
                        <Text style={styles.detailValue}>{point.latitude.toFixed(6)}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Longitude:</Text>
                        <Text style={styles.detailValue}>{point.longitude.toFixed(6)}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Altitude:</Text>
                        <Text style={styles.detailValue}>{point.altitude}m</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Relative Alt:</Text>
                        <Text style={styles.detailValue}>{point.relativeAltitude}m</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </>
          ) : results.type === 'drone' ? (
            <>
              {/* RGB Vegetation Health Analysis Results */}
              <Text style={styles.detailsTitle}>🌿 RGB Vegetation Health Analysis</Text>
              
              {results.data.results && results.data.results.map((result, idx) => (
                <View key={idx} style={styles.rgbAnalysisCard}>
                  <Text style={styles.detailFilename}>📸 {result.image}</Text>
                  
                  {result.error ? (
                    <Text style={styles.errorText}>❌ {result.error}</Text>
                  ) : (
                    <>
                      {/* Visualization Image */}
                      {result.visualization_image && (
                        <Image
                          source={{ uri: `${BACKEND_URL.replace('/api', '')}/${result.visualization_image}` }}
                          style={styles.visualizationImage}
                          resizeMode="contain"
                        />
                      )}
                      
                      {/* Health Statistics */}
                      <View style={styles.healthStatsRow}>
                        <View style={[styles.healthStatBox, styles.healthyBox]}>
                          <Text style={styles.healthStatLabel}>🟢 Healthy</Text>
                          <Text style={styles.healthStatValue}>
                            {result.analysis.health_analysis.healthy_percent}%
                          </Text>
                        </View>
                        
                        <View style={[styles.healthStatBox, styles.stressedBox]}>
                          <Text style={styles.healthStatLabel}>🟡 Stressed</Text>
                          <Text style={styles.healthStatValue}>
                            {result.analysis.health_analysis.stressed_percent}%
                          </Text>
                        </View>
                        
                        <View style={[styles.healthStatBox, styles.bareBox]}>
                          <Text style={styles.healthStatLabel}>🟤 Bare Soil</Text>
                          <Text style={styles.healthStatValue}>
                            {result.analysis.health_analysis.bare_soil_percent}%
                          </Text>
                        </View>
                      </View>
                      
                      {/* Vegetation Indices */}
                      <View style={styles.indicesContainer}>
                        <Text style={styles.indicesTitle}>Vegetation Indices</Text>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>VARI (Atmospheric Resistant):</Text>
                          <Text style={styles.detailValue}>{result.analysis.indices.vari_mean}</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>ExG (Excess Green):</Text>
                          <Text style={styles.detailValue}>{result.analysis.indices.exg_mean}</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>ExGR (ExG - ExR):</Text>
                          <Text style={styles.detailValue}>{result.analysis.indices.exgr_mean}</Text>
                        </View>
                      </View>
                      
                      {/* Total Vegetation Cover */}
                      <View style={styles.totalVegetationBox}>
                        <Text style={styles.totalVegetationLabel}>Total Vegetation Cover</Text>
                        <Text style={styles.totalVegetationValue}>
                          {result.analysis.health_analysis.vegetation_cover}%
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Clustering Method</Text>
                <Text style={[styles.metricValue, { fontSize: 20 }]}>
                  {(results.data.method || 'kmeans').toUpperCase()}
                </Text>

              </View>

              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Gaps Detected</Text>
                <Text style={styles.metricValue}>{results.data.detected_gaps}</Text>
              </View>

              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Total Gap Area</Text>
                <Text style={styles.metricValue}>{Math.round(results.data.total_gap_area_m2)} m²</Text>
              </View>

              <View style={styles.resultDetail}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Rows Analyzed:</Text>
                  <Text style={styles.detailValue}>{results.data.rows_analyzed}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Rows with Gaps:</Text>
                  <Text style={styles.detailValue}>{results.data.rows_with_gaps}</Text>
                </View>
              </View>

              {results.data.details && results.data.details.map((detail, idx) => (
                <View key={idx} style={styles.resultDetail}>
                  <Text style={styles.detailFilename}>{detail.filename}</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Gaps:</Text>
                    <Text style={styles.detailValue}>{detail.gaps_detected}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Area:</Text>
                    <Text style={styles.detailValue}>{Math.round(detail.gap_area_m2)} m²</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        <TouchableOpacity style={styles.newAnalysisBtn} onPress={resetApp}>
          <Text style={styles.newAnalysisBtnText}>Start New Analysis</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#1a472a',
    paddingTop: 60,
    paddingBottom: 40,
    alignItems: 'center',
  },
  headerEmoji: {
    fontSize: 60,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#a8d5ba',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusDotConnected: {
    backgroundColor: '#2ecc71',
  },
  statusDotDisconnected: {
    backgroundColor: '#e74c3c',
  },
  statusDotChecking: {
    backgroundColor: '#f39c12',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  refreshIcon: {
    fontSize: 14,
    marginLeft: 8,
  },
  warningBox: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#fff3cd',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#f39c12',
  },
  warningEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 6,
  },
  warningText: {
    fontSize: 13,
    color: '#856404',
    marginBottom: 10,
  },
  codeBox: {
    backgroundColor: '#2c3e50',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#2ecc71',
    marginBottom: 4,
  },
  cardsContainer: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderLeftWidth: 5,
    borderLeftColor: '#2d8659',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardDJI: {
    borderLeftColor: '#3498db',
  },
  cardAnnotation: {
    borderLeftColor: '#9b59b6',
  },
  cardDatasetJSON: {
    borderLeftColor: '#8B5CF6',
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardEmoji: {
    fontSize: 40,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
  settingsBtn: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 12,
  },
  settingsBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  configBox: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 20,
  },
  configLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 8,
  },
  configInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 10,
    color: '#333',
  },
  configHint: {
    fontSize: 12,
    color: '#999',
    lineHeight: 18,
    marginBottom: 12,
  },
  testConnectionBtn: {
    backgroundColor: '#2d8659',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  testConnectionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  topBar: {
    backgroundColor: '#1a472a',
    paddingTop: 30,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginRight: 40,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 13,
    color: '#666',
  },
  uploadBtn: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#2d8659',
    borderRadius: 12,
    paddingVertical: 40,
    alignItems: 'center',
    marginBottom: 20,
  },
  uploadBtnSecondary: {
    borderColor: '#f39c12',
    paddingVertical: 30,
  },
  uploadEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  uploadText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a472a',
  },
  geojsonInfo: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
    borderLeftColor: '#f39c12',
  },
  geojsonName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a472a',
    flex: 1,
  },
  imagesList: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  imagesListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 12,
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  imageThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
  },
  imageName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: '#333',
  },
  removeIcon: {
    fontSize: 18,
    color: '#e74c3c',
    fontWeight: 'bold',
  },
  actionButtons: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  analyzeBtn: {
    backgroundColor: '#2d8659',
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2d8659',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  analyzeBtnDisabled: {
    opacity: 0.5,
  },
  analyzeBtnEmoji: {
    fontSize: 18,
    marginRight: 8,
  },
  analyzeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  analyzingText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 12,
    fontSize: 13,
  },
  resultsHeader: {
    backgroundColor: '#1a472a',
    paddingTop: 50,
    paddingBottom: 30,
    alignItems: 'center',
  },
  resultsEmoji: {
    fontSize: 50,
    marginBottom: 10,
  },
  resultsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  downloadSection: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#3498db',
  },
  downloadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 12,
  },
  downloadButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  downloadBtn: {
    backgroundColor: '#3498db',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 80,
    shadowColor: '#3498db',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  downloadBtnEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  resultsContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  metricBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2d8659',
  },
  metricLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2d8659',
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a472a',
    marginTop: 16,
    marginBottom: 12,
  },
  previewNote: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 12,
    textAlign: 'center',
  },
  resultDetail: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  detailFilename: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a472a',
  },
  detailValueSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a472a',
    maxWidth: '60%',
    textAlign: 'right',
  },
  statusGood: {
    color: '#27ae60',
  },
  statusFair: {
    color: '#f39c12',
  },
  statusPoor: {
    color: '#e74c3c',
  },
  newAnalysisBtn: {
    marginHorizontal: 16,
    backgroundColor: '#2d8659',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  newAnalysisBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  mapToggleBtn: {
    marginHorizontal: 16,
    backgroundColor: '#3498db',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#3498db',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  mapToggleBtnEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  mapToggleBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  mapSection: {
    marginBottom: 20,
  },
  mapLegend: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },

  methodSelector: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  methodOption: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  methodOptionActive: {
    borderColor: '#2d8659',
    backgroundColor: '#e8f5e9',
  },
  methodText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  methodTextActive: {
    color: '#2d8659',
  },
  methodDesc: {
    fontSize: 11,
    color: '#999',
  },
  tifPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#e8f5e9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2d8659',
  },
  tifIcon: {
    fontSize: 24,
  },
  // NEW: Styles for info box
  infoBox: {
    marginHorizontal: 16,
    backgroundColor: '#e8f4fd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 4,
    borderLeftColor: '#3498db',
  },
  infoEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#2c3e50',
    lineHeight: 20,
  },
  // NEW: Styles for annotation cards
  annotationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#9b59b6',
  },
  annotationFilename: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 8,
  },
  annotationMatchBadge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#9b59b6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 12,
    overflow: 'hidden',
  },
  annotationSection: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  annotationSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  annotationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  annotationLabel: {
    fontSize: 12,
    color: '#888',
  },
  annotationValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2c3e50',
  },
  // Download annotated images styles
  downloadImagesSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
  },
  downloadImagesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a472a',
    marginBottom: 12,
  },
  downloadImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27ae60',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  downloadImageIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  downloadImageText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  // YOLO Annotation Styles
  yoloHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  toggleBtn: {
    backgroundColor: '#ccc',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  toggleBtnActive: {
    backgroundColor: '#4CAF50',
  },
  toggleBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  yoloSettingsBox: {
    marginHorizontal: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  yoloSettingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  industryBtnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  industryBtn: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginHorizontal: 4,
    borderWidth: 2,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  industryBtnActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#e8f5e9',
  },
  industryBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#666',
  },
  sliderInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
    fontSize: 14,
  },
  yoloInfoBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9800',
  },
  yoloInfoText: {
    fontSize: 11,
    color: '#555',
    lineHeight: 18,
  },
  yoloInfoBold: {
    fontWeight: '700',
    color: '#333',
  },
  yoloResultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  yoloResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  yoloResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a472a',
    flex: 1,
  },
  yoloResultBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  annotatedImageContainer: {
    width: '100%',
    height: 250,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  annotatedImage: {
    width: '100%',
    height: '100%',
  },
  detectionsList: {
    marginTop: 8,
  },
  detectionsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  detectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detectionBadge: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
  detectionClass: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    marginRight: 6,
  },
  detectionConfidence: {
    fontSize: 11,
    color: '#fff',
  },
  detectionCoords: {
    fontSize: 10,
    color: '#888',
  },
  editAnnotationBtn: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  editAnnotationBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  downloadAnnotatedBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  downloadAnnotatedBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  annotationActionsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  annotationActionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  editBtn: {
    backgroundColor: '#2196F3',
  },
  previewBtn: {
    backgroundColor: '#9C27B0',
  },
  annotationActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  noDetectionsText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  exportSection: {
    marginTop: 20,
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  exportHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  exportIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exportIconText: {
    fontSize: 24,
  },
  exportSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  exportSectionSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '400',
  },
  exportButtonsRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  exportBtnCoco: {
    flex: 1,
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#7C3AED',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  exportBtnYolo: {
    flex: 1,
    backgroundColor: '#EC4899',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#DB2777',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  exportBtnTrainingDataset: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#7C3AED',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  exportBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exportBtnIcon: {
    fontSize: 28,
  },
  exportBtnTextContainer: {
    flex: 1,
  },
  exportBtnTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  exportBtnSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  downloadAllBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2563EB',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 56,
  },
  downloadAllBtnDisabled: {
    backgroundColor: '#93C5FD',
    borderColor: '#BFDBFE',
    opacity: 0.7,
  },
  downloadAllBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadSpinner: {
    marginRight: 10,
  },
  downloadAllBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  yoloSuccessHeader: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  yoloSuccessIconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  yoloSuccessIcon: {
    fontSize: 40,
  },
  yoloSuccessTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 8,
    textAlign: 'center',
  },
  yoloSuccessSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  yoloStatsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 20,
    gap: 12,
  },
  yoloStatCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  yoloStatIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  yoloStatIcon: {
    fontSize: 28,
  },
  yoloStatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 4,
  },
  yoloStatLabel: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    fontWeight: '500',
  },
  cardAnnotation: {
    borderLeftColor: '#FF9800',
  },
  // RGB Analysis Styles
  rgbAnalysisCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  visualizationImage: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    marginVertical: 12,
    backgroundColor: '#F3F4F6',
  },
  healthStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  healthStatBox: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  healthyBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 2,
    borderColor: '#10B981',
  },
  stressedBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  bareBox: {
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  healthStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  healthStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  indicesContainer: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  indicesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  totalVegetationBox: {
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  totalVegetationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
    marginBottom: 4,
  },
  totalVegetationValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  moreFilesIndicator: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  moreFilesText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  // Progress tracking styles
  progressContainer: {
    marginTop: 16,
    width: '100%',
  },
  progressDetails: {
    marginTop: 12,
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  currentFileText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  timeRemainingText: {
    fontSize: 14,
    color: '#059669',
    marginTop: 8,
    textAlign: 'center',
    fontWeight: '500',
  },
  elapsedTimeText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
});