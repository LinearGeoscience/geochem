#!/usr/bin/env python
"""
Test the column mapping functionality with ambiguous files.
"""

import requests
import json

def test_preview_endpoint():
    """Test the preview endpoint with ambiguous column files."""

    # Files to test
    files = {
        'collar': ('test_collar_ambiguous.csv', open('test_collar_ambiguous.csv', 'rb'), 'text/csv'),
        'survey': ('test_survey_ambiguous.csv', open('test_survey_ambiguous.csv', 'rb'), 'text/csv'),
        'assay': ('test_assay_ambiguous.csv', open('test_assay_ambiguous.csv', 'rb'), 'text/csv')
    }

    try:
        # Send request to preview endpoint
        print("Testing preview endpoint...")
        response = requests.post(
            'http://localhost:8000/api/drillhole/preview',
            files=files
        )

        if response.status_code == 200:
            data = response.json()
            print("\n[SUCCESS] Preview successful!")

            # Display collar mappings
            print("\n" + "="*60)
            print("COLLAR FILE ANALYSIS:")
            print(f"Required fields: {data['collar']['required_fields']}")
            print("\nColumn suggestions:")
            for col in data['collar']['columns']:
                if col['suggested_role']:
                    print(f"  {col['name']:20} -> {col['suggested_role']:15} (confidence: {col['confidence']}%)")

            # Display survey mappings
            print("\n" + "="*60)
            print("SURVEY FILE ANALYSIS:")
            print(f"Required fields: {data['survey']['required_fields']}")
            print("\nColumn suggestions:")
            for col in data['survey']['columns']:
                if col['suggested_role']:
                    print(f"  {col['name']:20} -> {col['suggested_role']:15} (confidence: {col['confidence']}%)")

            # Display assay mappings
            print("\n" + "="*60)
            print("ASSAY FILE ANALYSIS:")
            print(f"Required fields: {data['assay']['required_fields']}")
            print("\nColumn suggestions:")
            for col in data['assay']['columns']:
                if col['suggested_role']:
                    print(f"  {col['name']:20} -> {col['suggested_role']:15} (confidence: {col['confidence']}%)")

            print("\n" + "="*60)
            print("[INFO] The UI should now show all columns for manual selection!")
            print("Users can override any automatic suggestions.")

        else:
            print(f"\n[ERROR] Preview failed with status {response.status_code}")
            print(f"Error: {response.text}")

    except Exception as e:
        print(f"\n[ERROR] Error testing preview: {e}")

    finally:
        # Close files
        for key, value in files.items():
            if hasattr(value[1], 'close'):
                value[1].close()

if __name__ == "__main__":
    print("Testing column mapping with ambiguous column names...")
    print("Make sure the backend is running on http://localhost:8000")
    print()
    test_preview_endpoint()
