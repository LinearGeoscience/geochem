#!/usr/bin/env python
"""
Create test drillhole data files for testing the column mapping functionality.
This creates properly formatted CSV files that should work with the drillhole import system.
"""

import pandas as pd
import numpy as np
import os

def create_test_data():
    """Create test collar, survey, and assay CSV files."""

    # Create test collar data
    collar_data = {
        'HOLE_ID': ['DH001', 'DH002', 'DH003', 'DH004', 'DH005'],
        'EASTING': [500000, 500100, 500200, 500050, 500150],
        'NORTHING': [7000000, 7000000, 7000000, 7000100, 7000100],
        'RL': [100, 105, 102, 98, 103],
        'TOTAL_DEPTH': [150, 200, 180, 220, 165],
        'DATE_DRILLED': ['2023-01-15', '2023-01-20', '2023-02-01', '2023-02-10', '2023-02-15']
    }
    collar_df = pd.DataFrame(collar_data)

    # Create test survey data
    survey_records = []
    for hole_id in collar_data['HOLE_ID']:
        depth = collar_data['TOTAL_DEPTH'][collar_data['HOLE_ID'].index(hole_id)]
        # Add survey readings every 30m
        for d in range(0, depth + 1, 30):
            survey_records.append({
                'HOLE_ID': hole_id,
                'DEPTH': d,
                'AZIMUTH': 90 + np.random.normal(0, 2),  # Around 90 degrees with some variation
                'DIP': -60 + np.random.normal(0, 1)  # Around -60 degrees with some variation
            })
    survey_df = pd.DataFrame(survey_records)

    # Create test assay data
    assay_records = []
    for hole_id in collar_data['HOLE_ID']:
        depth = collar_data['TOTAL_DEPTH'][collar_data['HOLE_ID'].index(hole_id)]
        # Add assay intervals every 2m
        for d in range(0, depth, 2):
            assay_records.append({
                'HOLE_ID': hole_id,
                'FROM': d,
                'TO': min(d + 2, depth),
                'Au_ppm': np.random.lognormal(0, 1),
                'Cu_pct': np.random.lognormal(-1, 0.5),
                'Ag_ppm': np.random.lognormal(1, 1),
                'Fe_pct': np.random.normal(5, 2),
                'S_pct': np.random.normal(1, 0.5)
            })
    assay_df = pd.DataFrame(assay_records)

    # Round numeric values
    survey_df['AZIMUTH'] = survey_df['AZIMUTH'].round(1)
    survey_df['DIP'] = survey_df['DIP'].round(1)
    assay_df['Au_ppm'] = assay_df['Au_ppm'].round(3)
    assay_df['Cu_pct'] = assay_df['Cu_pct'].round(3)
    assay_df['Ag_ppm'] = assay_df['Ag_ppm'].round(2)
    assay_df['Fe_pct'] = assay_df['Fe_pct'].round(2)
    assay_df['S_pct'] = assay_df['S_pct'].round(3)

    # Save to CSV files
    collar_df.to_csv('test_collar.csv', index=False)
    survey_df.to_csv('test_survey.csv', index=False)
    assay_df.to_csv('test_assay.csv', index=False)

    print("Test data files created:")
    print(f"  - test_collar.csv ({len(collar_df)} collars)")
    print(f"  - test_survey.csv ({len(survey_df)} survey points)")
    print(f"  - test_assay.csv ({len(assay_df)} assay intervals)")

    # Also create tab-delimited versions
    collar_df.to_csv('test_collar.txt', index=False, sep='\t')
    survey_df.to_csv('test_survey.txt', index=False, sep='\t')
    assay_df.to_csv('test_assay.txt', index=False, sep='\t')

    print("\nTab-delimited versions also created:")
    print("  - test_collar.txt")
    print("  - test_survey.txt")
    print("  - test_assay.txt")

    # Create semicolon-delimited versions (European format)
    collar_df.to_csv('test_collar_euro.csv', index=False, sep=';', decimal=',')
    survey_df.to_csv('test_survey_euro.csv', index=False, sep=';', decimal=',')
    assay_df.to_csv('test_assay_euro.csv', index=False, sep=';', decimal=',')

    print("\nSemicolon-delimited versions also created:")
    print("  - test_collar_euro.csv")
    print("  - test_survey_euro.csv")
    print("  - test_assay_euro.csv")

    # Display sample data
    print("\n" + "="*60)
    print("Sample Collar Data:")
    print(collar_df.head())
    print("\n" + "="*60)
    print("Sample Survey Data:")
    print(survey_df.head(10))
    print("\n" + "="*60)
    print("Sample Assay Data:")
    print(assay_df.head(10))

    return collar_df, survey_df, assay_df

if __name__ == "__main__":
    create_test_data()