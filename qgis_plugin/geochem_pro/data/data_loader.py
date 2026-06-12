"""
Loads GeochemData from the GeoChem backend via REST API.
Modeled after ioGAS gasdata_link.py.
Uses urllib (no extra dependencies) with fallback strategy.
"""

import json
import urllib.request
import urllib.error
from typing import Optional, List, Dict, Any

from ..support import logger, config
from .geochem_data import GeochemData, GeochemColumn


class DataLoader:
    """
    Fetches data from GeoChem backend, constructs GeochemData.
    Tries main data API first, falls back to QGIS push cache.
    """

    def __init__(self):
        self._base_url = config.get_base_url()

    def update_base_url(self):
        self._base_url = config.get_base_url()

    def _get(self, path: str) -> Any:
        """Make a GET request and return parsed JSON."""
        url = f"{self._base_url}{path}"
        try:
            req = urllib.request.Request(url)
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as e:
            logger.log_error(f"GET {url} failed: {e}", "data_loader")
            return None
        except json.JSONDecodeError as e:
            logger.log_error(f"Invalid JSON from {url}: {e}", "data_loader")
            return None

    def check_health(self) -> bool:
        """Check if the backend is reachable."""
        result = self._get(config.API_HEALTH)
        return result is not None and result.get("status") == "ok"

    def load_data(self) -> Optional[GeochemData]:
        """
        Load data from backend. Tries main data API first,
        falls back to QGIS-specific cache.
        """
        # Strategy 1: Main data API (always populated after upload)
        data = self._try_main_api()
        if data and data.row_count > 0:
            logger.log_info(
                f"Loaded {data.row_count} rows from main data API",
                "data_loader"
            )
            return data

        # Strategy 2: QGIS push cache (populated by frontend)
        data = self._try_qgis_cache()
        if data and data.row_count > 0:
            logger.log_info(
                f"Loaded {data.row_count} rows from QGIS cache",
                "data_loader"
            )
            return data

        logger.log_warning("No data available from backend", "data_loader")
        return None

    def _try_main_api(self) -> Optional[GeochemData]:
        """Try loading from /api/data/data and /api/data/columns."""
        rows = self._get(config.API_DATA)
        if not rows or not isinstance(rows, list) or len(rows) == 0:
            return None

        columns_info = self._get(config.API_COLUMNS) or []
        return self._build_geochem_data(rows, columns_info)

    def _try_qgis_cache(self) -> Optional[GeochemData]:
        """Try loading from /api/qgis/data and /api/qgis/columns."""
        rows = self._get(config.API_QGIS_DATA)
        if not rows or not isinstance(rows, list) or len(rows) == 0:
            return None

        columns_info = self._get(config.API_QGIS_COLUMNS) or []
        return self._build_geochem_data(rows, columns_info)

    def _build_geochem_data(
        self,
        rows: List[Dict],
        columns_info: List[Dict]
    ) -> GeochemData:
        """Build a GeochemData object from raw API responses."""
        data = GeochemData()

        # Build columns from column info if available
        if columns_info:
            for i, col_info in enumerate(columns_info):
                col = GeochemColumn(
                    name=col_info.get("name", f"col_{i}"),
                    data_type=self._map_type(col_info.get("type", "text")),
                    role=col_info.get("role", ""),
                    alias=col_info.get("alias", ""),
                    index=i,
                )
                data.columns.append(col)
        elif rows:
            # Infer columns from first row keys
            for i, key in enumerate(rows[0].keys()):
                val = rows[0][key]
                dtype = "numeric" if isinstance(val, (int, float)) else "text"
                data.columns.append(GeochemColumn(
                    name=key, data_type=dtype, index=i
                ))

        data.rows = rows
        data.detect_coordinate_fields()
        return data

    def load_styles(self) -> Optional[Dict]:
        """Load styling configuration from backend."""
        result = self._get(config.API_QGIS_STYLES)
        if result and isinstance(result, dict):
            return result
        return None

    def load_pathfinders(self) -> Optional[Dict]:
        """Load pathfinder configuration from backend."""
        result = self._get(config.API_QGIS_PATHFINDERS)
        if result and isinstance(result, dict):
            return result
        return None

    @staticmethod
    def _map_type(backend_type: str) -> str:
        """Map backend column types to our types."""
        t = backend_type.lower()
        if t in ("float64", "float32", "float", "double", "numeric",
                  "int64", "int32", "int", "integer"):
            return "numeric"
        return "text"
