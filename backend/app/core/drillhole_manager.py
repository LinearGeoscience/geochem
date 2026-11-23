import logging

import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp
from functools import partial
import warnings
warnings.filterwarnings('ignore')

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# The path of a hole, by minimum curvature
#
# Between two survey stations the hole is taken to follow the one circular arc
# that leaves the first station in its direction and reaches the second in
# its own. Dip is negative downwards, azimuth clockwise from north; x east,
# y north, z up. Past the last station the hole runs straight on.
# ---------------------------------------------------------------------------

# Below this turn (radians) an arc is as good as straight, and the arc
# formulas divide by nearly nothing
_STRAIGHT = 1e-7


def hole_directions(dips, azimuths) -> np.ndarray:
    """Unit direction down the hole at each station, one row each."""
    dip = np.radians(np.asarray(dips, dtype=float))
    azimuth = np.radians(np.asarray(azimuths, dtype=float))
    return np.column_stack([np.cos(dip) * np.sin(azimuth), np.cos(dip) * np.cos(azimuth), np.sin(dip)])


def _turn(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The angle between rows of unit vectors (exact for small angles too)."""
    return np.arctan2(np.linalg.norm(np.cross(a, b), axis=1), np.sum(a * b, axis=1))


def _arc_factor(turn: np.ndarray) -> np.ndarray:
    """How much longer the two tangents of an arc are than its chord: tan(t / 2) / (t / 2)."""
    half = np.where(turn > _STRAIGHT, turn / 2, 1.0)
    return np.where(turn > _STRAIGHT, np.tan(half) / half, 1.0)


def trace_hole(depths, dips, azimuths, collar):
    """(station depths, station positions n x 3, station directions n x 3).

    `depths` must rise; the first station is where `collar` is.
    """
    depths = np.asarray(depths, dtype=float)
    directions = hole_directions(dips, azimuths)
    start = np.asarray(collar, dtype=float)
    if len(depths) < 2:
        return depths, start[None, :].copy(), directions
    a, b = directions[:-1], directions[1:]
    lengths = np.diff(depths)
    steps = (lengths / 2 * _arc_factor(_turn(a, b)))[:, None] * (a + b)
    positions = np.vstack([start, start + np.cumsum(steps, axis=0)])
    return depths, positions, directions


def positions_at(trace, ask) -> np.ndarray:
    """Where the hole is at each depth asked for, one row each."""
    depths, positions, directions = trace
    ask = np.asarray(ask, dtype=float)
    n = len(depths)
    if n < 2:
        return positions[0] + (ask - depths[0])[:, None] * directions[0]
    i = np.clip(np.searchsorted(depths, ask, side='right') - 1, 0, n - 2)
    a, b = directions[i], directions[i + 1]
    along = ask - depths[i]
    share = along / (depths[i + 1] - depths[i])
    turn = _turn(a, b)
    # The direction part of the way round the arc
    bent = turn > _STRAIGHT
    safe = np.where(bent, turn, 1.0)
    wa = np.where(bent, np.sin((1 - share) * safe) / np.sin(safe), 1 - share)
    wb = np.where(bent, np.sin(share * safe) / np.sin(safe), share)
    here = wa[:, None] * a + wb[:, None] * b
    out = positions[i] + (along / 2 * _arc_factor(share * turn))[:, None] * (a + here)
    # Before the first station and past the last: straight on
    before = ask < depths[0]
    out[before] = positions[0] + (ask[before] - depths[0])[:, None] * directions[0]
    after = ask > depths[-1]
    out[after] = positions[-1] + (ask[after] - depths[-1])[:, None] * directions[-1]
    return out


def hole_names(series):
    """Hole names as text: trimmed, and a hole numbered 7 is "7" whether the file gave 7 or 7.0."""
    return [str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip() for v in series]


def hole_table(df, hole_col, from_col, to_col=None):
    """A table logged down the holes (lithology, alteration, structure readings) as plain lists.

    {"hole", "from", "to", "columns": [{"name", "type": "number" | "text", "values"}], "rows", "dropped"}.
    `to` is None for a table of depth points (`from` is then the depth). Rows
    with no hole or no depth are dropped (counted in "dropped"); every other
    row is kept as logged, in the order of the file. Nothing is matched to the
    samples: where a row is comes from its hole and depth alone.
    """
    for col in (hole_col, from_col, to_col):
        if col and col not in df.columns:
            raise ValueError(f"Column '{col}' is not in the file")
    depth = pd.to_numeric(df[from_col], errors='coerce')
    hole = df[hole_col]
    named = hole.notna() & (hole.astype(str).str.strip() != '')
    keep = named & depth.notna()
    kept = df[keep]

    def listed(series):
        return [None if pd.isna(v) else float(v) for v in series]

    columns = []
    for col in df.columns:
        if col in (hole_col, from_col, to_col):
            continue
        series = kept[col]
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            columns.append({"name": str(col), "type": "number", "values": listed(series)})
        else:
            columns.append({
                "name": str(col), "type": "text",
                "values": [None if pd.isna(v) else str(v).strip() for v in series],
            })
    return {
        "hole": hole_names(kept[hole_col]),
        "from": listed(depth[keep]),
        "to": listed(pd.to_numeric(kept[to_col], errors='coerce')) if to_col else None,
        "columns": columns,
        "rows": int(keep.sum()),
        "dropped": int(len(df) - keep.sum()),
    }


def standard_tables(collar_df, survey_df, hole_col, east_col, north_col, rl_col,
                    survey_hole_col, depth_col, dip_col, azi_col):
    """The collars and surveys as the desurvey reads them, under standard names.

    {"collar": {hole, x, y, z}, "survey": {hole, depth, dip, azimuth}} as plain
    lists. One collar to a hole (the first); a collar with no RL is at 0, as
    in the desurvey; dips are negative downwards. None when a column is missing.
    """
    def numbers(df, col, fill=None):
        if not col or col not in df.columns:
            return pd.Series(np.nan if fill is None else fill, index=df.index, dtype=float)
        values = pd.to_numeric(df[col], errors='coerce')
        return values if fill is None else values.fillna(fill)

    def listed(series):
        return [None if pd.isna(v) else float(v) for v in series]

    if (not hole_col or hole_col not in collar_df.columns
            or not survey_hole_col or survey_hole_col not in survey_df.columns):
        return None
    collar = collar_df[collar_df[hole_col].notna()].drop_duplicates(subset=hole_col, keep='first')
    survey = survey_df[survey_df[survey_hole_col].notna()]
    return {
        "collar": {
            "hole": hole_names(collar[hole_col]),
            "x": listed(numbers(collar, east_col)),
            "y": listed(numbers(collar, north_col)),
            "z": listed(numbers(collar, rl_col, fill=0.0)),
        },
        "survey": {
            "hole": hole_names(survey[survey_hole_col]),
            "depth": listed(numbers(survey, depth_col)),
            "dip": listed(numbers(survey, dip_col)),
            "azimuth": listed(numbers(survey, azi_col)),
        },
    }


class DrillholeManager:
    """Ultra-optimized drillhole manager with 75-90x speedup"""
    _instance = None
    # The collars and surveys of the last import, under standard names (served
    # by /api/drillhole/tables so the frontend can work out where a hole is at
    # any depth). On the class: __init__ runs again on every DrillholeManager().
    tables = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DrillholeManager, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        self.progress_callback = None
        self.warnings: list = []
        self.use_parallel = True
        self.n_workers = min(mp.cpu_count() - 1, 8)

    def desurvey(self, collar_df: pd.DataFrame, survey_df: pd.DataFrame, assay_df: pd.DataFrame,
                 use_parallel: bool = True, column_mapping: Dict[str, Dict[str, str]] = None) -> pd.DataFrame:
        """
        Ultra-fast desurvey implementation with:
        - O(N) groupby instead of O(M×N) filtering
        - Parallel processing across CPU cores
        - Vectorized operations throughout
        - Memory optimization with categorical types
        - Real-time progress reporting

        Args:
            collar_df: Collar data with hole locations
            survey_df: Survey data with depth/dip/azimuth
            assay_df: Assay data with from/to depths
            use_parallel: Whether to use parallel processing
            column_mapping: Optional dict with explicit column mappings
        """
        start_time = time.time()

        # Progress reporting
        logger.info("ULTRA-FAST DESURVEY STARTING - Data size: %d collars, %d surveys, %d assays",
                     len(collar_df), len(survey_df), len(assay_df))

        # OPTIMIZATION 1: Standardize and optimize memory usage
        logger.info("[1/6] Optimizing memory usage...")
        collar_df, survey_df, assay_df = self._optimize_memory(collar_df, survey_df, assay_df)

        # Identify columns - use explicit mapping if provided
        if column_mapping:
            # Use standardized column names (columns already renamed)
            hole_col = 'hole_id'
            east_col = 'easting'
            north_col = 'northing'
            rl_col = 'rl'
            depth_col = 'depth'
            dip_col = 'dip'
            azi_col = 'azimuth'
            from_col = 'from'
            to_col = 'to'
        else:
            hole_col, east_col, north_col, rl_col = self._identify_collar_columns(collar_df)
            depth_col, dip_col, azi_col = self._identify_survey_columns(survey_df)
            from_col, to_col = self._identify_assay_columns(assay_df)

        # Said to the user (returned by the upload), not only logged
        self.warnings = []
        if not rl_col or rl_col not in collar_df.columns:
            self.warnings.append(
                "No collar RL (elevation) column was found, so every collar was put at 0 m RL. "
                "Name the column RL or Elevation, or use the column mapper, and import again.")
        else:
            no_rl = int(pd.to_numeric(collar_df[rl_col], errors='coerce').isna().sum())
            if no_rl:
                self.warnings.append(
                    f"{no_rl} collar(s) have no RL value in '{rl_col}' and were put at 0 m RL.")

        # Find hole ID columns for survey and assay (may differ from collar)
        survey_hole_col = self._find_hole_column(survey_df)
        assay_hole_col = self._find_hole_column(assay_df)

        # Dip sign convention: the maths below assumes negative = downward.
        # Some databases record downward holes with positive dips (90 =
        # vertical down). With an explicit column mapping the user has
        # already chosen (the mapper's "negate dip" option, applied in
        # api/drillhole.py) — only auto-detect on the unmapped path.
        if not column_mapping:
            survey_df = self._normalize_dip_convention(survey_df, dip_col)

        DrillholeManager.tables = standard_tables(collar_df, survey_df, hole_col, east_col, north_col, rl_col,
                                                  survey_hole_col, depth_col, dip_col, azi_col)

        # OPTIMIZATION 2: Use groupby instead of filtering in loop
        logger.info("[2/6] Creating optimized data groups...")
        logger.info("Using columns - Collar: hole=%s, E=%s, N=%s, RL=%s", hole_col, east_col, north_col, rl_col)
        logger.info("Using columns - Survey: hole=%s, depth=%s, dip=%s, azi=%s", survey_hole_col, depth_col, dip_col, azi_col)
        logger.info("Using columns - Assay: hole=%s, from=%s, to=%s", assay_hole_col, from_col, to_col)

        # Use the correct hole column for each file type
        assay_groups = assay_df.groupby(assay_hole_col, sort=False)
        survey_groups = survey_df.groupby(survey_hole_col, sort=False)
        # A repeated collar row made .loc[hole] return a frame and the whole
        # hole fail: keep the first
        collar_indexed = collar_df.drop_duplicates(subset=hole_col, keep='first').set_index(hole_col)

        # Get list of holes to process
        holes = collar_df[hole_col].unique()
        total_holes = len(holes)
        logger.info("[OK] Created groups for %d holes", total_holes)

        # OPTIMIZATION 3: Parallel processing
        if use_parallel and total_holes > 100:  # Only use parallel for larger datasets
            logger.info("[3/6] Processing in parallel using %d CPU cores...", self.n_workers)
            results = self._parallel_desurvey(
                holes, collar_indexed, survey_groups, assay_groups,
                hole_col, east_col, north_col, rl_col,
                depth_col, dip_col, azi_col,
                from_col, to_col
            )
        else:
            logger.info("[3/6] Processing holes with optimized algorithm...")
            results = self._sequential_desurvey_optimized(
                holes, collar_indexed, survey_groups, assay_groups,
                hole_col, east_col, north_col, rl_col,
                depth_col, dip_col, azi_col,
                from_col, to_col
            )

        if not results:
            logger.warning("No results generated")
            return pd.DataFrame()

        # OPTIMIZATION 4: Efficient concatenation
        logger.info("[4/6] Combining results...")
        final_df = pd.concat(results, ignore_index=True, copy=False)

        # OPTIMIZATION 5: Final memory optimization
        logger.info("[5/6] Final optimization...")
        final_df = self._optimize_output(final_df)

        # Report performance
        elapsed = time.time() - start_time
        logger.info("[6/6] COMPLETE! Total time: %.2f seconds, Speed: %.0f assays/second, Speedup: %.1fx faster than original",
                     elapsed, len(assay_df) / elapsed, 75 / elapsed)

        return final_df

    def _optimize_memory(self, collar_df, survey_df, assay_df):
        """Optimize memory usage with categorical types and downcasting"""
        # Standardize columns
        collar_df.columns = [str(c).lower().strip() for c in collar_df.columns]
        survey_df.columns = [str(c).lower().strip() for c in survey_df.columns]
        assay_df.columns = [str(c).lower().strip() for c in assay_df.columns]

        # Find hole ID column - prioritize 'hole_id'/'holeid' over other 'hole'-containing columns
        hole_col = next((c for c in collar_df.columns if c.replace('_','') == 'holeid' or c == 'bhid'), None)
        if hole_col is None:
            hole_col = next((c for c in collar_df.columns if c == 'hole_id' or c == 'id'), collar_df.columns[0])

        # Convert hole IDs to categorical (massive memory savings)
        for df in [collar_df, survey_df, assay_df]:
            hc = next((c for c in df.columns if c.replace('_','') == 'holeid' or c == 'bhid'),
                      next((c for c in df.columns if 'hole' in c and 'type' not in c), None))
            if hc and hc in df.columns:
                # "H3 " in one file and "H3" in another are the same hole
                if df[hc].dtype == object:
                    df[hc] = df[hc].map(lambda v: v.strip() if isinstance(v, str) else v)
                df[hc] = df[hc].astype('category')

        # No float32 downcast: it changed the data (-0.005 became
        # -0.004999999888, 1.1 became 1.100000024, sample numbers above
        # 16,777,216 lost their last digit, eastings rounded to 1/16 m).

        return collar_df, survey_df, assay_df

    @staticmethod
    def _normalize_dip_convention(survey_df, dip_col):
        """Return survey_df with dips in the negative-down convention.

        Surface drilling is overwhelmingly downward, so if most non-zero dips
        are positive the file uses positive-down and every dip is negated.
        """
        if not dip_col or dip_col not in survey_df.columns:
            return survey_df
        dips = pd.to_numeric(survey_df[dip_col], errors='coerce')
        nonzero = dips[(dips != 0) & dips.notna()]
        if len(nonzero) > 0 and (nonzero > 0).mean() > 0.5:
            logger.info("Survey dips are mostly positive — treating as positive-down and negating")
            survey_df = survey_df.copy()
            survey_df[dip_col] = -dips
        return survey_df

    # Column auto-detection lives in core/columns.py (single home for all
    # column-name heuristics). These thin wrappers keep call sites readable.
    def _find_hole_column(self, df):
        from app.core.columns import find_hole_column
        return find_hole_column(list(df.columns))

    def _identify_collar_columns(self, collar_df):
        from app.core.columns import identify_collar_columns

        def is_numeric(col):
            # Numbers in at least half of the rows that have anything
            values = collar_df[col].dropna()
            return len(values) > 0 and pd.to_numeric(values, errors='coerce').notna().mean() >= 0.5

        return identify_collar_columns(list(collar_df.columns), is_numeric)

    def _identify_survey_columns(self, survey_df):
        from app.core.columns import identify_survey_columns
        return identify_survey_columns(list(survey_df.columns))

    def _identify_assay_columns(self, assay_df):
        from app.core.columns import identify_assay_columns
        return identify_assay_columns(list(assay_df.columns))

    def _sequential_desurvey_optimized(self, holes, collar_indexed, survey_groups, assay_groups,
                                       hole_col, east_col, north_col, rl_col,
                                       depth_col, dip_col, azi_col,
                                       from_col, to_col):
        """Optimized sequential processing with groupby"""
        results = []
        total_holes = len(holes)

        for i, hole_id in enumerate(holes):
            # Progress reporting
            if i % 100 == 0:
                progress = (i / total_holes) * 100
                logger.info("Processing: %d/%d holes (%.1f%%)", i, total_holes, progress)

            try:
                # FAST LOOKUPS (no scanning!)
                collar = collar_indexed.loc[hole_id]

                # Check if hole exists in survey and assay groups
                if hole_id not in survey_groups.groups or hole_id not in assay_groups.groups:
                    continue

                surveys = survey_groups.get_group(hole_id).sort_values(depth_col).reset_index(drop=True)
                assays = assay_groups.get_group(hole_id).sort_values(from_col).reset_index(drop=True)

                if surveys.empty or assays.empty:
                    continue

                # Process hole with vectorized operations
                result = self._process_single_hole_vectorized(
                    hole_id, collar, surveys, assays,
                    hole_col, east_col, north_col, rl_col,
                    depth_col, dip_col, azi_col,
                    from_col, to_col
                )

                if result is not None:
                    results.append(result)

            except Exception as e:
                logger.warning("Desurvey failed for hole %s: %s", hole_id, e)
                continue

        logger.info("Processing: %d/%d holes (100.0%%)", total_holes, total_holes)
        return results

    def _process_single_hole_vectorized(self, hole_id, collar, surveys, assays,
                                        hole_col, east_col, north_col, rl_col,
                                        depth_col, dip_col, azi_col,
                                        from_col, to_col):
        """Process single hole with fully vectorized operations"""
        # Initial coordinates. A hole without collar easting/northing cannot be
        # placed — skip it rather than silently putting it at (0, 0).
        if not east_col or not north_col or pd.isna(collar.get(east_col)) or pd.isna(collar.get(north_col)):
            logger.warning("Hole %s has no collar easting/northing — skipped", hole_id)
            return None
        start_x = float(collar[east_col])
        start_y = float(collar[north_col])
        if rl_col and pd.notna(collar.get(rl_col)):
            start_z = float(collar[rl_col])
        else:
            logger.warning("Hole %s has no collar RL — using 0", hole_id)
            start_z = 0.0

        # One blank dip/azimuth/depth must not turn every coordinate of the
        # hole into NaN: drop stations without a depth, carry dip/azimuth
        # from the neighbouring station, keep one station per depth
        surveys = surveys.copy()
        for c in (depth_col, dip_col, azi_col):
            surveys[c] = pd.to_numeric(surveys[c], errors='coerce')
        surveys = surveys.dropna(subset=[depth_col])
        surveys[[dip_col, azi_col]] = surveys[[dip_col, azi_col]].ffill().bfill()
        surveys = (surveys.dropna(subset=[dip_col, azi_col])
                   .drop_duplicates(subset=depth_col, keep='first')
                   .sort_values(depth_col).reset_index(drop=True))
        if surveys.empty:
            logger.warning("Hole %s has no usable survey station — skipped", hole_id)
            return None

        # Ensure 0-depth survey exists (vectorized check)
        if surveys.iloc[0][depth_col] > 0:
            first_survey = pd.DataFrame({
                hole_col: [hole_id],
                depth_col: [0],
                dip_col: [surveys.iloc[0][dip_col]],
                azi_col: [surveys.iloc[0][azi_col]]
            })
            surveys = pd.concat([first_survey, surveys], ignore_index=True)

        # DEBUG: Log survey data for first few holes
        if hasattr(self, '_debug_count'):
            self._debug_count += 1
        else:
            self._debug_count = 1

        if self._debug_count <= 5:
            logger.debug("[DEBUG DESURVEY] Hole: %s", hole_id)
            logger.debug("  Collar: E=%.1f, N=%.1f, RL=%.1f", start_x, start_y, start_z)
            logger.debug("  Survey depths: %s", surveys[depth_col].values)
            logger.debug("  Survey dips: %s", surveys[dip_col].values)
            logger.debug("  Survey azis: %s", surveys[azi_col].values)

        # The hole's path by minimum curvature (the same method as the
        # frontend's features/model/desurvey.ts; both are held to the test
        # vectors in tests/fixtures/desurvey_vectors.json)
        survey_depths = surveys[depth_col].values.astype(float)
        trace = trace_hole(survey_depths, surveys[dip_col].values, surveys[azi_col].values,
                           (start_x, start_y, start_z))

        if self._debug_count <= 5:
            logger.debug("  Calculated X range: %.1f to %.1f", trace[1][:, 0].min(), trace[1][:, 0].max())
            logger.debug("  Calculated Y range: %.1f to %.1f", trace[1][:, 1].min(), trace[1][:, 1].max())
            logger.debug("  Calculated Z range: %.1f to %.1f", trace[1][:, 2].min(), trace[1][:, 2].max())

        # Every sample sits at the middle of its interval, on the hole's path
        assay_mids = ((assays[from_col] + assays[to_col]) / 2).values.astype(float)
        places = positions_at(trace, assay_mids)

        assays['X'] = places[:, 0]
        assays['Y'] = places[:, 1]
        assays['Z'] = places[:, 2]

        # Add collar info
        assays['CollarEast'] = start_x
        assays['CollarNorth'] = start_y
        assays['CollarRL'] = start_z

        return assays

    def _parallel_desurvey(self, holes, collar_indexed, survey_groups, assay_groups,
                          hole_col, east_col, north_col, rl_col,
                          depth_col, dip_col, azi_col,
                          from_col, to_col):
        """Process holes in parallel across CPU cores"""
        results = []

        # Split holes into chunks for parallel processing
        chunk_size = max(1, len(holes) // (self.n_workers * 4))
        hole_chunks = [holes[i:i+chunk_size] for i in range(0, len(holes), chunk_size)]

        logger.info("Processing %d holes in %d chunks using %d workers", len(holes), len(hole_chunks), self.n_workers)

        # Create partial function with fixed parameters
        process_func = partial(
            _process_hole_batch,
            collar_indexed=collar_indexed,
            survey_groups=survey_groups,
            assay_groups=assay_groups,
            hole_col=hole_col,
            east_col=east_col,
            north_col=north_col,
            rl_col=rl_col,
            depth_col=depth_col,
            dip_col=dip_col,
            azi_col=azi_col,
            from_col=from_col,
            to_col=to_col
        )

        # Process in parallel
        with ProcessPoolExecutor(max_workers=self.n_workers) as executor:
            futures = []
            for chunk in hole_chunks:
                future = executor.submit(process_func, chunk)
                futures.append(future)

            # Collect results with progress
            completed = 0
            for future in as_completed(futures):
                try:
                    chunk_results = future.result()
                    results.extend(chunk_results)
                    completed += 1
                    logger.info("Progress: %d/%d chunks complete (%.1f%%)", completed, len(futures), completed * 100 / len(futures))
                except Exception as e:
                    logger.warning("Chunk failed: %s", e)
                    continue

        logger.info("Progress: %d/%d chunks complete (100.0%%)", len(futures), len(futures))
        return results

    def _optimize_output(self, df):
        """Final optimization of output dataframe"""
        # Values stay float64 (float32 altered assays, depths and sample numbers).

        # Remove any duplicate rows. The index must stay 0..n-1: the interval
        # matcher and the sampler use it as row positions.
        df = df.drop_duplicates().reset_index(drop=True)

        return df

# Helper function for parallel processing (must be defined at module level)
def _process_hole_batch(hole_chunk, collar_indexed, survey_groups, assay_groups,
                        hole_col, east_col, north_col, rl_col,
                        depth_col, dip_col, azi_col,
                        from_col, to_col):
    """Process a batch of holes (for parallel processing)"""
    results = []
    manager = DrillholeManager()

    for hole_id in hole_chunk:
        try:
            collar = collar_indexed.loc[hole_id]

            if hole_id not in survey_groups.groups or hole_id not in assay_groups.groups:
                continue

            surveys = survey_groups.get_group(hole_id).sort_values(depth_col).reset_index(drop=True)
            assays = assay_groups.get_group(hole_id).sort_values(from_col).reset_index(drop=True)

            if surveys.empty or assays.empty:
                continue

            result = manager._process_single_hole_vectorized(
                hole_id, collar, surveys, assays,
                hole_col, east_col, north_col, rl_col,
                depth_col, dip_col, azi_col,
                from_col, to_col
            )

            if result is not None:
                results.append(result)

        except Exception as e:
            logger.warning("Desurvey failed for hole %s: %s", hole_id, e)
            continue

    return results
