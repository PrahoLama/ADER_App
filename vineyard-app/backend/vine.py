
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

def analyze_orthophoto():
    """Main function for orthophoto gap detection"""
    print("\n" + "=" * 80)
    print("ORTHOPHOTO GAP ANALYSIS")
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

    # Detect bare soil
    print("🎯 Applying K-means clustering...")
    bare_soil_mask, labels, centroids = detect_bare_soil_kmeans(r, g, b)

    print(f"\n📊 Cluster centroids (RGB):")
    for i, centroid in enumerate(centroids):
        print(f"  Cluster {i}: R={centroid[0]:.1f}, G={centroid[1]:.1f}, B={centroid[2]:.1f}")

    # Create gap mask
    approaches = ['exg_adaptive', 'exgr', 'vari', 'kmeans', 'combined_improved']
    approach_results = {}

    for approach in approaches:
        gap_mask = create_gap_mask(indices, bare_soil_mask, approach)
        gap_percentage = np.sum(gap_mask) / gap_mask.size * 100
        approach_results[approach] = {
            'mask': gap_mask,
            'percentage': gap_percentage
        }
        print(f"📈 {approach}: {gap_percentage:.1f}% potential gaps")

    best_approach = 'combined_improved'
    final_gap_mask = approach_results[best_approach]['mask']

    print(f"\n✅ Using {best_approach} approach: {approach_results[best_approach]['percentage']:.1f}% gaps")

    # Process each row
    print(f"\n🔄 Processing {len(rows)} rows...")
    gaps = []
    row_summary = []

    for idx, row in rows.iterrows():
        try:
            # Create mask for this row
            mask = rasterize(
                [(row.geometry, 1)],
                out_shape=(h, w),
                transform=transform,
                fill=0,
                dtype='uint8'
            )

            if np.sum(mask) == 0:
                continue

            # Find gaps in this row
            row_gaps_mask = np.logical_and(final_gap_mask, mask == 1)
            gap_labels = measure.label(row_gaps_mask, connectivity=2)
            props = measure.regionprops(gap_labels)

            row_gaps = []
            gap_coordinates = []
            total_components = len(props)
            valid_components = 0

            for prop in props:
                # Filter by size
                if prop.area < Config.MIN_GAP_AREA_PIXELS or prop.area > Config.MAX_GAP_AREA_PIXELS:
                    continue

                valid_components += 1

                # Calculate geographic coordinates
                centroid_row, centroid_col = prop.centroid
                gap_lon, gap_lat = pixel_to_geographic(centroid_row, centroid_col, src.transform)

                # Bounding box
                minr, minc, maxr, maxc = prop.bbox
                lon_min, lat_max = src.transform * (minc, minr)
                lon_max, lat_min = src.transform * (maxc, maxr)

                # Calculate dimensions in meters
                width_meters = calculate_distance_meters(lat_min, lon_min, lat_min, lon_max)
                height_meters = calculate_distance_meters(lat_min, lon_min, lat_max, lon_min)
                area_sqm = width_meters * height_meters

                # Store gap info
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
    ensure_output_dir()

    if gaps:
        # GeoJSON files
        gdf = gpd.GeoDataFrame(gaps, crs=src.crs)
        out_geojson = os.path.join(Config.OUTPUT_DIR, 'vineyard_gaps_detailed.geojson')
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

        gdf_points = gpd.GeoDataFrame(gap_points, crs=src.crs)
        out_points = os.path.join(Config.OUTPUT_DIR, 'vineyard_gap_centers.geojson')
        gdf_points.to_file(out_points, driver='GeoJSON')

        # Save reports
        save_orthophoto_reports(gaps, row_summary, rows, src.crs)

        # Save debug visualization
        save_debug_visualization(r, g, b, final_gap_mask, labels, indices, best_approach)

        print(f"\n🎉 FINAL RESULTS:")
        print(f"📊 Total gaps detected: {len(gaps)}")
        print(f"📈 Rows with gaps: {len(row_summary)}/{len(rows)}")
        print(f"💾 Results saved in: {Config.OUTPUT_DIR}")

    src.close()

    return {
        'gaps': gaps,
        'row_summary': row_summary,
        'total_rows': len(rows)
    }


def save_orthophoto_reports(gaps, row_summary, rows, crs):
    """Save detailed reports for orthophoto analysis"""

    # Text summary
    summary_file = os.path.join(Config.OUTPUT_DIR, 'orthophoto_summary.txt')
    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write("╔" + "═" * 80 + "╗\n")
        f.write("║" + " " * 25 + "ORTHOPHOTO GAP ANALYSIS" + " " * 32 + "║\n")
        f.write("╚" + "═" * 80 + "╝\n\n")

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

    # CSV export
    csv_file = os.path.join(Config.OUTPUT_DIR, 'orthophoto_gaps.csv')
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write("row_id,gap_id,latitude,longitude,area_pixels,area_sqm,width_m,height_m,google_maps_link\n")
        for row_info in sorted(row_summary, key=lambda x: x['row_id']):
            for gap in row_info['gap_coordinates']:
                link = f"https://maps.google.com/?q={gap['lat']:.6f},{gap['lon']:.6f}"
                f.write(f"{row_info['row_id']},{gap['gap_id']},{gap['lat']:.8f},{gap['lon']:.8f},"
                        f"{gap['pixels']},{gap['area_sqm']:.1f},{gap['width_m']:.1f},{gap['height_m']:.1f},{link}\n")

    # JSON export
    json_file = os.path.join(Config.OUTPUT_DIR, 'orthophoto_gaps.json')
    json_data = {
        'metadata': {
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


def save_debug_visualization(r, g, b, gap_mask, labels, indices, approach):
    """Save debug visualization for orthophoto analysis - VERSIUNE EXTINSĂ"""
    fig, axes = plt.subplots(3, 3, figsize=(20, 18))

    rgb_img = np.stack([r, g, b], axis=2)

    # Rândul 1: RGB original, Gap detection, K-means clusters
    axes[0, 0].imshow(rgb_img)
    axes[0, 0].set_title('Original RGB', fontsize=12, fontweight='bold')
    axes[0, 0].axis('off')

    axes[0, 1].imshow(gap_mask, cmap='Reds')
    axes[0, 1].set_title(f'Gap Detection ({approach})', fontsize=12, fontweight='bold')
    axes[0, 1].axis('off')

    axes[0, 2].imshow(labels, cmap='tab10')
    axes[0, 2].set_title('K-means Clusters (RGB+Indici)', fontsize=12, fontweight='bold')
    axes[0, 2].axis('off')

    # Rândul 2: Indici individuali
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

    # Rândul 3: Indici suplimentari + rezultat final
    im4 = axes[2, 0].imshow(indices['ndi'], cmap='RdYlGn')
    axes[2, 0].set_title('NDI Index', fontsize=11)
    axes[2, 0].axis('off')
    plt.colorbar(im4, ax=axes[2, 0], fraction=0.046)

    im5 = axes[2, 1].imshow(indices['rgbvi'], cmap='RdYlGn')
    axes[2, 1].set_title('RGBVI Index', fontsize=11)
    axes[2, 1].axis('off')
    plt.colorbar(im5, ax=axes[2, 1], fraction=0.046)

    # Vegetație detectată final
    exg_mask = indices['exg'] < np.percentile(indices['exg'], 25)
    vari_mask = indices['vari'] < np.percentile(indices['vari'], 25)
    exgr_mask = indices['exgr'] < np.percentile(indices['exgr'], 20)
    vegetation_mask = ~(exg_mask | vari_mask | exgr_mask)

    masked_rgb = rgb_img.copy()
    masked_rgb[~vegetation_mask] = [100, 100, 100]

    axes[2, 2].imshow(masked_rgb)
    axes[2, 2].set_title('Vegetație Detectată Final\n(Combined Approach)',
                         fontsize=11, fontweight='bold')
    axes[2, 2].axis('off')

    plt.tight_layout()
    debug_file = os.path.join(Config.OUTPUT_DIR, 'orthophoto_debug_extended.png')
    plt.savefig(debug_file, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"✅ Salvat: {debug_file}")

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