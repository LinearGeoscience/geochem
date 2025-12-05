import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional

class DrillholeManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DrillholeManager, cls).__new__(cls)
        return cls._instance

    def desurvey(self, collar_df: pd.DataFrame, survey_df: pd.DataFrame, assay_df: pd.DataFrame,
                 column_mapping: Dict[str, Dict[str, str]] = None) -> pd.DataFrame:
        """
        OPTIMIZED: Desurvey drillhole data to calculate XYZ coordinates for each assay interval.
        Uses GroupBy for O(N) complexity instead of O(M*N) and the Balanced Tangential method.

        Args:
            collar_df: Collar data with hole locations
            survey_df: Survey data with depth/dip/azimuth
            assay_df: Assay data with from/to depths
            column_mapping: Optional dict with explicit column mappings:
                {
                    'collar': {'hole_id': 'actual_col', 'easting': 'actual_col', ...},
                    'survey': {'hole_id': 'actual_col', 'depth': 'actual_col', ...},
                    'assay': {'hole_id': 'actual_col', 'from': 'actual_col', ...}
                }
        """
        import time
        start_time = time.time()

        # Standardize column names (basic cleaning - lowercase)
        collar_df = collar_df.copy()
        survey_df = survey_df.copy()
        assay_df = assay_df.copy()

        collar_df.columns = [str(c).lower().strip() for c in collar_df.columns]
        survey_df.columns = [str(c).lower().strip() for c in survey_df.columns]
        assay_df.columns = [str(c).lower().strip() for c in assay_df.columns]

        # Use explicit column mapping if provided, otherwise auto-detect
        if column_mapping:
            # Use the provided mappings (columns should already be renamed to standard names)
            hole_col = 'hole_id'
            east_col = 'easting'
            north_col = 'northing'
            rl_col = 'rl'
            depth_col = 'depth'
            dip_col = 'dip'
            azi_col = 'azimuth'
            from_col = 'from'
            to_col = 'to'

            # Verify required columns exist
            required_collar = [hole_col, east_col, north_col, rl_col]
            required_survey = [hole_col, depth_col, dip_col, azi_col]
            required_assay = [hole_col, from_col, to_col]

            missing_collar = [c for c in required_collar if c not in collar_df.columns]
            missing_survey = [c for c in required_survey if c not in survey_df.columns]
            missing_assay = [c for c in required_assay if c not in assay_df.columns]

            if missing_collar:
                print(f"Warning: Missing collar columns: {missing_collar}. Available: {list(collar_df.columns)}")
            if missing_survey:
                print(f"Warning: Missing survey columns: {missing_survey}. Available: {list(survey_df.columns)}")
            if missing_assay:
                print(f"Warning: Missing assay columns: {missing_assay}. Available: {list(assay_df.columns)}")
        else:
            # Auto-detect columns (legacy behavior)
            hole_col = next((c for c in collar_df.columns if c == 'hole_id' or 'holeid' in c.replace('_','') or 'bhid' in c),
                           next((c for c in collar_df.columns if 'hole' in c), collar_df.columns[0]))
            east_col = next((c for c in collar_df.columns if c == 'easting' or 'east' in c),
                           next((c for c in collar_df.columns if c == 'x'), None))
            north_col = next((c for c in collar_df.columns if c == 'northing' or 'north' in c),
                            next((c for c in collar_df.columns if c == 'y'), None))
            rl_col = next((c for c in collar_df.columns if c == 'rl' or 'elev' in c),
                         next((c for c in collar_df.columns if c == 'z'), None))

            depth_col = next((c for c in survey_df.columns if c == 'depth' or 'depth' in c), survey_df.columns[1] if len(survey_df.columns) > 1 else None)
            dip_col = next((c for c in survey_df.columns if c == 'dip' or 'incl' in c), survey_df.columns[2] if len(survey_df.columns) > 2 else None)
            azi_col = next((c for c in survey_df.columns if c == 'azimuth' or 'azi' in c), survey_df.columns[3] if len(survey_df.columns) > 3 else None)

            from_col = next((c for c in assay_df.columns if c == 'from' or 'from' in c), assay_df.columns[1] if len(assay_df.columns) > 1 else None)
            to_col = next((c for c in assay_df.columns if c == 'to' and c != 'from'), assay_df.columns[2] if len(assay_df.columns) > 2 else None)

        # Find the survey hole_id column (may have different name than collar)
        survey_hole_col = next((c for c in survey_df.columns if c == 'hole_id' or 'holeid' in c.replace('_','') or 'bhid' in c),
                               next((c for c in survey_df.columns if 'hole' in c), survey_df.columns[0]))
        assay_hole_col = next((c for c in assay_df.columns if c == 'hole_id' or 'holeid' in c.replace('_','') or 'bhid' in c),
                              next((c for c in assay_df.columns if 'hole' in c), assay_df.columns[0]))

        print(f"Starting desurvey for {len(collar_df)} holes, {len(assay_df)} assays, {len(survey_df)} surveys")
        print(f"Using columns - Collar: hole={hole_col}, E={east_col}, N={north_col}, RL={rl_col}")
        print(f"Using columns - Survey: hole={survey_hole_col}, depth={depth_col}, dip={dip_col}, azi={azi_col}")
        print(f"Using columns - Assay: hole={assay_hole_col}, from={from_col}, to={to_col}")

        # OPTIMIZATION: Pre-group dataframes for O(N) lookups instead of O(M*N) filtering
        print("Grouping data by hole ID for fast lookups...")
        collar_indexed = collar_df.set_index(hole_col)
        # Use the correct hole column for each file type
        survey_groups = survey_df.groupby(survey_hole_col)
        assay_groups = assay_df.groupby(assay_hole_col)

        results = []
        total_holes = len(collar_df)
        processed = 0

        # Process each hole with optimized lookups
        for hole_id in collar_indexed.index:
            # Progress reporting
            processed += 1
            if processed % 100 == 0 or processed == total_holes:
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                eta = (total_holes - processed) / rate if rate > 0 else 0
                print(f"Progress: {processed}/{total_holes} holes ({processed*100/total_holes:.1f}%) "
                      f"- {rate:.1f} holes/sec - ETA: {eta:.1f}s", end='\r')

            try:
                # OPTIMIZED: Direct index lookup instead of filtering
                collar = collar_indexed.loc[hole_id]

                # OPTIMIZED: GroupBy get_group is O(1) instead of O(N) filtering
                if hole_id not in survey_groups.groups or hole_id not in assay_groups.groups:
                    continue

                surveys = survey_groups.get_group(hole_id).sort_values(depth_col).reset_index(drop=True)
                assays = assay_groups.get_group(hole_id).sort_values(from_col).reset_index(drop=True)

                if surveys.empty or assays.empty:
                    continue

                # Initial coordinates - handle missing values
                start_x = float(collar[east_col]) if east_col and pd.notna(collar.get(east_col)) else 0.0
                start_y = float(collar[north_col]) if north_col and pd.notna(collar.get(north_col)) else 0.0
                start_z = float(collar[rl_col]) if rl_col and pd.notna(collar.get(rl_col)) else 0.0

                # Ensure 0-depth survey exists
                if surveys.iloc[0][depth_col] > 0:
                    first_survey = pd.DataFrame({
                        hole_col: [hole_id],
                        depth_col: [0],
                        dip_col: [surveys.iloc[0][dip_col]],
                        azi_col: [surveys.iloc[0][azi_col]]
                    })
                    surveys = pd.concat([first_survey, surveys], ignore_index=True)

                # VECTORIZED CALCULATION OF XYZ FOR ALL SURVEY POINTS
                # Using the Balanced Tangential (Average Angle) Method
                depths = surveys[depth_col].values.astype(float)
                dips = surveys[dip_col].values.astype(float)
                azis = surveys[azi_col].values.astype(float)

                # Calculate interval lengths between survey stations
                depth_diffs = np.diff(depths, prepend=0)

                # Average angles for balanced tangential method
                # Dip convention: negative = downward (typical mining/drilling convention)
                avg_dips = np.radians((dips[:-1] + dips[1:]) / 2)
                avg_azis = np.radians((azis[:-1] + azis[1:]) / 2)

                # Calculate delta XYZ for each segment (vectorized)
                # For a hole going downward:
                # - Horizontal displacement = segment_length * cos(dip)
                # - Vertical displacement = segment_length * sin(dip)
                # Since dip is negative for downward holes, sin(dip) is negative
                # We want Z to DECREASE as we go down, so:
                # - dz = segment_length * sin(dip) gives negative values for downward holes
                # - This means Z decreases, which is correct!

                segments = depth_diffs[1:]  # Skip the first zero diff
                cos_dips = np.cos(avg_dips)
                sin_dips = np.sin(avg_dips)
                cos_azis = np.cos(avg_azis)
                sin_azis = np.sin(avg_azis)

                # Horizontal displacement components
                dx = segments * cos_dips * sin_azis  # East component
                dy = segments * cos_dips * cos_azis  # North component
                # Vertical displacement (sin of negative angle = negative, so Z decreases)
                dz = segments * sin_dips

                # Cumulative sum to get absolute positions
                survey_x = np.concatenate([[start_x], start_x + np.cumsum(dx)])
                survey_y = np.concatenate([[start_y], start_y + np.cumsum(dy)])
                survey_z = np.concatenate([[start_z], start_z + np.cumsum(dz)])

                # VECTORIZED INTERPOLATION FOR ALL ASSAYS
                assay_mids = ((assays[from_col] + assays[to_col]) / 2).values
                
                assays['X'] = np.interp(assay_mids, depths, survey_x)
                assays['Y'] = np.interp(assay_mids, depths, survey_y)
                assays['Z'] = np.interp(assay_mids, depths, survey_z)
                
                # Add collar info
                assays['CollarEast'] = start_x
                assays['CollarNorth'] = start_y
                assays['CollarRL'] = start_z
                
                results.append(assays)
            except Exception as e:
                # Skip holes with errors and continue
                print(f"Warning: Skipping hole {hole_id}: {str(e)}")
                continue

        if not results:
            return pd.DataFrame()

        # OPTIMIZED: Use concat with copy=False to save memory
        print(f"\nCombining results from {len(results)} holes...")
        final_df = pd.concat(results, ignore_index=True, copy=False)

        # Report final timing
        total_time = time.time() - start_time
        print(f"\nDesurvey complete! Processed {processed} holes with {len(final_df)} assays in {total_time:.2f} seconds")
        print(f"Average rate: {processed/total_time:.1f} holes/second")

        return final_df
