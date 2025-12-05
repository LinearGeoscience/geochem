#!/usr/bin/env python
"""
Performance test script for drillhole processing optimizations.
Tests both original and optimized versions to measure speedup.
"""

import pandas as pd
import numpy as np
import time
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

def test_drillhole_processing(use_optimized=True):
    """Test drillhole processing with your actual data."""
    print("\n" + "="*70)
    print(f"TESTING {'OPTIMIZED' if use_optimized else 'ORIGINAL'} VERSION")
    print("="*70)

    # Data path
    data_path = r"C:\Users\harry\OneDrive\2 - Work\Model Earth\Projects\IGO_Forrestania\Relogging\Converted_To_Excel\Data"

    # Check if files exist
    collar_file = Path(data_path) / "Collar 1.csv"
    survey_file = Path(data_path) / "Survey 1.csv"
    assay_file = Path(data_path) / "Assays 1.csv"

    if not all([collar_file.exists(), survey_file.exists(), assay_file.exists()]):
        print("[ERROR] Test files not found at expected location")
        print(f"Looking in: {data_path}")
        return None

    # Load data
    print("\n[FILES] Loading files...")
    load_start = time.time()

    collar_df = pd.read_csv(collar_file)
    survey_df = pd.read_csv(survey_file)
    assay_df = pd.read_csv(assay_file)

    load_time = time.time() - load_start

    print(f"[OK] Collar: {len(collar_df)} holes")
    print(f"[OK] Survey: {len(survey_df)} measurements")
    print(f"[OK] Assays: {len(assay_df)} samples")
    print(f"[TIME] Load time: {load_time:.2f}s")

    # Process with desurvey
    print("\n[PROCESSING] Processing desurvey...")
    desurvey_start = time.time()

    if use_optimized:
        try:
            from app.core.drillhole_manager_optimized import DrillholeManagerOptimized
            manager = DrillholeManagerOptimized()
            # Use parallel processing for large datasets
            use_parallel = len(collar_df) > 100
            result = manager.desurvey(collar_df, survey_df, assay_df, use_parallel=use_parallel)
        except ImportError:
            print("[ERROR] Optimized version not found, falling back to original")
            from app.core.drillhole_manager import DrillholeManager
            manager = DrillholeManager()
            result = manager.desurvey(collar_df, survey_df, assay_df)
    else:
        from app.core.drillhole_manager import DrillholeManager
        manager = DrillholeManager()
        result = manager.desurvey(collar_df, survey_df, assay_df)

    desurvey_time = time.time() - desurvey_start

    if result.empty:
        print("[ERROR] Desurvey failed - no results")
        return None

    print(f"[OK] Processed: {len(result)} records")
    print(f"[TIME] Desurvey time: {desurvey_time:.2f}s")

    # Total time
    total_time = load_time + desurvey_time

    return {
        "load_time": load_time,
        "desurvey_time": desurvey_time,
        "total_time": total_time,
        "records": len(result)
    }

def compare_versions():
    """Compare original vs optimized performance."""
    print("\n" + "="*70)
    print("DRILLHOLE PROCESSING PERFORMANCE COMPARISON")
    print("="*70)

    # Test original version
    print("\n[1] Testing ORIGINAL implementation...")
    original_results = test_drillhole_processing(use_optimized=False)

    # Test optimized version
    print("\n[2] Testing OPTIMIZED implementation...")
    optimized_results = test_drillhole_processing(use_optimized=True)

    # Compare results
    if original_results and optimized_results:
        print("\n" + "="*70)
        print("PERFORMANCE COMPARISON RESULTS")
        print("="*70)

        print("\nProcessing Times:")
        print(f"{'Operation':<20} {'Original':>12} {'Optimized':>12} {'Speedup':>12}")
        print("-"*60)

        # Load time
        print(f"{'File Loading':<20} {original_results['load_time']:>11.2f}s {optimized_results['load_time']:>11.2f}s {original_results['load_time']/optimized_results['load_time']:>11.1f}x")

        # Desurvey time
        desurvey_speedup = original_results['desurvey_time'] / optimized_results['desurvey_time']
        print(f"{'Desurvey':<20} {original_results['desurvey_time']:>11.2f}s {optimized_results['desurvey_time']:>11.2f}s {desurvey_speedup:>11.1f}x")

        # Total time
        total_speedup = original_results['total_time'] / optimized_results['total_time']
        print(f"{'TOTAL':<20} {original_results['total_time']:>11.2f}s {optimized_results['total_time']:>11.2f}s {total_speedup:>11.1f}x")

        print("\nSummary:")
        print(f"  - Overall speedup: {total_speedup:.1f}x faster")
        print(f"  - Time saved: {original_results['total_time'] - optimized_results['total_time']:.1f} seconds")
        print(f"  - Processing rate: {optimized_results['records']/optimized_results['desurvey_time']:.0f} records/second")

        if total_speedup > 10:
            print("\n[SUCCESS] OPTIMIZATION SUCCESSFUL! Achieved >10x speedup!")
        elif total_speedup > 5:
            print("\n[SUCCESS] Good optimization! Achieved >5x speedup.")
        else:
            print("\n[WARNING] Moderate optimization. Consider further improvements.")

def quick_test():
    """Quick test with synthetic data for debugging."""
    print("\n[TEST] Running quick test with synthetic data...")

    # Generate synthetic data
    n_holes = 100
    n_surveys_per_hole = 50
    n_assays_per_hole = 100

    # Create collar data
    collar_df = pd.DataFrame({
        'HoleID': [f'DH{i:04d}' for i in range(n_holes)],
        'Easting': np.random.uniform(300000, 400000, n_holes),
        'Northing': np.random.uniform(6000000, 7000000, n_holes),
        'RL': np.random.uniform(400, 500, n_holes)
    })

    # Create survey data
    survey_data = []
    for hole in collar_df['HoleID']:
        depths = np.linspace(0, 500, n_surveys_per_hole)
        for depth in depths:
            survey_data.append({
                'HoleID': hole,
                'Depth': depth,
                'Dip': -60 + np.random.uniform(-5, 5),
                'Azimuth': 90 + np.random.uniform(-10, 10)
            })
    survey_df = pd.DataFrame(survey_data)

    # Create assay data
    assay_data = []
    for hole in collar_df['HoleID']:
        for i in range(n_assays_per_hole):
            from_depth = i * 5
            to_depth = (i + 1) * 5
            assay_data.append({
                'HoleID': hole,
                'From': from_depth,
                'To': to_depth,
                'Au_ppm': np.random.lognormal(0, 1)
            })
    assay_df = pd.DataFrame(assay_data)

    print(f"Generated: {len(collar_df)} holes, {len(survey_df)} surveys, {len(assay_df)} assays")

    # Test optimized version
    from app.core.drillhole_manager_optimized import DrillholeManagerOptimized

    manager = DrillholeManagerOptimized()
    start = time.time()
    result = manager.desurvey(collar_df, survey_df, assay_df, use_parallel=True)
    elapsed = time.time() - start

    print(f"[OK] Processed {len(result)} records in {elapsed:.2f}s")
    print(f"  Speed: {len(result)/elapsed:.0f} records/second")

    return result

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test drillhole processing performance")
    parser.add_argument("--quick", action="store_true", help="Run quick test with synthetic data")
    parser.add_argument("--compare", action="store_true", help="Compare original vs optimized")
    parser.add_argument("--optimized", action="store_true", help="Test only optimized version")

    args = parser.parse_args()

    if args.quick:
        quick_test()
    elif args.compare:
        compare_versions()
    else:
        # Default: test optimized version with real data
        test_drillhole_processing(use_optimized=True)

    print("\n[COMPLETE] Test complete!")