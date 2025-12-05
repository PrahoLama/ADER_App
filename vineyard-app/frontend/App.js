
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
  const [backendIP, setBackendIP] = useState('10.71.43.211');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedLogFile, setSelectedLogFile] = useState(null);
  const [analysisType, setAnalysisType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [showIPConfig, setShowIPConfig] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [rowsGeojson, setRowsGeojson] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [clusteringMethod, setClusteringMethod] = useState('kmeans');
  const [annotationImages, setAnnotationImages] = useState([]); // NEW: for image annotation

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
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              setSelectedLogFile({
                uri: event.target.result,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size
              });
            };
            reader.readAsDataURL(file);
          }
        };
        input.click();
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/plain', 'application/octet-stream'],
          copyToCacheDirectory: true,
        });

        if (!result.canceled && result.assets[0]) {
          setSelectedLogFile(result.assets[0]);
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
      csvContent = 'Filename,Vegetation %,Vine Count,Health Status,Width,Height\n';
      results.data.images.forEach(img => {
        if (!img.error) {
          csvContent += `"${img.filename}",${img.vegetation_percentage},${img.vine_count},"${img.health_status}",${img.image_size.width},${img.image_size.height}\n`;
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
        reportContent += 'SUMMARY\n';
        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += `Total Images Analyzed: ${results.data.total_images}\n`;
        reportContent += `Average Vegetation Coverage: ${results.data.average_vegetation}%\n\n`;

        reportContent += '────────────────────────────────────────────────────────────\n';
        reportContent += 'DETAILED RESULTS\n';
        reportContent += '────────────────────────────────────────────────────────────\n\n';

        results.data.images.forEach((img, idx) => {
          if (!img.error) {
            reportContent += `${idx + 1}. ${img.filename}\n`;
            reportContent += `   Vegetation Coverage: ${img.vegetation_percentage}%\n`;
            reportContent += `   Vines Detected: ${img.vine_count}\n`;
            reportContent += `   Health Status: ${img.health_status}\n`;
            reportContent += `   Image Size: ${img.image_size.width}x${img.image_size.height}\n\n`;
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
      if (!selectedLogFile) {
        showAlert('Error', 'Please select a DJI log file');
        return;
      }
      if (annotationImages.length === 0) {
        showAlert('Error', 'Please select at least one image to annotate');
        return;
      }
    }

    if (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && selectedImages.length === 0) {
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

    try {
      const formData = new FormData();

      // ===================================================================
      // IMAGE ANNOTATION - NEW
      // ===================================================================
      if (analysisType === 'image-annotation') {
        console.log('📸 Processing image annotation...');
        console.log('📄 Log file:', selectedLogFile.name);
        console.log('🖼️ Images:', annotationImages.length);

        // Add log file
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

        // Add images
        for (let i = 0; i < annotationImages.length; i++) {
          const img = annotationImages[i];

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

        const response = await axios.post(
          `${BACKEND_URL}/annotate-images`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 600000, // 10 minutes for large batches
          }
        );

        console.log('✅ Image annotation complete');
        setResults({ type: 'image-annotation', data: response.data.data });
        setSelectedLogFile(null);
        setAnnotationImages([]);

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

          if (Platform.OS === 'web') {
            const response = await fetch(img.uri);
            const blob = await response.blob();
            formData.append('images', blob, `drone_${i}_${Date.now()}.jpg`);
          } else {
            formData.append('images', {
              uri: img.uri,
              type: 'image/jpeg',
              name: `drone_${i}_${Date.now()}.jpg`,
            });
          }
        }

        console.log('📡 Sending request to:', `${BACKEND_URL}/analyze-drone`);

        const response = await axios.post(
          `${BACKEND_URL}/analyze-drone`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
          }
        );

        console.log('✅ Drone images analyzed successfully');
        setResults({ type: 'drone', data: response.data.data });
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
                  analysisType === 'image-annotation' ? '🏷️ Annotation' : '🚁 DJI Log'}
            </Text>
          </View>

          {/* NEW: Image Annotation UI */}
          {analysisType === 'image-annotation' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 1: Select DJI Log File</Text>
                <Text style={styles.sectionDesc}>
                  Upload the encrypted DJI flight log (.txt file)
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
                    📄 {selectedLogFile.name} ({Math.round((selectedLogFile.size || 0) / 1024)}KB)
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedLogFile(null)}>
                    <Text style={styles.removeIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Step 2: Select Images to Annotate</Text>
                <Text style={styles.sectionDesc}>
                  Upload drone images (.tif, .jpg, .png) to annotate with flight data
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
                    data={annotationImages}
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
                </View>
              )}

              <View style={styles.infoBox}>
                <Text style={styles.infoEmoji}>💡</Text>
                <Text style={styles.infoText}>
                  Images will be matched with flight data based on timestamps extracted from filenames
                  (e.g., IMG_20251115_164300.tif) or sequentially if no timestamp found.
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
                    data={selectedImages}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => {
                      const fileName = item.uri.split('/').pop() || '';
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
                  (analysisType === 'image-annotation' && (!selectedLogFile || annotationImages.length === 0)) ||
                  (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && selectedImages.length === 0)
                ) && styles.analyzeBtnDisabled
              ]}
              onPress={handleAnalyze}
              disabled={
                loading ||
                (analysisType === 'dji-log' && !selectedLogFile) ||
                (analysisType === 'image-annotation' && (!selectedLogFile || annotationImages.length === 0)) ||
                (analysisType !== 'dji-log' && analysisType !== 'image-annotation' && selectedImages.length === 0)
              }
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <>
                  <Text style={styles.analyzeBtnEmoji}>⚡</Text>
                  <Text style={styles.analyzeBtnText}>
                    {analysisType === 'dji-log' ? 'Parse Log' :
                      analysisType === 'image-annotation' ? 'Annotate Images' : 'Analyze Now'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {loading && (
              <Text style={styles.analyzingText}>
                {analysisType === 'dji-log' ? 'Parsing flight log...' :
                  analysisType === 'image-annotation' ? 'Annotating images with flight data...' : 'Processing images...'}
              </Text>
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
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Total Images</Text>
                <Text style={styles.metricValue}>{results.data.total_images}</Text>
              </View>

              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Avg Vegetation</Text>
                <Text style={styles.metricValue}>{results.data.average_vegetation}%</Text>
              </View>

              <Text style={styles.detailsTitle}>Image Results</Text>
              {results.data.images.map((img, idx) => (
                <View key={idx} style={styles.resultDetail}>
                  <Text style={styles.detailFilename}>{img.filename}</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Vegetation:</Text>
                    <Text style={styles.detailValue}>{img.vegetation_percentage}%</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Vines Detected:</Text>
                    <Text style={styles.detailValue}>{img.vine_count}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status:</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        img.health_status === 'Good' && styles.statusGood,
                        img.health_status === 'Fair' && styles.statusFair,
                        img.health_status === 'Poor' && styles.statusPoor,
                      ]}
                    >
                      {img.health_status}
                    </Text>
                  </View>
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
});