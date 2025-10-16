#!/usr/bin/env python3
"""
Standalone vineyard analysis for web app
Extracts core logic from vine.py without requiring full vine.py import
"""
import sys
import json
import os
from pathlib import Path
import numpy as np
import cv2
from skimage import measure


def calculate_vegetation_indices(r, g, b):
    """Calculate vegetation indices from RGB bands"""
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

    # VARI
    indices['vari'] = (g_norm - r_norm) / (g_norm + r_norm - b_norm + epsilon)

    return indices


def analyze_drone_images_rgb_only(image_paths):
    """
    Analyze drone RGB images without NIR
    Uses RGB-based vegetation indices from vine.py methodology
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
                    'filename': Path(image_path).name,
                    'error': 'File not found'
                })
                continue

            # Load image
            img = cv2.imread(image_path)
            if img is None:
                results['images'].append({
                    'filename': Path(image_path).name,
                    'error': 'Failed to load image'
                })
                continue

            h, w = img.shape[:2]

            # Split channels (OpenCV uses BGR)
            b, g, r = cv2.split(img)

            # Calculate vegetation indices
            indices = calculate_vegetation_indices(r, g, b)

            # Create vegetation mask using combined approach (from vine.py)
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
                # Filter by size (similar to vine.py MIN_VINE_SIZE=500)
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
                'filename': Path(image_path).name,
                'vegetation_percentage': round(vegetation_percentage, 1),
                'vine_count': vine_count,
                'health_status': health_status,
                'image_size': {'width': w, 'height': h}
            })

        except Exception as e:
            results['images'].append({
                'filename': Path(image_path).name,
                'error': str(e)
            })

    if len(image_paths) > 0:
        results['average_vegetation'] = round(total_vegetation / len(image_paths), 1)

    return results


def analyze_orthophoto_simple(orthophoto_path, rows_geojson_path=None):
    """
    Simplified orthophoto analysis
    For full analysis with GeoJSON rows, use the original vine.py directly
    """
    try:
        if not os.path.exists(orthophoto_path):
            return {"error": f"Orthophoto not found: {orthophoto_path}"}

        # Load image
        img = cv2.imread(orthophoto_path)
        if img is None:
            return {"error": "Failed to load orthophoto"}

        h, w = img.shape[:2]
        b, g, r = cv2.split(img)

        # Calculate vegetation indices
        indices = calculate_vegetation_indices(r, g, b)

        # Create gap mask (inverse of vegetation)
        exg_threshold = np.percentile(indices['exg'], 30)
        vari_threshold = np.percentile(indices['vari'], 30)
        exgr_threshold = np.percentile(indices['exgr'], 25)

        gap_mask = (indices['exg'] < exg_threshold) | (indices['vari'] < vari_threshold) | (indices['exgr'] < exgr_threshold)

        # Morphological cleanup
        kernel = np.ones((3, 3), np.uint8)
        gap_mask = cv2.morphologyEx(gap_mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
        gap_mask = cv2.morphologyEx(gap_mask, cv2.MORPH_CLOSE, kernel)
        gap_mask = gap_mask > 0

        # Find gap regions
        labels_img = measure.label(gap_mask, connectivity=2)

        gap_count = 0
        total_gap_pixels = 0

        # Estimate pixels per meter (adjust based on drone altitude)
        pixels_per_meter = 10

        for region in measure.regionprops(labels_img):
            # Filter by size (from vine.py MIN/MAX_GAP_AREA_PIXELS)
            if 15 < region.area < 3000:
                gap_count += 1
                total_gap_pixels += region.area

        # Convert to m²
        total_gap_area_m2 = total_gap_pixels / (pixels_per_meter ** 2)

        return {
            'detected_gaps': gap_count,
            'total_gap_area_m2': round(total_gap_area_m2, 1),
            'rows_analyzed': 1,
            'rows_with_gaps': 1 if gap_count > 0 else 0,
            'details': [{
                'filename': Path(orthophoto_path).name,
                'gaps_detected': gap_count,
                'gap_area_m2': round(total_gap_area_m2, 1),
                'image_size': {'width': w, 'height': h}
            }]
        }

    except Exception as e:
        return {"error": f"Orthophoto analysis failed: {str(e)}"}


def run_original_vine_orthophoto(orthophoto_path, rows_geojson_path):
    """
    Run the original vine.py orthophoto analysis with full GeoJSON support
    This temporarily modifies vine.py's Config paths
    """
    try:
        # Import vine.py
        import vine
        from vine import Config, analyze_orthophoto

        # Store original paths
        original_ortho = Config.ORTHO_PATH
        original_rows = Config.ROWS_PATH

        # Update paths
        Config.ORTHO_PATH = orthophoto_path
        if rows_geojson_path and os.path.exists(rows_geojson_path):
            Config.ROWS_PATH = rows_geojson_path

        # Check files exist
        if not os.path.exists(Config.ORTHO_PATH):
            return {"error": f"Orthophoto not found: {Config.ORTHO_PATH}"}

        if not os.path.exists(Config.ROWS_PATH):
            return {"error": f"Rows GeoJSON not found: {Config.ROWS_PATH}. Please upload it or ensure default path exists."}

        # Run analysis
        result = analyze_orthophoto()

        # Restore paths
        Config.ORTHO_PATH = original_ortho
        Config.ROWS_PATH = original_rows

        if result is None:
            return {"error": "Analysis returned no results"}

        # Format for API
        return {
            'detected_gaps': len(result.get('gaps', [])),
            'total_gap_area_m2': sum(g.get('area_sqm', 0) for g in result.get('gaps', [])),
            'rows_analyzed': result.get('total_rows', 0),
            'rows_with_gaps': len(result.get('row_summary', [])),
            'details': [{
                'filename': Path(orthophoto_path).name,
                'gaps_detected': len(result.get('gaps', [])),
                'gap_area_m2': sum(g.get('area_sqm', 0) for g in result.get('gaps', []))
            }]
        }

    except ImportError as e:
        # Fallback to simple analysis if vine.py can't be imported
        return analyze_orthophoto_simple(orthophoto_path, rows_geojson_path)
    except Exception as e:
        return {"error": f"Analysis failed: {str(e)}"}


if __name__ == '__main__':
    try:
        if len(sys.argv) < 3:
            error_msg = {
                "error": "Usage: vine_analysis.py <analysis_type> <file_path1> [file_path2 ...]",
                "examples": {
                    "drone": "vine_analysis.py drone image1.jpg image2.jpg",
                    "orthophoto": "vine_analysis.py orthophoto orthophoto.tif [rows.geojson]"
                }
            }
            print(json.dumps(error_msg))
            sys.exit(1)

        analysis_type = sys.argv[1]

        if analysis_type == 'drone':
            image_paths = sys.argv[2:]
            result = analyze_drone_images_rgb_only(image_paths)

        elif analysis_type == 'orthophoto':
            orthophoto_path = sys.argv[2]
            rows_path = sys.argv[3] if len(sys.argv) > 3 else None

            # Try to use original vine.py if available
            result = run_original_vine_orthophoto(orthophoto_path, rows_path)

        else:
            result = {"error": f"Unknown analysis type: {analysis_type}. Use 'drone' or 'orthophoto'"}

        # Output JSON
        print(json.dumps(result))

    except Exception as e:
        error_result = {
            'error': str(e),
            'traceback': str(e.__traceback__)
        }
        print(json.dumps(error_result))
        sys.exit(1)