
import os
import json
import numpy as np
import matplotlib.pyplot as plt
import cv2
import rasterio
from rasterio.transform import xy
from scipy import ndimage
from scipy.signal import find_peaks, savgol_filter
from skimage import filters, morphology, measure
from sklearn.cluster import DBSCAN
from shapely.geometry import LineString, MultiLineString
from pathlib import Path


class VineyardRowDetector:

    def __init__(self, orthophoto_path, output_geojson_path=None):
        self.orthophoto_path = Path(orthophoto_path)

        if output_geojson_path:
            self.output_path = Path(output_geojson_path)
        else:
            self.output_path = self.orthophoto_path.parent / f"{self.orthophoto_path.stem}_rows.geojson"

        self.transform = None
        self.crs = None
        self.image_rgb = None
        self.vegetation_mask = None
        self.pixel_size_m = None

        print(f"🔧 Vineyard Row Detector - Original Detection + Extrapolation")
        print(f"   Input: {self.orthophoto_path.name}")

    def calculate_vegetation_indices(self, r, g, b):
        """Calculate vegetation indices"""
        r_norm = r.astype(float) / 255.0
        g_norm = g.astype(float) / 255.0
        b_norm = b.astype(float) / 255.0
        epsilon = 1e-7

        indices = {}
        indices['exg'] = 2 * g_norm - r_norm - b_norm
        indices['ndi'] = (g_norm - r_norm) / (g_norm + r_norm + epsilon)
        indices['vari'] = (g_norm - r_norm) / (g_norm + r_norm - b_norm + epsilon)

        return indices

    def load_orthophoto(self):
        """Load orthophoto"""
        print(f"\n📂 Loading orthophoto...")

        with rasterio.open(self.orthophoto_path) as src:
            self.transform = src.transform
            self.crs = src.crs

            if src.count >= 3:
                r = src.read(1)
                g = src.read(2)
                b = src.read(3)
                self.image_rgb = np.dstack([r, g, b])
            else:
                gray = src.read(1)
                self.image_rgb = np.dstack([gray, gray, gray])

        h, w = self.image_rgb.shape[:2]
        pixel_width = abs(self.transform[0])
        pixel_height = abs(self.transform[4])
        self.pixel_size_m = (pixel_width + pixel_height) / 2 * 111000

        print(f"✅ Loaded: {w}x{h} pixels (~{self.pixel_size_m:.3f}m/pixel)")

    def create_vegetation_mask(self):
        """Create vegetation mask"""
        print(f"\n🌿 Creating vegetation mask...")

        r, g, b = self.image_rgb[:, :, 0], self.image_rgb[:, :, 1], self.image_rgb[:, :, 2]
        indices = self.calculate_vegetation_indices(r, g, b)

        exg_threshold = np.percentile(indices['exg'], 60)
        vari_threshold = np.percentile(indices['vari'], 55)

        vegetation_mask = (indices['exg'] > exg_threshold) | (indices['vari'] > vari_threshold)
        vegetation_mask = morphology.remove_small_objects(vegetation_mask, min_size=50)
        vegetation_mask = morphology.binary_closing(vegetation_mask, morphology.disk(2))

        self.vegetation_mask = vegetation_mask
        coverage = np.sum(vegetation_mask) / vegetation_mask.size * 100

        print(f"✅ Vegetation coverage: {coverage:.1f}%")

        return indices

    def detect_orientation_original_method(self):
        """Use the ORIGINAL orientation detection that worked"""
        print(f"\n📐 Detecting orientation (original method)...")

        # Use skeleton for better line detection
        skeleton = morphology.skeletonize(self.vegetation_mask)
        skeleton_dilated = morphology.binary_dilation(skeleton, morphology.disk(1))
        edges_uint8 = (skeleton_dilated * 255).astype(np.uint8)

        # Hough transform
        lines = cv2.HoughLinesP(
            edges_uint8,
            rho=1,
            theta=np.pi / 180,
            threshold=30,
            minLineLength=50,
            maxLineGap=10
        )

        if lines is None or len(lines) == 0:
            print("⚠️  No lines, using edges...")
            edges = filters.sobel(self.vegetation_mask.astype(float))
            edges_binary = edges > filters.threshold_otsu(edges)
            edges_uint8 = (edges_binary * 255).astype(np.uint8)
            lines = cv2.HoughLines(edges_uint8, 1, np.pi / 180, threshold=50)

            if lines is not None:
                angles = [np.degrees(theta) - 90 for _, theta in lines[:, 0]]
            else:
                return 0.0
        else:
            angles = []
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
                if angle > 90:
                    angle -= 180
                elif angle < -90:
                    angle += 180
                angles.append(angle)

        # Cluster angles
        angles_array = np.array(angles).reshape(-1, 1)
        clustering = DBSCAN(eps=5, min_samples=5).fit(angles_array)
        labels = clustering.labels_

        if len(set(labels)) > 1 and np.any(labels != -1):
            unique_labels, counts = np.unique(labels[labels != -1], return_counts=True)
            dominant_cluster = unique_labels[np.argmax(counts)]
            dominant_angle = np.median(angles_array[labels == dominant_cluster])
        else:
            dominant_angle = np.median(angles)

        print(f"✅ Orientation: {dominant_angle:.1f}° (from {len(lines)} lines)")
        return float(dominant_angle)

    def detect_sample_rows_original_method(self, angle):
        """
        Use ORIGINAL projection method that detected rows correctly
        (even if only 2 rows)
        """
        print(f"\n🔍 Detecting sample rows (original method)...")

        h, w = self.vegetation_mask.shape
        center = (w // 2, h // 2)

        # Rotate
        M = cv2.getRotationMatrix2D(center, -angle, 1.0)
        rotated = cv2.warpAffine(
            self.vegetation_mask.astype(np.uint8),
            M,
            (w, h),
            flags=cv2.INTER_NEAREST
        )

        # Vertical projection
        projection = np.sum(rotated, axis=1)

        # ORIGINAL smoothing approach
        window_size = min(51, len(projection) // 10 * 2 + 1)
        if window_size >= 5:
            smoothed = savgol_filter(projection, window_size, 3)
        else:
            smoothed = projection

        # ORIGINAL peak detection
        min_distance_px = max(10, int(20 / self.pixel_size_m))
        height_threshold = np.max(smoothed) * 0.15

        peaks, properties = find_peaks(
            smoothed,
            height=height_threshold,
            distance=min_distance_px,
            prominence=height_threshold * 0.3
        )

        print(f"✅ Detected {len(peaks)} sample rows")

        if len(peaks) >= 2:
            # Calculate spacing from detected peaks
            spacings = np.diff(peaks)
            avg_spacing_px = np.median(spacings)
            avg_spacing_m = avg_spacing_px * self.pixel_size_m

            print(f"   📏 Measured spacing: {avg_spacing_m:.2f}m ({avg_spacing_px:.1f} px)")
        else:
            # Fallback
            avg_spacing_px = int(1.8 / self.pixel_size_m)
            avg_spacing_m = 1.8
            print(f"   ⚠️  Using default spacing: {avg_spacing_m:.2f}m")

        return peaks, rotated, -angle, avg_spacing_px

    def extrapolate_all_rows(self, sample_peaks, avg_spacing_px, rotated_shape):
        """
        Extrapolate rows across entire field from sample rows
        """
        print(f"\n📐 Extrapolating rows across field...")

        h, w = rotated_shape

        if len(sample_peaks) == 0:
            print("❌ No sample rows")
            return []

        # Use middle peak as reference
        reference_y = int(sample_peaks[len(sample_peaks) // 2])

        print(f"   🎯 Reference: y={reference_y}")
        print(f"   📏 Spacing: {avg_spacing_px:.1f} px ({avg_spacing_px * self.pixel_size_m:.2f}m)")

        # Generate positions
        row_positions = [reference_y]

        # Upward
        current_y = reference_y - avg_spacing_px
        while current_y > 0:
            row_positions.append(int(current_y))
            current_y -= avg_spacing_px

        # Downward
        current_y = reference_y + avg_spacing_px
        while current_y < h:
            row_positions.append(int(current_y))
            current_y += avg_spacing_px

        row_positions = sorted(row_positions)

        print(f"✅ Extrapolated {len(row_positions)} rows")

        return row_positions

    def create_field_mask(self):
        """Create field boundary mask"""
        r, g, b = self.image_rgb[:, :, 0], self.image_rgb[:, :, 1], self.image_rgb[:, :, 2]
        brightness = (r.astype(float) + g.astype(float) + b.astype(float)) / 3
        field_mask = brightness > 15
        field_mask = morphology.remove_small_objects(field_mask, min_size=1000)
        field_mask = morphology.binary_closing(field_mask, morphology.disk(5))
        field_mask = morphology.binary_erosion(field_mask, morphology.disk(3))
        return field_mask

    def extract_row_geometries(self, row_positions, rotated, rotation_angle):
        """Extract geometries with field boundary clipping"""
        print(f"\n📏 Creating row geometries...")

        h, w = rotated.shape
        field_mask = self.create_field_mask()

        # Rotate field mask
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, -rotation_angle, 1.0)
        field_mask_rotated = cv2.warpAffine(
            field_mask.astype(np.uint8),
            M,
            (w, h),
            flags=cv2.INTER_NEAREST
        ).astype(bool)

        row_geometries = []

        for row_idx, row_y in enumerate(row_positions):
            if row_y < 0 or row_y >= h:
                continue

            # Get field mask at this row
            row_field_mask = field_mask_rotated[row_y, :]
            field_cols = np.where(row_field_mask)[0]

            if len(field_cols) < 10:
                continue

            # Find continuous segments
            gaps = np.diff(field_cols) > 5
            gap_indices = np.where(gaps)[0]

            segments = []
            start_idx = 0
            for gap_idx in gap_indices:
                segment = field_cols[start_idx:gap_idx + 1]
                if len(segment) > 10:
                    segments.append(segment)
                start_idx = gap_idx + 1

            final_segment = field_cols[start_idx:]
            if len(final_segment) > 10:
                segments.append(final_segment)

            if len(segments) == 0:
                continue

            # Create line for longest segment
            segment = max(segments, key=len)
            x_start = segment[0]
            x_end = segment[-1]

            # Sample points
            num_points = 20
            x_points = np.linspace(x_start, x_end, num_points)
            y_points = np.full_like(x_points, row_y)

            # Rotate back
            angle_rad = np.radians(-rotation_angle)
            center_x, center_y = w / 2, h / 2

            x_rot = (x_points - center_x) * np.cos(angle_rad) - (y_points - center_y) * np.sin(angle_rad) + center_x
            y_rot = (x_points - center_x) * np.sin(angle_rad) + (y_points - center_y) * np.cos(angle_rad) + center_y

            # To geographic
            geo_coords = []
            for x, y in zip(x_rot, y_rot):
                if 0 <= x < w and 0 <= y < h:
                    lon, lat = xy(self.transform, y, x)
                    geo_coords.append([lon, lat])

            if len(geo_coords) >= 2:
                geometry = LineString(geo_coords)
                length_m = geometry.length * 111000

                if length_m >= 5:
                    row_geometries.append({
                        'row_number': row_idx + 1,
                        'geometry': geometry,
                        'length_m': length_m,
                        'segments': 1
                    })

        print(f"✅ Created {len(row_geometries)} rows")

        return row_geometries

    def create_geojson(self, row_geometries):
        """Create GeoJSON"""
        features = []

        for row_info in row_geometries:
            coordinates = [list(row_info['geometry'].coords)]

            feature = {
                "type": "Feature",
                "properties": {
                    "rand": str(row_info['row_number']),
                    "row_id": row_info['row_number'],
                    "length_m": round(row_info['length_m'], 2)
                },
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": coordinates
                }
            }
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "name": f"{self.orthophoto_path.stem}_rows",
            "crs": {
                "type": "name",
                "properties": {
                    "name": str(self.crs) if self.crs else "urn:ogc:def:crs:OGC:1.3:CRS84"
                }
            },
            "features": features
        }

    def save_geojson(self, geojson):
        """Save GeoJSON"""
        with open(self.output_path, 'w') as f:
            json.dump(geojson, f, indent=2)
        print(f"✅ Saved: {self.output_path.name}")

    def visualize(self, row_geometries, indices):
        """Create visualization"""
        print(f"\n🎨 Creating visualization...")

        fig, axes = plt.subplots(2, 2, figsize=(16, 12))

        axes[0, 0].imshow(self.image_rgb)
        axes[0, 0].set_title('Original', fontsize=12, fontweight='bold')
        axes[0, 0].axis('off')

        axes[0, 1].imshow(self.vegetation_mask, cmap='Greens')
        axes[0, 1].set_title('Vegetation', fontsize=12, fontweight='bold')
        axes[0, 1].axis('off')

        im = axes[1, 0].imshow(indices['exg'], cmap='RdYlGn')
        axes[1, 0].set_title('ExG Index', fontsize=12)
        axes[1, 0].axis('off')
        plt.colorbar(im, ax=axes[1, 0], fraction=0.046)

        overlay = self.image_rgb.copy()
        h, w = overlay.shape[:2]

        colors = plt.cm.rainbow(np.linspace(0, 1, len(row_geometries)))

        for idx, row_info in enumerate(row_geometries):
            geom = row_info['geometry']
            color_bgr = (int(colors[idx][2]*255), int(colors[idx][1]*255), int(colors[idx][0]*255))

            coords = list(geom.coords)
            for i in range(len(coords) - 1):
                lon1, lat1 = coords[i]
                lon2, lat2 = coords[i + 1]

                col1, row1 = ~self.transform * (lon1, lat1)
                col2, row2 = ~self.transform * (lon2, lat2)

                cv2.line(overlay, (int(col1), int(row1)), (int(col2), int(row2)), color_bgr, 2)

        axes[1, 1].imshow(overlay)
        axes[1, 1].set_title(f'{len(row_geometries)} ROWS', fontsize=13, fontweight='bold', color='green')
        axes[1, 1].axis('off')

        plt.tight_layout()
        viz_path = self.output_path.with_suffix('.png')
        plt.savefig(viz_path, dpi=150, bbox_inches='tight')
        plt.close()

        print(f"✅ Saved: {viz_path.name}")

    def run(self):
        """Main pipeline"""
        print("\n" + "="*80)
        print("🍇 VINEYARD ROW DETECTION - ORIGINAL + EXTRAPOLATION")
        print("="*80)

        self.load_orthophoto()
        indices = self.create_vegetation_mask()

        # Use ORIGINAL detection
        angle = self.detect_orientation_original_method()
        sample_peaks, rotated, rotation, avg_spacing_px = self.detect_sample_rows_original_method(angle)

        # Extrapolate
        all_positions = self.extrapolate_all_rows(sample_peaks, avg_spacing_px, rotated.shape)

        # Create geometries
        row_geometries = self.extract_row_geometries(all_positions, rotated, rotation)

        if len(row_geometries) == 0:
            print("\n❌ No rows!")
            return None

        geojson = self.create_geojson(row_geometries)
        self.save_geojson(geojson)
        self.visualize(row_geometries, indices)

        print("\n" + "="*80)
        print("✅ COMPLETE!")
        print("="*80)
        print(f"   📊 Rows: {len(row_geometries)}")
        print(f"   📏 Spacing: {avg_spacing_px * self.pixel_size_m:.2f}m")
        print(f"   📁 Output: {self.output_path.name}")
        print("="*80 + "\n")

        return geojson


def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python detect_rows_final.py <orthophoto.tif> [output.geojson]")
        sys.exit(1)

    orthophoto = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None

    detector = VineyardRowDetector(orthophoto, output)
    geojson = detector.run()

    if geojson:
        print(f"✅ Success! {len(geojson['features'])} rows")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()