"""
Intermediate data structures between protocol and QGIS layers.
Modeled after ioGAS gasdata_base.py.
Pure Python - no QGIS dependency, testable standalone.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


@dataclass
class GeochemColumn:
    """Column metadata."""
    name: str
    data_type: str = "text"     # "numeric", "text", "integer"
    role: str = ""              # "East", "North", "RL", "HoleID", etc.
    alias: str = ""
    index: int = -1


@dataclass
class GeochemData:
    """
    Holds a complete dataset ready for layer creation.
    Equivalent to ioGAS GasData_Base.
    """
    columns: List[GeochemColumn] = field(default_factory=list)
    rows: List[Dict[str, Any]] = field(default_factory=list)

    # Coordinate configuration
    x_field: str = ""
    y_field: str = ""
    z_field: str = ""
    crs: str = ""               # e.g. "EPSG:4326"

    # Style configuration (from web app)
    color_config: Optional[Dict] = None
    shape_config: Optional[Dict] = None
    size_config: Optional[Dict] = None
    opacity: float = 1.0

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def column_count(self) -> int:
        return len(self.columns)

    def column_names(self) -> List[str]:
        return [c.name for c in self.columns]

    def get_column(self, name: str) -> Optional[GeochemColumn]:
        for c in self.columns:
            if c.name == name:
                return c
        return None

    def get_numeric_columns(self) -> List[str]:
        return [c.name for c in self.columns if c.data_type == "numeric"]

    def get_columns_by_role(self, role: str) -> List[GeochemColumn]:
        return [c for c in self.columns if c.role == role]

    def detect_coordinate_fields(self):
        """Auto-detect coordinate fields from column roles or common names."""
        # Try by role first (stop at first match for each axis)
        for col in self.columns:
            role = col.role.lower() if col.role else ""
            if not self.x_field and role in ("east", "easting", "x"):
                self.x_field = col.name
            elif not self.y_field and role in ("north", "northing", "y"):
                self.y_field = col.name
            elif not self.z_field and role in ("elevation", "rl", "z"):
                self.z_field = col.name

        # Fallback: try common name patterns
        if not self.x_field or not self.y_field:
            name_map = {}
            for col in self.columns:
                lower = col.name.lower()
                name_map[lower] = col.name

            x_candidates = ["east", "easting", "x", "longitude", "lon", "long"]
            y_candidates = ["north", "northing", "y", "latitude", "lat"]
            z_candidates = ["elevation", "rl", "z", "altitude", "elev"]

            if not self.x_field:
                for cand in x_candidates:
                    if cand in name_map:
                        self.x_field = name_map[cand]
                        break

            if not self.y_field:
                for cand in y_candidates:
                    if cand in name_map:
                        self.y_field = name_map[cand]
                        break

            if not self.z_field:
                for cand in z_candidates:
                    if cand in name_map:
                        self.z_field = name_map[cand]
                        break

    def has_coordinates(self) -> bool:
        return bool(self.x_field and self.y_field)

    def has_3d(self) -> bool:
        return bool(self.z_field)
