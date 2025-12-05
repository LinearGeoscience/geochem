#!/usr/bin/env python
"""
Test the drillhole upload endpoint directly.
"""

import requests
import sys
import time
from pathlib import Path

def test_upload(collar_file, survey_file, assay_file, server_url="http://localhost:8000"):
    """Test drillhole upload with specified files."""

    print(f"\n{'='*60}")
    print("TESTING DRILLHOLE UPLOAD")
    print(f"{'='*60}")
    print(f"Server: {server_url}")
    print(f"Collar: {collar_file} ({Path(collar_file).stat().st_size/1024:.1f} KB)")
    print(f"Survey: {survey_file} ({Path(survey_file).stat().st_size/1024:.1f} KB)")
    print(f"Assay:  {assay_file} ({Path(assay_file).stat().st_size/1024:.1f} KB)")
    print(f"{'='*60}\n")

    # Prepare files
    files = {
        'collar': ('collar.csv', open(collar_file, 'rb'), 'text/csv'),
        'survey': ('survey.csv', open(survey_file, 'rb'), 'text/csv'),
        'assay': ('assay.csv', open(assay_file, 'rb'), 'text/csv')
    }

    # Make request
    url = f"{server_url}/api/data/upload/drillhole"
    print(f"Sending POST request to {url}...")

    start_time = time.time()

    try:
        response = requests.post(url, files=files, timeout=300)  # 5 minute timeout

        elapsed = time.time() - start_time

        if response.status_code == 200:
            print(f"\n[SUCCESS] Upload completed in {elapsed:.2f} seconds")

            result = response.json()
            print(f"\nResult:")
            print(f"  - Rows: {result.get('rows', 'N/A')}")
            print(f"  - Columns: {result.get('columns', 'N/A')}")

            if 'performance' in result:
                perf = result['performance']
                print(f"\nPerformance:")
                print(f"  - Upload time: {perf.get('upload_time', 'N/A')}s")
                print(f"  - Desurvey time: {perf.get('desurvey_time', 'N/A')}s")
                print(f"  - Total time: {perf.get('total_time', 'N/A')}s")

            return True

        else:
            print(f"\n[ERROR] Upload failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False

    except requests.exceptions.Timeout:
        print(f"\n[ERROR] Request timed out after {time.time() - start_time:.1f} seconds")
        return False

    except requests.exceptions.ConnectionError:
        print(f"\n[ERROR] Could not connect to server at {server_url}")
        print("Make sure the backend is running: python -m uvicorn app.main:app --reload")
        return False

    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Close files
        for key, (filename, file, mimetype) in files.items():
            file.close()

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test drillhole upload")
    parser.add_argument("--small", action="store_true", help="Test with small files (2 holes)")
    parser.add_argument("--medium", action="store_true", help="Test with medium files (100 holes)")
    parser.add_argument("--large", action="store_true", help="Test with large files")
    parser.add_argument("--server", default="http://localhost:8000", help="Server URL")

    args = parser.parse_args()

    if args.small:
        print("Testing with SMALL dataset (2 holes)...")
        success = test_upload(
            "test_collar.csv",
            "test_survey.csv",
            "test_assay.csv",
            args.server
        )
    elif args.medium:
        print("Testing with MEDIUM dataset (100 holes)...")
        success = test_upload(
            "test_collar_medium.csv",
            "test_survey_medium.csv",
            "test_assay_medium.csv",
            args.server
        )
    elif args.large:
        # Test with actual large files
        data_path = r"C:\Users\harry\OneDrive\2 - Work\Model Earth\Projects\IGO_Forrestania\Relogging\Converted_To_Excel\Data"
        collar = Path(data_path) / "Collar 1.csv"
        survey = Path(data_path) / "Survey 1.csv"
        assay = Path(data_path) / "Assays 1.csv"

        if all([collar.exists(), survey.exists(), assay.exists()]):
            print("Testing with LARGE dataset (48K holes)...")
            success = test_upload(str(collar), str(survey), str(assay), args.server)
        else:
            print("[ERROR] Large test files not found")
            sys.exit(1)
    else:
        # Default: test with small files
        print("Testing with SMALL dataset (default)...")
        success = test_upload(
            "test_collar.csv",
            "test_survey.csv",
            "test_assay.csv",
            args.server
        )

    sys.exit(0 if success else 1)