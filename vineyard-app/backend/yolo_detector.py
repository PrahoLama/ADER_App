#!/usr/bin/env python3
"""
YOLO-based Multi-Industry Object Detection System
Supports: Agriculture (vines, fruits, trees, gaps) & Rescue (people, lost objects)
"""

import sys
import json
import os
from pathlib import Path
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional

# Check for ultralytics
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    print("⚠️ ultralytics not installed. Run: pip install ultralytics", file=sys.stderr)
    YOLO_AVAILABLE = False


class MultiIndustryDetector:
    """
    Multi-purpose YOLO detector for agriculture and rescue operations
    """
    
    # Industry-specific class mappings
    INDUSTRY_CLASSES = {
        'agriculture': {
            'vine': ['vine', 'grapevine', 'plant'],
            'fruit': ['grape', 'fruit', 'berry'],
            'tree': ['tree', 'bush'],
            'gap': ['gap', 'missing_plant', 'empty_spot'],
            'disease': ['disease', 'blight', 'pest', 'damage'],
            'weed': ['weed', 'unwanted_plant'],
            'soil': ['bare_soil', 'ground']
        },
        'rescue': {
            'person': ['person', 'human', 'people'],
            'lost_object': ['backpack', 'handbag', 'suitcase', 'bottle'],
            'vehicle': ['car', 'truck', 'motorcycle', 'bicycle'],
            'animal': ['dog', 'cat', 'horse', 'cow', 'sheep'],
            'structure': ['tent', 'building', 'shelter']
        },
        'general': {
            # COCO classes - all available
            'all': list(range(80))
        }
    }
    
    # COCO class names (YOLOv8 default)
    COCO_CLASSES = [
        'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
        'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
        'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
        'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
        'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
        'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
        'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
        'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
        'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
        'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
    ]
    
    def __init__(self, model_path: str = None, industry: str = 'general', confidence: float = 0.25):
        """
        Initialize YOLO detector
        
        Args:
            model_path: Path to custom YOLO model (if None, uses YOLOv8n pretrained)
            industry: 'agriculture', 'rescue', or 'general'
            confidence: Detection confidence threshold (0-1)
        """
        self.industry = industry
        self.confidence = confidence
        self.model = None
        
        if not YOLO_AVAILABLE:
            raise ImportError("ultralytics package not available")
        
        # Load model
        if model_path and os.path.exists(model_path):
            print(f"📦 Loading custom model: {model_path}", file=sys.stderr)
            self.model = YOLO(model_path)
        else:
            print("📦 Loading YOLOv8n pretrained model...", file=sys.stderr)
            self.model = YOLO('yolov8n.pt')  # Nano model (fastest)
        
        print(f"✅ YOLO model loaded for industry: {industry}", file=sys.stderr)
    
    def get_relevant_classes(self) -> List[str]:
        """Get relevant class names for current industry"""
        if self.industry == 'general':
            return self.COCO_CLASSES
        
        industry_config = self.INDUSTRY_CLASSES.get(self.industry, {})
        relevant_classes = []
        
        for category, class_keywords in industry_config.items():
            for keyword in class_keywords:
                if keyword in self.COCO_CLASSES:
                    relevant_classes.append(keyword)
        
        return relevant_classes if relevant_classes else self.COCO_CLASSES
    
    def detect_objects(self, image_path: str, output_path: str = None) -> Dict:
        """
        Detect objects in image and return bounding boxes
        
        Args:
            image_path: Path to input image
            output_path: Optional path to save annotated image
            
        Returns:
            Dictionary with detections and metadata
        """
        if not os.path.exists(image_path):
            return {'error': f'Image not found: {image_path}'}
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            return {'error': f'Failed to load image: {image_path}'}
        
        img_height, img_width = image.shape[:2]
        
        # Run inference with enhanced parameters
        # - imgsz: larger size for better small object detection
        # - iou: higher threshold to reduce overlapping boxes
        # - max_det: allow more detections per image
        # - agnostic_nms: class-agnostic NMS for better filtering
        # Use lower confidence initially to catch distant objects, then filter
        initial_confidence = max(0.15, self.confidence * 0.7)  # 30% lower for initial detection
        
        results = self.model(
            image, 
            conf=initial_confidence,
            iou=0.5,  # Higher IOU threshold for better NMS
            imgsz=640,  # Standard YOLO input size
            max_det=300,  # Allow more detections
            agnostic_nms=False,  # Class-specific NMS
            verbose=False
        )
        
        # Process detections
        detections = []
        relevant_classes = self.get_relevant_classes()
        
        # Size threshold: filter out very small boxes (likely false positives)
        min_box_area = (img_width * img_height) * 0.0001  # 0.01% of image area
        
        for result in results:
            boxes = result.boxes
            
            for box in boxes:
                # Extract box data
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                class_name = self.COCO_CLASSES[class_id] if class_id < len(self.COCO_CLASSES) else 'unknown'
                
                # Filter by industry relevance
                if self.industry != 'general' and class_name not in relevant_classes:
                    continue
                
                # Calculate box area
                box_area = (x2 - x1) * (y2 - y1)
                
                # Filter out very small detections (likely noise or distant objects)
                if box_area < min_box_area:
                    continue
                
                # Class-specific confidence adjustment (reduce false positives)
                # Traffic lights often have false positives, require higher confidence
                min_confidence = self.confidence
                if class_name == 'traffic light':
                    min_confidence = max(0.4, self.confidence * 1.3)  # 30% higher threshold
                
                if confidence < min_confidence:
                    continue
                
                # Calculate normalized coordinates (0-1)
                detection = {
                    'class': class_name,
                    'class_id': class_id,
                    'confidence': round(confidence, 3),
                    'bbox': {
                        'x1': float(x1),
                        'y1': float(y1),
                        'x2': float(x2),
                        'y2': float(y2),
                        'width': float(x2 - x1),
                        'height': float(y2 - y1)
                    },
                    'bbox_normalized': {
                        'x_center': float((x1 + x2) / 2 / img_width),
                        'y_center': float((y1 + y2) / 2 / img_height),
                        'width': float((x2 - x1) / img_width),
                        'height': float((y2 - y1) / img_height)
                    }
                }
                detections.append(detection)
        
        # Create annotated image if requested
        annotated_image_path = None
        if output_path:
            annotated_image = self._draw_detections(image.copy(), detections)
            cv2.imwrite(output_path, annotated_image)
            annotated_image_path = output_path
        
        return {
            'image_path': image_path,
            'image_size': {'width': img_width, 'height': img_height},
            'industry': self.industry,
            'confidence_threshold': self.confidence,
            'detections': detections,
            'detection_count': len(detections),
            'annotated_image': annotated_image_path
        }
    
    def _draw_detections(self, image: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """Draw bounding boxes on image"""
        for det in detections:
            bbox = det['bbox']
            x1, y1, x2, y2 = int(bbox['x1']), int(bbox['y1']), int(bbox['x2']), int(bbox['y2'])
            
            # Color based on confidence
            confidence = det['confidence']
            if confidence > 0.7:
                color = (0, 255, 0)  # Green
            elif confidence > 0.5:
                color = (0, 255, 255)  # Yellow
            else:
                color = (0, 165, 255)  # Orange
            
            # Draw box
            cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
            
            # Draw label
            label = f"{det['class']} {confidence:.2f}"
            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(image, (x1, y1 - label_size[1] - 10), 
                         (x1 + label_size[0], y1), color, -1)
            cv2.putText(image, label, (x1, y1 - 5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        return image
    
    def batch_detect(self, image_paths: List[str], output_dir: str = None) -> List[Dict]:
        """Process multiple images"""
        results = []
        
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        
        for i, img_path in enumerate(image_paths):
            print(f"Processing {i+1}/{len(image_paths)}: {img_path}", file=sys.stderr)
            
            output_path = None
            if output_dir:
                filename = Path(img_path).stem
                output_path = os.path.join(output_dir, f"annotated_{filename}.jpg")
            
            result = self.detect_objects(img_path, output_path)
            results.append(result)
        
        return results


def main():
    """CLI interface"""
    import argparse
    
    parser = argparse.ArgumentParser(description='YOLO Multi-Industry Object Detector')
    parser.add_argument('--image', required=True, help='Path to image or directory')
    parser.add_argument('--industry', default='general', 
                       choices=['agriculture', 'rescue', 'general'],
                       help='Industry mode')
    parser.add_argument('--confidence', type=float, default=0.25,
                       help='Detection confidence threshold')
    parser.add_argument('--model', help='Path to custom YOLO model')
    parser.add_argument('--output', help='Output directory for annotated images')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    
    args = parser.parse_args()
    
    # Initialize detector
    detector = MultiIndustryDetector(
        model_path=args.model,
        industry=args.industry,
        confidence=args.confidence
    )
    
    # Process images
    image_path = Path(args.image)
    
    if image_path.is_dir():
        # Batch processing
        image_paths = list(image_path.glob('*.jpg')) + list(image_path.glob('*.png'))
        results = detector.batch_detect([str(p) for p in image_paths], args.output)
    else:
        # Single image
        output_path = None
        if args.output:
            os.makedirs(args.output, exist_ok=True)
            output_path = os.path.join(args.output, f"annotated_{image_path.name}")
        
        results = [detector.detect_objects(str(image_path), output_path)]
    
    # Output results
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            if 'error' in result:
                print(f"❌ Error: {result['error']}", file=sys.stderr)
            else:
                print(f"✅ {result['image_path']}: {result['detection_count']} detections")
                for det in result['detections']:
                    print(f"   - {det['class']}: {det['confidence']:.2f}")


if __name__ == '__main__':
    main()
