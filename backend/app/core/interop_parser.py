"""
.gas File Parser

Parses native .gas project files which are ZIP archives containing:
- version.txt: file version string
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


# character escaping rules (from metadata.xml header)
INTEROP_ESCAPE_MAP = {
    '_a': '&',
    '_l': '<',
    '_g': '>',
    '_q': '"',
    '_c': ',',
    '_t': '\t',
    '_u': '_',  # Must be processed last
}


def unescape_interop_string(s: str) -> str:
    """Unescape special character sequences."""
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


class InteropParser:
    """Parser for .gas project files."""

    # Special columns added by at the end of each row: 0-based indexes
    # into the filter/colour/shape/size attribute lists of metadata.xml
    SPECIAL_COLUMNS = ['__gas__extra__', '__gas__color__', '__gas__shape__', '__gas__size__']
    SPECIAL_KIND = {
        '__gas__color__': 'colour',
        '__gas__shape__': 'shape',
        '__gas__size__': 'size',
        '__gas__extra__': 'filter',
    }
    # Data columns that carry each row's attribute group (added on import)
    ATTRIBUTE_COLUMN = {
        'colour': 'Colour attribute',
        'shape': 'Shape attribute',
        'size': 'Size attribute',
        'filter': 'Filter attribute',
    }

    def __init__(self):
        self.version: str = ""
        self.metadata: Dict[str, Any] = {}
        self.columns: List[Dict[str, Any]] = []
        self.special_columns: Dict[str, str] = {}
        self.color_attributes: List[Dict[str, Any]] = []
        self.shape_attributes: List[Dict[str, Any]] = []
        self.size_attributes: List[Dict[str, Any]] = []
        self.filter_attributes: List[Dict[str, Any]] = []
        self.attribute_titles: Dict[str, str] = {}
        self.row_attribute_indices: Dict[str, np.ndarray] = {}
        self.attribute_columns: Dict[str, str] = {}
        self.selection_history: List[List[str]] = []
        self.workspace_xml: Optional[str] = None
        self.checkpoints: List[Dict[str, Any]] = []
        self.df: Optional[pd.DataFrame] = None

    @staticmethod
    def colour_to_hex(value: int) -> str:
        """stores colours as signed 32-bit ARGB ints (Java Color.getRGB)."""
        return '#{:06x}'.format(value & 0xFFFFFF)

    @staticmethod
    def _safe_int(value: Optional[str], default: int) -> int:
        """Safely parse an integer from XML text, returning default on failure."""
        if value is None:
            return default
        try:
            return int(value)
        except (ValueError, TypeError):
            return default

    def parse(self, file_content: bytes) -> Dict[str, Any]:
        """
        Parse a .gas file.

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

                self._add_attribute_columns()

                if 'workspace.xml' in file_list:
                    try:
                        self._parse_workspace(zf.read('workspace.xml'))
                    except ET.ParseError as e:
                        logger.warning("Could not read workspace.xml: %s", e)

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
                    'originalName': unescape_interop_string(
                        col_elem.findtext('origonalName', '')  # Note: has typo
                    ),
                    'aliasName': unescape_interop_string(
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

        # Attribute list titles (the field the list was built from, e.g. "Lith1")
        for kind, tag in (('colour', 'colourAttributes'), ('shape', 'shapeAttributes'),
                          ('size', 'sizeAttributes'), ('filter', 'extraAttributes2')):
            elem = root.find(tag)
            if elem is not None:
                self.attribute_titles[kind] = unescape_interop_string((elem.findtext('title') or '').strip())

        # Parse color attributes
        color_attrs = root.find('colourAttributes')
        if color_attrs is not None:
            for attr in color_attrs.findall('colourAttribute'):
                colour = self._safe_int(attr.findtext('colour', '-16777216'), -16777216)  # Signed int RGB
                self.color_attributes.append({
                    'name': unescape_interop_string(attr.findtext('name', '')),
                    'color': colour,
                    'hex': self.colour_to_hex(colour),
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse shape attributes. <shape> is the base glyph; <shapeCode> adds
        # variants (e.g. 40 = hollow circle) on top of it
        shape_attrs = root.find('shapeAttributes')
        if shape_attrs is not None:
            for attr in shape_attrs.findall('shapeAttribute'):
                self.shape_attributes.append({
                    'name': unescape_interop_string(attr.findtext('name', '')),
                    'shape': self._safe_int(attr.findtext('shape', attr.findtext('shapeCode', '0')), 0),
                    'shapeCode': self._safe_int(attr.findtext('shapeCode', '0'), 0),
                    'filled': attr.findtext('filled', 'true') == 'true',
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse size attributes
        size_attrs = root.find('sizeAttributes')
        if size_attrs is not None:
            for attr in size_attrs.findall('sizeAttribute'):
                self.size_attributes.append({
                    'name': unescape_interop_string(attr.findtext('name', '')),
                    'size': self._safe_int(attr.findtext('size', '4'), 4),
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Parse filter/extra attributes
        filter_attrs = root.find('extraAttributes2')
        if filter_attrs is not None:
            for attr in filter_attrs.findall('extraAttribute'):
                self.filter_attributes.append({
                    'name': unescape_interop_string(attr.findtext('name', '')),
                    'visible': attr.findtext('visible', 'true') == 'true'
                })

        # Variable selection history (oldest first; names are column aliases)
        history = root.find('variableSelectionHistory')
        if history is not None:
            for sel in history.findall('variableSelection'):
                names = [unescape_interop_string(v.findtext('variableName', ''))
                         for v in sel.findall('variable')]
                names = [n for n in names if n]
                if names:
                    self.selection_history.append(names)

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

        # Keep each row's attribute indexes, then remove the special columns
        for col in self.df.columns:
            kind = self.SPECIAL_KIND.get(str(col).strip())
            if kind:
                idx = pd.to_numeric(self.df[col], errors='coerce').fillna(0).astype(int)
                self.row_attribute_indices[kind] = idx.to_numpy()

        # Remove the special columns from the data
        columns_to_drop = [col for col in self.SPECIAL_COLUMNS if col in self.df.columns]

        # Also remove columns with leading space (adds space before some special columns)
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
            # stores columns in same order in metadata and CSV
            current_cols = list(self.df.columns)
            metadata_cols = [c['originalName'] for c in self.columns]

            # Only rename if counts match (excluding special columns we dropped)
            if len(current_cols) == len(metadata_cols):
                rename_map = {
                    old: unescape_interop_string(new)
                    for old, new in zip(current_cols, metadata_cols)
                    if old != new
                }
                if rename_map:
                    logger.debug("Renaming %d columns", len(rename_map))
                    self.df = self.df.rename(columns=rename_map)
            else:
                logger.warning(
                    "Column count mismatch: CSV has %d columns, metadata has %d — skipping rename",
                    len(current_cols), len(metadata_cols)
                )

    # Checkpoint entry classes -> attribute kind
    CHECKPOINT_KIND = {
        'ColourAttributeEntry': 'colour',
        'ShapeAttributeEntry': 'shape',
        'SizeAttributeEntry': 'size',
        'ExtraAttributeEntry': 'filter',
    }
    CHECKPOINT_TITLE = {'colour': 'm__colourTitle', 'shape': 'm__shapeTitle', 'size': 'm__sizeTitle', 'filter': 'm__extraTitle'}
    CHECKPOINT_INDEX = {'colour': 'm__colourIndex', 'shape': 'm__shapeIndex', 'size': 'm__sizeIndex', 'filter': 'm__extraIndex'}

    def _parse_workspace(self, content: bytes):
        """Open plots (creator list) and saved checkpoints from workspace.xml.

        The plot list is passed on as XML for the frontend to rebuild; each
        checkpoint becomes its attribute lists plus every row's group index
        per kind (stores one index set per data row).
        """
        text = content.decode('utf-8', errors='replace')
        cut = text.find('<m__checkpoints')
        head = text if cut < 0 else text[:cut]
        start, end = head.find('<m__creatorList>'), head.find('</m__creatorList>')
        if start >= 0 and end > start:
            self.workspace_xml = head[start:end + len('</m__creatorList>')]
        if cut < 0 or self.df is None:
            return
        root = ET.fromstring(content)
        n_rows = len(self.df)
        for entry in root.findall('m__checkpoints/m__list/*'):
            state = entry.find('m__attributeState')
            inner = state.find('m__attributeList/m__attributeList') if state is not None else None
            rows = state.find('m__list') if state is not None else None
            if inner is None or rows is None or len(rows) != n_rows:
                continue
            # One combined list; each row indexes into it once per kind
            where: List[Tuple[str, int]] = []
            lists: Dict[str, List[Dict[str, Any]]] = {k: [] for k in self.CHECKPOINT_TITLE}
            for item in inner:
                kind = self.CHECKPOINT_KIND.get(item.tag.split('.')[-1])
                if kind is None:
                    where.append(('', -1))
                    continue
                e: Dict[str, Any] = {
                    'name': unescape_interop_string(item.findtext('m__name', '')),
                    'visible': item.findtext('m__isVisible', 'true') == 'true',
                    'isDefault': item.findtext('m__isDefault', 'false') == 'true',
                }
                if kind == 'colour':
                    c = item.find('m__colour')
                    rgb = [self._safe_int(c.findtext(t) if c is not None else None, 0) for t in ('red', 'green', 'blue')]
                    e['hex'] = '#{:02x}{:02x}{:02x}'.format(*rgb)
                elif kind == 'shape':
                    e['shape'] = self._safe_int(item.findtext('m__shape'), 0)
                    e['filled'] = item.findtext('m__filled', 'true') == 'true'
                elif kind == 'size':
                    e['size'] = self._safe_int(item.findtext('m__size'), 4)
                where.append((kind, len(lists[kind])))
                lists[kind].append(e)
            attributes: Dict[str, Any] = {}
            for kind, entries in lists.items():
                if len(entries) < 2:
                    continue
                tag = self.CHECKPOINT_INDEX[kind]
                idx = []
                for r in rows:
                    g = self._safe_int(r.findtext(tag), 0)
                    k, local = where[g] if 0 <= g < len(where) else ('', -1)
                    idx.append(local if k == kind else 0)
                attributes[kind] = {
                    'title': unescape_interop_string((state.findtext(self.CHECKPOINT_TITLE[kind]) or '').strip()),
                    'entries': entries,
                    'rows': idx,
                }
            self.checkpoints.append({
                'name': unescape_interop_string(entry.findtext('m__name', '')) or f'Checkpoint {len(self.checkpoints) + 1}',
                'attributes': attributes,
            })

    def _attribute_list(self, kind: str) -> List[Dict[str, Any]]:
        return {
            'colour': self.color_attributes,
            'shape': self.shape_attributes,
            'size': self.size_attributes,
            'filter': self.filter_attributes,
        }[kind]

    def _add_attribute_columns(self):
        """Turn each row's attribute indexes into a text column of group names.

        Rows in the first (default) group get no value, so they fall to the
        default entry. Lists with only the default entry add nothing.
        """
        for kind, indices in self.row_attribute_indices.items():
            entries = self._attribute_list(kind)
            if len(entries) < 2 or len(indices) != len(self.df):
                continue
            names = [e['name'] for e in entries]
            values = [names[i] if 0 < i < len(names) else None for i in indices]
            base = self.ATTRIBUTE_COLUMN[kind]
            name, n = base, 2
            while name in self.df.columns:
                name, n = f'{base} {n}', n + 1
            self.df[name] = pd.Series(values, index=self.df.index, dtype=object)
            self.attribute_columns[kind] = name
            self.columns.append({'originalName': name, 'aliasName': name, 'type': 'Text', 'derived': False})

    def _lonlat_epsg(self) -> Optional[int]:
        """WGS84 when the map columns are longitude/latitude (no projection saved)."""
        east = self.special_columns.get('easting') or ''
        north = self.special_columns.get('northing') or ''
        if self.df is None or east not in self.df.columns or north not in self.df.columns:
            return None
        if re.search(r'lon', east, re.I) and re.search(r'lat', north, re.I):
            lon = pd.to_numeric(self.df[east], errors='coerce')
            lat = pd.to_numeric(self.df[north], errors='coerce')
            if lon.abs().max() <= 180 and lat.abs().max() <= 90:
                return 4326
        return None

    def _alias_to_name(self) -> Dict[str, str]:
        return {c['aliasName']: c['originalName'] for c in self.columns if c.get('aliasName')}

    def _build_result(self) -> Dict[str, Any]:
        """Build the result dictionary for the API response."""
        # Build column info in our format
        column_info = []
        aliases = self._alias_to_name()

        for i, col in enumerate(self.columns):
            col_name = col['originalName']

            # Skip if column not in dataframe
            if col_name not in self.df.columns:
                continue

            # Determine type
            interop_type = col['type'].lower()
            if interop_type == 'numeric':
                col_type = 'numeric'
                series = self.df[col_name].dropna()
                if len(series) > 0:
                    if pd.api.types.is_numeric_dtype(series):
                        # Already numeric — check if integer
                        try:
                            if (series == series.astype(int)).all():
                                col_type = 'integer'
                        except (ValueError, TypeError, OverflowError):
                            pass
                    else:
                        # dtype is object — metadata says Numeric but actual data may not be
                        coerced = pd.to_numeric(series, errors='coerce')
                        numeric_ratio = coerced.notna().sum() / len(series)
                        if numeric_ratio >= 0.8:
                            # Mostly numeric — coerce and update the dataframe column
                            self.df[col_name] = pd.to_numeric(self.df[col_name], errors='coerce')
                            non_null = coerced.dropna()
                            try:
                                if len(non_null) > 0 and (non_null == non_null.astype(int)).all():
                                    col_type = 'integer'
                            except (ValueError, TypeError, OverflowError):
                                pass
                        else:
                            # Mostly non-numeric — reclassify as text
                            col_type = 'text'
                            interop_type = 'text'
                            logger.warning(
                                "Column '%s' marked Numeric in metadata but only %.0f%% "
                                "values are numeric — reclassified as text",
                                col_name, numeric_ratio * 100
                            )
            else:
                col_type = 'text'

            # Determine role based on special column mappings — using the
            # CANONICAL dataset-role vocabulary from core/columns.py that the
            # frontend matches on. (Previously this emitted lowercase variants
            # like 'easting'/'from', so after a .gas import role-driven
            # features — maps finding East/North, logging merge needing
            # HoleID/From/To — silently failed.)
            role = None
            if col_name == self.special_columns.get('id'):
                role = 'ID'
            elif col_name == self.special_columns.get('group'):
                role = 'HoleID' if re.search(r'hole|sect', col_name, re.I) else 'Classification'
            elif col_name == self.special_columns.get('easting'):
                role = 'East'
            elif col_name == self.special_columns.get('northing'):
                role = 'North'
            elif col_name == self.special_columns.get('elevation'):
                role = 'Elevation'
            elif col_name.lower() in ['from', 'from_m', 'from_depth']:
                role = 'From'
            elif col_name.lower() in ['to', 'to_m', 'to_depth']:
                role = 'To'

            # Determine priority (for display ordering)
            priority = self._get_column_priority(col_name, role, interop_type)

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

        # Build preview (first 20 rows) — avoid materializing full dataset as dicts
        from app.core.parsing import clean_for_json
        preview = clean_for_json(self.df.head(20))

        return {
            'success': True,
            'rows': len(self.df),
            'columns': len(self.df.columns),
            'data': [],  # Data is streamed separately via /api/data/stream
            'preview': preview,
            'column_info': column_info,
            'interop_metadata': {
                'version': self.version,
                'special_columns': self.special_columns,
                'color_attributes': self.color_attributes,
                'shape_attributes': self.shape_attributes,
                'size_attributes': self.size_attributes,
                'filter_attributes': self.filter_attributes,
                'drillhole_options': self.metadata.get('drillhole'),
                # Attribute Manager state per tab: field column, list title, entries
                'attributes': {
                    kind: {
                        'column': col,
                        'title': self.attribute_titles.get(kind, ''),
                        'entries': self._attribute_list(kind),
                    }
                    for kind, col in self.attribute_columns.items()
                },
                'epsg': self._safe_int(self.special_columns.get('epsg'), 0) or self._lonlat_epsg(),
                'projection': self.special_columns.get('projection') or None,
                # Open plots (creator list XML) and saved checkpoints
                'workspace_xml': self.workspace_xml,
                'checkpoints': self.checkpoints,
                # Selections mapped from aliases to dataset column names
                'selection_history': [
                    [aliases.get(n, n) for n in sel] for sel in self.selection_history
                ],
            }
        }

    def _get_column_priority(self, name: str, role: str, interop_type: str) -> int:
        """
        Determine column priority for display ordering.
        Lower numbers appear first in dropdowns.
        """
        # ID columns first
        if role in ['ID', 'HoleID']:
            return 0

        # Location metadata
        if role == 'Classification':
            return 1
        if role in ['From', 'To']:
            return 2
        if role in ['East', 'North', 'Elevation']:
            return 3

        # Text columns (metadata) at lower priority
        if interop_type != 'numeric':
            return 8

        # Numeric data columns
        return 5
