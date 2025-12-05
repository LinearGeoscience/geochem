#!/usr/bin/env python
"""
Create test drillhole files with ambiguous column names to test manual column mapping.
This simulates real-world database exports with multiple similar column names.
"""

import pandas as pd
import numpy as np

def create_ambiguous_test_data():
    """Create test files with confusing/ambiguous column names."""

    # Collar file with multiple ID and coordinate columns
    collar_data = {
        'RecordID': list(range(1, 6)),  # Database record ID (not hole ID!)
        'SampleID': ['S001', 'S002', 'S003', 'S004', 'S005'],  # Sample ID (not hole ID!)
        'BHID': ['DH001', 'DH002', 'DH003', 'DH004', 'DH005'],  # Actual hole ID
        'HoleNumber': [1, 2, 3, 4, 5],  # Numeric hole number
        'X': [500000, 500100, 500200, 500050, 500150],  # Could be easting
        'Y': [7000000, 7000000, 7000000, 7000100, 7000100],  # Could be northing
        'LocalX': [0, 100, 200, 50, 150],  # Local grid X
        'LocalY': [0, 0, 0, 100, 100],  # Local grid Y
        'East': [500000, 500100, 500200, 500050, 500150],  # Another easting
        'North': [7000000, 7000000, 7000000, 7000100, 7000100],  # Another northing
        'Elevation': [100, 105, 102, 98, 103],  # Could be RL
        'Z': [100, 105, 102, 98, 103],  # Also could be RL
        'CollarRL': [100, 105, 102, 98, 103],  # Definitely RL
        'MaxDepth': [150, 200, 180, 220, 165],  # Total depth
        'FinalDepth': [150, 200, 180, 220, 165],  # Also total depth
        'DateStarted': ['2023-01-15', '2023-01-20', '2023-02-01', '2023-02-10', '2023-02-15'],
        'DateCompleted': ['2023-01-16', '2023-01-22', '2023-02-03', '2023-02-13', '2023-02-17'],
        'Company': ['ABC Mining'] * 5,
        'Project': ['Gold Project'] * 5
    }
    collar_df = pd.DataFrame(collar_data)

    # Survey file with multiple depth and angle columns
    survey_records = []
    for i, hole_id in enumerate(['DH001', 'DH002', 'DH003', 'DH004', 'DH005']):
        depths = [0, 30, 60, 90, 120, 150][:5-i]  # Different number of surveys per hole
        for d in depths:
            survey_records.append({
                'ID': len(survey_records) + 1,  # Record ID
                'DrillholeID': f'Hole_{i+1}',  # Different naming convention
                'BHID': hole_id,  # Actual hole ID
                'SurveyDepth': d,  # Could be depth
                'MeasuredDepth': d,  # Also could be depth
                'Depth_m': d,  # Also depth
                'Distance': d,  # Could mean depth
                'Angle': -60 + np.random.normal(0, 1),  # Could be dip
                'Inclination': -60 + np.random.normal(0, 1),  # Also could be dip
                'Dip': -60 + np.random.normal(0, 1),  # Actual dip
                'Bearing': 90 + np.random.normal(0, 2),  # Could be azimuth
                'Direction': 90 + np.random.normal(0, 2),  # Could be azimuth
                'Azimuth': 90 + np.random.normal(0, 2),  # Actual azimuth
                'MagneticAzi': 92 + np.random.normal(0, 2),  # Magnetic azimuth
                'TrueAzi': 90 + np.random.normal(0, 2),  # True azimuth
                'Method': 'Gyro',
                'Quality': 'Good'
            })
    survey_df = pd.DataFrame(survey_records)

    # Assay file with multiple interval columns and many element columns
    assay_records = []
    for hole_id in ['DH001', 'DH002', 'DH003', 'DH004', 'DH005']:
        for d in range(0, 150, 2):
            assay_records.append({
                'SampleNo': f'S{len(assay_records)+1:04d}',  # Sample number
                'HoleID': hole_id.replace('DH', 'DDH'),  # Different prefix
                'BHID': hole_id,  # Actual hole ID
                'StartDepth': d,  # Could be from
                'EndDepth': d + 2,  # Could be to
                'From_m': d,  # Also from
                'To_m': d + 2,  # Also to
                'SampleFrom': d,  # Another from
                'SampleTo': d + 2,  # Another to
                'Interval': 2,  # Sample length
                'Au_ppm': np.random.lognormal(0, 1),
                'Au_ppb': np.random.lognormal(3, 1),  # Same element, different units
                'Au_gpt': np.random.lognormal(0, 1),  # Same element, another unit
                'Cu_pct': np.random.lognormal(-1, 0.5),
                'Cu_ppm': np.random.lognormal(3, 0.5),  # Same element, different units
                'Ag_ppm': np.random.lognormal(1, 1),
                'Pb_ppm': np.random.lognormal(2, 0.8),
                'Zn_ppm': np.random.lognormal(3, 0.7),
                'Fe_pct': np.random.normal(5, 2),
                'Fe2O3_pct': np.random.normal(7, 2),  # Related to Fe
                'S_pct': np.random.normal(1, 0.5),
                'SO4_pct': np.random.normal(2, 0.5),  # Related to S
                'Lab': 'XYZ Labs',
                'BatchNo': f'B{np.random.randint(1000, 9999)}',
                'Method': 'Fire Assay'
            })
    assay_df = pd.DataFrame(assay_records)

    # Round numeric values
    for col in survey_df.columns:
        if survey_df[col].dtype in [np.float64, np.float32]:
            survey_df[col] = survey_df[col].round(1)

    for col in assay_df.columns:
        if assay_df[col].dtype in [np.float64, np.float32]:
            if 'ppm' in col or 'ppb' in col:
                assay_df[col] = assay_df[col].round(2)
            else:
                assay_df[col] = assay_df[col].round(3)

    # Save files
    collar_df.to_csv('test_collar_ambiguous.csv', index=False)
    survey_df.to_csv('test_survey_ambiguous.csv', index=False)
    assay_df.to_csv('test_assay_ambiguous.csv', index=False)

    print("Created ambiguous test files:")
    print(f"  - test_collar_ambiguous.csv ({len(collar_df)} records, {len(collar_df.columns)} columns)")
    print(f"  - test_survey_ambiguous.csv ({len(survey_df)} records, {len(survey_df.columns)} columns)")
    print(f"  - test_assay_ambiguous.csv ({len(assay_df)} records, {len(assay_df.columns)} columns)")

    print("\n" + "="*60)
    print("COLLAR FILE - Ambiguous columns:")
    print("  ID columns: RecordID, SampleID, BHID, HoleNumber")
    print("  X columns: X, LocalX, East")
    print("  Y columns: Y, LocalY, North")
    print("  Z columns: Elevation, Z, CollarRL")
    print("  --> Correct mapping: BHID, X or East, Y or North, CollarRL")

    print("\n" + "="*60)
    print("SURVEY FILE - Ambiguous columns:")
    print("  ID columns: ID, DrillholeID, BHID")
    print("  Depth columns: SurveyDepth, MeasuredDepth, Depth_m, Distance")
    print("  Dip columns: Angle, Inclination, Dip")
    print("  Azimuth columns: Bearing, Direction, Azimuth, MagneticAzi, TrueAzi")
    print("  --> Correct mapping: BHID, any depth column, Dip, Azimuth or TrueAzi")

    print("\n" + "="*60)
    print("ASSAY FILE - Ambiguous columns:")
    print("  ID columns: SampleNo, HoleID, BHID")
    print("  From columns: StartDepth, From_m, SampleFrom")
    print("  To columns: EndDepth, To_m, SampleTo")
    print("  Gold columns: Au_ppm, Au_ppb, Au_gpt (different units!)")
    print("  --> Correct mapping: BHID, any from column, any to column")

    print("\n" + "="*60)
    print("Sample data:")
    print("\nCollar (first 3 rows):")
    print(collar_df[['BHID', 'X', 'Y', 'CollarRL', 'MaxDepth']].head(3))
    print("\nSurvey (first 5 rows):")
    print(survey_df[['BHID', 'SurveyDepth', 'Dip', 'Azimuth']].head(5))
    print("\nAssay (first 5 rows):")
    print(assay_df[['BHID', 'From_m', 'To_m', 'Au_ppm', 'Cu_pct']].head(5))

if __name__ == "__main__":
    create_ambiguous_test_data()