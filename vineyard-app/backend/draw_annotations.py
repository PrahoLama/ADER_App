#!/usr/bin/env python3
"""
Draw annotations on images - used for exporting annotated images
"""

import argparse
import json
import cv2
import numpy as np
from pathlib import Path

# Color palette for different classes
COLORS = [
    (255, 0, 0),      # Red
    (0, 255, 0),      # Green
    (0, 0, 255),      # Blue
    (255, 255, 0),    # Cyan
    (255, 0, 255),    # Magenta
    (0, 255, 255),    # Yellow
    (128, 0, 255),    # Purple
    (255, 128, 0),    # Orange
    (0, 128, 255),    # Light Blue
    (128, 255, 0),    # Lime
]

def draw_annotations(image_path: str, detections: list, output_path: str):
    """
    Draw bounding boxes on an image
    
    Args:
        image_path: Path to the input image
        detections: List of detection dicts with bbox coordinates
        output_path: Path to save the annotated image
    """
    # Load image
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Failed to load image: {image_path}")
    
    height, width = image.shape[:2]
    
    for det in detections:
        # Get bbox coordinates
        bbox = det.get('bbox', {})
        
        # Support both absolute and normalized coordinates
        if all(k in bbox for k in ['x1', 'y1', 'x2', 'y2']):
            x1, y1, x2, y2 = int(bbox['x1']), int(bbox['y1']), int(bbox['x2']), int(bbox['y2'])
        elif 'bbox_normalized' in det:
            norm = det['bbox_normalized']
            x_center = norm.get('x_center', 0.5) * width
            y_center = norm.get('y_center', 0.5) * height
            w = norm.get('width', 0.1) * width
            h = norm.get('height', 0.1) * height
            x1, y1 = int(x_center - w/2), int(y_center - h/2)
            x2, y2 = int(x_center + w/2), int(y_center + h/2)
        else:
            continue
        
        # Get class and confidence
        class_name = det.get('class', 'object')
        confidence = det.get('confidence', 0.0)
        class_id = det.get('class_id', 0)
        
        # Select color based on class
        color = COLORS[class_id % len(COLORS)]
        
        # Draw bounding box
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        
        # Create label with class name and confidence
        label = f"{class_name}: {confidence:.2f}"
        
        # Get text size for background
        (text_width, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
        )
        
        # Draw label background
        cv2.rectangle(
            image,
            (x1, y1 - text_height - 10),
            (x1 + text_width + 5, y1),
            color,
            -1
        )
        
        # Draw label text
        cv2.putText(
            image,
            label,
            (x1 + 2, y1 - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2
        )
    
    # Save output
    cv2.imwrite(output_path, image)
    print(f"✅ Annotated image saved to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description='Draw annotations on images')
    parser.add_argument('--image', required=True, help='Input image path')
    parser.add_argument('--detections', help='JSON file with detections array')
    parser.add_argument('--annotations', help='Full annotation JSON file')
    parser.add_argument('--output', required=True, help='Output image path')
    
    args = parser.parse_args()
    
    # Load detections from either format
    if args.annotations:
        with open(args.annotations, 'r') as f:
            data = json.load(f)
            detections = data.get('detections', [])
    elif args.detections:
        with open(args.detections, 'r') as f:
            detections = json.load(f)
    else:
        raise ValueError("Either --detections or --annotations must be provided")
    
    draw_annotations(args.image, detections, args.output)

if __name__ == '__main__':
    main()
