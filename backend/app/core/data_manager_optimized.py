import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import json
import time
import re

logger = logging.getLogger(__name__)

class DataManagerOptimized:
    """Ultra-optimized DataManager with vectorized operations and caching"""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataManagerOptimized, cls).__new__(cls)
            cls._instance.df = None
            cls._instance.column_roles = {}
            cls._instance.column_types = {}
            cls._instance.aliases = {}
            cls._instance._column_cache = {}  # Cache for cleaned column names
            cls._instance._pattern_cache = {}  # Cache for compiled regex patterns
        return cls._instance

    def load_data(self, file_path: str) -> Dict[str, Any]:
        """Load data from Excel or CSV file with optimizations."""
        path = Path(file_path)
        start_time = time.time()

        try:
            # Optimized file reading
            if path.suffix.lower() in ['.xlsx', '.xls']:
                self.df = pd.read_excel(path, engine='openpyxl')  # Faster engine
            elif path.suffix.lower() == '.csv':
                # Use optimized CSV reading
                self.df = pd.read_csv(path,
                                      low_memory=False,  # Faster for known types
                                      na_values=['', 'NA', 'N/A', 'null', 'NULL'])
            else:
                raise ValueError(f"Unsupported file format: {path.suffix}")

            # Optimize memory
            self._optimize_dtypes()

            # Single-pass detection
            self._detect_all_properties()

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

    def _detect_column_types(self):
        """Detect column types - wrapper for compatibility."""
        if self.df is None:
            return
        # OPTIMIZED: Vectorized type detection
        numeric_dtypes = self.df.select_dtypes(include=[np.number]).columns
        self.column_types = {col: "numeric" for col in numeric_dtypes}
        for col in self.df.columns:
            if col not in self.column_types:
                self.column_types[col] = "text"

    def _auto_detect_roles(self):
        """Auto-detect column roles - wrapper for compatibility."""
        if self.df is None:
            return
        # Call the combined method if not already done
        if not hasattr(self, '_detection_done'):
            self._detect_all_properties()
            self._detection_done = True

    def _guess_aliases(self):
        """Guess aliases - wrapper for compatibility."""
        if self.df is None:
            return
        # Call the combined method if not already done
        if not hasattr(self, '_detection_done'):
            self._detect_all_properties()
            self._detection_done = True

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
        for col in self.df.columns:
            # Only check object (string) columns
            if self.df[col].dtype != 'object':
                continue

            # Skip columns that are clearly categorical (like HoleID, Project, etc.)
            # by checking if they have very few unique values relative to NON-NULL values
            non_null_count = self.df[col].notna().sum()
            if non_null_count == 0:
                continue

            unique_count = len(self.df[col].dropna().unique())
            unique_ratio = unique_count / max(1, non_null_count)

            # If less than 1% unique values AND more than 100 non-null values, probably categorical
            if unique_ratio < 0.01 and non_null_count > 100:
                continue

            # Try to convert to numeric, coercing errors to NaN
            numeric_series = pd.to_numeric(self.df[col], errors='coerce')

            # Count how many values could be converted
            original_non_null = self.df[col].notna().sum()
            numeric_non_null = numeric_series.notna().sum()

            if original_non_null == 0:
                continue

            # Calculate what percentage of non-null values are numeric
            numeric_ratio = numeric_non_null / original_non_null

            # If >= 80% of values are numeric, convert the column
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

        # OPTIMIZED: Compile patterns once
        # Note: Patterns are checked against exact column names
        role_patterns = {
            "ID": re.compile(r"(sample|id|lab_no)", re.IGNORECASE),
            "East": re.compile(r"(east|easting|x_coord|utme|collar_?east|^x$)", re.IGNORECASE),
            "North": re.compile(r"(north|northing|y_coord|utmn|collar_?north|^y$)", re.IGNORECASE),
            "Elevation": re.compile(r"(rl|elev|elevation|z_coord|collar_?rl|^z$)", re.IGNORECASE),
            "Latitude": re.compile(r"(lat|latitude)", re.IGNORECASE),
            "Longitude": re.compile(r"(long|longitude)", re.IGNORECASE),
            "HoleID": re.compile(r"(hole|dhid|hole_id|holeid)", re.IGNORECASE),
            "From": re.compile(r"(^from$|depth_from|sample_from|from_m)", re.IGNORECASE),
            "To": re.compile(r"(^to$|depth_to|sample_to|to_m)", re.IGNORECASE)
        }

        # OPTIMIZED: Single pass role detection with compiled patterns
        # Store role per column (not column per role) so multiple columns can have same role
        self._column_to_role = {}  # Maps column name to its role
        for col in self.df.columns:
            for role, pattern in role_patterns.items():
                if pattern.search(col):
                    self._column_to_role[col] = role
                    # Also keep legacy column_roles for backwards compat (first match wins)
                    if role not in self.column_roles:
                        self.column_roles[role] = col
                    break

        # DISABLED: Automatic alias detection - users should set aliases manually
        # self._detect_aliases_optimized()

    def _detect_aliases_optimized(self):
        """Optimized alias detection using vectorized operations."""
        # Common elements and oxides (sorted by frequency in geology)
        common_elements = [
            "Au", "Cu", "Ag", "Pb", "Zn", "Ni", "Co", "Fe", "As", "Mo",
            "U", "Th", "Bi", "Sb", "W", "Sn", "Cr", "V", "Ti", "Mn"
        ]

        rare_elements = [
            "Hg", "Cd", "Se", "Te", "In", "Ga", "Ge", "Tl", "Re",
            "Zr", "Hf", "Nb", "Ta", "Sc", "Y"
        ]

        ree_elements = [
            "La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy",
            "Ho", "Er", "Tm", "Yb", "Lu"
        ]

        pge_elements = ["Pt", "Pd", "Rh", "Ru", "Os", "Ir"]

        oxides = [
            "SiO2", "Al2O3", "Fe2O3", "FeO", "MgO", "CaO",
            "Na2O", "K2O", "TiO2", "P2O5", "MnO", "Cr2O3", "LOI"
        ]

        # Combine all elements (ordered by likelihood)
        all_elements = common_elements + oxides + rare_elements + ree_elements + pge_elements

        # Create pattern map for fast lookup
        element_patterns = {}
        for elem in all_elements:
            # Create specific patterns for each element
            if "O" in elem and elem != "Co" and elem != "Mo" and elem != "Ho":  # Oxides
                element_patterns[elem] = re.compile(f"^{re.escape(elem)}[_\\s]?", re.IGNORECASE)
            else:  # Elements
                element_patterns[elem] = re.compile(f"^{re.escape(elem)}[_\\s]?(?:ppm|ppb|pct|%)?", re.IGNORECASE)

        # Single pass through columns
        for col in self.df.columns:
            col_clean = self._column_cache.get(col, col)

            # Try to match elements (most specific first)
            for elem, pattern in element_patterns.items():
                if pattern.match(col):
                    self.aliases[col] = elem
                    break

    def get_column_info(self) -> List[Dict[str, Any]]:
        """Return metadata about columns for the frontend."""
        if self.df is None:
            return []

        # OPTIMIZED: Build info list with list comprehension
        # Use _column_to_role for direct lookup (faster and supports multiple cols per role)
        column_to_role = getattr(self, '_column_to_role', {})
        info = [
            {
                "name": col,
                "type": self.column_types.get(col, "unknown"),
                "role": column_to_role.get(col, None),
                "alias": self.aliases.get(col, None)
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