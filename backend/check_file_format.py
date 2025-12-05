#!/usr/bin/env python
"""
Check the format of uploaded files to diagnose corruption issues.
"""

import sys

def check_file(filename):
    """Check if a file is binary or text and its format."""

    try:
        with open(filename, 'rb') as f:
            # Read first 1KB
            header = f.read(1024)

            print(f"\nAnalyzing: {filename}")
            print("="*60)

            # Check for Excel signature
            if header[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
                print("FILE TYPE: Microsoft Excel (.xls) - OLD FORMAT")
                print("ERROR: This is a binary Excel file!")
                print("SOLUTION: Save as CSV in Excel: File -> Save As -> CSV")
                return

            if header[:4] == b'PK\x03\x04':
                print("FILE TYPE: Microsoft Excel (.xlsx) - NEW FORMAT")
                print("ERROR: This is a zipped Excel file!")
                print("SOLUTION: Save as CSV in Excel: File -> Save As -> CSV")
                return

            # Check for BOM
            if header[:3] == b'\xef\xbb\xbf':
                print("FILE TYPE: UTF-8 with BOM")
                encoding = 'utf-8-sig'
            elif header[:2] == b'\xff\xfe':
                print("FILE TYPE: UTF-16 LE with BOM")
                encoding = 'utf-16'
            elif header[:2] == b'\xfe\xff':
                print("FILE TYPE: UTF-16 BE with BOM")
                encoding = 'utf-16'
            else:
                print("FILE TYPE: Text file (no BOM)")
                encoding = None

            # Check for null bytes (binary indicator)
            if b'\x00' in header:
                print("WARNING: Contains null bytes - might be binary!")

            # Try to decode and show first few lines
            f.seek(0)
            try:
                if encoding:
                    content = f.read().decode(encoding)
                else:
                    # Try different encodings
                    raw_bytes = f.read()
                    for enc in ['utf-8', 'latin-1', 'cp1252']:
                        try:
                            content = raw_bytes.decode(enc)
                            print(f"Successfully decoded with: {enc}")
                            break
                        except:
                            continue

                lines = content.split('\n')[:5]
                print("\nFirst 5 lines:")
                for i, line in enumerate(lines, 1):
                    # Clean and truncate for display
                    clean_line = ''.join(c for c in line if c.isprintable())[:100]
                    print(f"  {i}: {clean_line}")

                # Detect delimiter
                first_line = lines[0] if lines else ""
                print(f"\nDelimiter detection:")
                print(f"  Commas: {first_line.count(',')}")
                print(f"  Tabs: {first_line.count(chr(9))}")
                print(f"  Semicolons: {first_line.count(';')}")
                print(f"  Pipes: {first_line.count('|')}")

            except Exception as e:
                print(f"ERROR: Cannot decode file: {e}")
                print("This file appears to be binary or corrupted!")

    except Exception as e:
        print(f"ERROR: Cannot read file: {e}")

if __name__ == "__main__":
    import glob

    # Check all test files
    test_files = glob.glob("test_*.csv") + glob.glob("test_*.txt")

    if test_files:
        print("Checking test files...")
        for f in test_files[:3]:  # Check first 3
            check_file(f)
    else:
        if len(sys.argv) > 1:
            check_file(sys.argv[1])
        else:
            print("Usage: python check_file_format.py <filename>")
            print("Or place test files in current directory")