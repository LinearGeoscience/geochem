import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import json
import time

logger = logging.getLogger(__name__)

# "<0.01", "< 5", "<=0.2", ">10000", "> 1e4"
_CENSORED_RE = r'^\s*([<>])\s*=?\s*([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$'


def parse_censored_series(series: pd.Series) -> Tuple[pd.Series, int, int]:
    """Rewrite censored assay strings in an object column.

    "<x" -> -x (standard convention: negative = below detection limit x) and
    ">x" -> x (over-limit). Other values are returned unchanged. Returns the
    rewritten series and the counts of below/above-limit values.
    """
    as_str = series.astype('string')
    parts = as_str.str.extract(_CENSORED_RE)
    below = parts[0] == '<'
    above = parts[0] == '>'
    n_below = int(below.sum())
    n_above = int(above.sum())
    if n_below == 0 and n_above == 0:
        return series, 0, 0
    values = pd.to_numeric(parts[1], errors='coerce')
    out = series.copy().astype(object)
    out[below.fillna(False)] = -values[below.fillna(False)]
    out[above.fillna(False)] = values[above.fillna(False)]
    return out, n_below, n_above


class DataManager:
    """Ultra-optimized DataManager with vectorized operations and caching"""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataManager, cls).__new__(cls)
            cls._instance.df = None
            cls._instance.column_roles = {}
            cls._instance.column_types = {}
            cls._instance.aliases = {}
            cls._instance._column_cache = {}  # Cache for cleaned column names
        return cls._instance

    def load_data(self, file_path: str) -> Dict[str, Any]:
        """Load data from Excel or CSV file with optimizations."""
        from app.core.parsing import parse_file_content

        path = Path(file_path)
        start_time = time.time()

        try:
            if path.suffix.lower() not in ['.xlsx', '.xls', '.csv']:
                raise ValueError(f"Unsupported file format: {path.suffix}")

            # Robust shared parser: delimiter sniffing, encoding fallback,
            # BOM stripping, euro-decimal conversion
            df = parse_file_content(path.read_bytes(), path.name)

            self.df = df
            self._optimize_dtypes()
            self.set_data(self.df)

            load_time = time.time() - start_time

            return {
                "success": True,
                "rows": len(self.df),
                "columns": len(self.df.columns),
                "preview": self.df.head().replace({np.nan: None}).to_dict(orient='records'),
                "load_time": round(load_time, 2)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_data(self) -> Optional[pd.DataFrame]:
        return self.df

    def set_data(self, df: pd.DataFrame):
        """Load a new DataFrame and run FRESH column detection.

        Single ingestion point for the API layer. Clears all cached detection
        state first — previously the sticky `_detection_done` flag made every
        upload after the first keep the first file's stale role map (a second
        collar upload would get no East/North/Elevation roles).
        """
        self.df = df
        self.column_roles = {}
        self.column_types = {}
        self.aliases = {}
        self._column_to_role = {}
        self._column_cache = {}
        if hasattr(self, '_detection_done'):
            del self._detection_done
        self._detect_all_properties()
        self._detection_done = True

    def _optimize_dtypes(self):
        """Optimize dataframe memory usage by converting to efficient dtypes."""
        if self.df is None:
            return

        # Convert string columns to category if they have low cardinality
        for col in self.df.columns:
            if self.df[col].dtype == 'object':
                unique_ratio = len(self.df[col].unique()) / len(self.df)
                if unique_ratio < 0.5:  # Less than 50% unique values
                    self.df[col] = self.df[col].astype('category')

        # Downcast numeric types
        for col in self.df.select_dtypes(include=['float64']).columns:
            self.df[col] = pd.to_numeric(self.df[col], downcast='float')

        for col in self.df.select_dtypes(include=['int64']).columns:
            self.df[col] = pd.to_numeric(self.df[col], downcast='integer')

    def _convert_mostly_numeric_columns(self):
        """
        Convert columns that are 'mostly numeric' to actual numeric type.
        This handles cases where columns have text values like 'MISSING', 'NS', 'BDL' mixed with numbers.
        Text values are converted to NaN.
        """
        if self.df is None:
            return

        # Common text values that should be treated as null/NaN in assay data
        null_text_values = {
            'MISSING', 'NS', 'DMGED', 'IS', 'ND', 'BDL', 'N/A', 'NA', 'NULL',
            '-', '--', '---', 'NR', 'NSS', 'INS', 'VOID', 'LOST', 'NO SAMPLE',
            'NOT SAMPLED', 'NOT ASSAYED', 'ASSAY PENDING', 'N/S', '<DL',
            'missing', 'ns', 'dmged', 'is', 'nd', 'bdl', 'n/a', 'na', 'null'
        }

        converted_count = 0
        self.censored_counts = {}
        for col in self.df.columns:
            # Only check object (string) columns
            if self.df[col].dtype != 'object':
                continue

            non_null_count = self.df[col].notna().sum()
            if non_null_count == 0:
                continue

            # Censored assay values: "<0.01" -> -0.01 (standard convention: a
            # negative value means "below this detection limit"), ">10000" ->
            # 10000 (over-limit, kept at the limit).
            censored, n_below, n_above = parse_censored_series(self.df[col])
            has_censored = (n_below + n_above) > 0

            # Skip columns that are clearly categorical (like HoleID, Project, etc.)
            # by checking if they have very few unique values relative to NON-NULL values.
            # A column with "<DL" values is an assay column, however few distinct
            # values it has (e.g. mostly "<0.005").
            unique_count = len(self.df[col].dropna().unique())
            unique_ratio = unique_count / max(1, non_null_count)

            # If less than 1% unique values AND more than 100 non-null values, probably categorical
            if not has_censored and unique_ratio < 0.01 and non_null_count > 100:
                continue

            # Try to convert to numeric, coercing errors to NaN
            numeric_series = pd.to_numeric(censored, errors='coerce')
            if has_censored:
                self.censored_counts[col] = {'below': int(n_below), 'above': int(n_above)}

            # Count how many values could be converted
            original_non_null = self.df[col].notna().sum()
            numeric_non_null = numeric_series.notna().sum()

            if original_non_null == 0:
                continue

            # Calculate what percentage of non-null values are numeric
            numeric_ratio = numeric_non_null / original_non_null

            # If >= 80% of values are numeric, convert the column
            if numeric_ratio < 0.80:
                self.censored_counts.pop(col, None)
            if numeric_ratio >= 0.80:
                # Check what values failed conversion
                failed_mask = self.df[col].notna() & numeric_series.isna()
                failed_values = set(self.df.loc[failed_mask, col].unique())

                # Log which values were converted to NaN
                if len(failed_values) > 0:
                    logger.info("Column '%s': Converting to numeric (%.1f%% numeric). Text values -> NaN: %s%s",
                                col, numeric_ratio * 100,
                                list(failed_values)[:5],
                                '...' if len(failed_values) > 5 else '')

                self.df[col] = numeric_series
                converted_count += 1

        if converted_count > 0:
            logger.info("Converted %d columns from text to numeric", converted_count)

    def _detect_all_properties(self):
        """Single-pass detection of all column properties (types, roles, aliases)."""
        if self.df is None:
            return

        # IMPORTANT: First convert mostly-numeric columns before type detection
        self._convert_mostly_numeric_columns()

        # Clear caches
        self.column_types = {}
        self.column_roles = {}
        self.aliases = {}
        self._column_cache = {}

        # OPTIMIZED: Vectorized type detection
        numeric_dtypes = self.df.select_dtypes(include=[np.number]).columns
        self.column_types = {col: "numeric" for col in numeric_dtypes}
        for col in self.df.columns:
            if col not in self.column_types:
                self.column_types[col] = "text"

        # OPTIMIZED: Cache cleaned column names
        for col in self.df.columns:
            self._column_cache[col] = col.lower().strip().replace("_", "").replace(" ", "")

        # Canonical dataset-role detection — the pattern table lives in
        # core/columns.py (single home for all column-name heuristics).
        # Multiple columns can share the same role.
        from app.core.columns import detect_dataset_roles
        self._column_to_role = detect_dataset_roles(list(self.df.columns))
        for col, role in self._column_to_role.items():
            # Also keep legacy column_roles for backwards compat (first match wins)
            if role not in self.column_roles:
                self.column_roles[role] = col

        # NOTE: automatic alias detection is intentionally absent — users set
        # aliases manually via update_alias / the frontend column manager

    def get_column_info(self) -> List[Dict[str, Any]]:
        """Return metadata about columns for the frontend."""
        if self.df is None:
            return []

        # OPTIMIZED: Build info list with list comprehension
        # Use _column_to_role for direct lookup (faster and supports multiple cols per role)
        column_to_role = getattr(self, '_column_to_role', {})
        censored = getattr(self, 'censored_counts', {})
        info = [
            {
                "name": col,
                "type": self.column_types.get(col, "unknown"),
                "role": column_to_role.get(col, None),
                "alias": self.aliases.get(col, None),
                # Only present for columns that contained "<x"/">x" values
                **({"censored": censored[col]} if col in censored else {}),
            }
            for col in self.df.columns
        ]
        return info

    def update_column_role(self, column: str, role: Optional[str]):
        """Update the role of a column."""
        # Ensure _column_to_role exists
        if not hasattr(self, '_column_to_role'):
            self._column_to_role = {}

        if role:
            # Update the per-column role mapping
            self._column_to_role[column] = role
            # Also update legacy mapping (backwards compat)
            self.column_roles = {r: c for r, c in self.column_roles.items() if r != role}
            self.column_roles[role] = column
        else:
            # Remove role from this column
            if column in self._column_to_role:
                del self._column_to_role[column]
            # Remove role if it was assigned to this column in legacy mapping
            self.column_roles = {r: c for r, c in self.column_roles.items() if c != column}

    def update_alias(self, column: str, alias: Optional[str]):
        """Update the alias of a column."""
        if alias:
            self.aliases[column] = alias
        elif column in self.aliases:
            del self.aliases[column]

    def get_performance_stats(self) -> Dict[str, Any]:
        """Get performance statistics about the loaded data."""
        if self.df is None:
            return {}

        memory_usage = self.df.memory_usage(deep=True).sum() / 1024 / 1024  # MB

        return {
            "rows": len(self.df),
            "columns": len(self.df.columns),
            "memory_mb": round(memory_usage, 2),
            "numeric_columns": len([c for c, t in self.column_types.items() if t == "numeric"]),
            "text_columns": len([c for c, t in self.column_types.items() if t == "text"]),
            "roles_detected": len(self.column_roles),
            "aliases_detected": len(self.aliases)
        }