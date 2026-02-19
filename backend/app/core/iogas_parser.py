"""
ioGAS .gas File Parser

Parses native ioGAS project files which are ZIP archives containing:
- version.txt: ioGAS version string
- data.csv: The actual data with special attribute columns at the end
- metadata.xml: Column definitions, attributes, special column mappings
- workspace.xml: Window settings (optional)
- changelog.txt: Audit trail (optional)
"""

import logging
import zipfile
import io
import xml.etree.ElementTree as ET
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import re

logger = logging.getLogger(__name__)


# ioGAS character escaping rules (from metadata.xml header)
IOGAS_ESCAPE_MAP = {
    '_a': '&',
    '_l': '<',
    '_g': '>',
    '_q': '"',
    '_c': ',',
    '_t': '\t',
    '_u': '_',  # Must be processed last
}


def unescape_iogas_string(s: str) -> str:
    """Unescape ioGAS special character sequences."""
    if not s:
        return s

    # Process in order, _u must be last
    result = s
    for escape, char in [('_a', '&'), ('_l', '<'), ('_g', '>'),
                          ('_q', '"'), ('_c', ','), ('_t', '\t')]:
        result = result.replace(escape, char)
    # _u -> _ must be last
    result = result.replace('_u', '_')
    return result


class IoGasParser:
    """Parser for ioGAS .gas project files."""

    # Special columns added by ioGAS at the end of each row
    SPECIAL_COLUMNS = ['__gas__extra__', '__gas__color__', '__gas__shape__', '__gas__size__']

    def __init__(self):
        self.version: str = ""
        self.metadata: Dict[str, Any] = {}
        self.columns: List[Dict[str, Any]] = []
        self.special_columns: Dict[str, str] = {}
        self.color_attributes: List[Dict[str, Any]] = []
        self.shape_attributes: List[Dict[str, Any]] = []
        self.size_attributes: List[Dict[str, Any]] = []
        self.filter_attributes: List[Dict[str, Any]] = []
        self.df: Optional[pd.DataFrame] = None

    def parse(self, file_content: bytes) -> Dict[str, Any]:
        """
        Parse an ioGAS .gas file.

        Args:
            file_content: Raw bytes of the .gas file

        Returns:
            Dictionary with parsed data and metadata
        """
        try:
            # Open as ZIP archive
            with zipfile.ZipFile(io.BytesIO(file_content), 'r') as zf:
                file_list = zf.namelist()
                logger.debug("Archive contains: %s", file_list)

                # Parse version
                if 'version.txt' in file_list:
                    self.version = zf.read('version.txt').decode('utf-8').strip()
                    logger.info("Version: %s", self.version)

                # Parse metadata.xml
                if 'metadata.xml' in file_list:
                    metadata_content = zf.read('metadata.xml')
                    self._parse_metadata(metadata_content)
                    logger.info("Parsed %d column definitions", len(self.columns))
                else:
                    raise ValueError("metadata.xml not found in .gas file")

                # Parse data.csv
                if 'data.csv' in file_list:
                    data_content = zf.read('data.csv')
                    self._parse_data(data_content)
                    logger.info("Loaded %d rows, %d columns", len(self.df), len(self.df.columns))
                else:
                    raise ValueError("data.csv not found in .gas file")

                # Build result
                return self._build_result()

        except zipfile.BadZipFile:
            raise ValueError("Invalid .gas file: Not a valid ZIP archive")
        except Exception as e:
            raise ValueError(f"Failed to parse .gas file: {str(e)}")

    def _parse_metadata(self, content: bytes):
        """Parse metadata.xml for column definitions and attributes."""
        # Try different encodings
        for encoding in ['utf-8', 'windows-1252', 'latin-1']:
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = content.decode('latin-1', errors='replace')

        root = ET.fromstring(text)

        # Parse column definitions
        columns_elem = root.find('columns')
        if columns_elem is not None:
            for col_elem in columns_elem.findall('column'):
                col_info = {
                    'originalName': unescape_iogas_string(
                        col_elem.findtext('origonalName', '')  # Note: ioGAS has typo
                    ),
                    'aliasName': unescape_iogas_string(
                        col_elem.findtext('aliasName', '')
                    ),
                    'type': col_elem.findtext('type', 'Text'),
                    'derived': col_elem.findtext('derived', 'false') == 'true',
                }

                # Parse expression for derived columns
                if col_info['derived']:
                    col_info['expression'] = col_elem.findtext('expression', '')
                    variables = []
                    for var_elem in col_elem.findall('Variable'):
                        variables.append({
                            'letter': var_elem.get('letter', ''),
                            'element': var_elem.get('element', ''),
                            'unit': var_elem.get('unit', '')
                        })
                    col_info['variables'] = variables

                self.columns.append(col_info)

        # Parse special column mappings
        special_elem = root.find('specialColumns')
        if special_elem is not None:
            self.special_columns = {
                'easting': special_elem.findtext('map_east', ''),
                'northing': special_elem.findtext('map_north', ''),
                'elevation': special_elem.findtext('map_elevation', ''),
                'projection': special_elem.findtext('map_proj', ''),
                'epsg': special_elem.findtext('map_epsg', ''),
                'id': special_elem.findtext('id', ''),
                'group': special_elem.findtext('group', ''),
            }

        # Parse color attributes
        color_attrs = root.find('colourAttributes')
        if color_attrs is not None:
            for attr in color_attrs.findall('colourAttribute'):
                self.color_attributes.append({
                    'name': attr.findtext('name', ''),
                    'color': int(attr.findtext('colour', '-16777216')),  # Signed int RGB
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse shape attributes
        shape_attrs = root.find('shapeAttributes')
        if shape_attrs is not None:
            for attr in shape_attrs.findall('shapeAttribute'):
                self.shape_attributes.append({
                    'name': attr.findtext('name', ''),
                    'shape': int(attr.findtext('shapeCode', '0')),
                    'filled': attr.findtext('filled', 'true') == 'true',
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse size attributes
        size_attrs = root.find('sizeAttributes')
        if size_attrs is not None:
            for attr in size_attrs.findall('sizeAttribute'):
                self.size_attributes.append({
                    'name': attr.findtext('name', ''),
                    'size': int(attr.findtext('size', '4')),
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse filter/extra attributes
        filter_attrs = root.find('extraAttributes2')
        if filter_attrs is not None:
            for attr in filter_attrs.findall('extraAttribute'):
                self.filter_attributes.append({
                    'name': attr.findtext('name', ''),
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse drillhole options
        dh_opts = root.find('DHOptions')
        if dh_opts is not None:
            self.metadata['drillhole'] = {
                'fromField': dh_opts.findtext('fromField', ''),
                'toField': dh_opts.findtext('toField', '')
            }

    def _parse_data(self, content: bytes):
        """Parse data.csv file."""
        # Try different encodings
        for encoding in ['utf-8', 'windows-1252', 'latin-1']:
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = content.decode('latin-1', errors='replace')

        # Read CSV
        self.df = pd.read_csv(
            io.StringIO(text),
            low_memory=False,
            na_values=['', 'NA', 'N/A', 'null', 'NULL']
        )

        # Remove the special ioGAS columns from the data
        columns_to_drop = [col for col in self.SPECIAL_COLUMNS if col in self.df.columns]

        # Also remove columns with leading space (ioGAS adds space before some special columns)
        for col in self.df.columns:
            if col.strip() in self.SPECIAL_COLUMNS and col not in columns_to_drop:
                columns_to_drop.append(col)

        if columns_to_drop:
            logger.debug("Removing special columns: %s", columns_to_drop)
            self.df = self.df.drop(columns=columns_to_drop)

        # Rename columns based on metadata (use original names from metadata, not CSV header)
        # The CSV header might have different names than the metadata
        if len(self.columns) > 0:
            # Build mapping from current column names to metadata names
            # ioGAS stores columns in same order in metadata and CSV
            current_cols = list(self.df.columns)
            metadata_cols = [c['originalName'] for c in self.columns]

            # Only rename if counts match (excluding special columns we dropped)
            if len(current_cols) == len(metadata_cols):
                rename_map = {
                    old: unescape_iogas_string(new)
                    for old, new in zip(current_cols, metadata_cols)
                    if old != new
                }
                if rename_map:
                    logger.debug("Renaming %d columns", len(rename_map))
                    self.df = self.df.rename(columns=rename_map)

    def _build_result(self) -> Dict[str, Any]:
        """Build the result dictionary for the API response."""
        # Build column info in our format
        column_info = []

        for i, col in enumerate(self.columns):
            col_name = col['originalName']

            # Skip if column not in dataframe
            if col_name not in self.df.columns:
                continue

            # Determine type
            iogas_type = col['type'].lower()
            if iogas_type == 'numeric':
                col_type = 'numeric'
                # Check if actually integer
                series = self.df[col_name].dropna()
                if len(series) > 0 and (series == series.astype(int)).all():
                    col_type = 'integer'
            else:
                col_type = 'text'

            # Determine role based on special column mappings
            role = 'data'
            if col_name == self.special_columns.get('id'):
                role = 'id'
            elif col_name == self.special_columns.get('group'):
                role = 'group'
            elif col_name == self.special_columns.get('easting'):
                role = 'easting'
            elif col_name == self.special_columns.get('northing'):
                role = 'northing'
            elif col_name == self.special_columns.get('elevation'):
                role = 'elevation'
            elif col_name.lower() in ['from', 'from_m', 'from_depth']:
                role = 'from'
            elif col_name.lower() in ['to', 'to_m', 'to_depth']:
                role = 'to'

            # Determine priority (for display ordering)
            priority = self._get_column_priority(col_name, role, iogas_type)

            column_info.append({
                'name': col_name,
                'type': col_type,
                'role': role,
                'alias': col['aliasName'] if col['aliasName'] != col_name else None,
                'priority': priority,
                'derived': col.get('derived', False),
            })

        # Sort columns by priority
        column_info.sort(key=lambda x: (x['priority'], x['name']))

        # Convert data to records
        data = self.df.replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records')

        return {
            'success': True,
            'rows': len(self.df),
            'columns': len(self.df.columns),
            'data': data,
            'preview': data[:5] if len(data) > 5 else data,
            'column_info': column_info,
            'iogas_metadata': {
                'version': self.version,
                'special_columns': self.special_columns,
                'color_attributes': self.color_attributes,
                'shape_attributes': self.shape_attributes,
                'size_attributes': self.size_attributes,
                'drillhole_options': self.metadata.get('drillhole'),
            }
        }

    def _get_column_priority(self, name: str, role: str, iogas_type: str) -> int:
        """
        Determine column priority for display ordering.
        Lower numbers appear first in dropdowns.
        """
        # ID columns first
        if role in ['id', 'sample_id']:
            return 0

        # Location metadata
        if role in ['group', 'hole_id']:
            return 1
        if role in ['from', 'to']:
            return 2
        if role in ['easting', 'northing', 'elevation']:
            return 3

        # Text columns (metadata) at lower priority
        if iogas_type != 'numeric':
            return 8

        # Numeric data columns
        return 5


def parse_iogas_file(file_content: bytes) -> Dict[str, Any]:
    """
    Convenience function to parse an ioGAS .gas file.

    Args:
        file_content: Raw bytes of the .gas file

    Returns:
        Dictionary with parsed data and metadata
    """
    parser = IoGasParser()
    return parser.parse(file_content)
