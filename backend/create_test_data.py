#!/usr/bin/env python
"""
Create small test datasets for debugging drillhole upload issues.
"""

import pandas as pd
import numpy as np

print("Creating small test datasets...")

# Create tiny test files - just 2 holes
collar = pd.DataFrame({
    'HoleID': ['TEST001', 'TEST002'],
    'Easting': [100000, 100100],
    'Northing': [200000, 200100],
    'RL': [500, 510],
    'EOH': [150, 200]
})
collar.to_csv('test_collar.csv', index=False)
print(f"Created test_collar.csv with {len(collar)} holes")

# Survey data - 5 measurements per hole
survey_data = []
for hole in collar['HoleID']:
    for depth in [0, 50, 100, 150, 200]:
        survey_data.append({
            'HoleID': hole,
            'Depth': depth,
            'Dip': -60 + np.random.uniform(-5, 5),
            'Azimuth': 90 + np.random.uniform(-10, 10)
        })
survey = pd.DataFrame(survey_data)
survey.to_csv('test_survey.csv', index=False)
print(f"Created test_survey.csv with {len(survey)} measurements")

# Assay data - 10 samples per hole
assay_data = []
for hole in collar['HoleID']:
    for i in range(10):
        from_depth = i * 10
        to_depth = (i + 1) * 10
        assay_data.append({
            'HoleID': hole,
            'From': from_depth,
            'To': to_depth,
            'Au_ppm': np.random.lognormal(0, 1),
            'Cu_pct': np.random.uniform(0, 2),
            'Sample_ID': f"{hole}_{i:03d}"
        })
assay = pd.DataFrame(assay_data)
assay.to_csv('test_assay.csv', index=False)
print(f"Created test_assay.csv with {len(assay)} samples")

print("\nTest files created successfully!")
print("Files: test_collar.csv, test_survey.csv, test_assay.csv")

# Also create medium-sized test files (100 holes)
print("\nCreating medium test datasets...")

# Medium collar
collar_med = pd.DataFrame({
    'HoleID': [f'DH{i:04d}' for i in range(100)],
    'Easting': np.random.uniform(99000, 101000, 100),
    'Northing': np.random.uniform(199000, 201000, 100),
    'RL': np.random.uniform(450, 550, 100)
})
collar_med.to_csv('test_collar_medium.csv', index=False)

# Medium survey (5 points per hole = 500 total)
survey_med = []
for hole in collar_med['HoleID']:
    for depth in [0, 50, 100, 150, 200]:
        survey_med.append({
            'HoleID': hole,
            'Depth': depth,
            'Dip': -60 + np.random.uniform(-5, 5),
            'Azimuth': 90 + np.random.uniform(-10, 10)
        })
survey_med = pd.DataFrame(survey_med)
survey_med.to_csv('test_survey_medium.csv', index=False)

# Medium assay (10 samples per hole = 1000 total)
assay_med = []
for hole in collar_med['HoleID']:
    for i in range(10):
        assay_med.append({
            'HoleID': hole,
            'From': i * 10,
            'To': (i + 1) * 10,
            'Au_ppm': np.random.lognormal(0, 1)
        })
assay_med = pd.DataFrame(assay_med)
assay_med.to_csv('test_assay_medium.csv', index=False)

print(f"Created medium test files with {len(collar_med)} holes")
print("Files: test_collar_medium.csv, test_survey_medium.csv, test_assay_medium.csv")