import React, { useState, useEffect, useRef } from 'react';
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
import { fromArrayBuffer } from 'geotiff';

const BACKEND_PORT = 5000;

export default function App() {
  const [backendIP, setBackendIP] = useState('192.168.100.47');
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
  const [annotationImages, setAnnotationImages] = useState([]); // for image annotation feature
  const [yoloIndustry, setYoloIndustry] = useState('agriculture'); // YOLO industry mode
  const [yoloConfidence, setYoloConfidence] = useState(0.25); // YOLO confidence threshold
  const [enableAutoAnnotation, setEnableAutoAnnotation] = useState(true); // Toggle YOLO
  const [yoloResults, setYoloResults] = useState(null); // YOLO detection results
  const [currentAnnotationIndex, setCurrentAnnotationIndex] = useState(0); // Current image being reviewed
  
  // Interactive Annotation Editor states
  const [annotationEditorVisible, setAnnotationEditorVisible] = useState(false);
  const [editingAnnotations, setEditingAnnotations] = useState([]); // Current detections being edited
  const [selectedDetection, setSelectedDetection] = useState(null); // Currently selected box
  const [isDrawingNewBox, setIsDrawingNewBox] = useState(false); // Drawing a new bounding box
  const [newBoxStart, setNewBoxStart] = useState(null); // Start point of new box
  const [newBoxEnd, setNewBoxEnd] = useState(null); // End point of new box
  const [isDraggingBox, setIsDraggingBox] = useState(false); // Dragging selected box
  const [isResizingBox, setIsResizingBox] = useState(false); // Resizing selected box
  const [resizeHandle, setResizeHandle] = useState(null); // Which corner is being resized
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); // Offset for dragging
  const [editingImageData, setEditingImageData] = useState(null); // Image being edited
  const [availableLabels, setAvailableLabels] = useState(['vine', 'grape', 'diseased', 'healthy', 'missing', 'person', 'car', 'other']); // Label options
  const [customLabelInput, setCustomLabelInput] = useState(''); // Custom label input
  const [editorImageDimensions, setEditorImageDimensions] = useState({ width: 4000, height: 3000 }); // Actual image dimensions
  const [newBoxLabel, setNewBoxLabel] = useState('vine'); // Label for new boxes being drawn
  const annotationCanvasRef = useRef(null);
  
  // NEW FEATURES: Orthomosaic Generator & Manual Row Digitizer
  const [orthomosaicProjects, setOrthomosaicProjects] = useState([]);
  const [selectedOrthomosaicProject, setSelectedOrthomosaicProject] = useState(null);
  const [orthomosaicProjectName, setOrthomosaicProjectName] = useState('');
  const [orthomosaicQuality, setOrthomosaicQuality] = useState('medium');
  const [orthomosaicFeatureQuality, setOrthomosaicFeatureQuality] = useState('high');
  const [orthomosaicProcessingStatus, setOrthomosaicProcessingStatus] = useState(null);
  const [droneImages, setDroneImages] = useState([]);
  
  // Manual Row Digitizer states
  const [digitizerOrthophoto, setDigitizerOrthophoto] = useState(null);
  const [drawnRows, setDrawnRows] = useState([]);
  const [currentRow, setCurrentRow] = useState([]);
  const [isDrawingRow, setIsDrawingRow] = useState(false);
  const [geoBounds, setGeoBounds] = useState(null); // Store actual GeoTIFF bounds
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState(null);
  const canvasRef = useRef(null);
  
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

  // Canvas rendering for manual digitizer
  useEffect(() => {
    if (!canvasRef.current || !digitizerOrthophoto) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    console.log('📊 Loading orthophoto:', digitizerOrthophoto.name);
    
    // Load and draw the orthophoto
    const img = new window.Image();
    img.onload = () => {
      console.log('✅ Image loaded successfully:', img.width, 'x', img.height);
      
      // Set canvas resolution to match image dimensions for crisp rendering
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Set display size (CSS will scale, but high-res canvas prevents blur)
      const containerWidth = canvas.parentElement.offsetWidth;
      const aspectRatio = img.height / img.width;
      canvas.style.width = '100%';
      canvas.style.height = (containerWidth * aspectRatio) + 'px';
      
      // Save context and apply transformations
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Apply zoom and pan transformations
      ctx.translate(panOffset.x, panOffset.y);
      ctx.scale(zoomLevel, zoomLevel);
      
      // Draw orthophoto at native resolution
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Draw all completed rows in red
      drawnRows.forEach((row, idx) => {
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 3 / zoomLevel; // Adjust line width for zoom
        ctx.beginPath();
        row.points.forEach((point, i) => {
          if (i === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        
        // Draw row number label at the midpoint with background
        if (row.points.length >= 2) {
          const midIdx = Math.floor(row.points.length / 2);
          const midPoint = row.points[midIdx];
          
          // Draw label background
          const text = `Row ${row.number}`;
          ctx.font = `bold ${14 / zoomLevel}px Arial`;
          const textWidth = ctx.measureText(text).width;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(midPoint.x + 8 / zoomLevel, midPoint.y - 18 / zoomLevel, textWidth + 8 / zoomLevel, 20 / zoomLevel);
          
          // Draw label text
          ctx.fillStyle = '#FF0000';
          ctx.fillText(text, midPoint.x + 12 / zoomLevel, midPoint.y - 4 / zoomLevel);
        }
        
        // Draw points as circles with white border (QGIS style)
        row.points.forEach(point => {
          // White border
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2 / zoomLevel;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 6 / zoomLevel, 0, 2 * Math.PI);
          ctx.stroke();
          
          // Red fill
          ctx.fillStyle = '#FF0000';
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4 / zoomLevel, 0, 2 * Math.PI);
          ctx.fill();
        });
      });
      
      // Draw current row being drawn (in yellow)
      if (currentRow.length > 0) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3 / zoomLevel;
        ctx.beginPath();
        currentRow.forEach((point, i) => {
          if (i === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        
        // Draw points with white border (QGIS style)
        currentRow.forEach(point => {
          // White border
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2 / zoomLevel;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 6 / zoomLevel, 0, 2 * Math.PI);
          ctx.stroke();
          
          // Yellow fill
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4 / zoomLevel, 0, 2 * Math.PI);
          ctx.fill();
        });
      }
      
      ctx.restore();
    };
    img.onerror = (e) => {
      console.error('❌ Failed to load image:', e);
      showAlert('Error', 'Failed to load orthophoto image. Make sure it is a valid image file.');
    };
    img.src = digitizerOrthophoto.uri;
  }, [digitizerOrthophoto, drawnRows, currentRow, zoomLevel, panOffset]);

  // Canvas click handler for manual digitizer
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    let lastClickTime = 0;
    
    const handleClick = (e) => {
      if (!isDrawingRow) return;
      
      const rect = canvas.getBoundingClientRect();
      
      // Calculate scaled coordinates (account for CSS scaling)
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      // Apply zoom and pan inverse transformations
      const x = ((e.clientX - rect.left) * scaleX - panOffset.x) / zoomLevel;
      const y = ((e.clientY - rect.top) * scaleY - panOffset.y) / zoomLevel;
      
      console.log('Click:', { clientX: e.clientX, clientY: e.clientY, x, y, zoom: zoomLevel, pan: panOffset });
      
      // Check for double-click
      const now = Date.now();
      if (now - lastClickTime < 300 && currentRow.length >= 2) {
        // Double-click: finish row
        setDrawnRows([...drawnRows, { 
          id: `row_${drawnRows.length + 1}`,
          points: currentRow,
          number: drawnRows.length + 1
        }]);
        setCurrentRow([]);
        setIsDrawingRow(false);
        showAlert('Row Completed', `Row ${drawnRows.length + 1} saved. Click "Draw New Row" to continue.`);
        return;
      }
      lastClickTime = now;
      
      // Single click: add point
      setCurrentRow([...currentRow, { x, y }]);
    };
    
    // Mouse wheel zoom
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(0.1, zoomLevel * delta), 10);
      
      // Zoom towards mouse cursor
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
      const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
      
      const newPanX = mouseX - (mouseX - panOffset.x) * (newZoom / zoomLevel);
      const newPanY = mouseY - (mouseY - panOffset.y) * (newZoom / zoomLevel);
      
      setZoomLevel(newZoom);
      setPanOffset({ x: newPanX, y: newPanY });
    };
    
    // Pan with middle mouse or space+drag
    const handleMouseDown = (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && !isDrawingRow)) { // Middle, right, or left when not drawing
        e.preventDefault();
        setIsPanning(true);
        setLastPanPoint({ x: e.clientX, y: e.clientY });
        canvas.style.cursor = 'grabbing';
      }
    };
    
    const handleMouseMove = (e) => {
      if (isPanning && lastPanPoint) {
        e.preventDefault();
        const dx = e.clientX - lastPanPoint.x;
        const dy = e.clientY - lastPanPoint.y;
        setPanOffset({ 
          x: panOffset.x + dx,
          y: panOffset.y + dy
        });
        setLastPanPoint({ x: e.clientX, y: e.clientY });
      }
    };
    
    const handleMouseUp = (e) => {
      if (isPanning) {
        setIsPanning(false);
        setLastPanPoint(null);
        canvas.style.cursor = isDrawingRow ? 'crosshair' : 'grab';
      }
    };
    
    const handleContextMenu = (e) => {
      e.preventDefault(); // Prevent right-click menu
    };
    
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isDrawingRow, currentRow, drawnRows, zoomLevel, panOffset, isPanning, lastPanPoint]);

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

  // Pick images for annotation
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

  // Remove annotation image
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
          const avgTimePerImage = 4000; // 4 seconds per image for YOLO
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
          timeout: 1800000, // 30 minutes for large batches
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

  // ==================== ANNOTATION EDITOR FUNCTIONS ====================
  
  // Open annotation editor for a specific image
  const openAnnotationEditor = (result, index) => {
    if (!result || !result.annotations) {
      showAlert('Error', 'No annotation data available for this image');
      return;
    }
    
    // Copy detections to editing state
    const detections = result.annotations.detections?.map((det, idx) => ({
      ...det,
      id: idx,
      isModified: false
    })) || [];
    
    // Get image dimensions from annotation data or use defaults
    const imageSize = result.annotations.image_size || {};
    const imgWidth = imageSize.width || result.annotations.image_width || 4000;
    const imgHeight = imageSize.height || result.annotations.image_height || 3000;
    console.log('📐 Annotation image_size:', result.annotations.image_size);
    console.log('📐 Using dimensions:', imgWidth, 'x', imgHeight);
    console.log('📐 Detections:', result.annotations.detections?.length || 0);
    if (result.annotations.detections?.length > 0) {
      console.log('📐 First detection bbox:', result.annotations.detections[0].bbox);
    }
    setEditorImageDimensions({ width: imgWidth, height: imgHeight });
    
    // Also try to load actual image dimensions from the image file
    if (Platform.OS === 'web') {
      const img = new window.Image();
      img.onload = () => {
        setEditorImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        console.log('📐 Loaded image dimensions:', img.naturalWidth, 'x', img.naturalHeight);
      };
      img.src = `${BACKEND_URL.replace('/api', '')}/uploads/${result.original_image || result.image}`;
    }
    
    setEditingAnnotations(detections);
    setEditingImageData({
      index,
      image: result.image,
      originalImage: result.original_image || result.image,
      annotated_image: result.annotated_image,
      annotations: result.annotations
    });
    setSelectedDetection(null);
    setAnnotationEditorVisible(true);
    setCurrentAnnotationIndex(index);
  };

  // Close annotation editor
  const closeAnnotationEditor = async (saveChanges = false) => {
    if (saveChanges && editingImageData) {
      // Save changes back to results (with alert)
      await saveAnnotationChanges(true);
    }
    
    setAnnotationEditorVisible(false);
    setEditingAnnotations([]);
    setEditingImageData(null);
    setSelectedDetection(null);
    setIsDrawingNewBox(false);
    setNewBoxStart(null);
    setNewBoxEnd(null);
  };

  // Save annotation changes to backend
  const saveAnnotationChanges = async (showSuccessAlert = true) => {
    if (!editingImageData) return;
    
    try {
      setLoading(true);
      
      // Extract imageId from the annotation file (keep annotated_ prefix as that's the file naming convention)
      const imageId = editingImageData.annotations?.image?.replace(/\.[^/.]+$/, '');
      console.log('💾 Saving annotations for imageId:', imageId);
      
      // Update local results state
      if (results?.data?.yoloResults) {
        const updatedResults = [...results.data.yoloResults];
        updatedResults[editingImageData.index] = {
          ...updatedResults[editingImageData.index],
          annotations: {
            ...updatedResults[editingImageData.index].annotations,
            detections: editingAnnotations.map(det => ({
              class: det.class,
              class_id: det.class_id,
              confidence: det.confidence,
              bbox: det.bbox,
              bbox_normalized: det.bbox_normalized
            })),
            detection_count: editingAnnotations.length,
            status: 'corrected'
          }
        };
        
        setResults({
          ...results,
          data: {
            ...results.data,
            yoloResults: updatedResults
          }
        });
      }
      
      // Save to backend if we have an imageId
      if (imageId) {
        await axios.put(`${BACKEND_URL}/annotations/${imageId}`, {
          detections: editingAnnotations,
          status: 'corrected'
        });
      }
      
      setLoading(false);
      if (showSuccessAlert) {
        showAlert('Success', 'Annotations saved successfully!');
      }
    } catch (error) {
      setLoading(false);
      console.error('Failed to save annotations:', error);
      if (showSuccessAlert) {
        showAlert('Error', 'Failed to save annotations: ' + error.message);
      }
    }
  };

  // Delete selected detection
  const deleteSelectedDetection = () => {
    if (selectedDetection === null) {
      showAlert('Info', 'Please select a bounding box to delete');
      return;
    }
    
    setEditingAnnotations(prev => prev.filter((_, idx) => idx !== selectedDetection));
    setSelectedDetection(null);
  };

  // Change label of selected detection
  const changeDetectionLabel = (newLabel, classId = 0) => {
    if (selectedDetection === null) return;
    
    setEditingAnnotations(prev => prev.map((det, idx) => 
      idx === selectedDetection 
        ? { ...det, class: newLabel, class_id: classId, isModified: true }
        : det
    ));
  };

  // Add new detection box
  const addNewDetection = (bbox, label = 'vine') => {
    const newDetection = {
      id: editingAnnotations.length,
      class: label,
      class_id: availableLabels.indexOf(label),
      confidence: 1.0, // Manual annotation = 100% confidence
      bbox: {
        x1: Math.min(bbox.x1, bbox.x2),
        y1: Math.min(bbox.y1, bbox.y2),
        x2: Math.max(bbox.x1, bbox.x2),
        y2: Math.max(bbox.y1, bbox.y2),
        width: Math.abs(bbox.x2 - bbox.x1),
        height: Math.abs(bbox.y2 - bbox.y1)
      },
      bbox_normalized: {}, // Will be calculated when exporting
      isModified: true,
      isManual: true
    };
    
    setEditingAnnotations(prev => [...prev, newDetection]);
    setSelectedDetection(editingAnnotations.length);
  };

  // Update detection position (for drag)
  const updateDetectionPosition = (index, dx, dy) => {
    setEditingAnnotations(prev => prev.map((det, idx) => {
      if (idx !== index) return det;
      return {
        ...det,
        bbox: {
          ...det.bbox,
          x1: det.bbox.x1 + dx,
          y1: det.bbox.y1 + dy,
          x2: det.bbox.x2 + dx,
          y2: det.bbox.y2 + dy
        },
        isModified: true
      };
    }));
  };

  // Update detection size (for resize)
  const updateDetectionSize = (index, newBbox) => {
    setEditingAnnotations(prev => prev.map((det, idx) => {
      if (idx !== index) return det;
      return {
        ...det,
        bbox: {
          x1: Math.min(newBbox.x1, newBbox.x2),
          y1: Math.min(newBbox.y1, newBbox.y2),
          x2: Math.max(newBbox.x1, newBbox.x2),
          y2: Math.max(newBbox.y1, newBbox.y2),
          width: Math.abs(newBbox.x2 - newBbox.x1),
          height: Math.abs(newBbox.y2 - newBbox.y1)
        },
        isModified: true
      };
    }));
  };

  // Export corrected annotations as PNG
  const exportAnnotatedImage = async () => {
    if (!editingImageData) return;
    
    try {
      setLoading(true);
      
      // First save the current annotations to ensure backend has latest
      await saveAnnotationChanges(false);
      
      const imageId = editingImageData.annotations?.image?.replace(/\.[^/.]+$/, '');
      
      const response = await axios.post(`${BACKEND_URL}/annotations/${imageId}/export`, {
        format: 'png'
      });
      
      if (response.data.success && response.data.base64) {
        // Download the image
        if (Platform.OS === 'web') {
          const link = document.createElement('a');
          link.href = response.data.base64;
          link.download = `corrected_${editingImageData.image}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        showAlert('Success', 'Corrected image exported!');
      }
      
      setLoading(false);
    } catch (error) {
      setLoading(false);
      showAlert('Error', 'Failed to export image: ' + error.message);
    }
  };

  // Export JSON annotation file for current image
  const exportAnnotationJSON = async () => {
    if (!editingImageData) return;
    
    try {
      const imageId = editingImageData.annotations?.image?.replace(/\.[^/.]+$/, '');
      
      // Create JSON with current annotations
      const annotationData = {
        image: editingImageData.image,
        image_path: editingImageData.annotations?.image_path,
        timestamp: new Date().toISOString(),
        image_size: editorImageDimensions,
        detections: editingAnnotations.map(det => ({
          class: det.class,
          class_id: det.class_id || 0,
          confidence: det.confidence,
          bbox: det.bbox,
          bbox_normalized: det.bbox_normalized || {},
          isManual: det.isManual || false
        })),
        detection_count: editingAnnotations.length,
        status: 'corrected'
      };
      
      // Download JSON
      if (Platform.OS === 'web') {
        const blob = new Blob([JSON.stringify(annotationData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${imageId}_annotations.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      
      showAlert('Success', 'JSON annotations exported!');
    } catch (error) {
      showAlert('Error', 'Failed to export JSON: ' + error.message);
    }
  };

  // Export both image and JSON
  const exportBoth = async () => {
    if (!editingImageData) return;
    
    try {
      setLoading(true);
      await exportAnnotatedImage();
      await exportAnnotationJSON();
      setLoading(false);
    } catch (error) {
      setLoading(false);
      showAlert('Error', 'Failed to export: ' + error.message);
    }
  };

  // Download all modified/corrected annotations as ZIP
  const downloadAllModified = async () => {
    try {
      setDownloadingZip(true);
      
      const response = await axios.get(`${BACKEND_URL}/download-modified`, {
        responseType: 'blob'
      });
      
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = `modified_annotations_${Date.now()}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
      
      setDownloadingZip(false);
      showAlert('Success', 'Downloaded all modified annotations as ZIP!');
    } catch (error) {
      setDownloadingZip(false);
      if (error.response?.status === 404) {
        showAlert('Info', 'No modified annotations found. Edit some annotations first!');
      } else {
        showAlert('Error', 'Failed to download: ' + error.message);
      }
    }
  };

  // Navigate to next/previous image in editor
  const navigateAnnotationEditor = async (direction) => {
    if (!results?.data?.yoloResults) return;
    
    const totalImages = results.data.yoloResults.length;
    let newIndex = currentAnnotationIndex + direction;
    
    if (newIndex < 0) newIndex = totalImages - 1;
    if (newIndex >= totalImages) newIndex = 0;
    
    // Save current changes silently (don't show alert)
    await saveAnnotationChanges(false);
    
    // Open next image
    const nextResult = results.data.yoloResults[newIndex];
    openAnnotationEditor(nextResult, newIndex);
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

  const removeAllImages = () => {
    setSelectedImages([]);
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

    if (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && analysisType !== 'orthophoto-gaps' && selectedImages.length === 0) {
      showAlert('Error', 'Please select at least one image');
      return;
    }

    if (analysisType === 'orthophoto-gaps' && selectedImages.length === 0) {
      showAlert('Error', 'Please select an orthophoto image');
      return;
    }

    if (analysisType === 'orthophoto-gaps' && !rowsGeojson) {
      showAlert('Rows GeoJSON Required', 'Please upload a rows.geojson file for gap detection analysis');
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
        console.log('🔍 Checking YOLO conditions:');
        console.log('  - enableAutoAnnotation:', enableAutoAnnotation);
        console.log('  - annotations count:', response.data.data.annotations?.length);
        console.log('  - annotatedImages count:', response.data.data.annotatedImages?.length);
        
        // If YOLO auto-annotation is enabled, run it next
        if (enableAutoAnnotation && response.data.data.annotations && response.data.data.annotatedImages) {
          console.log('🤖 Starting YOLO auto-annotation...');
          await runYoloAutoAnnotation(response.data.data.annotations, response.data.data.annotatedImages);
        } else {
          console.log('⚠️ YOLO auto-annotation skipped');
          if (!enableAutoAnnotation) console.log('  Reason: YOLO not enabled');
          if (!response.data.data.annotations) console.log('  Reason: No annotations');
          if (!response.data.data.annotatedImages) console.log('  Reason: No annotated images');
          
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
        // ORTHOPHOTO GAP ANALYSIS
        // ===================================================================
      } else if (analysisType === 'orthophoto-gaps') {
        console.log('🗺️ Processing orthophoto gap detection...');

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
                Detect gaps, generate orthomosaics, or digitize vineyard rows
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
                analysisType === 'orthophoto' ? '🗺️ Orthophoto Tools' :
                  analysisType === 'orthophoto-gaps' ? '🔍 Gap Detection' :
                    analysisType === 'image-annotation' ? '🏷️ Annotation' :
                      analysisType === 'training-dataset' ? '📦 Training Dataset' :
                        analysisType === 'generate-orthomosaic' ? '🌍 Generate Orthomosaic' :
                          analysisType === 'manual-digitizer' ? '📍 Manual Row Digitizer' : '🚁 DJI Log'}
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
          ) : analysisType === 'generate-orthomosaic' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🌍 Generate Orthomosaic</Text>
                <Text style={styles.sectionDesc}>
                  Upload georeferenced images (TIF/JPG) and merge them into a high-quality orthophoto
                </Text>
              </View>

              <View style={styles.infoBox}>
                <Text style={styles.infoEmoji}>ℹ️</Text>
                <Text style={styles.infoText}>
                  Local orthomosaic processor using GDAL. Merges georeferenced images into a single TIF file. Processing 100-500 images takes 5-15 minutes depending on image size and quality settings.
                </Text>
              </View>

              {/* Step 1: Create or Select Project */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 1: Project Name</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.projectInput}
                    placeholder="Enter project name (e.g., vineyard_2024)"
                    value={orthomosaicProjectName}
                    onChangeText={setOrthomosaicProjectName}
                  />
                  <TouchableOpacity 
                    style={styles.createProjectBtn}
                    onPress={() => {
                      if (orthomosaicProjectName.trim()) {
                        showAlert('Success', `Project "${orthomosaicProjectName}" is ready`);
                      } else {
                        showAlert('Error', 'Please enter a project name');
                      }
                    }}
                  >
                    <Text style={styles.createProjectText}>Create</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Step 2: Upload Images */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 2: Upload Drone Images</Text>
                <Text style={styles.sectionDesc}>
                  Select 20+ overlapping drone images (JPG, PNG). Images should have GPS metadata (EXIF).
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={async () => {
                  try {
                    if (Platform.OS === 'web') {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/jpeg,image/jpg,image/png';
                      input.multiple = true;
                      input.onchange = (e) => {
                        const files = Array.from(e.target.files);
                        const images = files.map(file => ({
                          uri: URL.createObjectURL(file),
                          name: file.name,
                          type: file.type,
                          size: file.size,
                          file: file
                        }));
                        setDroneImages(images);
                      };
                      input.click();
                    } else {
                      const result = await DocumentPicker.getDocumentAsync({
                        type: ['image/jpeg', 'image/jpg', 'image/png'],
                        multiple: true,
                        copyToCacheDirectory: true,
                      });
                      if (!result.canceled) {
                        setDroneImages(result.assets);
                      }
                    }
                  } catch (error) {
                    showAlert('Error', 'Failed to select images: ' + error.message);
                  }
                }}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>📷</Text>
                <Text style={styles.uploadText}>
                  {droneImages.length === 0 ? 'Select Drone Images' : `${droneImages.length} Images Selected`}
                </Text>
              </TouchableOpacity>

              {droneImages.length > 0 && (
                <View style={styles.imagesList}>
                  <View style={styles.imagesListHeader}>
                    <Text style={styles.imagesListTitle}>
                      Selected Images ({droneImages.length})
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setDroneImages([])}
                      style={styles.deleteAllBtn}
                    >
                      <Text style={styles.deleteAllText}>🗑️ Delete All</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    data={droneImages.slice(0, 5)}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => (
                      <View style={styles.imageRow}>
                        <Image
                          source={{ uri: item.uri }}
                          style={styles.imageThumbnail}
                        />
                        <Text style={styles.imageName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.imageSize}>
                          {(item.size / (1024 * 1024)).toFixed(2)} MB
                        </Text>
                        <TouchableOpacity onPress={() => {
                          setDroneImages(droneImages.filter((_, i) => i !== index));
                        }}>
                          <Text style={styles.removeIcon}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    keyExtractor={(_, idx) => idx.toString()}
                  />
                  {droneImages.length > 5 && (
                    <View style={styles.moreFilesIndicator}>
                      <Text style={styles.moreFilesText}>
                        + {droneImages.length - 5} more images
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Step 3: Quality Settings */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 3: Quality Settings</Text>
                <Text style={styles.optionLabel}>Processing Quality</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicQuality === 'low' && styles.segmentActive]}
                    onPress={() => setOrthomosaicQuality('low')}
                  >
                    <Text style={[styles.segmentText, orthomosaicQuality === 'low' && styles.segmentTextActive]}>
                      Low (Fast)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicQuality === 'medium' && styles.segmentActive]}
                    onPress={() => setOrthomosaicQuality('medium')}
                  >
                    <Text style={[styles.segmentText, orthomosaicQuality === 'medium' && styles.segmentTextActive]}>
                      Medium
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicQuality === 'high' && styles.segmentActive]}
                    onPress={() => setOrthomosaicQuality('high')}
                  >
                    <Text style={[styles.segmentText, orthomosaicQuality === 'high' && styles.segmentTextActive]}>
                      High
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicQuality === 'ultra' && styles.segmentActive]}
                    onPress={() => setOrthomosaicQuality('ultra')}
                  >
                    <Text style={[styles.segmentText, orthomosaicQuality === 'ultra' && styles.segmentTextActive]}>
                      Ultra (Slow)
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.optionLabel}>Feature Quality</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicFeatureQuality === 'low' && styles.segmentActive]}
                    onPress={() => setOrthomosaicFeatureQuality('low')}
                  >
                    <Text style={[styles.segmentText, orthomosaicFeatureQuality === 'low' && styles.segmentTextActive]}>
                      Low
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicFeatureQuality === 'medium' && styles.segmentActive]}
                    onPress={() => setOrthomosaicFeatureQuality('medium')}
                  >
                    <Text style={[styles.segmentText, orthomosaicFeatureQuality === 'medium' && styles.segmentTextActive]}>
                      Medium
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segment, orthomosaicFeatureQuality === 'high' && styles.segmentActive]}
                    onPress={() => setOrthomosaicFeatureQuality('high')}
                  >
                    <Text style={[styles.segmentText, orthomosaicFeatureQuality === 'high' && styles.segmentTextActive]}>
                      High
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Step 4: Process Button */}
              <TouchableOpacity
                style={[styles.analyzeBtn, (!orthomosaicProjectName || droneImages.length < 5 || loading) && styles.analyzeBtnDisabled]}
                onPress={async () => {
                  if (!orthomosaicProjectName) {
                    showAlert('Error', 'Please enter a project name');
                    return;
                  }
                  if (droneImages.length < 5) {
                    showAlert('Error', 'Please select at least 5 images (20+ recommended for best results)');
                    return;
                  }

                  try {
                    setLoading(true);
                    setOrthomosaicProcessingStatus('Creating project...');

                    // Step 1: Create project
                    const createResponse = await axios.post(`${BACKEND_URL}/orthomosaic/create`, {
                      project_name: orthomosaicProjectName
                    });

                    const projectId = createResponse.data.project_id;
                    setSelectedOrthomosaicProject(createResponse.data);
                    setOrthomosaicProcessingStatus(`Project created: ${orthomosaicProjectName}`);

                    // Step 2: Upload images in chunks (100 at a time)
                    setOrthomosaicProcessingStatus(`Preparing to upload ${droneImages.length} images...`);
                    const chunkSize = 100;
                    const chunks = [];
                    for (let i = 0; i < droneImages.length; i += chunkSize) {
                      chunks.push(droneImages.slice(i, i + chunkSize));
                    }

                    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                      const chunk = chunks[chunkIndex];
                      setOrthomosaicProcessingStatus(
                        `Uploading batch ${chunkIndex + 1}/${chunks.length} (${chunk.length} images)...`
                      );

                      const formData = new FormData();
                      
                      for (let i = 0; i < chunk.length; i++) {
                        const img = chunk[i];
                        
                        if (Platform.OS === 'web') {
                          if (img.file) {
                            formData.append('images', img.file, img.name);
                          } else {
                            const response = await fetch(img.uri);
                            const blob = await response.blob();
                            formData.append('images', blob, img.name);
                          }
                        } else {
                          formData.append('images', {
                            uri: img.uri,
                            type: img.type || 'image/jpeg',
                            name: img.name,
                          });
                        }
                      }

                      formData.append('project_id', projectId);

                      const uploadResponse = await axios.post(
                        `${BACKEND_URL}/orthomosaic/upload`,
                        formData,
                        {
                          headers: { 'Content-Type': 'multipart/form-data' },
                          timeout: 600000, // 10 minutes per chunk
                        }
                      );
                    }

                    setOrthomosaicProcessingStatus('All images uploaded successfully. Starting processing...');

                    // Step 3: Start processing
                    const processResponse = await axios.post(`${BACKEND_URL}/orthomosaic/process`, {
                      project_id: projectId,
                      options: {
                        quality: orthomosaicQuality,
                        feature_quality: orthomosaicFeatureQuality,
                        dsm: true,
                        dtm: true,
                        orthophoto_resolution: orthomosaicQuality === 'ultra' ? 2 : orthomosaicQuality === 'high' ? 5 : 10,
                        use_3dmesh: true
                      }
                    });

                    setOrthomosaicProcessingStatus('Processing started! This will take 15-60 minutes depending on image count and quality settings.');
                    
                    showAlert(
                      'Processing Started',
                      `Processing ${droneImages.length} images with local orthomosaic generator.\n\n` +
                      `Project: ${orthomosaicProjectName}\n` +
                      `Quality: ${orthomosaicQuality}\n` +
                      `Estimated time: ${droneImages.length < 50 ? '15-30' : droneImages.length < 200 ? '30-60' : '60-120'} minutes\n\n` +
                      `You can check progress in the backend logs.`
                    );

                    // Show real-time processing dashboard
                    setResults({
                      type: 'orthomosaic-processing',
                      data: {
                        project_id: projectId,
                        project_name: orthomosaicProjectName,
                        status: 'processing',
                        images_count: droneImages.length,
                        started_at: new Date().toISOString(),
                        quality: orthomosaicQuality,
                        feature_quality: orthomosaicFeatureQuality
                      }
                    });

                    // Start polling for status
                    const statusInterval = setInterval(async () => {
                      try {
                        const statusResponse = await axios.get(`${BACKEND_URL}/orthomosaic/status/${projectId}`);
                        const status = statusResponse.data.status;
                        
                        console.log('📊 Status Update:', status);
                        const progressValue = (status.progress || 0).toFixed(2);
                        setOrthomosaicProcessingStatus(`Status: ${status.status} - ${progressValue}%`);

                        // Update results with current status
                        setResults(prev => ({
                          ...prev,
                          data: {
                            ...prev.data,
                            status: status.status,
                            progress: status.progress || 0
                          }
                        }));

                        if (status.status === 'completed' && status.progress === 100) {
                          console.log('✅ COMPLETION DETECTED - Switching to download screen');
                          clearInterval(statusInterval);
                          setLoading(false);
                          setOrthomosaicProcessingStatus('Processing complete! Orthomosaic is ready.');
                          
                          // Update to completed state - this triggers the download screen
                          setResults({
                            type: 'orthomosaic',
                            data: {
                              project_id: projectId,
                              project_name: orthomosaicProjectName,
                              status: 'completed',
                              images_count: droneImages.length,
                              completed_at: status.completed_at || new Date().toISOString(),
                              quality: orthomosaicQuality
                            }
                          });
                          
                          showAlert('Success', 'Orthomosaic generation completed successfully!');
                        } else if (status.status === 'failed') {
                          clearInterval(statusInterval);
                          setLoading(false);
                          setOrthomosaicProcessingStatus('Processing failed. Check backend logs for details.');
                          showAlert('Error', 'Processing failed: ' + (status.error || 'Unknown error'));
                        }
                      } catch (error) {
                        console.error('Status check error:', error);
                      }
                    }, 5000); // Check every 5 seconds

                    setLoading(false);

                  } catch (error) {
                    setLoading(false);
                    setOrthomosaicProcessingStatus('Error: ' + error.message);
                    showAlert('Error', 'Failed to process orthomosaic: ' + error.message);
                  }
                }}
                disabled={!orthomosaicProjectName || droneImages.length < 5 || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.analyzeBtnText}>
                    🚀 Start Processing
                  </Text>
                )}
              </TouchableOpacity>

              {orthomosaicProcessingStatus && (
                <View style={styles.infoBox}>
                  <Text style={styles.infoEmoji}>⏳</Text>
                  <Text style={styles.infoText}>
                    {orthomosaicProcessingStatus}
                  </Text>
                </View>
              )}
            </>
          ) : analysisType === 'manual-digitizer' ? (
            <>
              <View style={styles.infoBox}>
                <Text style={styles.infoEmoji}>ℹ️</Text>
                <Text style={styles.infoText}>
                  Load a georeferenced orthophoto, then draw lines to mark vineyard rows. Click to add points along each row, double-click to finish. Rows will be numbered automatically.
                </Text>
              </View>

              {/* Step 1: Load Orthophoto */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 1: Load Orthophoto</Text>
                <Text style={styles.sectionDesc}>
                  Select an orthophoto (TIFF will be auto-converted to PNG, or use PNG/JPG directly)
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={async () => {
                  try {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.tif,.tiff,.png,.jpg,.jpeg';
                    input.onchange = async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      
                      // Check if it's a TIFF file
                      if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
                        setLoading(true);
                        showAlert('Processing...', 'Converting TIFF and extracting coordinates...');
                        
                        try {
                          // First, extract GeoTIFF metadata
                          const arrayBuffer = await file.arrayBuffer();
                          let extractedBounds = null;
                          try {
                            const tiff = await fromArrayBuffer(arrayBuffer);
                            const image = await tiff.getImage();
                            const bbox = image.getBoundingBox();
                            
                            if (bbox && bbox.length === 4) {
                              extractedBounds = {
                                minLng: bbox[0],
                                minLat: bbox[1],
                                maxLng: bbox[2],
                                maxLat: bbox[3]
                              };
                              setGeoBounds(extractedBounds);
                              console.log('✅ Extracted GeoTIFF bounds:', bbox);
                            } else {
                              console.warn('⚠️ No geospatial info found, using default bounds');
                              setGeoBounds(null);
                            }
                          } catch (geoErr) {
                            console.warn('⚠️ Could not extract geospatial info:', geoErr);
                            setGeoBounds(null);
                          }
                          
                          // Upload TIFF to backend for conversion
                          const formData = new FormData();
                          formData.append('tiff', file);
                          // Send bounds to backend so we can include them in response
                          if (extractedBounds) {
                            formData.append('bounds', JSON.stringify(extractedBounds));
                          }
                          
                          const response = await axios.post(`${BACKEND_URL}/api/convert-tiff`, formData, {
                            headers: { 'Content-Type': 'multipart/form-data' }
                          });
                          
                          if (response.data.success) {
                            // Restore bounds from backend response if available
                            if (response.data.bounds) {
                              setGeoBounds(response.data.bounds);
                            } else if (extractedBounds) {
                              setGeoBounds(extractedBounds);
                            }
                            
                            setDigitizerOrthophoto({
                              uri: response.data.base64,
                              name: response.data.filename,
                              size: file.size,
                              originalName: file.name
                            });
                            setDrawnRows([]);
                            setCurrentRow([]);
                            setIsDrawingRow(false);
                            
                            const currentBounds = response.data.bounds || extractedBounds || geoBounds;
                            const boundsMsg = currentBounds
                              ? `\n✅ Coordinates: ${currentBounds.minLng.toFixed(6)}, ${currentBounds.minLat.toFixed(6)} to ${currentBounds.maxLng.toFixed(6)}, ${currentBounds.maxLat.toFixed(6)}`
                              : '\n⚠️ No georeferencing found - coordinates may be inaccurate';
                            showAlert('Success', `TIFF converted!${boundsMsg}\n\nClick "Draw New Row" to begin.`);
                          } else {
                            showAlert('Error', 'Failed to convert TIFF file');
                          }
                        } catch (error) {
                          console.error('TIFF conversion error:', error);
                          showAlert('Error', 
                            'Failed to convert TIFF file. Error: ' + error.message + '\n\n' +
                            'Please convert your TIFF to PNG/JPG using QGIS first:\n' +
                            'Right-click layer → Export → Save As → PNG/JPEG');
                        } finally {
                          setLoading(false);
                        }
                        return;
                      }
                      
                      // Regular image file (PNG/JPG) - no geospatial info
                      setGeoBounds(null);
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        setDigitizerOrthophoto({
                          uri: event.target.result,
                          name: file.name,
                          size: file.size
                        });
                        setDrawnRows([]);
                        setCurrentRow([]);
                        setIsDrawingRow(false);
                        showAlert('Image Loaded', 
                          'PNG/JPG loaded successfully!\n\n' +
                          '⚠️ Note: PNG/JPG files don\'t contain geospatial coordinates.\n' +
                          'Exported coordinates will be approximate. Use GeoTIFF for accurate results.');
                      };
                      reader.readAsDataURL(file);
                    };
                    input.click();
                  } catch (error) {
                    showAlert('Error', 'Failed to load orthophoto: ' + error.message);
                  }
                }}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>🗺️</Text>
                <Text style={styles.uploadText}>
                  {digitizerOrthophoto ? `✓ ${digitizerOrthophoto.name}` : 'Load Orthophoto'}
                </Text>
              </TouchableOpacity>

              {/* Step 2: Interactive Drawing Canvas */}
              {digitizerOrthophoto && (
                <>
                  {geoBounds && (
                    <View style={styles.geoBoundsCardStyle}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Text style={{ fontSize: 20, marginRight: 8 }}>🌍</Text>
                        <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#10b981' }}>Georeferenced</Text>
                        <View style={styles.successBadgeStyle}>
                          <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold' }}>ACTIVE</Text>
                        </View>
                      </View>
                      <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, flex: 1, minWidth: 140 }}>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Min Lng</Text>
                            <Text style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{geoBounds.minLng.toFixed(6)}</Text>
                          </View>
                          <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, flex: 1, minWidth: 140 }}>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Min Lat</Text>
                            <Text style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{geoBounds.minLat.toFixed(6)}</Text>
                          </View>
                          <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, flex: 1, minWidth: 140 }}>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Max Lng</Text>
                            <Text style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{geoBounds.maxLng.toFixed(6)}</Text>
                          </View>
                          <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, flex: 1, minWidth: 140 }}>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Max Lat</Text>
                            <Text style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{geoBounds.maxLat.toFixed(6)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                  
                  {!geoBounds && (
                    <View style={styles.warningCardStyle}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ fontSize: 20, marginRight: 8 }}>⚠️</Text>
                        <View>
                          <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#fbbf24' }}>No Georeferencing</Text>
                          <Text style={{ fontSize: 12, color: '#fcd34d', marginTop: 4 }}>Pixel coordinates only - may not match QGIS</Text>
                        </View>
                      </View>
                    </View>
                  )}
                  
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Step 2: Draw Vineyard Rows</Text>
                    <Text style={styles.sectionDesc}>
                      Click to add points, double-click to finish each row
                    </Text>
                  </View>

                  {/* Drawing Canvas with Orthophoto */}
                  <View style={styles.canvasContainerModern}>
                    {/* Zoom Controls Overlay */}
                    <View style={styles.zoomControlsModern}>
                      <TouchableOpacity
                        style={styles.zoomBtnModern}
                        onPress={() => {
                          const newZoom = Math.min(zoomLevel * 1.2, 10);
                          setZoomLevel(newZoom);
                        }}
                      >
                        <Text style={{ fontSize: 20, color: '#fff', fontWeight: '300' }}>+</Text>
                      </TouchableOpacity>
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center' }}>ZOOM</Text>
                        <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', textAlign: 'center' }}>{Math.round(zoomLevel * 100)}%</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.zoomBtnModern}
                        onPress={() => {
                          const newZoom = Math.max(zoomLevel * 0.8, 0.1);
                          setZoomLevel(newZoom);
                        }}
                      >
                        <Text style={{ fontSize: 20, color: '#fff', fontWeight: '300' }}>−</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.zoomBtnModern, { backgroundColor: '#475569', marginTop: 8 }]}
                        onPress={() => {
                          setZoomLevel(1);
                          setPanOffset({ x: 0, y: 0 });
                        }}
                      >
                        <Text style={{ fontSize: 16, color: '#fff' }}>⟲</Text>
                      </TouchableOpacity>
                    </View>
                    
                    {/* Mode Indicator */}
                    <View style={styles.modeIndicatorStyle}>
                      {isDrawingRow ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={styles.pulsingDotStyle} />
                          <Text style={{ fontSize: 12, color: '#fff', fontWeight: '600' }}>Drawing Mode</Text>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 14 }}>🖱️</Text>
                          <Text style={{ fontSize: 12, color: '#94a3b8', fontWeight: '500' }}>Pan Mode</Text>
                        </View>
                      )}
                    </View>
                    
                    <canvas
                      ref={canvasRef}
                      id="digitizer-canvas"
                      style={{
                        width: '100%',
                        maxWidth: '100%',
                        height: 'auto',
                        border: '2px solid #334155',
                        borderRadius: '12px',
                        cursor: isPanning ? 'grabbing' : (isDrawingRow ? 'crosshair' : 'grab'),
                        backgroundColor: '#0f172a',
                        display: 'block',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
                      }}
                    />
                  </View>

                  {/* Drawing Controls */}
                  <View style={styles.digitizerControls}>
                    <TouchableOpacity
                      style={[styles.digitizerBtn, isDrawingRow && styles.digitizerBtnActive]}
                      onPress={() => {
                        if (isDrawingRow) {
                          // Cancel current row
                          setCurrentRow([]);
                          setIsDrawingRow(false);
                        } else {
                          // Start new row
                          setIsDrawingRow(true);
                          setCurrentRow([]);
                        }
                      }}
                    >
                      <Text style={styles.digitizerBtnText}>
                        {isDrawingRow ? '✕ Cancel' : '✏️ Draw New Row'}
                      </Text>
                    </TouchableOpacity>

                    {isDrawingRow && currentRow.length >= 2 && (
                      <TouchableOpacity
                        style={[styles.digitizerBtn, { backgroundColor: '#2e7d32' }]}
                        onPress={() => {
                          setDrawnRows([...drawnRows, { 
                            id: `row_${drawnRows.length + 1}`,
                            points: currentRow,
                            number: drawnRows.length + 1
                          }]);
                          setCurrentRow([]);
                          setIsDrawingRow(false);
                          showAlert('Row Completed', `Row ${drawnRows.length + 1} saved`);
                        }}
                      >
                        <Text style={styles.digitizerBtnText}>
                          ✓ Finish Row
                        </Text>
                      </TouchableOpacity>
                    )}

                    {drawnRows.length > 0 && (
                      <TouchableOpacity
                        style={[styles.digitizerBtn, { backgroundColor: '#d32f2f' }]}
                        onPress={() => {
                          if (drawnRows.length === 0) return;
                          setDrawnRows(drawnRows.slice(0, -1));
                          showAlert('Row Deleted', `Removed row ${drawnRows.length}`);
                        }}
                      >
                        <Text style={styles.digitizerBtnText}>
                          ⬅️ Undo Last Row
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[styles.digitizerBtn, { backgroundColor: '#666' }]}
                      onPress={() => {
                        setDrawnRows([]);
                        setCurrentRow([]);
                        setIsDrawingRow(false);
                        showAlert('Cleared', 'All rows deleted');
                      }}
                      disabled={drawnRows.length === 0 && currentRow.length === 0}
                    >
                      <Text style={styles.digitizerBtnText}>
                        🗑️ Clear All
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Status Display */}
                  <View style={styles.digitizerStatus}>
                    <Text style={styles.digitizerStatusText}>
                      📊 Rows digitized: <Text style={{ fontWeight: 'bold', color: '#2e7d32' }}>{drawnRows.length}</Text>
                    </Text>
                    {isDrawingRow && (
                      <Text style={styles.digitizerStatusText}>
                        ✏️ Current row: {currentRow.length} points
                      </Text>
                    )}
                  </View>

                  {/* Row List */}
                  {drawnRows.length > 0 && (
                    <View style={styles.rowListContainer}>
                      <Text style={styles.rowListTitle}>Digitized Rows:</Text>
                      <ScrollView style={styles.rowList}>
                        {drawnRows.map((row, idx) => (
                          <View key={row.id} style={styles.rowListItem}>
                            <Text style={styles.rowListNumber}>Row {row.number}</Text>
                            <Text style={styles.rowListPoints}>{row.points.length} points</Text>
                            <TouchableOpacity
                              onPress={() => {
                                const newRows = drawnRows.filter((_, i) => i !== idx);
                                // Renumber remaining rows
                                const renumbered = newRows.map((r, i) => ({
                                  ...r,
                                  number: i + 1,
                                  id: `row_${i + 1}`
                                }));
                                setDrawnRows(renumbered);
                                showAlert('Deleted', `Row ${row.number} removed`);
                              }}
                            >
                              <Text style={styles.rowListDelete}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Step 3: Export GeoJSON */}
                  {drawnRows.length > 0 && (
                    <>
                      <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Step 3: Export GeoJSON</Text>
                        <Text style={styles.sectionDesc}>
                          Download the digitized rows as GeoJSON with coordinates
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.analyzeBtn}
                        onPress={() => {
                          const canvas = document.getElementById('digitizer-canvas');
                          
                          // Use extracted GeoTIFF bounds or fallback to defaults
                          const bounds = geoBounds || {
                            minLng: 23.859,
                            maxLng: 23.861,
                            minLat: 46.183,
                            maxLat: 46.185
                          };
                          
                          if (!geoBounds) {
                            showAlert('Warning', 
                              'No geospatial coordinates found in image.\n\n' +
                              'Using approximate coordinates. For accurate results, use a GeoTIFF file.\n\n' +
                              'Proceeding with export...');
                          }
                          
                          const features = drawnRows.map((row) => {
                            const coords = row.points.map(point => {
                              // Convert pixel to lat/lng using actual bounds
                              const lng = bounds.minLng + (point.x / canvas.width) * (bounds.maxLng - bounds.minLng);
                              const lat = bounds.maxLat - (point.y / canvas.height) * (bounds.maxLat - bounds.minLat);
                              return [lng, lat];
                            });
                            
                            return {
                              type: 'Feature',
                              properties: { rand: row.number.toString() },
                              geometry: {
                                type: 'MultiLineString',
                                coordinates: [coords]
                              }
                            };
                          });
                          
                          const geojson = {
                            type: 'FeatureCollection',
                            name: `digitized_rows_${Date.now()}`,
                            crs: {
                              type: 'name',
                              properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }
                            },
                            features
                          };
                          
                          // Export GeoJSON
                          const dataStr = JSON.stringify(geojson, null, 2);
                          const dataBlob = new Blob([dataStr], { type: 'application/json' });
                          const url = URL.createObjectURL(dataBlob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `digitized_rows_${Date.now()}.geojson`;
                          link.click();
                          URL.revokeObjectURL(url);
                          
                          const coordMsg = geoBounds 
                            ? `\nCoordinates: ${bounds.minLng.toFixed(6)} to ${bounds.maxLng.toFixed(6)}, ${bounds.minLat.toFixed(6)} to ${bounds.maxLat.toFixed(6)}`
                            : '\n⚠️ Using approximate coordinates';
                          showAlert('Success', `Exported ${drawnRows.length} rows to GeoJSON${coordMsg}`);
                        }}
                      >
                        <Text style={styles.analyzeBtnText}>
                          📥 Export GeoJSON
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </>
          ) : analysisType === 'orthophoto' ? (
            <>
              {/* Orthophoto Mode Selection */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🗺️ Orthophoto Tools</Text>
                <Text style={styles.sectionDesc}>
                  Choose your workflow
                </Text>
              </View>

              <View style={styles.cardsContainer}>
                <TouchableOpacity
                  style={[styles.card]}
                  onPress={() => setAnalysisType('orthophoto-gaps')}
                >
                  <Text style={styles.cardEmoji}>🔍</Text>
                  <Text style={styles.cardTitle}>Detect Gaps</Text>
                  <Text style={styles.cardDesc}>
                    Analyze orthophoto to detect bare soil and gaps in vineyard rows
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.card, styles.cardOrthomosaic]}
                  onPress={() => setAnalysisType('generate-orthomosaic')}
                >
                  <Text style={styles.cardEmoji}>🌍</Text>
                  <Text style={styles.cardTitle}>Generate Orthomosaic</Text>
                  <Text style={styles.cardDesc}>
                    Merge georeferenced images into orthophotos locally
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.card, styles.cardDigitizer]}
                  onPress={() => setAnalysisType('manual-digitizer')}
                >
                  <Text style={styles.cardEmoji}>📍</Text>
                  <Text style={styles.cardTitle}>Digitize Rows</Text>
                  <Text style={styles.cardDesc}>
                    Manually draw vineyard rows on orthophoto and export to GeoJSON
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : analysisType === 'orthophoto-gaps' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 1: Select Orthophoto</Text>
                <Text style={styles.sectionDesc}>
                  Upload your orthophoto image (.tif format)
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

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 2: Upload Rows GeoJSON (Required) ⚠️</Text>
                <Text style={styles.sectionDesc}>
                  Upload rows.geojson file to define vineyard row locations
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.uploadBtn, styles.uploadBtnSecondary, !rowsGeojson && styles.uploadBtnRequired]}
                onPress={pickRowsGeojson}
                disabled={loading}
              >
                <Text style={styles.uploadEmoji}>📍</Text>
                <Text style={styles.uploadText}>
                  {rowsGeojson ? `✓ ${rowsGeojson.name || 'GeoJSON Selected'}` : '⚠️ Select Rows GeoJSON (REQUIRED)'}
                </Text>
              </TouchableOpacity>

              {rowsGeojson && (
                <View style={styles.geojsonInfo}>
                  <Text style={styles.geojsonName}>✓ {rowsGeojson.name || 'rows.geojson'}</Text>
                  <TouchableOpacity onPress={() => setRowsGeojson(null)}>
                    <Text style={styles.removeIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!rowsGeojson && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningEmoji}>⚠️</Text>
                  <Text style={styles.warningText}>
                    Rows GeoJSON file is REQUIRED for gap detection analysis
                  </Text>
                </View>
              )}

              {selectedImages.length > 0 && (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Step 3: Clustering Method</Text>
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
                </>
              )}

              {selectedImages.length > 0 && (
                <View style={styles.imagesList}>
                  <View style={styles.imagesListHeader}>
                    <Text style={styles.imagesListTitle}>
                      Selected Images ({selectedImages.length})
                    </Text>
                    <TouchableOpacity 
                      onPress={removeAllImages}
                      style={styles.deleteAllBtn}
                    >
                      <Text style={styles.deleteAllText}>🗑️ Delete All</Text>
                    </TouchableOpacity>
                  </View>
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
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Select Drone Images</Text>
                <Text style={styles.sectionDesc}>
                  Upload one or more drone images
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

              {selectedImages.length > 0 && (
                <View style={styles.imagesList}>
                  <View style={styles.imagesListHeader}>
                    <Text style={styles.imagesListTitle}>
                      Selected Images ({selectedImages.length})
                    </Text>
                    <TouchableOpacity 
                      onPress={removeAllImages}
                      style={styles.deleteAllBtn}
                    >
                      <Text style={styles.deleteAllText}>🗑️ Delete All</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    data={selectedImages.slice(0, 5)}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => {
                      let fileName = item.fileName || item.name;
                      
                      if (!fileName) {
                        if (item.uri.startsWith('blob:')) {
                          fileName = `Image ${index + 1}.jpg`;
                        } else {
                          const uriParts = item.uri.split('/');
                          fileName = uriParts[uriParts.length - 1].split('#')[0].split('?')[0];
                        }
                      }

                      return (
                        <View style={styles.imageRow}>
                          <Image
                            source={{ uri: item.uri }}
                            style={styles.imageThumbnail}
                          />
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

          {analysisType !== 'manual-annotation' && analysisType !== 'generate-orthomosaic' && analysisType !== 'manual-digitizer' && analysisType !== 'orthophoto' && analysisType !== 'orthophoto-gaps' && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[
                styles.analyzeBtn,
                (loading ||
                  (analysisType === 'dji-log' && !selectedLogFile) ||
                  (analysisType === 'image-annotation' && (selectedLogFiles.length === 0 || annotationImages.length === 0)) ||
                  (analysisType === 'training-dataset') ||
                  (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && analysisType !== 'orthophoto-gaps' && selectedImages.length === 0) ||
                  (analysisType === 'orthophoto-gaps' && (selectedImages.length === 0 || !rowsGeojson))
                ) && styles.analyzeBtnDisabled
              ]}
              onPress={handleAnalyze}
              disabled={
                loading ||
                (analysisType === 'dji-log' && !selectedLogFile) ||
                (analysisType === 'image-annotation' && (selectedLogFiles.length === 0 || annotationImages.length === 0)) ||
                (analysisType === 'training-dataset') ||
                (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && analysisType !== 'training-dataset' && analysisType !== 'orthophoto-gaps' && selectedImages.length === 0) ||
                (analysisType === 'orthophoto-gaps' && (selectedImages.length === 0 || !rowsGeojson))
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
                      {processingProgress.current} / {processingProgress.total} files ({processingProgress.percentage.toFixed(2)}%)
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
                    {processingProgress.startTime && (() => {
                      const elapsedSeconds = Math.round((Date.now() - processingProgress.startTime) / 1000);
                      const minutes = Math.floor(elapsedSeconds / 60);
                      const seconds = elapsedSeconds % 60;
                      return (
                        <Text style={styles.elapsedTimeText}>
                          ⏰ Elapsed: {minutes > 0 ? `${minutes}m ` : ''}{seconds}s
                        </Text>
                      );
                    })()}
                  </View>
                )}
              </View>
            )}
          </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // Screen 3: Show Results with Download Options
  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsEmoji}>
            {results.type === 'orthomosaic-processing' ? '⏳' : '✅'}
          </Text>
          <Text style={styles.resultsTitle}>
            {results.type === 'dji-log' ? 'Parsing Complete' :
              results.type === 'image-annotation' ? 'Annotation Complete' :
                results.type === 'orthomosaic-processing' ? 'Processing Orthomosaic...' :
                  results.type === 'orthomosaic' ? 'Orthomosaic Complete' : 'Analysis Complete'}
          </Text>
        </View>

        {/* REAL-TIME ORTHOMOSAIC PROCESSING DASHBOARD */}
        {results.type === 'orthomosaic-processing' && (
          <View style={styles.processingDashboard}>
            <View style={styles.dashboardHeader}>
              <Text style={styles.dashboardTitle}>🌍 ODM Photogrammetry Processing</Text>
              <Text style={styles.dashboardSubtitle}>{results.data.project_name}</Text>
              <Text style={styles.odmBadge}>🚀 Using OpenDroneMap Engine</Text>
            </View>

            <View style={styles.progressSection}>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBarFill, { width: `${(results.data.progress || 0).toFixed(2)}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {(results.data.progress || 0).toFixed(2)}% Complete
              </Text>
            </View>

            <View style={styles.dashboardMetrics}>
              <View style={styles.metricCard}>
                <Text style={styles.metricEmoji}>📷</Text>
                <Text style={styles.metricValue}>{results.data.images_count}</Text>
                <Text style={styles.metricLabel}>Images</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricEmoji}>⚙️</Text>
                <Text style={styles.metricValue}>{results.data.quality}</Text>
                <Text style={styles.metricLabel}>Quality</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricEmoji}>⏱️</Text>
                <Text style={styles.metricValue}>
                  {Math.floor((Date.now() - new Date(results.data.started_at).getTime()) / 60000)}m
                </Text>
                <Text style={styles.metricLabel}>Elapsed</Text>
              </View>
            </View>

            <View style={styles.statusLog}>
              <Text style={styles.statusLogTitle}>📋 Processing Status</Text>
              <View style={styles.statusLogContent}>
                <Text style={styles.statusLogText}>
                  Status: {results.data.status}
                </Text>
                <Text style={styles.statusLogText}>
                  {orthomosaicProcessingStatus || 'Initializing...'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.analyzeBtn, { backgroundColor: '#6B7280' }]}
              onPress={() => {
                setResults(null);
                setAnalysisType(null);
              }}
            >
              <Text style={styles.analyzeBtnText}>Cancel & Go Back</Text>
            </TouchableOpacity>
            
            {/* Download Button (appears when status is completed or failed) */}
            {(results.data.status === 'completed' || results.data.status === 'failed') && (
              <TouchableOpacity
                style={[styles.analyzeBtn, { backgroundColor: '#10B981', marginTop: 12 }]}
                onPress={async () => {
                  try {
                    const response = await fetch(`http://${backendIP}:${BACKEND_PORT}/api/orthomosaic/download/${results.data.project_id}`);
                    if (!response.ok) {
                      showAlert('Error', 'Failed to download orthomosaic');
                      return;
                    }
                    
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `orthomosaic_${results.data.project_id}.tif`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showAlert('Success', 'Orthomosaic downloaded!');
                  } catch (error) {
                    console.error('Download error:', error);
                    showAlert('Error', 'Download failed: ' + error.message);
                  }
                }}
              >
                <Text style={styles.analyzeBtnText}>📥 Download Orthomosaic</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ORTHOMOSAIC COMPLETE */}
        {results.type === 'orthomosaic' && (
          <View style={styles.orthomosaicResults}>
            <View style={styles.successBanner}>
              <Text style={styles.successEmoji}>🎉</Text>
              <Text style={styles.successText}>
                Orthomosaic Generated Successfully!
              </Text>
            </View>

            <View style={styles.projectInfo}>
              <Text style={styles.projectInfoTitle}>Project Details</Text>
              <View style={styles.projectInfoRow}>
                <Text style={styles.projectInfoLabel}>Name:</Text>
                <Text style={styles.projectInfoValue}>{results.data.project_name}</Text>
              </View>
              <View style={styles.projectInfoRow}>
                <Text style={styles.projectInfoLabel}>Images:</Text>
                <Text style={styles.projectInfoValue}>{results.data.images_count}</Text>
              </View>
              <View style={styles.projectInfoRow}>
                <Text style={styles.projectInfoLabel}>Quality:</Text>
                <Text style={styles.projectInfoValue}>{results.data.quality}</Text>
              </View>
              <View style={styles.projectInfoRow}>
                <Text style={styles.projectInfoLabel}>Completed:</Text>
                <Text style={styles.projectInfoValue}>
                  {new Date(results.data.completed_at).toLocaleString()}
                </Text>
              </View>
            </View>

            <View style={styles.downloadSection}>
              <Text style={styles.downloadTitle}>📥 Download Outputs</Text>
              <Text style={styles.downloadDesc}>
                Click below to download your georeferenced orthomosaic
              </Text>
              
              <TouchableOpacity
                style={[styles.analyzeBtn, { backgroundColor: '#10B981', marginTop: 16 }]}
                onPress={async () => {
                  try {
                    console.log('Downloading orthomosaic for project:', results.data.project_id);
                    
                    if (Platform.OS === 'web') {
                      // Web download
                      const downloadUrl = `http://${backendIP}:${BACKEND_PORT}/api/orthomosaic/download/${results.data.project_id}`;
                      console.log('Download URL:', downloadUrl);
                      
                      const a = document.createElement('a');
                      a.href = downloadUrl;
                      a.download = `${results.data.project_name}_orthomosaic.tif`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      
                      showAlert('Success', 'Download started! Check your downloads folder.');
                    } else {
                      // Mobile - show alert with file location
                      showAlert('Info', `File location:\nbackend/orthomosaic_projects/${results.data.project_id}/output/orthomosaic.tif`);
                    }
                  } catch (error) {
                    console.error('Download error:', error);
                    showAlert('Error', 'Download failed: ' + error.message);
                  }
                }}
              >
                <Text style={styles.analyzeBtnText}>📥 Download Orthomosaic.TIF</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* DOWNLOAD BUTTONS */}
        {Platform.OS === 'web' && results.type !== 'orthomosaic-processing' && results.type !== 'orthomosaic' && (
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

                {/* Download Modified/Corrected Annotations Button */}
                <TouchableOpacity
                  style={[styles.downloadModifiedBtn, downloadingZip && styles.downloadAllBtnDisabled]}
                  disabled={downloadingZip}
                  onPress={downloadAllModified}
                >
                  {downloadingZip ? (
                    <View style={styles.downloadAllBtnContent}>
                      <ActivityIndicator color="#fff" size="small" style={styles.downloadSpinner} />
                      <Text style={styles.downloadAllBtnText}>Creating ZIP...</Text>
                    </View>
                  ) : (
                    <Text style={styles.downloadAllBtnText}>
                      ✏️ Download User-Modified Annotations (Images + JSONs)
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
                          onPress={() => openAnnotationEditor(result, idx)}
                        >
                          <Text style={styles.annotationActionBtnText}>✏️ Edit Boxes</Text>
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

              {/* Browse All Images for Editing */}
              <View style={styles.browseAllImagesSection}>
                <Text style={styles.browseAllTitle}>📂 Browse All Images</Text>
                <Text style={styles.browseAllSubtitle}>
                  Select an image to edit its annotations
                </Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={true}
                  style={styles.imageScrollView}
                >
                  {results.data.yoloResults?.map((result, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.imageThumbnailCard,
                        result.annotations?.status === 'corrected' && styles.imageThumbnailCorrected
                      ]}
                      onPress={() => openAnnotationEditor(result, idx)}
                    >
                      <Image
                        source={{ 
                          uri: result.annotated_image 
                            ? `${BACKEND_URL.replace('/api', '')}/${result.annotated_image}`
                            : `${BACKEND_URL.replace('/api', '')}/uploads/${result.image}`
                        }}
                        style={styles.thumbnailImage}
                        resizeMode="cover"
                      />
                      <View style={styles.thumbnailOverlay}>
                        <Text style={styles.thumbnailIndex}>#{idx + 1}</Text>
                        <Text style={styles.thumbnailCount}>
                          {result.annotations?.detection_count || 0} 📦
                        </Text>
                      </View>
                      {result.annotations?.status === 'corrected' && (
                        <View style={styles.correctedBadge}>
                          <Text style={styles.correctedBadgeText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
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
          ) : results.type !== 'orthomosaic-processing' && results.type !== 'orthomosaic' ? (
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
          ) : null}
        </View>

        <TouchableOpacity style={styles.newAnalysisBtn} onPress={resetApp}>
          <Text style={styles.newAnalysisBtnText}>Start New Analysis</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ==================== ANNOTATION EDITOR MODAL ==================== */}
      {annotationEditorVisible && editingImageData && (
        <View style={styles.annotationEditorModal}>
          {/* Header */}
          <View style={styles.editorHeader}>
            <TouchableOpacity 
              style={styles.editorCloseBtn}
              onPress={() => closeAnnotationEditor(false)}
            >
              <Text style={styles.editorCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.editorTitleContainer}>
              <Text style={styles.editorTitle}>Edit Annotations</Text>
              <Text style={styles.editorSubtitle}>
                Image {currentAnnotationIndex + 1} of {results?.data?.yoloResults?.length || 0}
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.editorSaveBtn}
              onPress={() => closeAnnotationEditor(true)}
            >
              <Text style={styles.editorSaveBtnText}>💾 Save</Text>
            </TouchableOpacity>
          </View>

          {/* Navigation */}
          <View style={styles.editorNavigation}>
            <TouchableOpacity 
              style={styles.editorNavBtn}
              onPress={() => navigateAnnotationEditor(-1)}
            >
              <Text style={styles.editorNavBtnText}>◀ Previous</Text>
            </TouchableOpacity>
            <Text style={styles.editorImageName}>{editingImageData.image}</Text>
            <TouchableOpacity 
              style={styles.editorNavBtn}
              onPress={() => navigateAnnotationEditor(1)}
            >
              <Text style={styles.editorNavBtnText}>Next ▶</Text>
            </TouchableOpacity>
          </View>

          {/* Main Content */}
          <View style={styles.editorContent}>
            {/* Image with Overlays */}
            <View style={styles.editorImageContainer}>
              {/* Image wrapper to maintain aspect ratio */}
              <View 
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Original Image */}
                <Image
                  source={{ 
                    uri: `${BACKEND_URL.replace('/api', '')}/uploads/${editingImageData.originalImage || editingImageData.image}`
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                  resizeMode="contain"
                />
                
                {/* SVG Overlay for Bounding Boxes - matches image with same aspect ratio handling */}
                {Platform.OS === 'web' && (
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: isDrawingNewBox ? 'all' : 'none',
                      cursor: isDrawingNewBox ? 'crosshair' : 'default'
                    }}
                    viewBox={`0 0 ${editorImageDimensions.width} ${editorImageDimensions.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    onMouseDown={(e) => {
                      if (!isDrawingNewBox) return;
                      const svg = e.currentTarget;
                      const rect = svg.getBoundingClientRect();
                      const point = svg.createSVGPoint();
                      point.x = e.clientX;
                      point.y = e.clientY;
                      const ctm = svg.getScreenCTM().inverse();
                      const svgPoint = point.matrixTransform(ctm);
                      setNewBoxStart({ x: svgPoint.x, y: svgPoint.y });
                      setNewBoxEnd({ x: svgPoint.x, y: svgPoint.y });
                    }}
                    onMouseMove={(e) => {
                      if (!isDrawingNewBox || !newBoxStart) return;
                      const svg = e.currentTarget;
                      const point = svg.createSVGPoint();
                      point.x = e.clientX;
                      point.y = e.clientY;
                      const ctm = svg.getScreenCTM().inverse();
                      const svgPoint = point.matrixTransform(ctm);
                      setNewBoxEnd({ x: svgPoint.x, y: svgPoint.y });
                    }}
                    onMouseUp={(e) => {
                      if (!isDrawingNewBox || !newBoxStart || !newBoxEnd) return;
                      const width = Math.abs(newBoxEnd.x - newBoxStart.x);
                      const height = Math.abs(newBoxEnd.y - newBoxStart.y);
                      // Only add if box is meaningful size (at least 20x20 pixels)
                      if (width > 20 && height > 20) {
                        addNewDetection({
                          x1: newBoxStart.x,
                          y1: newBoxStart.y,
                          x2: newBoxEnd.x,
                          y2: newBoxEnd.y
                        }, newBoxLabel);
                      }
                      setNewBoxStart(null);
                      setNewBoxEnd(null);
                      setIsDrawingNewBox(false);
                    }}
                    onMouseLeave={() => {
                      if (isDrawingNewBox) {
                        setNewBoxStart(null);
                        setNewBoxEnd(null);
                      }
                    }}
                  >
                  {editingAnnotations.map((det, idx) => {
                    const x1 = det.bbox.x1;
                    const y1 = det.bbox.y1;
                    const boxWidth = det.bbox.width || (det.bbox.x2 - det.bbox.x1);
                    const boxHeight = det.bbox.height || (det.bbox.y2 - det.bbox.y1);
                    const isSelected = selectedDetection === idx;
                    const strokeColor = isSelected ? '#00ff00' : (det.isManual ? '#ffff00' : '#ff0000');
                    
                    return (
                      <g key={idx}>
                        <rect
                          x={x1}
                          y={y1}
                          width={boxWidth}
                          height={boxHeight}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={isSelected ? 6 : 3}
                          style={{ cursor: 'pointer', pointerEvents: 'all' }}
                          onClick={() => setSelectedDetection(idx)}
                        />
                        {/* Label background */}
                        <rect
                          x={x1}
                          y={y1 - 30}
                          width={150}
                          height={25}
                          fill={strokeColor}
                          opacity={0.8}
                        />
                        <text
                          x={x1 + 5}
                          y={y1 - 10}
                          fill="#ffffff"
                          fontSize="18"
                          fontWeight="bold"
                        >
                          {det.class} ({Math.round(det.confidence * 100)}%)
                        </text>
                      </g>
                    );
                  })}
                  
                  {/* Preview box while drawing */}
                  {isDrawingNewBox && newBoxStart && newBoxEnd && (
                    <rect
                      x={Math.min(newBoxStart.x, newBoxEnd.x)}
                      y={Math.min(newBoxStart.y, newBoxEnd.y)}
                      width={Math.abs(newBoxEnd.x - newBoxStart.x)}
                      height={Math.abs(newBoxEnd.y - newBoxStart.y)}
                      fill="rgba(39, 174, 96, 0.2)"
                      stroke="#27ae60"
                      strokeWidth={3}
                      strokeDasharray="10,5"
                    />
                  )}
                </svg>
              )}
              </View>
            </View>

            {/* Controls Panel */}
            <View style={styles.editorControlsPanel}>
              {/* Draw New Box Section */}
              <View style={styles.drawNewBoxSection}>
                <Text style={styles.drawNewBoxTitle}>➕ Add New Box</Text>
                
                {/* Label selector for new boxes */}
                <Text style={styles.changeLabelTitle}>Select label first:</Text>
                <View style={styles.labelButtonsContainer}>
                  {availableLabels.slice(0, 6).map((label, idx) => (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.labelButton,
                        newBoxLabel === label && styles.labelButtonActive
                      ]}
                      onPress={() => setNewBoxLabel(label)}
                    >
                      <Text style={[
                        styles.labelButtonText,
                        newBoxLabel === label && styles.labelButtonTextActive
                      ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                {/* Draw button */}
                <TouchableOpacity
                  style={[
                    styles.drawBoxBtn,
                    isDrawingNewBox && styles.drawBoxBtnActive
                  ]}
                  onPress={() => {
                    setIsDrawingNewBox(!isDrawingNewBox);
                    setSelectedDetection(null);
                    if (!isDrawingNewBox) {
                      setNewBoxStart(null);
                      setNewBoxEnd(null);
                    }
                  }}
                >
                  <Text style={styles.drawBoxBtnText}>
                    {isDrawingNewBox ? '❌ Cancel Drawing' : '✏️ Draw Box with "' + newBoxLabel + '"'}
                  </Text>
                </TouchableOpacity>
                
                {isDrawingNewBox && (
                  <Text style={styles.drawingHint}>
                    Click and drag on the image to draw a box
                  </Text>
                )}
              </View>

              {/* Detection Count */}
              <View style={styles.editorStatsCard}>
                <Text style={styles.editorStatsTitle}>Detections</Text>
                <Text style={styles.editorStatsValue}>{editingAnnotations.length}</Text>
              </View>

              {/* Selected Box Info */}
              {selectedDetection !== null && editingAnnotations[selectedDetection] && (
                <View style={styles.selectedBoxInfo}>
                  <Text style={styles.selectedBoxTitle}>Selected Box #{selectedDetection + 1}</Text>
                  <Text style={styles.selectedBoxLabel}>
                    Class: {editingAnnotations[selectedDetection].class}
                  </Text>
                  <Text style={styles.selectedBoxLabel}>
                    Confidence: {Math.round(editingAnnotations[selectedDetection].confidence * 100)}%
                  </Text>
                  
                  {/* Change Label */}
                  <Text style={styles.changeLabelTitle}>Change Label:</Text>
                  <View style={styles.labelButtonsContainer}>
                    {availableLabels.map((label, idx) => (
                      <TouchableOpacity
                        key={label}
                        style={[
                          styles.labelButton,
                          editingAnnotations[selectedDetection]?.class === label && styles.labelButtonActive
                        ]}
                        onPress={() => changeDetectionLabel(label, idx)}
                      >
                        <Text style={[
                          styles.labelButtonText,
                          editingAnnotations[selectedDetection]?.class === label && styles.labelButtonTextActive
                        ]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  
                  {/* Custom Label Input */}
                  <Text style={styles.changeLabelTitle}>Or enter custom label:</Text>
                  <View style={styles.customLabelContainer}>
                    <TextInput
                      style={styles.customLabelInput}
                      placeholder="Enter custom label..."
                      placeholderTextColor="#666"
                      value={customLabelInput}
                      onChangeText={setCustomLabelInput}
                    />
                    <TouchableOpacity
                      style={[styles.customLabelBtn, !customLabelInput.trim() && styles.customLabelBtnDisabled]}
                      onPress={() => {
                        if (customLabelInput.trim()) {
                          // Add to available labels if not already present
                          if (!availableLabels.includes(customLabelInput.trim())) {
                            setAvailableLabels(prev => [...prev, customLabelInput.trim()]);
                          }
                          changeDetectionLabel(customLabelInput.trim(), availableLabels.length);
                          setCustomLabelInput('');
                        }
                      }}
                      disabled={!customLabelInput.trim()}
                    >
                      <Text style={styles.customLabelBtnText}>Apply</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Delete Button */}
                  <TouchableOpacity
                    style={styles.deleteBoxBtn}
                    onPress={deleteSelectedDetection}
                  >
                    <Text style={styles.deleteBoxBtnText}>🗑️ Delete Box</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Detection List */}
              <View style={styles.editorDetectionList}>
                <Text style={styles.editorDetectionListTitle}>All Detections:</Text>
                <ScrollView style={styles.detectionListScroll}>
                  {editingAnnotations.map((det, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.editorDetectionItem,
                        selectedDetection === idx && styles.editorDetectionItemSelected,
                        det.isManual && styles.editorDetectionItemManual,
                        det.isModified && styles.editorDetectionItemModified
                      ]}
                      onPress={() => setSelectedDetection(idx)}
                    >
                      <Text style={styles.editorDetectionIndex}>#{idx + 1}</Text>
                      <Text style={styles.editorDetectionClass}>{det.class}</Text>
                      <Text style={styles.editorDetectionConf}>
                        {Math.round(det.confidence * 100)}%
                      </Text>
                      {det.isManual && <Text style={styles.manualBadge}>Manual</Text>}
                      {det.isModified && !det.isManual && <Text style={styles.modifiedBadge}>Edited</Text>}
                    </TouchableOpacity>
                  ))}
                  {editingAnnotations.length === 0 && (
                    <Text style={styles.noDetectionsMsg}>No detections</Text>
                  )}
                </ScrollView>
              </View>

              {/* Export Buttons */}
              <View style={styles.exportButtonsContainer}>
                <Text style={styles.exportSectionTitle}>📥 Download Options</Text>
                
                <TouchableOpacity
                  style={styles.editorExportBtn}
                  onPress={exportAnnotatedImage}
                  disabled={loading}
                >
                  <Text style={styles.editorExportBtnText}>🖼️ Download Image (with boxes)</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.editorExportBtn, styles.exportJsonBtn]}
                  onPress={exportAnnotationJSON}
                  disabled={loading}
                >
                  <Text style={styles.editorExportBtnText}>📄 Download JSON Annotations</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.editorExportBtn, styles.exportBothBtn]}
                  onPress={exportBoth}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.editorExportBtnText}>📦 Download Both</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}
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
  uploadBtnRequired: {
    borderColor: '#e74c3c',
    borderWidth: 3,
    backgroundColor: '#fff5f5',
  },
  warningBox: {
    marginHorizontal: 16,
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
  },
  warningEmoji: {
    fontSize: 20,
    marginRight: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#856404',
    fontWeight: '500',
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
  imagesListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  imagesListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a472a',
  },
  deleteAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ff4444',
    borderRadius: 6,
  },
  deleteAllText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
  imageSize: {
    fontSize: 11,
    color: '#888',
    marginRight: 8,
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
  downloadModifiedBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#7C3AED',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 56,
    marginTop: 12,
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
  // New feature styles
  cardOrthomosaic: {
    backgroundColor: '#C7F9CC',
    borderLeftWidth: 6,
    borderLeftColor: '#10B981',
  },
  cardDigitizer: {
    backgroundColor: '#DBEAFE',
    borderLeftWidth: 6,
    borderLeftColor: '#3B82F6',
  },
  projectInput: {
    flex: 1,
    height: 48,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '500',
    color: '#1F2937',
  },
  createProjectBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createProjectText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#3B82F6',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentTextActive: {
    color: '#fff',
  },
  drawingCanvas: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    minHeight: 300,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orthophotoPreview: {
    width: '100%',
    height: 250,
    borderRadius: 8,
  },
  drawingHint: {
    marginTop: 12,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  drawingControls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  drawBtn: {
    flex: 1,
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  drawBtnActive: {
    backgroundColor: '#10B981',
  },
  drawBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  clearBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  rowCount: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  // Orthomosaic Processing Dashboard
  processingDashboard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  dashboardHeader: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 16,
  },
  dashboardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  dashboardSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  odmBadge: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
    marginTop: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  progressSection: {
    marginBottom: 24,
  },
  dashboardMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  metricEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  statusLog: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  statusLogTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  statusLogContent: {
    gap: 8,
  },
  statusLogText: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  // Orthomosaic Results
  orthomosaicResults: {
    padding: 16,
  },
  successBanner: {
    backgroundColor: '#D1FAE5',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#065F46',
  },
  projectInfo: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  projectInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  projectInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  projectInfoLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  projectInfoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  downloadDesc: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 8,
  },
  // Manual Digitizer Styles - ENHANCED
  digitizerHeaderCard: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  digitizerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  digitizerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
  },
  statBadgeStyle: {
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    minWidth: 70,
  },
  statLabelStyle: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statValueStyle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3b82f6',
    marginTop: 4,
  },
  geoBoundsCardStyle: {
    background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#10b981',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  successBadgeStyle: {
    backgroundColor: '#10b981',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  warningCardStyle: {
    backgroundColor: '#92400e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  canvasContainerModern: {
    position: 'relative',
    marginBottom: 24,
  },
  zoomControlsModern: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    gap: 6,
  },
  zoomBtnModern: {
    backgroundColor: '#2563eb',
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modeIndicatorStyle: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  pulsingDotStyle: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
  },
  digitizerContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 8,
    marginVertical: 12,
    position: 'relative',
  },
  zoomControls: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    padding: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  zoomBtn: {
    backgroundColor: '#1a472a',
    width: 36,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
  },
  zoomBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  zoomLevel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a472a',
    minWidth: 45,
    textAlign: 'center',
  },
  zoomHint: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  digitizerControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    justifyContent: 'center',
  },
  digitizerBtn: {
    backgroundColor: '#1a472a',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  digitizerBtnActive: {
    backgroundColor: '#FFD700',
  },
  digitizerBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  digitizerStatus: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2e7d32',
  },
  digitizerStatusText: {
    fontSize: 14,
    color: '#1F2937',
    marginBottom: 4,
  },
  rowListContainer: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  rowListTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  rowList: {
    maxHeight: 200,
  },
  rowListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    marginBottom: 6,
  },
  rowListNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
    flex: 1,
  },
  rowListPoints: {
    fontSize: 12,
    color: '#6B7280',
    flex: 1,
    textAlign: 'center',
  },
  rowListDelete: {
    fontSize: 18,
    color: '#d32f2f',
    fontWeight: 'bold',
    paddingHorizontal: 12,
  },
  
  // ==================== ANNOTATION EDITOR STYLES ====================
  annotationEditorModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1a1a2e',
    zIndex: 1000,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  editorCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editorCloseBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  editorTitleContainer: {
    alignItems: 'center',
    flex: 1,
  },
  editorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  editorSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  editorSaveBtn: {
    backgroundColor: '#27ae60',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  editorSaveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  editorNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f3460',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  editorNavBtn: {
    backgroundColor: '#1a472a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  editorNavBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  editorImageName: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: '50%',
    textAlign: 'center',
  },
  editorContent: {
    flex: 1,
    flexDirection: 'row',
  },
  editorImageContainer: {
    flex: 2,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  editorImage: {
    width: '100%',
    height: '100%',
  },
  editorControlsPanel: {
    flex: 1,
    backgroundColor: '#16213e',
    padding: 16,
    maxWidth: 320,
    overflowY: 'auto',
  },
  drawNewBoxSection: {
    backgroundColor: '#0f3460',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#3498db',
  },
  drawNewBoxTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  drawBoxBtn: {
    backgroundColor: '#3498db',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  drawBoxBtnActive: {
    backgroundColor: '#e74c3c',
  },
  drawBoxBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  drawingHint: {
    color: '#27ae60',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  editorStatsCard: {
    backgroundColor: '#0f3460',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  editorStatsTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  editorStatsValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  selectedBoxInfo: {
    backgroundColor: '#0f3460',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
  },
  selectedBoxTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  selectedBoxLabel: {
    color: '#e2e8f0',
    fontSize: 13,
    marginBottom: 4,
  },
  changeLabelTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 8,
  },
  labelButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  labelButton: {
    backgroundColor: '#1a472a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2d8659',
  },
  labelButtonActive: {
    backgroundColor: '#27ae60',
    borderColor: '#27ae60',
  },
  labelButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  labelButtonTextActive: {
    fontWeight: 'bold',
  },
  customLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  customLabelInput: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2d8659',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 13,
  },
  customLabelBtn: {
    backgroundColor: '#27ae60',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  customLabelBtnDisabled: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  customLabelBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteBoxBtn: {
    backgroundColor: '#e74c3c',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  deleteBoxBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  editorDetectionList: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  editorDetectionListTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  detectionListScroll: {
    flex: 1,
  },
  editorDetectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  editorDetectionItemSelected: {
    borderColor: '#27ae60',
    backgroundColor: '#1a3a2e',
  },
  editorDetectionItemManual: {
    borderLeftWidth: 3,
    borderLeftColor: '#f39c12',
  },
  editorDetectionItemModified: {
    borderLeftWidth: 3,
    borderLeftColor: '#3498db',
  },
  editorDetectionIndex: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    width: 30,
  },
  editorDetectionClass: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  editorDetectionConf: {
    color: '#27ae60',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 8,
  },
  manualBadge: {
    backgroundColor: '#f39c12',
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modifiedBadge: {
    backgroundColor: '#3498db',
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  noDetectionsMsg: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  exportButtonsContainer: {
    marginTop: 'auto',
    paddingTop: 12,
  },
  exportSectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  editorExportBtn: {
    backgroundColor: '#2d8659',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  exportJsonBtn: {
    backgroundColor: '#3498db',
  },
  exportBothBtn: {
    backgroundColor: '#9b59b6',
  },
  editorExportBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  
  // Browse All Images Section
  browseAllImagesSection: {
    marginTop: 24,
    paddingVertical: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  browseAllTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 4,
  },
  browseAllSubtitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
  },
  imageScrollView: {
    paddingVertical: 8,
  },
  imageThumbnailCard: {
    width: 120,
    height: 100,
    marginRight: 12,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    borderWidth: 2,
    borderColor: '#d1d5db',
  },
  imageThumbnailCorrected: {
    borderColor: '#27ae60',
    borderWidth: 3,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  thumbnailIndex: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  thumbnailCount: {
    color: '#fff',
    fontSize: 11,
  },
  correctedBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#27ae60',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  correctedBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
