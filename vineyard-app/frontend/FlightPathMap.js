// FlightPathMap.js - Universal Map Component
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';

// Try to import leaflet libraries, but don't fail if they're not available
let MapContainer, TileLayer, Polyline, Marker, Popup, L;
let leafletAvailable = false;

if (Platform.OS === 'web') {
  try {
    const leafletModule = require('react-leaflet');
    MapContainer = leafletModule.MapContainer;
    TileLayer = leafletModule.TileLayer;
    Polyline = leafletModule.Polyline;
    Marker = leafletModule.Marker;
    Popup = leafletModule.Popup;
    L = require('leaflet');
    require('leaflet/dist/leaflet.css');

    // Fix leaflet marker icons
    if (typeof window !== 'undefined') {
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      });
    }
    leafletAvailable = true;
  } catch (e) {
    console.log('Leaflet not available, using fallback map');
    leafletAvailable = false;
  }
}

const FlightPathMap = ({ flightPath }) => {
  const [imageError, setImageError] = useState(false);

  if (!flightPath || flightPath.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No flight path data available</Text>
      </View>
    );
  }

  // Calculate bounds
  const lats = flightPath.map(p => p.latitude);
  const lons = flightPath.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  // Start and end points
  const startPoint = flightPath[0];
  const endPoint = flightPath[flightPath.length - 1];

  // WEB with Leaflet available
  if (Platform.OS === 'web' && leafletAvailable) {
    const pathCoordinates = flightPath.map(point => [point.latitude, point.longitude]);

    const startIcon = new L.Icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    const endIcon = new L.Icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    return (
      <View style={styles.mapContainer}>
        <MapContainer
          center={[centerLat, centerLon]}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline
            positions={pathCoordinates}
            color="#3498db"
            weight={3}
            opacity={0.7}
          />
          <Marker position={[startPoint.latitude, startPoint.longitude]} icon={startIcon}>
            <Popup>
              <strong>🟢 Start</strong><br/>
              {startPoint.timestamp}<br/>
              Alt: {startPoint.altitude}m
            </Popup>
          </Marker>
          <Marker position={[endPoint.latitude, endPoint.longitude]} icon={endIcon}>
            <Popup>
              <strong>🔴 End</strong><br/>
              {endPoint.timestamp}<br/>
              Alt: {endPoint.altitude}m
            </Popup>
          </Marker>
        </MapContainer>
      </View>
    );
  }

  // WEB Fallback - Static map with Mapbox
  if (Platform.OS === 'web' && !leafletAvailable) {
    const width = 800;
    const height = 400;
    const mapboxToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';

    const pathCoords = flightPath
      .filter((_, idx) => idx % 5 === 0)
      .map(p => `${p.longitude},${p.latitude}`)
      .join(',');

    const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v11/static/path-2+3498db-0.7(${pathCoords})/pin-s-a+27ae60(${startPoint.longitude},${startPoint.latitude}),pin-s-b+e74c3c(${endPoint.longitude},${endPoint.latitude})/auto/${width}x${height}@2x?access_token=${mapboxToken}`;

    return (
      <View style={styles.mapContainer}>
        {!imageError ? (
          <img
            src={staticMapUrl}
            alt="Flight Path Map"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 12
            }}
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.fallbackContainer}>
            <Text style={styles.fallbackTitle}>🗺️ Flight Path Coordinates</Text>
            <Text style={styles.fallbackText}>
              Start: {startPoint.latitude.toFixed(6)}, {startPoint.longitude.toFixed(6)}
            </Text>
            <Text style={styles.fallbackText}>
              End: {endPoint.latitude.toFixed(6)}, {endPoint.longitude.toFixed(6)}
            </Text>
            <Text style={styles.fallbackText}>
              Total Points: {flightPath.length}
            </Text>
            <View style={styles.installNote}>
              <Text style={styles.installNoteText}>
                💡 For interactive maps, install:
              </Text>
              <Text style={styles.installCommand}>npm install react-leaflet@4.2.1 leaflet@1.9.4</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  // Mobile - Canvas-based map visualization
  return (
    <View style={styles.mapContainer}>
      <View style={styles.canvasContainer}>
        <MobileMapCanvas flightPath={flightPath} />
      </View>
      <ScrollView style={styles.coordinatesList}>
        <View style={styles.coordinateHeader}>
          <Text style={styles.coordinateHeaderText}>Flight Path Details</Text>
          <Text style={styles.coordinateSubtext}>{flightPath.length} total points</Text>
        </View>

        <View style={styles.coordinateItem}>
          <Text style={styles.coordinateLabel}>🟢 START</Text>
          <Text style={styles.coordinateValue}>
            {startPoint.latitude.toFixed(6)}, {startPoint.longitude.toFixed(6)}
          </Text>
          <Text style={styles.coordinateDetail}>
            Alt: {startPoint.altitude}m | Time: {startPoint.timestamp}
          </Text>
        </View>

        {flightPath.filter((_, idx) => idx % 20 === 0 && idx !== 0 && idx !== flightPath.length - 1).map((point, idx) => (
          <View key={idx} style={styles.coordinateItem}>
            <Text style={styles.coordinateLabel}>🔵 WAYPOINT {idx + 1}</Text>
            <Text style={styles.coordinateValue}>
              {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
            </Text>
            <Text style={styles.coordinateDetail}>
              Alt: {point.altitude}m | Rel Alt: {point.relativeAltitude}m
            </Text>
          </View>
        ))}

        <View style={styles.coordinateItem}>
          <Text style={styles.coordinateLabel}>🔴 END</Text>
          <Text style={styles.coordinateValue}>
            {endPoint.latitude.toFixed(6)}, {endPoint.longitude.toFixed(6)}
          </Text>
          <Text style={styles.coordinateDetail}>
            Alt: {endPoint.altitude}m | Time: {endPoint.timestamp}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

// Mobile Canvas Map Component
const MobileMapCanvas = ({ flightPath }) => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!flightPath || flightPath.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#e8f5e9';
    ctx.fillRect(0, 0, width, height);

    // Get bounds
    const lats = flightPath.map(p => p.latitude);
    const lons = flightPath.map(p => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Add padding
    const padding = 40;
    const drawWidth = width - (padding * 2);
    const drawHeight = height - (padding * 2);

    // Scale coordinates to canvas
    const scaleX = (lon) => padding + ((lon - minLon) / (maxLon - minLon)) * drawWidth;
    const scaleY = (lat) => height - padding - ((lat - minLat) / (maxLat - minLat)) * drawHeight;

    // Draw grid
    ctx.strokeStyle = '#c8e6c9';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = padding + (drawWidth / 4) * i;
      const y = padding + (drawHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw flight path
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    flightPath.forEach((point, idx) => {
      const x = scaleX(point.longitude);
      const y = scaleY(point.latitude);
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw waypoint dots
    flightPath.forEach((point, idx) => {
      if (idx % 10 === 0 && idx !== 0 && idx !== flightPath.length - 1) {
        const x = scaleX(point.longitude);
        const y = scaleY(point.latitude);
        ctx.fillStyle = '#2196f3';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw start point
    const startX = scaleX(flightPath[0].longitude);
    const startY = scaleY(flightPath[0].latitude);
    ctx.fillStyle = '#27ae60';
    ctx.beginPath();
    ctx.arc(startX, startY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw end point
    const endX = scaleX(flightPath[flightPath.length - 1].longitude);
    const endY = scaleY(flightPath[flightPath.length - 1].latitude);
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(endX, endY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = '#1a472a';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('START', startX + 12, startY + 4);
    ctx.fillText('END', endX + 12, endY + 4);

    // Draw compass
    const compassX = width - 50;
    const compassY = 50;
    ctx.strokeStyle = '#1a472a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(compassX, compassY - 15);
    ctx.lineTo(compassX, compassY + 15);
    ctx.moveTo(compassX - 15, compassY);
    ctx.lineTo(compassX + 15, compassY);
    ctx.stroke();
    ctx.fillStyle = '#1a472a';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('N', compassX - 4, compassY - 20);

  }, [flightPath]);

  if (Platform.OS === 'web') {
    return (
      <canvas
        ref={canvasRef}
        width={800}
        height={300}
        style={{ width: '100%', height: '100%' }}
      />
    );
  }

  // For React Native, we'd need react-native-canvas or similar
  // For now, show a simplified view
  return (
    <View style={styles.mobileMapPlaceholder}>
      <Text style={styles.mapPlaceholderTitle}>📍 Flight Path Visualization</Text>
      <Text style={styles.mapPlaceholderText}>
        Interactive map view available on web version
      </Text>
      <Text style={styles.mapPlaceholderSubtext}>
        View detailed coordinates below
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    height: 400,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#f0f0f0',
  },
  emptyContainer: {
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ddd',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
  fallbackContainer: {
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    backgroundColor: '#fff',
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 20,
  },
  fallbackText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  installNote: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2d8659',
  },
  installNoteText: {
    fontSize: 12,
    color: '#1a472a',
    marginBottom: 8,
    fontWeight: '600',
  },
  installCommand: {
    fontSize: 11,
    color: '#2d8659',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 4,
  },
  coordinatesList: {
    flex: 1,
    padding: 16,
  },
  coordinateHeader: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#2d8659',
  },
  coordinateHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 4,
  },
  coordinateSubtext: {
    fontSize: 12,
    color: '#666',
  },
  coordinateItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2d8659',
  },
  coordinateLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 6,
  },
  coordinateValue: {
    fontSize: 12,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  coordinateDetail: {
    fontSize: 11,
    color: '#666',
  },
  canvasContainer: {
    height: 300,
    backgroundColor: '#fff',
    borderBottomWidth: 2,
    borderBottomColor: '#2d8659',
  },
  mobileMapPlaceholder: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    padding: 20,
  },
  mapPlaceholderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a472a',
    marginBottom: 12,
  },
  mapPlaceholderText: {
    fontSize: 14,
    color: '#2d8659',
    textAlign: 'center',
    marginBottom: 8,
  },
  mapPlaceholderSubtext: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
});

export default FlightPathMap;