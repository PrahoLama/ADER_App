#!/usr/bin/env python3
"""
DJI Flight Log Analyzer - Standalone Python Parser
Parses DJI flight log .txt files (versions 1-12, non-encrypted)
"""

import struct
import json
import csv
import os
import sys
import math
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Tuple

class DJILogParser:
    """Direct parser for DJI flight log files"""

    # Frame type definitions
    FRAME_TYPES = {
        1: "Home Point",
        2: "Gimbal",
        3: "RC",
        5: "Custom",
        11: "Deform",
        12: "Center Battery",
        13: "Smart Battery",
        255: "OSD (Main telemetry)"
    }

    def __init__(self, log_file: str):
        self.log_file = Path(log_file)
        self.version = None
        self.details = {}
        self.records = []

        if not self.log_file.exists():
            raise FileNotFoundError(f"Log file not found: {log_file}")

    def parse(self) -> Dict:
        """Parse the entire log file"""
        with open(self.log_file, 'rb') as f:
            data = f.read()

        # Parse header
        offset = 0

        # First 8 bytes: record area size (or first 4 + 4 zeros)
        record_size = struct.unpack('<Q', data[offset:offset+8])[0]
        offset += 8

        # Next 2 bytes: details area length
        details_length = struct.unpack('<H', data[offset:offset+2])[0]
        offset += 2

        # Next byte: version indicator
        self.version = data[offset]
        offset += 1

        print(f"Log Version: {self.version}")
        print(f"Details Length: {details_length} bytes")
        print(f"Record Area Size: {record_size} bytes")

        # Parse details section (JSON-like data)
        if details_length > 0:
            details_end = offset + details_length
            try:
                details_data = data[offset:details_end]
                # Try to decode as UTF-8 and parse as JSON
                details_str = details_data.decode('utf-8', errors='ignore')
                # Clean up the string
                details_str = details_str.strip('\x00')
                if details_str:
                    try:
                        self.details = json.loads(details_str)
                    except json.JSONDecodeError:
                        # Try to extract key info manually
                        self.details = {'raw': details_str[:200]}
            except Exception as e:
                print(f"Warning: Could not parse details: {e}")

            offset = details_end

        # Parse records
        print(f"\nParsing records starting at offset {offset}...")
        record_count = 0

        while offset < len(data) - 1:
            try:
                # Read frame type
                frame_type = data[offset]

                if frame_type == 0 or frame_type > 20:
                    # Skip invalid frames
                    offset += 1
                    continue

                # Read frame length (next byte for most types)
                if offset + 1 >= len(data):
                    break

                frame_length = data[offset + 1]

                if frame_length == 0 or offset + frame_length + 2 > len(data):
                    offset += 1
                    continue

                # Extract frame data
                frame_data = data[offset:offset + frame_length + 2]

                # Parse based on type
                if frame_type == 255:  # OSD - Main telemetry
                    record = self.parse_osd_frame(frame_data)
                    if record:
                        self.records.append(record)
                        record_count += 1
                elif frame_type == 13:  # Smart Battery
                    record = self.parse_battery_frame(frame_data)
                    if record:
                        self.records.append(record)
                        record_count += 1

                offset += frame_length + 2

            except Exception as e:
                offset += 1
                continue

        print(f"Parsed {record_count} records")

        return {
            'version': self.version,
            'details': self.details,
            'records': self.records
        }

    def parse_osd_frame(self, data: bytes) -> Optional[Dict]:
        """Parse OSD (main telemetry) frame - Type 255"""
        try:
            if len(data) < 55:
                return None

            offset = 2  # Skip type and length

            # Parse GPS coordinates (radians)
            longitude_rad = struct.unpack('<d', data[offset:offset+8])[0]
            offset += 8
            latitude_rad = struct.unpack('<d', data[offset:offset+8])[0]
            offset += 8

            # Convert to degrees
            longitude = math.degrees(longitude_rad)
            latitude = math.degrees(latitude_rad)

            # Height above start point (meters * 10)
            height_raw = struct.unpack('<h', data[offset:offset+2])[0]
            height = height_raw / 10.0
            offset += 2

            # Velocities (m/s * 10)
            x_speed_raw = struct.unpack('<h', data[offset:offset+2])[0]
            x_speed = x_speed_raw / 10.0
            offset += 2

            y_speed_raw = struct.unpack('<h', data[offset:offset+2])[0]
            y_speed = y_speed_raw / 10.0
            offset += 2

            z_speed_raw = struct.unpack('<h', data[offset:offset+2])[0]
            z_speed = z_speed_raw / 10.0
            offset += 2

            # Attitude (degrees * 10)
            pitch_raw = struct.unpack('<h', data[offset:offset+2])[0]
            pitch = pitch_raw / 10.0
            offset += 2

            roll_raw = struct.unpack('<h', data[offset:offset+2])[0]
            roll = roll_raw / 10.0
            offset += 2

            yaw_raw = struct.unpack('<h', data[offset:offset+2])[0]
            yaw = yaw_raw / 10.0
            offset += 2

            # Skip some fields
            offset += 6

            # GPS satellite count
            gps_sats = data[offset] if offset < len(data) else 0

            return {
                'type': 'OSD',
                'latitude': round(latitude, 7),
                'longitude': round(longitude, 7),
                'height_m': round(height, 2),
                'x_speed_ms': round(x_speed, 2),
                'y_speed_ms': round(y_speed, 2),
                'z_speed_ms': round(z_speed, 2),
                'pitch_deg': round(pitch, 1),
                'roll_deg': round(roll, 1),
                'yaw_deg': round(yaw, 1),
                'gps_satellites': gps_sats
            }
        except Exception as e:
            return None

    def parse_battery_frame(self, data: bytes) -> Optional[Dict]:
        """Parse Smart Battery frame - Type 13"""
        try:
            if len(data) < 30:
                return None

            offset = 2  # Skip type and length

            # Battery level (percent)
            battery_percent = data[offset]
            offset += 1

            # Current capacity (mAh)
            current_capacity = struct.unpack('<H', data[offset:offset+2])[0]
            offset += 2

            # Total capacity (mAh)
            total_capacity = struct.unpack('<H', data[offset:offset+2])[0]
            offset += 2

            # Skip some fields
            offset += 3

            # Charge cycles
            if offset + 4 <= len(data):
                charge_cycles = struct.unpack('<I', data[offset:offset+4])[0]
            else:
                charge_cycles = 0

            return {
                'type': 'Battery',
                'battery_percent': battery_percent,
                'current_capacity_mah': current_capacity,
                'total_capacity_mah': total_capacity,
                'charge_cycles': charge_cycles
            }
        except Exception as e:
            return None

    def export_to_csv(self, output_file: str):
        """Export records to CSV"""
        if not self.records:
            print("No records to export")
            return

        # Get all unique keys
        all_keys = set()
        for record in self.records:
            all_keys.update(record.keys())

        fieldnames = sorted(all_keys)

        with open(output_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(self.records)

        print(f"Exported {len(self.records)} records to {output_file}")

    def export_to_kml(self, output_file: str):
        """Export GPS track to KML"""
        gps_records = [r for r in self.records if r.get('type') == 'OSD'
                       and r.get('latitude') and r.get('longitude')]

        if not gps_records:
            print("No GPS records to export")
            return

        kml = ['<?xml version="1.0" encoding="UTF-8"?>']
        kml.append('<kml xmlns="http://www.opengis.net/kml/2.2">')
        kml.append('  <Document>')
        kml.append(f'    <name>{self.log_file.name}</name>')
        kml.append('    <Placemark>')
        kml.append('      <name>Flight Path</name>')
        kml.append('      <LineString>')
        kml.append('        <coordinates>')

        for record in gps_records:
            lon = record['longitude']
            lat = record['latitude']
            alt = record.get('height_m', 0)
            kml.append(f'          {lon},{lat},{alt}')

        kml.append('        </coordinates>')
        kml.append('      </LineString>')
        kml.append('    </Placemark>')
        kml.append('  </Document>')
        kml.append('</kml>')

        with open(output_file, 'w') as f:
            f.write('\n'.join(kml))

        print(f"Exported GPS track with {len(gps_records)} points to {output_file}")

    def print_summary(self):
        """Print a summary of the flight"""
        print(f"\n{'='*60}")
        print("FLIGHT SUMMARY")
        print(f"{'='*60}\n")

        # Details
        if self.details:
            print("Flight Details:")
            for key, value in self.details.items():
                print(f"  {key}: {value}")
            print()

        # Statistics from records
        osd_records = [r for r in self.records if r.get('type') == 'OSD']
        battery_records = [r for r in self.records if r.get('type') == 'Battery']

        print(f"Total Records: {len(self.records)}")
        print(f"  - Telemetry (OSD): {len(osd_records)}")
        print(f"  - Battery: {len(battery_records)}")

        if osd_records:
            print(f"\nTelemetry Summary:")

            # GPS
            valid_gps = [r for r in osd_records if r.get('latitude') and r.get('longitude')]
            if valid_gps:
                print(f"  GPS Points: {len(valid_gps)}")
                print(f"  Start Position: {valid_gps[0]['latitude']:.6f}, {valid_gps[0]['longitude']:.6f}")
                print(f"  End Position: {valid_gps[-1]['latitude']:.6f}, {valid_gps[-1]['longitude']:.6f}")

            # Altitude
            heights = [r['height_m'] for r in osd_records if 'height_m' in r]
            if heights:
                print(f"  Max Height: {max(heights):.2f} m")
                print(f"  Min Height: {min(heights):.2f} m")

            # Speed
            speeds = [abs(r.get('x_speed_ms', 0)) + abs(r.get('y_speed_ms', 0))
                      for r in osd_records]
            if speeds:
                print(f"  Max Horizontal Speed: {max(speeds):.2f} m/s")

            # GPS satellites
            gps_sats = [r['gps_satellites'] for r in osd_records if 'gps_satellites' in r]
            if gps_sats:
                print(f"  GPS Satellites: {min(gps_sats)} - {max(gps_sats)}")

        if battery_records:
            print(f"\nBattery Summary:")
            battery_levels = [r['battery_percent'] for r in battery_records]
            print(f"  Start Level: {battery_levels[0]}%")
            print(f"  End Level: {battery_levels[-1]}%")
            print(f"  Min Level: {min(battery_levels)}%")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description='Analyze DJI flight log files (standalone parser)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze and display summary
  python dji_log_analyzer.py flight.txt
  
  # Export to CSV
  python dji_log_analyzer.py flight.txt --csv output.csv
  
  # Export to KML (for Google Earth)
  python dji_log_analyzer.py flight.txt --kml track.kml
  
  # Export to JSON
  python dji_log_analyzer.py flight.txt --json output.json
  
  # Export all formats
  python dji_log_analyzer.py flight.txt --csv data.csv --kml track.kml --json data.json

Note: This parser works with non-encrypted logs (versions 1-12).
For encrypted logs (version 13+), use the Rust tool from:
https://github.com/lvauvillier/dji-log-parser/releases
        """
    )

    parser.add_argument('log_file', help='Path to DJI flight log .txt file')
    parser.add_argument('--csv', help='Export to CSV file')
    parser.add_argument('--kml', help='Export GPS track to KML file')
    parser.add_argument('--json', help='Export to JSON file')

    args = parser.parse_args()

    try:
        # Create parser
        print(f"\n{'='*60}")
        print(f"DJI Flight Log Parser")
        print(f"{'='*60}\n")
        print(f"Parsing: {args.log_file}")

        log_parser = DJILogParser(args.log_file)

        # Parse the log
        result = log_parser.parse()

        # Print summary
        log_parser.print_summary()

        # Export if requested
        print(f"\n{'='*60}")
        print("EXPORTS")
        print(f"{'='*60}\n")

        if args.csv:
            log_parser.export_to_csv(args.csv)

        if args.kml:
            log_parser.export_to_kml(args.kml)

        if args.json:
            with open(args.json, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"Exported full data to {args.json}")

        if not any([args.csv, args.kml, args.json]):
            print("No export format specified. Use --csv, --kml, or --json to export data.")

        print(f"\n{'='*60}")
        print("DONE!")
        print(f"{'='*60}\n")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()