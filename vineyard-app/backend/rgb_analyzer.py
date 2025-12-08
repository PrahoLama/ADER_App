#!/usr/bin/env python3
"""
RGB Drone Image Analyzer for Vegetation Health Detection
Analyzes RGB drone images to detect:
- Vegetation indices (VARI, ExG, ExGR)
- Health zones (healthy, stressed, bare soil)
- Coverage percentages
- Anomaly detection
"""

import sys
import json
import os
from pathlib import Path
import numpy as np
import cv2
from typing import Dict, List, Tuple

class RGBVegetationAnalyzer:
    """Analyze RGB drone images for vegetation health"""
    
    def __init__(self):
        """Initialize analyzer"""
        pass
    
    def calculate_vari(self, image: np.ndarray) -> np.ndarray:
        """
        Calculate Visible Atmospherically Resistant Index (VARI)
        VARI = (Green - Red) / (Green + Red - Blue)
        Range: -1 to 1, higher = more vegetation
        """
        b, g, r = cv2.split(image.astype(float))
        
        # Avoid division by zero
        denominator = g + r - b
        denominator[denominator == 0] = 0.0001
        
        vari = (g - r) / denominator
        vari = np.clip(vari, -1, 1)
        
        return vari
    
    def calculate_exg(self, image: np.ndarray) -> np.ndarray:
        """
        Calculate Excess Green Index (ExG)
        ExG = 2*Green - Red - Blue
        Emphasizes green vegetation
        """
        b, g, r = cv2.split(image.astype(float))
        exg = 2 * g - r - b
        
        # Normalize to 0-255
        exg = cv2.normalize(exg, None, 0, 255, cv2.NORM_MINMAX)
        
        return exg
    
    def calculate_exgr(self, image: np.ndarray) -> np.ndarray:
        """
        Calculate Excess Green minus Excess Red (ExGR)
        ExGR = ExG - ExR = 3*Green - 2.4*Red - Blue
        Better discrimination between vegetation and soil
        """
        b, g, r = cv2.split(image.astype(float))
        exgr = 3 * g - 2.4 * r - b
        
        # Normalize to 0-255
        exgr = cv2.normalize(exgr, None, 0, 255, cv2.NORM_MINMAX)
        
        return exgr
    
    def detect_health_zones(self, vari: np.ndarray, exg: np.ndarray) -> Dict:
        """
        Classify pixels into health zones
        Returns: masks and statistics
        """
        # Thresholds
        vari_healthy = 0.1  # VARI > 0.1 = healthy vegetation
        vari_stressed = -0.1  # VARI < -0.1 = stressed/bare
        exg_vegetation = 20  # ExG > 20 = vegetation present
        
        # Create masks
        healthy_mask = (vari > vari_healthy) & (exg > exg_vegetation)
        stressed_mask = (vari > vari_stressed) & (vari <= vari_healthy) & (exg > exg_vegetation)
        bare_soil_mask = (vari <= vari_stressed) | (exg <= exg_vegetation)
        
        # Calculate percentages
        total_pixels = vari.size
        healthy_pct = (np.sum(healthy_mask) / total_pixels) * 100
        stressed_pct = (np.sum(stressed_mask) / total_pixels) * 100
        bare_soil_pct = (np.sum(bare_soil_mask) / total_pixels) * 100
        
        return {
            'masks': {
                'healthy': healthy_mask,
                'stressed': stressed_mask,
                'bare_soil': bare_soil_mask
            },
            'statistics': {
                'healthy_percent': round(healthy_pct, 2),
                'stressed_percent': round(stressed_pct, 2),
                'bare_soil_percent': round(bare_soil_pct, 2),
                'vegetation_cover': round(healthy_pct + stressed_pct, 2)
            }
        }
    
    def create_visualization(self, image: np.ndarray, vari: np.ndarray, 
                           exg: np.ndarray, health_zones: Dict) -> np.ndarray:
        """Create visualization overlay with health zones"""
        
        # Create color-coded health map
        health_map = np.zeros_like(image)
        
        masks = health_zones['masks']
        
        # Healthy = Green
        health_map[masks['healthy']] = [0, 255, 0]
        
        # Stressed = Yellow/Orange
        health_map[masks['stressed']] = [0, 165, 255]
        
        # Bare soil = Brown/Red
        health_map[masks['bare_soil']] = [50, 50, 150]
        
        # Blend with original image
        alpha = 0.4
        overlay = cv2.addWeighted(image, 1 - alpha, health_map, alpha, 0)
        
        # Add statistics text
        stats = health_zones['statistics']
        text_lines = [
            f"Healthy: {stats['healthy_percent']:.1f}%",
            f"Stressed: {stats['stressed_percent']:.1f}%",
            f"Bare Soil: {stats['bare_soil_percent']:.1f}%",
            f"Total Vegetation: {stats['vegetation_cover']:.1f}%"
        ]
        
        y_offset = 30
        for line in text_lines:
            cv2.putText(overlay, line, (10, y_offset), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(overlay, line, (10, y_offset), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 1)
            y_offset += 30
        
        # Add legend
        legend_y = image.shape[0] - 100
        cv2.rectangle(overlay, (10, legend_y), (30, legend_y + 20), (0, 255, 0), -1)
        cv2.putText(overlay, "Healthy", (35, legend_y + 15), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        cv2.rectangle(overlay, (10, legend_y + 25), (30, legend_y + 45), (0, 165, 255), -1)
        cv2.putText(overlay, "Stressed", (35, legend_y + 40), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        cv2.rectangle(overlay, (10, legend_y + 50), (30, legend_y + 70), (50, 50, 150), -1)
        cv2.putText(overlay, "Bare Soil", (35, legend_y + 65), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        return overlay
    
    def analyze_image(self, image_path: str, output_dir: str = None) -> Dict:
        """
        Analyze single RGB drone image
        
        Args:
            image_path: Path to input image
            output_dir: Optional directory to save visualizations
            
        Returns:
            Dictionary with analysis results
        """
        if not os.path.exists(image_path):
            return {'error': f'Image not found: {image_path}'}
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            return {'error': f'Failed to load image: {image_path}'}
        
        img_height, img_width = image.shape[:2]
        
        print(f"   📐 Image size: {img_width}x{img_height}", file=sys.stderr)
        
        # Calculate vegetation indices
        print("   🌿 Calculating VARI...", file=sys.stderr)
        vari = self.calculate_vari(image)
        
        print("   🌱 Calculating ExG...", file=sys.stderr)
        exg = self.calculate_exg(image)
        
        print("   🍃 Calculating ExGR...", file=sys.stderr)
        exgr = self.calculate_exgr(image)
        
        # Detect health zones
        print("   🏥 Detecting health zones...", file=sys.stderr)
        health_zones = self.detect_health_zones(vari, exg)
        
        # Calculate mean indices
        mean_vari = float(np.mean(vari))
        mean_exg = float(np.mean(exg))
        mean_exgr = float(np.mean(exgr))
        
        # Create visualization if output directory specified
        visualization_path = None
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            filename = Path(image_path).stem
            visualization_path = os.path.join(output_dir, f"rgb_analysis_{filename}.jpg")
            
            print(f"   🎨 Creating visualization...", file=sys.stderr)
            overlay = self.create_visualization(image, vari, exg, health_zones)
            cv2.imwrite(visualization_path, overlay)
            print(f"   ✅ Saved to: {visualization_path}", file=sys.stderr)
        
        return {
            'image_path': image_path,
            'image_size': {'width': img_width, 'height': img_height},
            'indices': {
                'vari_mean': round(mean_vari, 3),
                'exg_mean': round(mean_exg, 2),
                'exgr_mean': round(mean_exgr, 2)
            },
            'health_analysis': health_zones['statistics'],
            'visualization': visualization_path
        }


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='RGB Drone Image Vegetation Analyzer')
    parser.add_argument('--image', required=True, help='Path to image or directory')
    parser.add_argument('--output', help='Output directory for visualizations')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    
    args = parser.parse_args()
    
    # Initialize analyzer
    analyzer = RGBVegetationAnalyzer()
    
    # Process images
    image_path = Path(args.image)
    
    if image_path.is_dir():
        # Batch processing
        image_paths = list(image_path.glob('*.jpg')) + list(image_path.glob('*.png'))
        results = []
        for img_path in image_paths:
            print(f"\n📸 Processing: {img_path.name}", file=sys.stderr)
            result = analyzer.analyze_image(str(img_path), args.output)
            results.append(result)
    else:
        # Single image
        print(f"\n📸 Processing: {image_path.name}", file=sys.stderr)
        results = [analyzer.analyze_image(str(image_path), args.output)]
    
    # Output results
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            if 'error' in result:
                print(f"❌ Error: {result['error']}", file=sys.stderr)
            else:
                print(f"\n✅ Results for {Path(result['image_path']).name}:", file=sys.stderr)
                print(f"   VARI: {result['indices']['vari_mean']}", file=sys.stderr)
                print(f"   ExG: {result['indices']['exg_mean']}", file=sys.stderr)
                print(f"   Healthy: {result['health_analysis']['healthy_percent']}%", file=sys.stderr)
                print(f"   Stressed: {result['health_analysis']['stressed_percent']}%", file=sys.stderr)
                print(f"   Bare Soil: {result['health_analysis']['bare_soil_percent']}%", file=sys.stderr)
