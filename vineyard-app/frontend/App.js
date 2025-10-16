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
import axios from 'axios';

const BACKEND_PORT = 5000;

export default function App() {
    const [backendIP, setBackendIP] = useState('localhost');
    const [selectedImages, setSelectedImages] = useState([]);
    const [analysisType, setAnalysisType] = useState(null);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [showIPConfig, setShowIPConfig] = useState(false);
    const [backendStatus, setBackendStatus] = useState('checking');
    const [rowsGeojson, setRowsGeojson] = useState(null);

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

    // DOWNLOAD FUNCTIONS
    const downloadJSON = () => {
        const jsonStr = JSON.stringify(results.data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vineyard_analysis_${results.type}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert('Success', 'JSON file downloaded!');
    };

    const downloadCSV = () => {
        let csvContent = '';

        if (results.type === 'drone') {
            // CSV header for drone analysis
            csvContent = 'Filename,Vegetation %,Vine Count,Health Status,Width,Height\n';

            results.data.images.forEach(img => {
                if (!img.error) {
                    csvContent += `"${img.filename}",${img.vegetation_percentage},${img.vine_count},"${img.health_status}",${img.image_size.width},${img.image_size.height}\n`;
                }
            });
        } else {
            // CSV header for orthophoto analysis
            csvContent = 'Filename,Gaps Detected,Gap Area (m²),Rows Analyzed,Rows with Gaps\n';

            if (results.data.details) {
                results.data.details.forEach(detail => {
                    csvContent += `"${detail.filename}",${detail.gaps_detected},${detail.gap_area_m2},${results.data.rows_analyzed},${results.data.rows_with_gaps}\n`;
                });
            }
        }

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vineyard_analysis_${results.type}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert('Success', 'CSV file downloaded!');
    };

    const downloadReport = () => {
        let reportContent = '';
        const timestamp = new Date().toLocaleString();

        reportContent += '═══════════════════════════════════════════════════════════\n';
        reportContent += '           VINEYARD ANALYSIS REPORT\n';
        reportContent += '═══════════════════════════════════════════════════════════\n\n';
        reportContent += `Analysis Type: ${results.type === 'drone' ? 'Drone Image Analysis' : 'Orthophoto Gap Detection'}\n`;
        reportContent += `Generated: ${timestamp}\n\n`;

        if (results.type === 'drone') {
            reportContent += '───────────────────────────────────────────────────────────\n';
            reportContent += 'SUMMARY\n';
            reportContent += '───────────────────────────────────────────────────────────\n';
            reportContent += `Total Images Analyzed: ${results.data.total_images}\n`;
            reportContent += `Average Vegetation Coverage: ${results.data.average_vegetation}%\n\n`;

            reportContent += '───────────────────────────────────────────────────────────\n';
            reportContent += 'DETAILED RESULTS\n';
            reportContent += '───────────────────────────────────────────────────────────\n\n';

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
            reportContent += '───────────────────────────────────────────────────────────\n';
            reportContent += 'SUMMARY\n';
            reportContent += '───────────────────────────────────────────────────────────\n';
            reportContent += `Total Gaps Detected: ${results.data.detected_gaps}\n`;
            reportContent += `Total Gap Area: ${Math.round(results.data.total_gap_area_m2)} m²\n`;
            reportContent += `Rows Analyzed: ${results.data.rows_analyzed}\n`;
            reportContent += `Rows with Gaps: ${results.data.rows_with_gaps}\n\n`;

            if (results.data.details && results.data.details.length > 0) {
                reportContent += '───────────────────────────────────────────────────────────\n';
                reportContent += 'DETAILED RESULTS\n';
                reportContent += '───────────────────────────────────────────────────────────\n\n';

                results.data.details.forEach((detail, idx) => {
                    reportContent += `${idx + 1}. ${detail.filename}\n`;
                    reportContent += `   Gaps Detected: ${detail.gaps_detected}\n`;
                    reportContent += `   Gap Area: ${Math.round(detail.gap_area_m2)} m²\n\n`;
                });
            }
        }

        reportContent += '═══════════════════════════════════════════════════════════\n';
        reportContent += 'END OF REPORT\n';
        reportContent += '═══════════════════════════════════════════════════════════\n';

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vineyard_report_${results.type}_${Date.now()}.txt`;
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

        if (selectedImages.length === 0) {
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

            if (analysisType === 'drone') {
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

                const response = await axios.post(
                    `${BACKEND_URL}/analyze-drone`,
                    formData,
                    {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        timeout: 300000,
                    }
                );

                setResults({ type: 'drone', data: response.data.data });

            } else {
                const img = selectedImages[0];

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

                if (rowsGeojson) {
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
                }

                const response = await axios.post(
                    `${BACKEND_URL}/analyze-orthophoto`,
                    formData,
                    {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        timeout: 300000,
                    }
                );

                setResults({ type: 'orthophoto', data: response.data.data });
            }

            setSelectedImages([]);
            setRowsGeojson(null);

        } catch (error) {
            console.error('❌ ERROR:', error);
            showAlert(
                'Analysis Failed',
                error.response?.data?.error || error.message || 'Connection failed'
            );
        } finally {
            setLoading(false);
        }
    };

    const resetApp = () => {
        setResults(null);
        setAnalysisType(null);
        setSelectedImages([]);
        setRowsGeojson(null);
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
                        <Text style={styles.headerSubtitle}>Monitor your vineyard health</Text>
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

    // Screen 2: Select Images & Analyze
    if (!results) {
        return (
            <View style={styles.container}>
                <ScrollView>
                    <View style={styles.topBar}>
                        <TouchableOpacity onPress={() => setAnalysisType(null)}>
                            <Text style={styles.backBtn}>← Back</Text>
                        </TouchableOpacity>
                        <Text style={styles.topBarTitle}>
                            {analysisType === 'drone' ? '📷 Drone' : '🗺️ Orthophoto'}
                        </Text>
                    </View>

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
                                renderItem={({ item, index }) => (
                                    <View style={styles.imageRow}>
                                        <Image
                                            source={{ uri: item.uri }}
                                            style={styles.imageThumbnail}
                                        />
                                        <Text style={styles.imageName} numberOfLines={1}>
                                            {item.uri.split('/').pop()}
                                        </Text>
                                        <TouchableOpacity onPress={() => removeImage(index)}>
                                            <Text style={styles.removeIcon}>✕</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                                keyExtractor={(_, idx) => idx.toString()}
                            />
                        </View>
                    )}

                    <View style={styles.actionButtons}>
                        <TouchableOpacity
                            style={[styles.analyzeBtn, (loading || selectedImages.length === 0) && styles.analyzeBtnDisabled]}
                            onPress={handleAnalyze}
                            disabled={loading || selectedImages.length === 0}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" size="large" />
                            ) : (
                                <>
                                    <Text style={styles.analyzeBtnEmoji}>⚡</Text>
                                    <Text style={styles.analyzeBtnText}>Analyze Now</Text>
                                </>
                            )}
                        </TouchableOpacity>
                        {loading && <Text style={styles.analyzingText}>Processing images...</Text>}
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
                    <Text style={styles.resultsTitle}>Analysis Complete</Text>
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
                    {results.type === 'drone' ? (
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
        paddingTop: 12,
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
});