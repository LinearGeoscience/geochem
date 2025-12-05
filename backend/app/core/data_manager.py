import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import json

class DataManager:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataManager, cls).__new__(cls)
            cls._instance.df = None
            cls._instance.column_roles = {}
            cls._instance.column_types = {}
            cls._instance.aliases = {}
        return cls._instance

    def load_data(self, file_path: str) -> Dict[str, Any]:
        """Load data from Excel or CSV file."""
        path = Path(file_path)
        try:
            if path.suffix.lower() in ['.xlsx', '.xls']:
                self.df = pd.read_excel(path)
            elif path.suffix.lower() == '.csv':
                self.df = pd.read_csv(path)
            else:
                raise ValueError(f"Unsupported file format: {path.suffix}")
            
            # Initial processing
            self._detect_column_types()
            self._auto_detect_roles()
            self._guess_aliases()
            
            return {
                "success": True,
                "rows": len(self.df),
                "columns": len(self.df.columns),
                "preview": self.df.head().replace({np.nan: None}).to_dict(orient='records')
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_data(self) -> Optional[pd.DataFrame]:
        return self.df

    def _detect_column_types(self):
        """Detect if columns are numeric or text."""
        if self.df is None:
            return
            
        for col in self.df.columns:
            if pd.api.types.is_numeric_dtype(self.df[col]):
                self.column_types[col] = "numeric"
            else:
                self.column_types[col] = "text"

    def _auto_detect_roles(self):
        """Auto-detect special column roles (ID, Coordinates, etc.)."""
        if self.df is None:
            return
            
        # Reset roles
        self.column_roles = {}
        
        # Keywords for detection
        keywords = {
            "ID": ["sample", "id", "lab_no"],
            "East": ["east", "easting", "x_coord", "utme"],
            "North": ["north", "northing", "y_coord", "utmn"],
            "Elevation": ["rl", "elev", "elevation", "z_coord", "depth"],
            "Latitude": ["lat", "latitude"],
            "Longitude": ["long", "longitude"]
        }
        
        assigned_cols = set()
        
        for role, keys in keywords.items():
            for col in self.df.columns:
                if col in assigned_cols:
                    continue
                if any(k in col.lower() for k in keys):
                    self.column_roles[role] = col
                    assigned_cols.add(col)
                    break

    def _guess_aliases(self):
        """Guess standard element/oxide names."""
        if self.df is None:
            return
            
        # Common elements and oxides
        elements = [
            "Au", "Ag", "Cu", "Pb", "Zn", "Ni", "Co", "Fe", "Mn", "Cr", "V", "Ti",
            "As", "Sb", "Bi", "Hg", "Mo", "W", "Sn", "U", "Th", "Zr", "Hf", "Nb", "Ta",
            "Y", "La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
            "Sc", "Ga", "Ge", "In", "Tl", "Cd", "Se", "Te", "Re", "Os", "Ir", "Pt", "Pd", "Rh", "Ru",
            "SiO2", "Al2O3", "Fe2O3", "FeO", "MgO", "CaO", "Na2O", "K2O", "TiO2", "P2O5", "MnO", "Cr2O3", "LOI"
        ]
        
        for col in self.df.columns:
            # Simple matching logic - can be improved
            col_clean = col.replace("_", "").replace(" ", "").upper()
            
            for elem in elements:
                if col_clean.startswith(elem.upper()):
                    # Check if it's likely the element (e.g. "Au_ppm" -> "Au")
                    # Avoid matching "Ca" in "CaO" if "CaO" is the target
                    if elem.upper() == "CA" and "CAO" in col_clean:
                        continue
                    
                    self.aliases[col] = elem
                    break

    def get_column_info(self) -> List[Dict[str, Any]]:
        """Return metadata about columns for the frontend."""
        if self.df is None:
            return []
            
        info = []
        for col in self.df.columns:
            info.append({
                "name": col,
                "type": self.column_types.get(col, "unknown"),
                "role": next((r for r, c in self.column_roles.items() if c == col), None),
                "alias": self.aliases.get(col, None)
            })
        return info

    def update_column_role(self, column: str, role: Optional[str]):
        """Update the role of a column."""
        # Remove role from other columns
        if role:
            for r, c in list(self.column_roles.items()):
                if r == role:
                    del self.column_roles[r]
            self.column_roles[role] = column
        else:
            # Remove role if it was assigned to this column
            for r, c in list(self.column_roles.items()):
                if c == column:
                    del self.column_roles[r]

    def update_alias(self, column: str, alias: Optional[str]):
        """Update the alias of a column."""
        if alias:
            self.aliases[column] = alias
        elif column in self.aliases:
            del self.aliases[column]
