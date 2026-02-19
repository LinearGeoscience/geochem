"""
Interval Matcher Engine for merging logging interval data onto assay rows.

Handles lithology, alteration, structural, and other categorical logging data
by finding the logging interval(s) with the greatest overlap for each assay interval.
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class OverlapExample:
    hole_id: str
    assay_from: float
    assay_to: float
    log_values: List[str]
    log_froms: List[float]
    log_tos: List[float]


@dataclass
class OverlapReport:
    has_overlaps: bool
    overlap_count: int
    holes_with_overlaps: List[str]
    overlapping_values: List[str]
    sample_overlaps: List[OverlapExample]


@dataclass
class HoleMatchSummary:
    hole_id: str
    assay_count: int
    matched_count: int
    match_pct: float
    avg_overlap_pct: float
    gaps: int
    overlaps: int


@dataclass
class LoggingIntegrity:
    total_gaps: int
    total_overlaps: int
    holes_with_gaps: List[str]
    holes_with_overlaps: List[str]


@dataclass
class QAQCReport:
    holes_in_logging_not_in_assay: List[str]
    holes_in_assay_not_in_logging: List[str]
    total_assay_rows: int
    matched_rows: int
    unmatched_rows: int
    low_overlap_count: int
    avg_overlap_pct: float
    per_hole_summary: List[HoleMatchSummary]
    logging_integrity: LoggingIntegrity


@dataclass
class MatchResult:
    """Result of interval matching."""
    columns_added: List[str]
    new_column_data: Dict[str, List]  # column_name -> list of values aligned to assay rows
    overlap_pcts: List[float]  # per-row best overlap percentage
    qaqc: QAQCReport


class IntervalMatcher:
    """Core engine for matching logging intervals to assay intervals."""

    CHUNK_THRESHOLD = 10_000_000  # n_assay * n_log threshold for chunked processing

    def detect_overlaps(
        self,
        logging_df: pd.DataFrame,
        hole_col: str,
        from_col: str,
        to_col: str,
        category_col: str,
    ) -> OverlapReport:
        """Detect overlapping intervals within the same hole in logging data."""
        overlap_count = 0
        holes_with_overlaps: List[str] = []
        overlapping_values: set = set()
        sample_overlaps: List[OverlapExample] = []

        for hole_id, group in logging_df.groupby(hole_col):
            sorted_group = group.sort_values(from_col).reset_index(drop=True)
            froms = sorted_group[from_col].values.astype(float)
            tos = sorted_group[to_col].values.astype(float)
            cats = sorted_group[category_col].values

            for i in range(len(froms) - 1):
                for j in range(i + 1, len(froms)):
                    if froms[j] >= tos[i]:
                        break  # sorted, so no more overlaps possible
                    # froms[j] < tos[i] means overlap
                    overlap_count += 1
                    if str(hole_id) not in holes_with_overlaps:
                        holes_with_overlaps.append(str(hole_id))
                    overlapping_values.add(str(cats[i]))
                    overlapping_values.add(str(cats[j]))

                    if len(sample_overlaps) < 5:
                        sample_overlaps.append(OverlapExample(
                            hole_id=str(hole_id),
                            assay_from=float(froms[j]),
                            assay_to=float(tos[i]),
                            log_values=[str(cats[i]), str(cats[j])],
                            log_froms=[float(froms[i]), float(froms[j])],
                            log_tos=[float(tos[i]), float(tos[j])],
                        ))

        return OverlapReport(
            has_overlaps=overlap_count > 0,
            overlap_count=overlap_count,
            holes_with_overlaps=holes_with_overlaps,
            overlapping_values=sorted(overlapping_values),
            sample_overlaps=sample_overlaps,
        )

    def match_intervals(
        self,
        assay_df: pd.DataFrame,
        logging_df: pd.DataFrame,
        assay_hole_col: str,
        assay_from_col: str,
        assay_to_col: str,
        log_hole_col: str,
        log_from_col: str,
        log_to_col: str,
        log_category_col: str,
        strategy: str = "max_overlap",
        min_overlap_pct: float = 0.0,
        column_prefix: str = "",
    ) -> MatchResult:
        """
        Match logging intervals to assay intervals.

        Strategies:
        - max_overlap: Single column, picks interval with highest overlap %
        - split_columns: One boolean column per unique category value
        - combine_codes: Single column with pipe-delimited values where multiple match
        """
        logger.info(
            "Matching intervals: %d assay rows, %d logging rows, strategy=%s",
            len(assay_df), len(logging_df), strategy,
        )

        # Determine output column name(s)
        base_name = column_prefix if column_prefix else log_category_col

        # Get unique category values for split_columns
        unique_values = sorted(logging_df[log_category_col].dropna().unique().astype(str))

        # Initialize result containers
        n_assay = len(assay_df)
        overlap_pcts = np.zeros(n_assay, dtype=float)

        if strategy == "split_columns":
            col_data: Dict[str, List] = {}
            for val in unique_values:
                col_name = f"{base_name}_{val.replace(' ', '')}"
                col_data[col_name] = ["No"] * n_assay
        else:
            col_data = {base_name: [None] * n_assay}

        # Build QAQC tracking
        assay_holes = set(assay_df[assay_hole_col].dropna().unique().astype(str))
        log_holes = set(logging_df[log_hole_col].dropna().unique().astype(str))
        holes_in_log_not_assay = sorted(log_holes - assay_holes)
        holes_in_assay_not_log = sorted(assay_holes - log_holes)
        common_holes = assay_holes & log_holes

        per_hole_summaries: List[HoleMatchSummary] = []
        total_matched = 0
        total_low_overlap = 0
        all_overlap_pcts: List[float] = []

        # Logging integrity checks
        total_gaps = 0
        total_log_overlaps = 0
        holes_with_gaps: List[str] = []
        holes_with_log_overlaps: List[str] = []

        # Group both DataFrames by hole for efficient matching
        assay_grouped = assay_df.groupby(assay_hole_col)
        log_grouped = logging_df.groupby(log_hole_col)

        for hole_id in sorted(common_holes):
            hole_id_orig = hole_id
            # Find the matching group keys
            assay_group = None
            log_group = None
            for key, grp in assay_grouped:
                if str(key) == hole_id:
                    assay_group = grp
                    break
            for key, grp in log_grouped:
                if str(key) == hole_id:
                    log_group = grp
                    break

            if assay_group is None or log_group is None:
                continue

            assay_idx = assay_group.index.values
            a_from = assay_group[assay_from_col].values.astype(float)
            a_to = assay_group[assay_to_col].values.astype(float)
            a_lengths = a_to - a_from
            a_lengths = np.where(a_lengths <= 0, 1e-10, a_lengths)  # avoid div by zero

            l_from = log_group[log_from_col].values.astype(float)
            l_to = log_group[log_to_col].values.astype(float)
            l_cats = log_group[log_category_col].values.astype(str)

            # Check logging integrity for this hole
            sorted_idx = np.argsort(l_from)
            l_from_sorted = l_from[sorted_idx]
            l_to_sorted = l_to[sorted_idx]
            hole_gaps = 0
            hole_overlaps = 0
            for i in range(len(l_from_sorted) - 1):
                if l_from_sorted[i + 1] > l_to_sorted[i] + 0.001:
                    hole_gaps += 1
                elif l_from_sorted[i + 1] < l_to_sorted[i] - 0.001:
                    hole_overlaps += 1
            total_gaps += hole_gaps
            total_log_overlaps += hole_overlaps
            if hole_gaps > 0:
                holes_with_gaps.append(hole_id)
            if hole_overlaps > 0:
                holes_with_log_overlaps.append(hole_id)

            n_a = len(a_from)
            n_l = len(l_from)

            # Decide whether to chunk
            if n_a * n_l > self.CHUNK_THRESHOLD:
                self._match_hole_chunked(
                    assay_idx, a_from, a_to, a_lengths,
                    l_from, l_to, l_cats,
                    strategy, min_overlap_pct, base_name, unique_values,
                    overlap_pcts, col_data,
                )
            else:
                self._match_hole_vectorized(
                    assay_idx, a_from, a_to, a_lengths,
                    l_from, l_to, l_cats,
                    strategy, min_overlap_pct, base_name, unique_values,
                    overlap_pcts, col_data,
                )

            # Per-hole stats
            hole_overlap_pcts = overlap_pcts[assay_idx]
            matched_count = int(np.sum(hole_overlap_pcts > 0))
            low_overlap = int(np.sum((hole_overlap_pcts > 0) & (hole_overlap_pcts < 50)))
            avg_ov = float(np.mean(hole_overlap_pcts[hole_overlap_pcts > 0])) if matched_count > 0 else 0.0

            total_matched += matched_count
            total_low_overlap += low_overlap
            all_overlap_pcts.extend(hole_overlap_pcts[hole_overlap_pcts > 0].tolist())

            per_hole_summaries.append(HoleMatchSummary(
                hole_id=hole_id,
                assay_count=n_a,
                matched_count=matched_count,
                match_pct=round(matched_count / n_a * 100, 1) if n_a > 0 else 0.0,
                avg_overlap_pct=round(avg_ov, 1),
                gaps=hole_gaps,
                overlaps=hole_overlaps,
            ))

        # Also add summaries for holes only in assay (no logging)
        for hole_id in sorted(holes_in_assay_not_log):
            for key, grp in assay_grouped:
                if str(key) == hole_id:
                    per_hole_summaries.append(HoleMatchSummary(
                        hole_id=hole_id,
                        assay_count=len(grp),
                        matched_count=0,
                        match_pct=0.0,
                        avg_overlap_pct=0.0,
                        gaps=0,
                        overlaps=0,
                    ))
                    break

        # Build final QAQC
        avg_overlap = float(np.mean(all_overlap_pcts)) if all_overlap_pcts else 0.0
        columns_added = list(col_data.keys())

        qaqc = QAQCReport(
            holes_in_logging_not_in_assay=holes_in_log_not_assay,
            holes_in_assay_not_in_logging=holes_in_assay_not_log,
            total_assay_rows=n_assay,
            matched_rows=total_matched,
            unmatched_rows=n_assay - total_matched,
            low_overlap_count=total_low_overlap,
            avg_overlap_pct=round(avg_overlap, 1),
            per_hole_summary=per_hole_summaries,
            logging_integrity=LoggingIntegrity(
                total_gaps=total_gaps,
                total_overlaps=total_log_overlaps,
                holes_with_gaps=holes_with_gaps,
                holes_with_overlaps=holes_with_log_overlaps,
            ),
        )

        logger.info(
            "Matching complete: %d/%d rows matched, avg overlap %.1f%%, %d columns added",
            total_matched, n_assay, avg_overlap, len(columns_added),
        )

        return MatchResult(
            columns_added=columns_added,
            new_column_data=col_data,
            overlap_pcts=overlap_pcts.tolist(),
            qaqc=qaqc,
        )

    def _match_hole_vectorized(
        self,
        assay_idx: np.ndarray,
        a_from: np.ndarray, a_to: np.ndarray, a_lengths: np.ndarray,
        l_from: np.ndarray, l_to: np.ndarray, l_cats: np.ndarray,
        strategy: str, min_overlap_pct: float, base_name: str,
        unique_values: List[str],
        overlap_pcts: np.ndarray,
        col_data: Dict[str, List],
    ):
        """Vectorized matching for a single hole using numpy broadcasting."""
        # (n_assay, n_log) overlap matrix
        overlap_start = np.maximum(a_from[:, None], l_from[None, :])
        overlap_end = np.minimum(a_to[:, None], l_to[None, :])
        overlaps = np.maximum(0, overlap_end - overlap_start)
        overlap_pct_matrix = overlaps / a_lengths[:, None] * 100

        for i, global_idx in enumerate(assay_idx):
            row_overlaps = overlap_pct_matrix[i]

            if strategy == "max_overlap":
                best_idx = np.argmax(row_overlaps)
                best_pct = row_overlaps[best_idx]
                if best_pct > min_overlap_pct:
                    overlap_pcts[global_idx] = best_pct
                    col_data[base_name][global_idx] = str(l_cats[best_idx])

            elif strategy == "split_columns":
                matching = np.where(row_overlaps > min_overlap_pct)[0]
                if len(matching) > 0:
                    overlap_pcts[global_idx] = float(np.max(row_overlaps[matching]))
                    for j in matching:
                        val = str(l_cats[j])
                        col_name = f"{base_name}_{val.replace(' ', '')}"
                        if col_name in col_data:
                            col_data[col_name][global_idx] = "Yes"

            elif strategy == "combine_codes":
                matching = np.where(row_overlaps > min_overlap_pct)[0]
                if len(matching) > 0:
                    overlap_pcts[global_idx] = float(np.max(row_overlaps[matching]))
                    matched_cats = sorted(set(str(l_cats[j]) for j in matching))
                    col_data[base_name][global_idx] = " | ".join(matched_cats)

    def _match_hole_chunked(
        self,
        assay_idx: np.ndarray,
        a_from: np.ndarray, a_to: np.ndarray, a_lengths: np.ndarray,
        l_from: np.ndarray, l_to: np.ndarray, l_cats: np.ndarray,
        strategy: str, min_overlap_pct: float, base_name: str,
        unique_values: List[str],
        overlap_pcts: np.ndarray,
        col_data: Dict[str, List],
    ):
        """Chunked matching for large holes to avoid memory issues."""
        chunk_size = max(1, self.CHUNK_THRESHOLD // len(l_from))

        for start in range(0, len(a_from), chunk_size):
            end = min(start + chunk_size, len(a_from))
            chunk_idx = assay_idx[start:end]
            chunk_from = a_from[start:end]
            chunk_to = a_to[start:end]
            chunk_lengths = a_lengths[start:end]

            self._match_hole_vectorized(
                chunk_idx, chunk_from, chunk_to, chunk_lengths,
                l_from, l_to, l_cats,
                strategy, min_overlap_pct, base_name, unique_values,
                overlap_pcts, col_data,
            )
