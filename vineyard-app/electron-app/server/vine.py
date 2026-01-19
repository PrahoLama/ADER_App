
import os
import re
import json
import numpy as np
import matplotlib.pyplot as plt
import cv2
import rasterio
import geopandas as gpd
from shapely.geometry import box, Point
from rasterio.features import rasterize
from skimage import io, measure, filters, morphology
from sklearn.cluster import KMeans
from math import radians, sin, cos, sqrt, atan2
from sklearn.cluster import DBSCAN, MeanShift, estimate_bandwidth
from skimage.segmentation import slic
from skimage.color import label2rgb

# ================================
# CONFIGURATION
# ================================
class Config:
    # Orthophoto paths
    ORTHO_PATH = '/home/praho/Documents/Job/BlajADER/HartiParcele/107Media-orthophoto.tif'
    ROWS_PATH = '/home/praho/Documents/Job/BlajADER/Randuri/107randuri.geojson'

    # Drone images folder
    DRONE_FOLDER = '/home/praho/Documents/Job/BlajADER/101MEDIA'

    # Gap detection parameters
    MIN_GAP_AREA_PIXELS = 15
    MAX_GAP_AREA_PIXELS = 3000

    # NDVI parameters
    NDVI_THRESHOLD = 0.97
    MIN_VINE_SIZE = 500  # pixels

    # Output files
    OUTPUT_DIR = 'vineyard_analysis_results'


# ================================
# UTILITY FUNCTIONS
# ================================
def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """Calculate distance between two GPS coordinates in meters using Haversine formula"""
    R = 6371000  # Earth radius in meters

    lat1_rad, lon1_rad = radians(lat1), radians(lon1)
    lat2_rad, lon2_rad = radians(lat2), radians(lon2)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = sin(dlat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c


def pixel_to_geographic(row, col, transform):
    """Convert pixel coordinates to geographic coordinates"""
    lon, lat = transform * (col, row)
    return lon, lat


def extract_number(fname):
    """Extract number from drone image filename (e.g., DJI_0010.jpg -> 10)"""
    match = re.search(r"DJI_(\d+)", fname)
    return int(match.group(1)) if match else None


def ensure_output_dir():
    """Create output directory if it doesn't exist"""
    os.makedirs(Config.OUTPUT_DIR, exist_ok=True)


# ================================
# VEGETATION INDICES
# ================================
def calculate_vegetation_indices(r, g, b):
    """Calculate multiple vegetation indices from RGB bands"""
    r_norm = r.astype(float) / 255.0
    g_norm = g.astype(float) / 255.0
    b_norm = b.astype(float) / 255.0

    epsilon = 1e-7
    indices = {}

    # Excess Green
    indices['exg'] = 2 * g_norm - r_norm - b_norm

    # Excess Green minus Excess Red
    excess_red = 1.4 * r_norm - g_norm
    indices['exgr'] = indices['exg'] - excess_red

    # Normalized Difference Index
    indices['ndi'] = (g_norm - r_norm) / (g_norm + r_norm + epsilon)

    # Visible Atmospherically Resistant Index
    indices['vari'] = (g_norm - r_norm) / (g_norm + r_norm - b_norm + epsilon)

    # Green-Red Vegetation Index
    indices['grvi'] = (g_norm - r_norm) / (g_norm + r_norm + epsilon)

    # RGB Vegetation Index
    indices['rgbvi'] = (g_norm ** 2 - b_norm * r_norm) / (g_norm ** 2 + b_norm * r_norm + epsilon)

    return indices


def calculate_ndvi(red, nir):
    """Calculate NDVI from red and NIR bands"""
    return (nir - red) / (nir + red + 1e-6)


# ================================
# BARE SOIL DETECTION (K-MEANS)
# ================================
def detect_bare_soil_kmeans(r, g, b, n_clusters=4):
    """Detect bare soil using K-means clustering on RGB + ALL vegetation indices"""
    h, w = r.shape

    # Calculează toți indicii vegetativi
    indices = calculate_vegetation_indices(r, g, b)

    # Creează vectorul de caracteristici: RGB + toți indicii
    # [R, G, B, ExG, ExGR, NDI, VARI, GRVI, RGBVI]
    features = np.stack([
        r.flatten(),
        g.flatten(),
        b.flatten(),
        indices['exg'].flatten(),
        indices['exgr'].flatten(),
        indices['ndi'].flatten(),
        indices['vari'].flatten(),
        indices['grvi'].flatten(),
        indices['rgbvi'].flatten()
    ], axis=1)

    # Normalizare pentru ca toți indicii să aibă greutate echilibrată
    # RGB sunt 0-255, indicii sunt aproximativ -1 to 1
    features_normalized = features.copy()
    features_normalized[:, 0:3] = features[:, 0:3] / 255.0  # Normalizează RGB
    # Indicii sunt deja în range -1 to 1, dar îi scalăm ușor pentru echilibru
    features_normalized[:, 3:] = features[:, 3:] * 2.0  # Dă mai multă greutate indicilor

    # Filtrează pixelii valizi (evită valorile extreme)
    valid_mask = (features[:, 0] > 10) & (features[:, 0] < 245) & \
                 (features[:, 1] > 10) & (features[:, 1] < 245) & \
                 (features[:, 2] > 10) & (features[:, 2] < 245)

    valid_features = features_normalized[valid_mask]

    # K-means clustering pe caracteristicile extinse
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10, max_iter=300)
    kmeans.fit(valid_features)

    # Atribuie etichetele
    labels = np.full(len(features), -1)
    labels[valid_mask] = kmeans.predict(valid_features)
    labels = labels.reshape(h, w)

    centroids_normalized = kmeans.cluster_centers_

    # Denormalizează centroizii pentru afișare
    centroids = centroids_normalized.copy()
    centroids[:, 0:3] = centroids_normalized[:, 0:3] * 255.0
    centroids[:, 3:] = centroids_normalized[:, 3:] / 2.0

    # Identifică clusterul de sol bazat pe RGB ȘI indici vegetativi
    soil_scores = []
    for i, centroid_norm in enumerate(centroids_normalized):
        # Denormalizează pentru calcul
        r_val = centroid_norm[0] * 255
        g_val = centroid_norm[1] * 255
        b_val = centroid_norm[2] * 255

        # Indicii vegetativi (normalizați)
        exg_val = centroid_norm[3] / 2.0
        exgr_val = centroid_norm[4] / 2.0
        vari_val = centroid_norm[6] / 2.0

        # Scor bazat pe RGB (solul e mai roșiatic)
        rgb_soil_score = (r_val - g_val) + (r_val - b_val) + (g_val - b_val) * 0.5

        # Scor bazat pe indici (solul are valori MICI pentru indici de vegetație)
        # ExG, ExGR, VARI scăzute = sol
        veg_indices_score = -(exg_val + exgr_val + vari_val) * 100  # Negativ pentru că vrem valori mici

        # Bonus pentru luminozitate moderată (solul nu e prea întunecos sau prea deschis)
        brightness = (r_val + g_val + b_val) / 3
        brightness_bonus = 0
        if 80 < brightness < 180:
            brightness_bonus = 30

        # Scor final combinat
        soil_score = rgb_soil_score + veg_indices_score + brightness_bonus
        soil_scores.append(soil_score)

    soil_cluster = np.argmax(soil_scores)
    bare_soil_mask = (labels == soil_cluster)

    # Curățare morfologică
    bare_soil_mask = morphology.binary_opening(bare_soil_mask, morphology.disk(2))
    bare_soil_mask = morphology.binary_closing(bare_soil_mask, morphology.disk(3))

    return bare_soil_mask, labels, centroids

def detect_bare_soil_dbscan(r, g, b, eps=0.12, min_samples=30, sample_ratio=0.05):
    """
    Memory-optimized DBSCAN for bare soil detection in vineyard images

    Key optimizations:
    - Reduced sample ratio (default 5% instead of 8%)
    - Smaller maximum sample size to prevent memory overflow
    - Efficient feature computation with memory management
    - Simplified grid sampling
    - Optimized label propagation with smaller batches

    Parameters:
    -----------
    r, g, b : numpy arrays
        Red, green, blue channels
    eps : float
        DBSCAN epsilon parameter (default: 0.12)
    min_samples : int
        Minimum samples for core point (default: 30)
    sample_ratio : float
        Ratio of pixels to sample (default: 0.05 = 5%)
    """
    h, w = r.shape
    total_pixels = h * w

    print(f"   🔧 DBSCAN - Memory Optimized Version")
    print(f"   📏 Image size: {h}x{w} = {total_pixels:,} pixels")

    # Calculate vegetation indices
    indices = calculate_vegetation_indices(r, g, b)

    # ============================================================================
    # STEP 1: EFFICIENT FEATURE ENGINEERING
    # ============================================================================

    # Normalize RGB efficiently (in-place operations where possible)
    r_norm = r.astype(np.float32) / 255.0  # Use float32 instead of float64
    g_norm = g.astype(np.float32) / 255.0
    b_norm = b.astype(np.float32) / 255.0

    # Compute engineered features
    redness = r_norm - g_norm
    brownness = (r_norm + g_norm) * 0.5 - b_norm
    brightness = (r_norm + g_norm + b_norm) / 3.0
    greenness_inv = 1.0 - (2 * g_norm - r_norm - b_norm)

    # Stack features - use float32 to save memory
    features = np.stack([
        r.flatten().astype(np.float32),
        g.flatten().astype(np.float32),
        b.flatten().astype(np.float32),
        indices['exg'].flatten().astype(np.float32),
        indices['vari'].flatten().astype(np.float32),
        indices['ndi'].flatten().astype(np.float32),
        redness.flatten(),
        brownness.flatten(),
        brightness.flatten(),
        greenness_inv.flatten()
    ], axis=1)

    # Clear intermediate arrays to free memory
    del r_norm, g_norm, b_norm, redness, brownness, greenness_inv

    # ============================================================================
    # STEP 2: NORMALIZATION
    # ============================================================================

    features_normalized = features.copy()
    features_normalized[:, 0:3] = features[:, 0:3] / 255.0
    features_normalized[:, 3:6] = features[:, 3:6] * 1.5
    features_normalized[:, 6:10] = features[:, 6:10] * 2.0

    del features  # Free original features array

    # ============================================================================
    # STEP 3: PIXEL FILTERING
    # ============================================================================

    valid_mask = (
            (features_normalized[:, 0] > 0.04) & (features_normalized[:, 0] < 0.96) &
            (features_normalized[:, 1] > 0.04) & (features_normalized[:, 1] < 0.96) &
            (features_normalized[:, 2] > 0.04) & (features_normalized[:, 2] < 0.96) &
            (features_normalized[:, 8] > 0.1) & (features_normalized[:, 8] < 0.9)  # brightness
    )

    valid_features = features_normalized[valid_mask]
    valid_indices = np.where(valid_mask)[0]

    del features_normalized  # Free memory

    print(f"   📊 Valid pixels: {len(valid_features):,} ({len(valid_features) / total_pixels * 100:.1f}%)")

    # ============================================================================
    # STEP 4: OPTIMIZED SAMPLING - REDUCED SIZE
    # ============================================================================

    # CRITICAL: Reduced max_samples to prevent memory crashes
    max_samples = 12000  # Reduced from 25000
    sample_size = min(max_samples, int(len(valid_features) * sample_ratio))
    sample_size = max(sample_size, 5000)  # Minimum samples
    sample_size = min(sample_size, len(valid_features))  # Can't exceed available

    print(f"   🎯 Sampling {sample_size:,} pixels ({sample_size / len(valid_features) * 100:.1f}%)")

    # Simplified grid sampling - smaller grid for efficiency
    grid_size = 8  # Reduced from 12
    samples_per_cell = max(1, sample_size // (grid_size * grid_size))

    sampled_indices = []

    for i in range(grid_size):
        for j in range(grid_size):
            row_start = int(i * h / grid_size)
            row_end = int((i + 1) * h / grid_size)
            col_start = int(j * w / grid_size)
            col_end = int((j + 1) * w / grid_size)

            # Find valid pixels in cell
            cell_pixel_indices = []
            for row in range(row_start, row_end):
                for col in range(col_start, col_end):
                    pixel_idx = row * w + col
                    if valid_mask[pixel_idx]:
                        # Find position in valid_features array
                        valid_pos = np.searchsorted(valid_indices, pixel_idx)
                        if valid_pos < len(valid_indices) and valid_indices[valid_pos] == pixel_idx:
                            cell_pixel_indices.append(valid_pos)

            # Sample from cell
            if len(cell_pixel_indices) > 0:
                n_samples = min(samples_per_cell, len(cell_pixel_indices))
                selected = np.random.choice(cell_pixel_indices, n_samples, replace=False)
                sampled_indices.extend(selected)

    sampled_indices = np.array(sampled_indices)

    # Fill to target size
    remaining = sample_size - len(sampled_indices)
    if remaining > 0:
        available = np.setdiff1d(np.arange(len(valid_features)), sampled_indices)
        if len(available) > 0:
            additional = np.random.choice(available, min(remaining, len(available)), replace=False)
            sampled_indices = np.concatenate([sampled_indices, additional])

    # Limit to target size if oversampled
    if len(sampled_indices) > sample_size:
        sampled_indices = sampled_indices[:sample_size]

    sample_features = valid_features[sampled_indices]
    print(f"   🔬 Final sample size: {len(sample_features):,}")

    # ============================================================================
    # STEP 5: DBSCAN CLUSTERING
    # ============================================================================

    print(f"   ⚙️ Running DBSCAN (eps={eps:.4f}, min_samples={min_samples})...")

    try:
        dbscan = DBSCAN(
            eps=eps,
            min_samples=min_samples,
            algorithm='ball_tree',
            n_jobs=2,  # Limit parallelization to prevent memory spike
            leaf_size=40
        )

        sample_labels = dbscan.fit_predict(sample_features)

        n_clusters = len(np.unique(sample_labels[sample_labels >= 0]))
        n_noise = np.sum(sample_labels == -1)

        print(f"   ✅ DBSCAN complete")
        print(f"   📊 Clusters found: {n_clusters}")
        print(f"   🔇 Noise points: {n_noise:,} ({n_noise / len(sample_labels) * 100:.1f}%)")

        if n_clusters == 0:
            print(f"   ⚠️ No clusters found - falling back to threshold method")
            raise ValueError("No clusters found")

    except Exception as e:
        print(f"   ❌ DBSCAN failed: {e}")
        print(f"   🔄 Using threshold-based detection instead")
        bare_soil_mask = (indices['exg'] < np.percentile(indices['exg'], 30))
        return bare_soil_mask, np.zeros((h, w), dtype=int), np.array([])

    # ============================================================================
    # STEP 6: OPTIMIZED LABEL PROPAGATION
    # ============================================================================

    print(f"   🔄 Propagating labels (this may take a moment)...")

    valid_clusters = sample_labels >= 0

    if np.sum(valid_clusters) > 100:  # Need enough samples
        from sklearn.neighbors import KNeighborsClassifier

        knn = KNeighborsClassifier(
            n_neighbors=5,
            weights='distance',
            algorithm='ball_tree',
            n_jobs=2  # Limit parallelization
        )

        knn.fit(sample_features[valid_clusters], sample_labels[valid_clusters])

        # Predict in SMALLER batches to prevent memory crash
        batch_size = 20000  # Reduced from 50000
        all_labels = np.full(len(valid_features), -1, dtype=np.int32)

        n_batches = (len(valid_features) + batch_size - 1) // batch_size

        for batch_idx, start_idx in enumerate(range(0, len(valid_features), batch_size)):
            end_idx = min(start_idx + batch_size, len(valid_features))
            batch = valid_features[start_idx:end_idx]

            # Simple prediction without probability threshold
            predictions = knn.predict(batch)
            all_labels[start_idx:end_idx] = predictions

            if batch_idx % 5 == 0:
                print(f"      Batch {batch_idx + 1}/{n_batches}: {end_idx:,}/{len(valid_features):,} pixels")

        print(f"   ✅ Label propagation complete")
    else:
        all_labels = np.full(len(valid_features), -1, dtype=np.int32)
        print(f"   ⚠️ Insufficient valid clusters")

    # ============================================================================
    # STEP 7: RECONSTRUCT IMAGE
    # ============================================================================

    labels = np.full(total_pixels, -1, dtype=np.int32)
    labels[valid_mask] = all_labels
    labels = labels.reshape(h, w)

    # ============================================================================
    # STEP 8: CLUSTER ANALYSIS
    # ============================================================================

    unique_labels = np.unique(sample_labels[sample_labels >= 0])
    centroids = []
    cluster_sizes = []

    for label in unique_labels:
        cluster_mask = (sample_labels == label)
        cluster_features = sample_features[cluster_mask]
        centroid = np.mean(cluster_features, axis=0)
        centroids.append(centroid)
        cluster_sizes.append(np.sum(cluster_mask))

    centroids = np.array(centroids) if len(centroids) > 0 else np.array([])
    cluster_sizes = np.array(cluster_sizes)

    # ============================================================================
    # STEP 9: SOIL IDENTIFICATION
    # ============================================================================

    if len(centroids) > 0:
        print(f"   🔍 Identifying soil cluster...")

        soil_scores = []

        for i, (centroid, size) in enumerate(zip(centroids, cluster_sizes)):
            # Denormalize
            r_val = centroid[0] * 255
            exg_val = centroid[3] / 1.5
            vari_val = centroid[4] / 1.5
            redness = centroid[6] / 2.0
            brownness = centroid[7] / 2.0
            brightness = centroid[8] / 2.0

            # Soil scoring
            color_score = redness * 50 + brownness * 40
            veg_score = -(exg_val + vari_val) * 60
            brightness_score = 20 if (0.3 < brightness < 0.7) else 0
            size_score = min(15, (size / len(sample_features)) * 150)

            total_score = color_score + veg_score + brightness_score + size_score
            soil_scores.append(total_score)

            print(f"      Cluster {i}: score={total_score:.1f}, size={size:,}")

        soil_cluster_idx = np.argmax(soil_scores)
        soil_cluster = unique_labels[soil_cluster_idx]

        print(f"   ✅ Selected cluster {soil_cluster} as SOIL")

        bare_soil_mask = (labels == soil_cluster)
        soil_coverage = np.sum(bare_soil_mask) / bare_soil_mask.size * 100
        print(f"   📊 Soil coverage: {soil_coverage:.1f}%")

    else:
        print(f"   ❌ No valid clusters")
        bare_soil_mask = np.zeros((h, w), dtype=bool)

    # ============================================================================
    # STEP 10: MORPHOLOGICAL CLEANUP
    # ============================================================================

    print(f"   🧹 Cleaning up mask...")

    from skimage import morphology

    bare_soil_mask = morphology.binary_opening(bare_soil_mask, morphology.disk(2))
    bare_soil_mask = morphology.binary_closing(bare_soil_mask, morphology.disk(3))
    bare_soil_mask = morphology.remove_small_objects(bare_soil_mask, min_size=50)
    bare_soil_mask = morphology.remove_small_holes(bare_soil_mask, area_threshold=100)

    final_coverage = np.sum(bare_soil_mask) / bare_soil_mask.size * 100
    print(f"   ✅ Final coverage: {final_coverage:.1f}%")

    return bare_soil_mask, labels, centroids

def detect_bare_soil_slic(r, g, b, n_segments=1000, compactness=10):
    """Detect bare soil using SLIC superpixel segmentation"""
    h, w = r.shape

    # Create RGB image for SLIC
    rgb_img = np.stack([r, g, b], axis=2)

    # SLIC segmentation
    print(f"   Running SLIC (n_segments={n_segments}, compactness={compactness})...")
    segments = slic(rgb_img, n_segments=n_segments, compactness=compactness,
                    start_label=0, channel_axis=2)

    # Calculate features for each superpixel
    indices = calculate_vegetation_indices(r, g, b)
    n_superpixels = segments.max() + 1

    superpixel_features = []
    for i in range(n_superpixels):
        mask = (segments == i)
        if np.sum(mask) == 0:
            continue

        # Average RGB and indices for this superpixel
        r_mean = np.mean(r[mask])
        g_mean = np.mean(g[mask])
        b_mean = np.mean(b[mask])
        exg_mean = np.mean(indices['exg'][mask])
        exgr_mean = np.mean(indices['exgr'][mask])
        ndi_mean = np.mean(indices['ndi'][mask])
        vari_mean = np.mean(indices['vari'][mask])
        grvi_mean = np.mean(indices['grvi'][mask])
        rgbvi_mean = np.mean(indices['rgbvi'][mask])

        superpixel_features.append([
            i, r_mean, g_mean, b_mean, exg_mean, exgr_mean,
            ndi_mean, vari_mean, grvi_mean, rgbvi_mean
        ])

    superpixel_features = np.array(superpixel_features)

    # Identify soil superpixels
    soil_scores = []
    for feat in superpixel_features:
        r_val, g_val, b_val = feat[1], feat[2], feat[3]
        exg_val, exgr_val, vari_val = feat[4], feat[5], feat[7]

        rgb_soil_score = (r_val - g_val) + (r_val - b_val) + (g_val - b_val) * 0.5
        veg_indices_score = -(exg_val + exgr_val + vari_val) * 100

        brightness = (r_val + g_val + b_val) / 3
        brightness_bonus = 30 if 80 < brightness < 180 else 0

        soil_score = rgb_soil_score + veg_indices_score + brightness_bonus
        soil_scores.append(soil_score)

    # Select top soil superpixels (top 25%)
    threshold = np.percentile(soil_scores, 75)
    soil_superpixel_ids = superpixel_features[np.array(soil_scores) > threshold, 0].astype(int)

    # Create soil mask
    bare_soil_mask = np.isin(segments, soil_superpixel_ids)

    # Morphological cleanup
    bare_soil_mask = morphology.binary_opening(bare_soil_mask, morphology.disk(2))
    bare_soil_mask = morphology.binary_closing(bare_soil_mask, morphology.disk(3))

    # Create centroids for visualization
    centroids = superpixel_features[:, 1:4]  # RGB values only

    return bare_soil_mask, segments, centroids


def detect_bare_soil_meanshift(r, g, b, bandwidth=None):
    """Detect bare soil using Mean Shift clustering"""
    h, w = r.shape

    indices = calculate_vegetation_indices(r, g, b)

    # Feature vector
    features = np.stack([
        r.flatten(),
        g.flatten(),
        b.flatten(),
        indices['exg'].flatten(),
        indices['exgr'].flatten(),
        indices['ndi'].flatten(),
        indices['vari'].flatten(),
        indices['grvi'].flatten(),
        indices['rgbvi'].flatten()
    ], axis=1)

    # Normalize
    features_normalized = features.copy()
    features_normalized[:, 0:3] = features[:, 0:3] / 255.0
    features_normalized[:, 3:] = features[:, 3:] * 2.0

    # Filter valid pixels
    valid_mask = (features[:, 0] > 10) & (features[:, 0] < 245) & \
                 (features[:, 1] > 10) & (features[:, 1] < 245) & \
                 (features[:, 2] > 10) & (features[:, 2] < 245)

    valid_features = features_normalized[valid_mask]

    # Subsample for speed (Mean Shift is slow)
    sample_size = min(10000, len(valid_features))
    sample_indices = np.random.choice(len(valid_features), sample_size, replace=False)
    sample_features = valid_features[sample_indices]

    # Estimate bandwidth if not provided
    if bandwidth is None:
        print("   Estimating bandwidth for Mean Shift...")
        bandwidth = estimate_bandwidth(sample_features, quantile=0.2, n_samples=2000)
        print(f"   Estimated bandwidth: {bandwidth:.3f}")

    # Mean Shift clustering
    print(f"   Running Mean Shift (bandwidth={bandwidth:.3f})...")
    ms = MeanShift(bandwidth=bandwidth, bin_seeding=True, n_jobs=-1)
    ms.fit(sample_features)

    # Predict all valid pixels
    labels = np.full(len(features), -1)
    labels[valid_mask] = ms.predict(valid_features)
    labels = labels.reshape(h, w)

    centroids = ms.cluster_centers_

    # Denormalize centroids
    centroids_denorm = centroids.copy()
    centroids_denorm[:, 0:3] = centroids[:, 0:3] * 255.0
    centroids_denorm[:, 3:] = centroids[:, 3:] / 2.0

    # Identify soil cluster
    soil_scores = []
    for i, centroid_norm in enumerate(centroids):
        r_val = centroid_norm[0] * 255
        g_val = centroid_norm[1] * 255
        b_val = centroid_norm[2] * 255

        exg_val = centroid_norm[3] / 2.0
        exgr_val = centroid_norm[4] / 2.0
        vari_val = centroid_norm[6] / 2.0

        rgb_soil_score = (r_val - g_val) + (r_val - b_val) + (g_val - b_val) * 0.5
        veg_indices_score = -(exg_val + exgr_val + vari_val) * 100

        brightness = (r_val + g_val + b_val) / 3
        brightness_bonus = 30 if 80 < brightness < 180 else 0

        soil_score = rgb_soil_score + veg_indices_score + brightness_bonus
        soil_scores.append(soil_score)

    soil_cluster = np.argmax(soil_scores)
    bare_soil_mask = (labels == soil_cluster)

    # Morphological cleanup
    bare_soil_mask = morphology.binary_opening(bare_soil_mask, morphology.disk(2))
    bare_soil_mask = morphology.binary_closing(bare_soil_mask, morphology.disk(3))

    return bare_soil_mask, labels, centroids_denorm



# ================================
# GAP DETECTION
# ================================
def create_gap_mask(indices, bare_soil_mask, approach='combined_improved'):
    """Create gap mask using various approaches"""
    if approach == 'exg_adaptive':
        threshold = np.percentile(indices['exg'], 25)
        return indices['exg'] < threshold

    elif approach == 'exgr':
        threshold = np.percentile(indices['exgr'], 20)
        return indices['exgr'] < threshold

    elif approach == 'vari':
        threshold = np.percentile(indices['vari'], 30)
        return indices['vari'] < threshold

    elif approach == 'kmeans':
        return bare_soil_mask

    elif approach == 'combined_improved':
        # Combine multiple indices
        exg_mask = indices['exg'] < np.percentile(indices['exg'], 25)
        vari_mask = indices['vari'] < np.percentile(indices['vari'], 25)
        exgr_mask = indices['exgr'] < np.percentile(indices['exgr'], 20)

        combined_mask = bare_soil_mask | exg_mask | vari_mask | exgr_mask

        # Morphological cleanup
        combined_mask = morphology.binary_opening(combined_mask, morphology.disk(1))
        combined_mask = morphology.binary_closing(combined_mask, morphology.disk(2))
        combined_mask = morphology.remove_small_objects(combined_mask, min_size=2)

        return combined_mask


# ================================
# ORTHOPHOTO ANALYSIS
# ================================
def analyze_drone_images_rgb_only(image_paths):
    """
    Analyze drone RGB images without NIR
    Uses RGB-based vegetation indices
    """
    results = {
        'total_images': len(image_paths),
        'images': [],
        'average_vegetation': 0
    }

    total_vegetation = 0

    for image_path in image_paths:
        try:
            # Check file exists
            if not os.path.exists(image_path):
                results['images'].append({
                    'filename': os.path.basename(image_path),
                    'error': 'File not found'
                })
                continue

            # Load image
            img = cv2.imread(image_path)
            if img is None:
                results['images'].append({
                    'filename': os.path.basename(image_path),
                    'error': 'Failed to load image'
                })
                continue

            h, w = img.shape[:2]

            # Split channels (OpenCV uses BGR)
            b, g, r = cv2.split(img)

            # Calculate vegetation indices
            indices = calculate_vegetation_indices(r, g, b)

            # Create vegetation mask using combined approach
            exg_threshold = np.percentile(indices['exg'], 75)
            vari_threshold = np.percentile(indices['vari'], 70)

            vegetation_mask = (indices['exg'] > exg_threshold) | (indices['vari'] > vari_threshold)

            # Morphological cleanup
            kernel = np.ones((3, 3), np.uint8)
            vegetation_mask = cv2.morphologyEx(vegetation_mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel)
            vegetation_mask = cv2.morphologyEx(vegetation_mask, cv2.MORPH_OPEN, kernel)
            vegetation_mask = vegetation_mask > 0

            # Calculate vegetation percentage
            vegetation_pixels = np.sum(vegetation_mask)
            vegetation_percentage = (vegetation_pixels / vegetation_mask.size) * 100
            total_vegetation += vegetation_percentage

            # Find individual vines (connected components)
            labels_img = measure.label(vegetation_mask, connectivity=2)
            vine_count = 0

            for region in measure.regionprops(labels_img):
                # Filter by size
                if 200 < region.area < 50000:
                    vine_count += 1

            # Determine health status
            if vegetation_percentage > 60:
                health_status = 'Good'
            elif vegetation_percentage > 35:
                health_status = 'Fair'
            else:
                health_status = 'Poor'

            results['images'].append({
                'filename': os.path.basename(image_path),
                'vegetation_percentage': round(vegetation_percentage, 1),
                'vine_count': vine_count,
                'health_status': health_status,
                'image_size': {'width': w, 'height': h}
            })

        except Exception as e:
            results['images'].append({
                'filename': os.path.basename(image_path),
                'error': str(e)
            })

    if len(image_paths) > 0:
        results['average_vegetation'] = round(total_vegetation / len(image_paths), 1)

    return results

def analyze_orthophoto(method='kmeans'):
    """Main function for orthophoto gap detection with selectable clustering method"""
    print("\n" + "=" * 80)
    print(f"ORTHOPHOTO GAP ANALYSIS - {method.upper()} METHOD")
    print("=" * 80)

    if not os.path.exists(Config.ORTHO_PATH):
        print(f"❌ Orthophoto not found: {Config.ORTHO_PATH}")
        return None

    if not os.path.exists(Config.ROWS_PATH):
        print(f"❌ Rows file not found: {Config.ROWS_PATH}")
        return None

    # Load data
    print("\n📂 Loading orthophoto and rows...")
    src = rasterio.open(Config.ORTHO_PATH)
    r, g, b = src.read(1), src.read(2), src.read(3)
    h, w = src.height, src.width
    transform = src.transform

    rows = gpd.read_file(Config.ROWS_PATH)
    if 'row_id' not in rows.columns:
        rows['row_id'] = range(1, len(rows) + 1)

    print(f"✅ Loaded orthophoto: {w}x{h} pixels")
    print(f"✅ Loaded {len(rows)} rows")
    print(f"📍 CRS: {src.crs}")

    # Calculate vegetation indices
    print("\n🧮 Calculating vegetation indices...")
    indices = calculate_vegetation_indices(r, g, b)

    # Select clustering method based on user choice
    print(f"\n🎯 Using {method.upper()} clustering method...")

    clustering_methods = {
        'kmeans': lambda: detect_bare_soil_kmeans(r, g, b, n_clusters=4),
        'dbscan': lambda: detect_bare_soil_dbscan(r, g, b, eps=0.12, min_samples=30),
        'slic': lambda: detect_bare_soil_slic(r, g, b, n_segments=1000, compactness=10),
        'meanshift': lambda: detect_bare_soil_meanshift(r, g, b, bandwidth=None)
    }

    if method not in clustering_methods:
        print(f"❌ Unknown method '{method}'. Using 'kmeans' as default.")
        method = 'kmeans'

    try:
        bare_soil_mask, labels, centroids = clustering_methods[method]()
        soil_percentage = np.sum(bare_soil_mask) / bare_soil_mask.size * 100
        print(f"✅ {method.upper()}: {soil_percentage:.1f}% bare soil detected")

        if len(centroids) > 0:
            print(f"📊 Found {len(centroids)} clusters")
    except Exception as e:
        print(f"❌ {method.upper()} failed: {e}")
        print("🔄 Falling back to K-means...")
        method = 'kmeans'
        bare_soil_mask, labels, centroids = detect_bare_soil_kmeans(r, g, b, n_clusters=4)

    # Create gap mask
    final_gap_mask = create_gap_mask(indices, bare_soil_mask, 'combined_improved')

    gaps = []
    row_summary = []

    ensure_output_dir()

    # Process gaps
    print("\n" + "=" * 80)
    print(f"PROCESSING GAPS - {method.upper()} METHOD")
    print("=" * 80)

    for idx, row in rows.iterrows():
        try:
            mask = rasterize(
                [(row.geometry, 1)],
                out_shape=(h, w),
                transform=transform,
                fill=0,
                dtype='uint8'
            )

            if np.sum(mask) == 0:
                continue

            row_gaps_mask = np.logical_and(final_gap_mask, mask == 1)
            gap_labels = measure.label(row_gaps_mask, connectivity=2)
            props = measure.regionprops(gap_labels)

            row_gaps = []
            gap_coordinates = []
            total_components = len(props)
            valid_components = 0

            for prop in props:
                if prop.area < Config.MIN_GAP_AREA_PIXELS or prop.area > Config.MAX_GAP_AREA_PIXELS:
                    continue

                valid_components += 1

                centroid_row, centroid_col = prop.centroid
                gap_lon, gap_lat = pixel_to_geographic(centroid_row, centroid_col, src.transform)

                minr, minc, maxr, maxc = prop.bbox
                lon_min, lat_max = src.transform * (minc, minr)
                lon_max, lat_min = src.transform * (maxc, maxr)

                width_meters = calculate_distance_meters(lat_min, lon_min, lat_min, lon_max)
                height_meters = calculate_distance_meters(lat_min, lon_min, lat_max, lon_min)
                area_sqm = width_meters * height_meters

                poly = box(lon_min, lat_min, lon_max, lat_max)
                gap_info = {
                    'row_id': row.row_id,
                    'gap_id': valid_components,
                    'geometry': poly,
                    'centroid_point': Point(gap_lon, gap_lat),
                    'centroid_lon': gap_lon,
                    'centroid_lat': gap_lat,
                    'area_pixels': prop.area,
                    'area_sqm': area_sqm,
                    'width_meters': width_meters,
                    'height_meters': height_meters,
                    'bbox_lon_min': lon_min,
                    'bbox_lat_min': lat_min,
                    'bbox_lon_max': lon_max,
                    'bbox_lat_max': lat_max
                }
                gaps.append(gap_info)
                row_gaps.append(gap_info)
                gap_coordinates.append({
                    'gap_id': valid_components,
                    'lon': gap_lon,
                    'lat': gap_lat,
                    'pixels': prop.area,
                    'area_sqm': area_sqm,
                    'width_m': width_meters,
                    'height_m': height_meters
                })

            if total_components > 0:
                print(f"🔍 Row {row.row_id}: {total_components} components found, {valid_components} significant gaps")

            if len(row_gaps) > 0:
                print(f"\n📍 ROW {row.row_id}:")
                print(f"   🔢 Significant gaps: {len(row_gaps)}")
                print(f"   📍 GPS coordinates:")

                for gap_coord in gap_coordinates:
                    print(f"      Gap {gap_coord['gap_id']}: {gap_coord['lat']:.6f}°N, {gap_coord['lon']:.6f}°E "
                          f"({gap_coord['pixels']} pixels, {gap_coord['area_sqm']:.1f} m²)")

                row_summary.append({
                    'row_id': row.row_id,
                    'gap_count': len(row_gaps),
                    'gap_coordinates': gap_coordinates
                })

        except Exception as e:
            print(f"❌ Error processing row {row.row_id}: {e}")
            continue

    # Save results
    if gaps:
        print(f"\n💾 Saving {method.upper()} results...")
        save_orthophoto_reports(gaps, row_summary, rows, src.crs, method)
        print(f"   ✅ {method.upper()}: {len(gaps)} gaps saved")

    # Save debug visualization
    save_debug_visualization(r, g, b, bare_soil_mask, labels, indices,
                             'combined_improved', {method: {
            'mask': bare_soil_mask,
            'labels': labels,
            'centroids': centroids,
            'percentage': soil_percentage
        }}, method)

    print(f"\n🎉 FINAL RESULTS ({method.upper()}):")
    print(f"📊 Total gaps detected: {len(gaps)}")
    print(f"💾 Results saved in: {Config.OUTPUT_DIR}")

    src.close()

    return {
        'method': method,
        'gaps': gaps,
        'row_summary': row_summary,
        'total_rows': len(rows),
        'detected_gaps': len(gaps),
        'total_gap_area_m2': sum(g['area_sqm'] for g in gaps) if gaps else 0,
        'rows_analyzed': len(rows),
        'rows_with_gaps': len(row_summary)
    }

def save_orthophoto_reports(gaps, row_summary, rows, crs, method_name='kmeans'):
    """Save detailed reports for orthophoto analysis"""

    # Text summary
    summary_file = os.path.join(Config.OUTPUT_DIR, f'orthophoto_summary_{method_name}.txt')
    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write("╔" + "═" * 80 + "╗\n")
        f.write("║" + " " * 20 + f"ORTHOPHOTO GAP ANALYSIS - {method_name.upper()}" + " " * (39 - len(method_name)) + "║\n")
        f.write("╚" + "═" * 80 + "╝\n\n")

        f.write(f"Method: {method_name.upper()}\n")
        f.write(f"Total rows analyzed: {len(rows)}\n")
        f.write(f"Rows with gaps: {len(row_summary)}\n")
        f.write(f"Total gaps detected: {len(gaps)}\n")
        f.write(f"Minimum gap size: {Config.MIN_GAP_AREA_PIXELS} pixels\n")
        f.write(f"CRS: {crs}\n\n")

        if row_summary:
            total_area_sqm = sum(gap['area_sqm'] for gap in gaps)
            avg_gaps_per_row = sum(r['gap_count'] for r in row_summary) / len(row_summary)

            f.write("STATISTICS:\n")
            f.write(f"• Average gaps per row: {avg_gaps_per_row:.1f}\n")
            f.write(f"• Total gap area: {total_area_sqm:.1f} m²\n")
            f.write(f"• Average gap area: {total_area_sqm / len(gaps):.1f} m²\n\n")

            f.write("ROW DETAILS:\n")
            for row_info in sorted(row_summary, key=lambda x: x['row_id']):
                f.write(f"\nRow {row_info['row_id']}: {row_info['gap_count']} gaps\n")
                for gap in row_info['gap_coordinates']:
                    f.write(
                        f"  Gap {gap['gap_id']}: {gap['lat']:.6f}°N, {gap['lon']:.6f}°E ({gap['area_sqm']:.1f} m²)\n")

    # GeoJSON files
    gdf = gpd.GeoDataFrame(gaps, crs=crs)
    out_geojson = os.path.join(Config.OUTPUT_DIR, f'vineyard_gaps_detailed_{method_name}.geojson')
    gdf.to_file(out_geojson, driver='GeoJSON')

    # Gap centers
    gap_points = [{
        'row_id': gap['row_id'],
        'gap_id': gap['gap_id'],
        'geometry': gap['centroid_point'],
        'lon': gap['centroid_lon'],
        'lat': gap['centroid_lat'],
        'pixels': gap['area_pixels'],
        'area_sqm': gap['area_sqm']
    } for gap in gaps]

    gdf_points = gpd.GeoDataFrame(gap_points, crs=crs)
    out_points = os.path.join(Config.OUTPUT_DIR, f'vineyard_gap_centers_{method_name}.geojson')
    gdf_points.to_file(out_points, driver='GeoJSON')

    # CSV export
    csv_file = os.path.join(Config.OUTPUT_DIR, f'orthophoto_gaps_{method_name}.csv')
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write("row_id,gap_id,latitude,longitude,area_pixels,area_sqm,width_m,height_m,google_maps_link\n")
        for row_info in sorted(row_summary, key=lambda x: x['row_id']):
            for gap in row_info['gap_coordinates']:
                link = f"https://maps.google.com/?q={gap['lat']:.6f},{gap['lon']:.6f}"
                f.write(f"{row_info['row_id']},{gap['gap_id']},{gap['lat']:.8f},{gap['lon']:.8f},"
                        f"{gap['pixels']},{gap['area_sqm']:.1f},{gap['width_m']:.1f},{gap['height_m']:.1f},{link}\n")

    # JSON export
    json_file = os.path.join(Config.OUTPUT_DIR, f'orthophoto_gaps_{method_name}.json')
    json_data = {
        'metadata': {
            'method': method_name,
            'total_rows': len(rows),
            'rows_with_gaps': len(row_summary),
            'total_gaps': len(gaps),
            'min_area_pixels': Config.MIN_GAP_AREA_PIXELS,
            'crs': str(crs)
        },
        'rows': []
    }

    for row_info in sorted(row_summary, key=lambda x: x['row_id']):
        row_data = {
            'row_id': row_info['row_id'],
            'gap_count': row_info['gap_count'],
            'gaps': [{
                'gap_id': g['gap_id'],
                'coordinates': {'latitude': g['lat'], 'longitude': g['lon']},
                'dimensions': {
                    'area_pixels': g['pixels'],
                    'area_sqm': g['area_sqm'],
                    'width_m': g['width_m'],
                    'height_m': g['height_m']
                }
            } for g in row_info['gap_coordinates']]
        }
        json_data['rows'].append(row_data)

    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False)

    print(f"   ✅ Saved: {out_geojson}")
    print(f"   ✅ Saved: {out_points}")
    print(f"   ✅ Saved: {summary_file}")
    print(f"   ✅ Saved: {csv_file}")
    print(f"   ✅ Saved: {json_file}")

def save_debug_visualization(r, g, b, gap_mask, labels, indices, approach, clustering_results=None, method='kmeans'):
    """Save debug visualization with selected clustering method"""

    fig, axes = plt.subplots(3, 3, figsize=(20, 18))

    rgb_img = np.stack([r, g, b], axis=2)

    # Row 1: RGB original, Gap detection, Clustering result
    axes[0, 0].imshow(rgb_img)
    axes[0, 0].set_title('Original RGB', fontsize=12, fontweight='bold')
    axes[0, 0].axis('off')

    axes[0, 1].imshow(gap_mask, cmap='Reds')
    axes[0, 1].set_title(f'Gap Detection ({approach})', fontsize=12, fontweight='bold')
    axes[0, 1].axis('off')

    axes[0, 2].imshow(labels, cmap='tab10')
    axes[0, 2].set_title(f'{method.upper()} Clustering Result', fontsize=12, fontweight='bold')
    axes[0, 2].axis('off')

    # Row 2: Vegetation indices
    im1 = axes[1, 0].imshow(indices['exg'], cmap='RdYlGn')
    axes[1, 0].set_title('Excess Green (ExG)', fontsize=11)
    axes[1, 0].axis('off')
    plt.colorbar(im1, ax=axes[1, 0], fraction=0.046)

    im2 = axes[1, 1].imshow(indices['vari'], cmap='RdYlGn')
    axes[1, 1].set_title('VARI Index', fontsize=11)
    axes[1, 1].axis('off')
    plt.colorbar(im2, ax=axes[1, 1], fraction=0.046)

    im3 = axes[1, 2].imshow(indices['exgr'], cmap='RdYlGn')
    axes[1, 2].set_title('ExG - ExR (ExGR)', fontsize=11)
    axes[1, 2].axis('off')
    plt.colorbar(im3, ax=axes[1, 2], fraction=0.046)

    # Row 3: More indices + final result
    im4 = axes[2, 0].imshow(indices['ndi'], cmap='RdYlGn')
    axes[2, 0].set_title('NDI Index', fontsize=11)
    axes[2, 0].axis('off')
    plt.colorbar(im4, ax=axes[2, 0], fraction=0.046)

    im5 = axes[2, 1].imshow(indices['rgbvi'], cmap='RdYlGn')
    axes[2, 1].set_title('RGBVI Index', fontsize=11)
    axes[2, 1].axis('off')
    plt.colorbar(im5, ax=axes[2, 1], fraction=0.046)

    # Final vegetation detection
    exg_mask = indices['exg'] < np.percentile(indices['exg'], 25)
    vari_mask = indices['vari'] < np.percentile(indices['vari'], 25)
    exgr_mask = indices['exgr'] < np.percentile(indices['exgr'], 20)
    vegetation_mask = ~(exg_mask | vari_mask | exgr_mask)

    masked_rgb = rgb_img.copy()
    masked_rgb[~vegetation_mask] = [100, 100, 100]

    axes[2, 2].imshow(masked_rgb)
    axes[2, 2].set_title('Final Vegetation Detection', fontsize=11, fontweight='bold')
    axes[2, 2].axis('off')

    plt.tight_layout()
    debug_file = os.path.join(Config.OUTPUT_DIR, f'orthophoto_debug_{method}.png')
    plt.savefig(debug_file, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"✅ Saved: {debug_file}")

def analyze_drone_images():
    """Analyze individual drone RGB/NIR image pairs"""
    print("\n" + "=" * 80)
    print("DRONE IMAGE NDVI ANALYSIS")
    print("=" * 80)

    if not os.path.exists(Config.DRONE_FOLDER):
        print(f"❌ Drone folder not found: {Config.DRONE_FOLDER}")
        return None

    # Find RGB/NIR pairs
    rgb_files = [f for f in os.listdir(Config.DRONE_FOLDER)
                 if f.lower().endswith(".jpg") and "dji" in f.lower()]

    pairs = []
    for rgb_file in rgb_files:
        num = extract_number(rgb_file)
        if num is not None:
            nir_num = num + 5
            nir_file = f"DJI_{nir_num:04d}.tif"
            nir_path = os.path.join(Config.DRONE_FOLDER, nir_file)
            if os.path.exists(nir_path):
                pairs.append((os.path.join(Config.DRONE_FOLDER, rgb_file), nir_path))

    print(f"\n✅ Found {len(pairs)} RGB/NIR pairs")

    if len(pairs) == 0:
        print("❌ No valid RGB/NIR pairs found")
        return None

    ensure_output_dir()
    results = []

    # Process each pair
    for idx, (rgb_path, nir_path) in enumerate(pairs, 1):
        print(f"\n📸 Processing pair {idx}/{len(pairs)}:")
        print(f"  RGB: {os.path.basename(rgb_path)}")
        print(f"  NIR: {os.path.basename(nir_path)}")

        try:
            # Load images
            rgb = io.imread(rgb_path).astype(float)
            nir = io.imread(nir_path).astype(float)
            red = rgb[:, :, 0]

            # Calculate NDVI
            ndvi = calculate_ndvi(red, nir)

            # Vegetation mask
            veg_mask = ndvi > Config.NDVI_THRESHOLD

            # Size filtering to identify vines
            labels_img = measure.label(veg_mask)
            vine_mask = np.zeros_like(veg_mask, dtype=bool)

            vine_count = 0
            total_vine_area = 0

            for region in measure.regionprops(labels_img):
                if region.area > Config.MIN_VINE_SIZE:
                    vine_mask[labels_img == region.label] = True
                    vine_count += 1
                    total_vine_area += region.area

            # Calculate statistics
            veg_percentage = np.sum(veg_mask) / veg_mask.size * 100
            vine_percentage = np.sum(vine_mask) / vine_mask.size * 100
            avg_ndvi = np.mean(ndvi[veg_mask]) if np.any(veg_mask) else 0

            print(f"  ✅ Vegetation coverage: {veg_percentage:.1f}%")
            print(f"  🌿 Identified vines: {vine_count}")
            print(f"  📊 Vine coverage: {vine_percentage:.1f}%")
            print(f"  📈 Avg NDVI (vegetation): {avg_ndvi:.3f}")

            # Save results
            result = {
                'rgb_file': os.path.basename(rgb_path),
                'nir_file': os.path.basename(nir_path),
                'vegetation_percentage': veg_percentage,
                'vine_count': vine_count,
                'vine_percentage': vine_percentage,
                'avg_ndvi': avg_ndvi,
                'total_vine_area_pixels': total_vine_area
            }
            results.append(result)

            # Save visualizations
            save_drone_visualizations(rgb, ndvi, veg_mask, vine_mask,
                                      os.path.basename(rgb_path), idx)

        except Exception as e:
            print(f"  ❌ Error: {e}")
            continue

    # Save summary report
    save_drone_report(results)

    print(f"\n🎉 Drone analysis complete!")
    print(f"💾 Results saved in: {Config.OUTPUT_DIR}")

    return results


def save_drone_visualizations(rgb, ndvi, veg_mask, vine_mask, filename, idx):
    """Save visualizations for drone image analysis"""
    fig, axes = plt.subplots(2, 2, figsize=(15, 12))

    # Original RGB
    axes[0, 0].imshow(rgb.astype(np.uint8))
    axes[0, 0].set_title(f'Original RGB: {filename}')
    axes[0, 0].axis('off')

    # NDVI
    im1 = axes[0, 1].imshow(ndvi, cmap='RdYlGn', vmin=-1, vmax=1)
    axes[0, 1].set_title('NDVI Map')
    axes[0, 1].axis('off')
    plt.colorbar(im1, ax=axes[0, 1], label='NDVI')

    # Vegetation mask
    axes[1, 0].imshow(veg_mask, cmap='Greens')
    axes[1, 0].set_title(f'Vegetation Mask (NDVI > {Config.NDVI_THRESHOLD})')
    axes[1, 0].axis('off')

    # Vine mask
    axes[1, 1].imshow(vine_mask, cmap='YlGn')
    axes[1, 1].set_title(f'Individual Vines (Size > {Config.MIN_VINE_SIZE} px)')
    axes[1, 1].axis('off')

    plt.tight_layout()
    output_file = os.path.join(Config.OUTPUT_DIR, f'drone_analysis_{idx:03d}.png')
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    plt.close()


def save_drone_report(results):
    """Save summary report for drone image analysis"""
    report_file = os.path.join(Config.OUTPUT_DIR, 'drone_analysis_summary.txt')

    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("╔" + "═" * 80 + "╗\n")
        f.write("║" + " " * 25 + "DRONE IMAGE NDVI ANALYSIS" + " " * 30 + "║\n")
        f.write("╚" + "═" * 80 + "╝\n\n")

        f.write(f"Total image pairs analyzed: {len(results)}\n")
        f.write(f"NDVI threshold: {Config.NDVI_THRESHOLD}\n")
        f.write(f"Minimum vine size: {Config.MIN_VINE_SIZE} pixels\n\n")

        if results:
            avg_veg = np.mean([r['vegetation_percentage'] for r in results])
            avg_vines = np.mean([r['vine_count'] for r in results])
            avg_ndvi = np.mean([r['avg_ndvi'] for r in results if r['avg_ndvi'] > 0])

            f.write("OVERALL STATISTICS:\n")
            f.write(f"• Average vegetation coverage: {avg_veg:.1f}%\n")
            f.write(f"• Average vines per image: {avg_vines:.1f}\n")
            f.write(f"• Average NDVI: {avg_ndvi:.3f}\n\n")

            f.write("INDIVIDUAL IMAGE RESULTS:\n")
            f.write("-" * 80 + "\n")

            for i, result in enumerate(results, 1):
                f.write(f"\n{i}. {result['rgb_file']}\n")
                f.write(f"   Vegetation coverage: {result['vegetation_percentage']:.1f}%\n")
                f.write(f"   Identified vines: {result['vine_count']}\n")
                f.write(f"   Vine coverage: {result['vine_percentage']:.1f}%\n")
                f.write(f"   Average NDVI: {result['avg_ndvi']:.3f}\n")

    # CSV export
    csv_file = os.path.join(Config.OUTPUT_DIR, 'drone_analysis_results.csv')
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write("image_number,rgb_file,nir_file,vegetation_pct,vine_count,vine_pct,avg_ndvi\n")
        for i, result in enumerate(results, 1):
            f.write(f"{i},{result['rgb_file']},{result['nir_file']},"
                    f"{result['vegetation_percentage']:.2f},{result['vine_count']},"
                    f"{result['vine_percentage']:.2f},{result['avg_ndvi']:.4f}\n")

    # JSON export
    json_file = os.path.join(Config.OUTPUT_DIR, 'drone_analysis_results.json')
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump({
            'metadata': {
                'total_images': len(results),
                'ndvi_threshold': Config.NDVI_THRESHOLD,
                'min_vine_size': Config.MIN_VINE_SIZE
            },
            'results': results
        }, f, indent=2, ensure_ascii=False)


# ================================
# MAIN EXECUTION
# ================================
def main():
    """Main function to run both analyses"""
    print("\n" + "=" * 80)
    print("COMBINED VINEYARD ANALYSIS SYSTEM")
    print("=" * 80)
    print("\nThis system performs two types of analysis:")
    print("1. Orthophoto Analysis - Large-scale gap detection with GPS coordinates")
    print("2. Drone Image Analysis - Detailed NDVI and vine identification")
    print("=" * 80)

    ensure_output_dir()

    # Run orthophoto analysis
    ortho_results = None
    try:
        ortho_results = analyze_orthophoto()
    except Exception as e:
        print(f"\n⚠️ Orthophoto analysis skipped or failed: {e}")

    # Run drone image analysis
    drone_results = None
    try:
        drone_results = analyze_drone_images()
    except Exception as e:
        print(f"\n⚠️ Drone image analysis skipped or failed: {e}")

    # Generate combined summary
    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)

    summary_file = os.path.join(Config.OUTPUT_DIR, 'combined_analysis_summary.txt')
    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write("╔" + "═" * 80 + "╗\n")
        f.write("║" + " " * 20 + "COMBINED VINEYARD ANALYSIS SUMMARY" + " " * 26 + "║\n")
        f.write("╚" + "═" * 80 + "╝\n\n")

        # Orthophoto results
        f.write("1. ORTHOPHOTO GAP ANALYSIS:\n")
        f.write("-" * 80 + "\n")
        if ortho_results:
            f.write(f"   ✅ Analysis completed successfully\n")
            f.write(f"   • Total rows analyzed: {ortho_results['total_rows']}\n")
            f.write(f"   • Rows with gaps: {len(ortho_results['row_summary'])}\n")
            f.write(f"   • Total gaps detected: {len(ortho_results['gaps'])}\n")
            if ortho_results['gaps']:
                total_area = sum(g['area_sqm'] for g in ortho_results['gaps'])
                f.write(f"   • Total gap area: {total_area:.1f} m²\n")
        else:
            f.write("   ⚠️ Analysis not performed or failed\n")

        f.write("\n")

        # Drone image results
        f.write("2. DRONE IMAGE NDVI ANALYSIS:\n")
        f.write("-" * 80 + "\n")
        if drone_results:
            f.write(f"   ✅ Analysis completed successfully\n")
            f.write(f"   • Image pairs processed: {len(drone_results)}\n")
            avg_veg = np.mean([r['vegetation_percentage'] for r in drone_results])
            avg_vines = np.mean([r['vine_count'] for r in drone_results])
            f.write(f"   • Average vegetation coverage: {avg_veg:.1f}%\n")
            f.write(f"   • Average vines per image: {avg_vines:.1f}\n")
        else:
            f.write("   ⚠️ Analysis not performed or failed\n")

        f.write("\n" + "=" * 80 + "\n")
        f.write(f"All results saved in: {Config.OUTPUT_DIR}\n")

    print(f"\n📊 Summary:")
    if ortho_results:
        print(f"   ✅ Orthophoto: {len(ortho_results['gaps'])} gaps detected")
    if drone_results:
        print(f"   ✅ Drone images: {len(drone_results)} pairs analyzed")

    print(f"\n💾 All results saved in: {Config.OUTPUT_DIR}")
    print(f"📄 Combined summary: {summary_file}")

    print("\n" + "=" * 80)
    print("Generated files:")
    print("=" * 80)

    expected_files = [
        'vineyard_gaps_detailed.geojson',
        'vineyard_gap_centers.geojson',
        'orthophoto_summary.txt',
        'orthophoto_gaps.csv',
        'orthophoto_gaps.json',
        'orthophoto_debug.png',
        'drone_analysis_summary.txt',
        'drone_analysis_results.csv',
        'drone_analysis_results.json',
        'drone_analysis_*.png (multiple)',
        'combined_analysis_summary.txt'
    ]

    for filename in expected_files:
        print(f"   • {filename}")

    print("\n✅ Analysis complete!\n")


if __name__ == "__main__":
    main()