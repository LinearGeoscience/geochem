"""
Style Synchronization Manager for GeoChem Pro QGIS Plugin
Applies web app styling to QGIS layers for consistent visualization
"""

from typing import Dict, Any, List, Optional, Tuple
from PyQt5.QtCore import QObject, pyqtSignal
from PyQt5.QtGui import QColor
from qgis.core import (
    QgsVectorLayer,
    QgsMarkerSymbol,
    QgsSimpleMarkerSymbolLayer,
    QgsSingleSymbolRenderer,
    QgsCategorizedSymbolRenderer,
    QgsGraduatedSymbolRenderer,
    QgsRendererCategory,
    QgsRendererRange,
    QgsSymbol,
    QgsMessageLog,
    Qgis
)


class StyleSyncManager(QObject):
    """
    Manages style synchronization between GeoChem Pro web app and QGIS.

    Converts web app attribute styling (color, shape, size, opacity)
    to equivalent QGIS symbology.
    """

    # Signals
    style_applied = pyqtSignal(str)  # style type applied
    style_error = pyqtSignal(str)    # error message

    # Web app shape to QGIS shape mapping
    # Web app uses Plotly-style names, QGIS uses QgsSimpleMarkerSymbolLayer shapes
    SHAPE_MAP = {
        'circle': QgsSimpleMarkerSymbolLayer.Circle,
        'square': QgsSimpleMarkerSymbolLayer.Square,
        'diamond': QgsSimpleMarkerSymbolLayer.Diamond,
        'cross': QgsSimpleMarkerSymbolLayer.Cross,
        'x': QgsSimpleMarkerSymbolLayer.Cross2,
        'triangle-up': QgsSimpleMarkerSymbolLayer.Triangle,
        'triangle-down': QgsSimpleMarkerSymbolLayer.Triangle,  # Rotated 180
        'triangle-left': QgsSimpleMarkerSymbolLayer.Triangle,  # Rotated 270
        'triangle-right': QgsSimpleMarkerSymbolLayer.Triangle,  # Rotated 90
        'pentagon': QgsSimpleMarkerSymbolLayer.Pentagon,
        'hexagon': QgsSimpleMarkerSymbolLayer.Hexagon,
        'star': QgsSimpleMarkerSymbolLayer.Star,
        'hourglass': QgsSimpleMarkerSymbolLayer.Star,  # Closest match
    }

    # Shape rotation for triangles
    SHAPE_ROTATION = {
        'triangle-down': 180,
        'triangle-left': 270,
        'triangle-right': 90,
    }

    # Pixel to mm conversion (at 96 DPI: 1mm ≈ 3.78 pixels)
    PIXEL_TO_MM = 1 / 3.78

    def __init__(self, connection_manager, parent=None):
        super().__init__(parent)
        self.connection = connection_manager
        self._layer: Optional[QgsVectorLayer] = None

    def set_layer(self, layer: QgsVectorLayer):
        """Set the layer to apply styles to"""
        self._layer = layer

    def fetch_and_apply_styles(self) -> bool:
        """
        Fetch styles from GeoChem Pro and apply to layer.

        Returns:
            True if styles were applied successfully
        """
        if not self._layer:
            self.style_error.emit("No layer set")
            return False

        try:
            styles = self.connection.fetch_styles()
            if not styles:
                self.style_error.emit("No styles available from web app")
                return False

            return self.apply_styles(styles)

        except Exception as e:
            self.style_error.emit(f"Failed to fetch styles: {str(e)}")
            return False

    def apply_styles(self, styles: Dict[str, Any]) -> bool:
        """
        Apply styles configuration to the layer.

        Args:
            styles: Style configuration from web app attributeStore

        Returns:
            True if styles were applied successfully
        """
        if not self._layer:
            self.style_error.emit("No layer set")
            return False

        try:
            color_config = styles.get('color', {})
            shape_config = styles.get('shape', {})
            size_config = styles.get('size', {})
            global_opacity = styles.get('globalOpacity', 1.0)
            emphasis = styles.get('emphasis', {})

            # Determine the primary styling field (color takes precedence)
            color_field = color_config.get('field')
            color_entries = color_config.get('entries', [])

            if not color_field or not color_entries:
                # No color field set - apply single symbol style
                self._apply_single_symbol_style(
                    color_entries, shape_config.get('entries', []),
                    size_config.get('entries', []), global_opacity
                )
                self.style_applied.emit('single')
                return True

            # Check if categorical or graduated
            color_method = color_config.get('method', 'categorical')
            entry_types = [e.get('type') for e in color_entries if not e.get('isDefault')]

            if 'range' in entry_types:
                # Graduated/range styling
                self._apply_graduated_style(
                    color_field, color_entries, shape_config,
                    size_config, global_opacity
                )
                self.style_applied.emit('graduated')
            else:
                # Categorical styling
                self._apply_categorical_style(
                    color_field, color_entries, shape_config,
                    size_config, global_opacity
                )
                self.style_applied.emit('categorical')

            return True

        except Exception as e:
            error_msg = f"Failed to apply styles: {str(e)}"
            self.style_error.emit(error_msg)
            QgsMessageLog.logMessage(error_msg, "GeoChem Pro", Qgis.Warning)
            return False

    def _apply_single_symbol_style(
        self,
        color_entries: List[Dict],
        shape_entries: List[Dict],
        size_entries: List[Dict],
        global_opacity: float
    ):
        """Apply single symbol style using default entries"""
        # Get default values
        default_color = '#1f77b4'
        default_shape = 'circle'
        default_size = 8

        for entry in color_entries:
            if entry.get('isDefault'):
                default_color = entry.get('color', default_color)
                break

        for entry in shape_entries:
            if entry.get('isDefault'):
                default_shape = entry.get('shape', default_shape)
                break

        for entry in size_entries:
            if entry.get('isDefault'):
                default_size = entry.get('size', default_size)
                break

        symbol = self._create_marker_symbol(
            default_color, default_shape, default_size, global_opacity
        )

        renderer = QgsSingleSymbolRenderer(symbol)
        self._layer.setRenderer(renderer)
        self._layer.triggerRepaint()

        QgsMessageLog.logMessage(
            f"Applied single symbol style",
            "GeoChem Pro",
            Qgis.Info
        )

    def _apply_categorical_style(
        self,
        field: str,
        color_entries: List[Dict],
        shape_config: Dict,
        size_config: Dict,
        global_opacity: float
    ):
        """Apply categorical styling based on color entries"""
        categories = []
        shape_entries = shape_config.get('entries', [])
        size_entries = size_config.get('entries', [])

        # Build lookup for shape and size by category value
        shape_by_value = self._build_value_lookup(shape_entries, 'shape', 'circle')
        size_by_value = self._build_value_lookup(size_entries, 'size', 8)

        for entry in color_entries:
            if entry.get('isDefault'):
                continue

            entry_type = entry.get('type')
            if entry_type != 'category':
                continue

            value = entry.get('categoryValue', '')
            color = entry.get('color', '#808080')
            name = entry.get('name', str(value))
            visible = entry.get('visible', True)

            # Get shape and size for this value
            shape = shape_by_value.get(value, 'circle')
            size = size_by_value.get(value, 8)

            symbol = self._create_marker_symbol(color, shape, size, global_opacity)
            category = QgsRendererCategory(value, symbol, name, visible)
            categories.append(category)

        # Add default category for unmatched values
        default_entry = next((e for e in color_entries if e.get('isDefault')), None)
        if default_entry:
            default_color = default_entry.get('color', '#808080')
            default_shape = shape_by_value.get('__default__', 'circle')
            default_size = size_by_value.get('__default__', 8)

            symbol = self._create_marker_symbol(
                default_color, default_shape, default_size, global_opacity
            )
            # Empty string matches unclassified/NULL values
            categories.append(QgsRendererCategory('', symbol, 'Other', True))

        if categories:
            renderer = QgsCategorizedSymbolRenderer(field, categories)
            self._layer.setRenderer(renderer)
            self._layer.triggerRepaint()

            QgsMessageLog.logMessage(
                f"Applied categorical style on '{field}' with {len(categories)} categories",
                "GeoChem Pro",
                Qgis.Info
            )

    def _apply_graduated_style(
        self,
        field: str,
        color_entries: List[Dict],
        shape_config: Dict,
        size_config: Dict,
        global_opacity: float
    ):
        """Apply graduated/range styling based on color entries"""
        ranges = []
        shape_entries = shape_config.get('entries', [])
        size_entries = size_config.get('entries', [])

        # Get default shape and size
        default_shape = 'circle'
        default_size = 8
        for entry in shape_entries:
            if entry.get('isDefault'):
                default_shape = entry.get('shape', default_shape)
                break
        for entry in size_entries:
            if entry.get('isDefault'):
                default_size = entry.get('size', default_size)
                break

        for entry in color_entries:
            if entry.get('isDefault'):
                continue

            entry_type = entry.get('type')
            if entry_type != 'range':
                continue

            min_val = entry.get('min', 0)
            max_val = entry.get('max', 0)
            color = entry.get('color', '#808080')
            name = entry.get('name', f'{min_val} - {max_val}')
            visible = entry.get('visible', True)

            # Use entry's shape/size if available, otherwise default
            shape = entry.get('shape', default_shape)
            size = entry.get('size', default_size)

            symbol = self._create_marker_symbol(color, shape, size, global_opacity)
            range_obj = QgsRendererRange(min_val, max_val, symbol, name, visible)
            ranges.append(range_obj)

        if ranges:
            renderer = QgsGraduatedSymbolRenderer(field, ranges)
            self._layer.setRenderer(renderer)
            self._layer.triggerRepaint()

            QgsMessageLog.logMessage(
                f"Applied graduated style on '{field}' with {len(ranges)} ranges",
                "GeoChem Pro",
                Qgis.Info
            )

    def _create_marker_symbol(
        self,
        color: str,
        shape: str,
        size: float,
        opacity: float
    ) -> QgsMarkerSymbol:
        """
        Create a QGIS marker symbol matching web app style.

        Args:
            color: Hex color string (e.g., '#1f77b4')
            shape: Shape name (e.g., 'circle', 'square')
            size: Size in pixels
            opacity: Opacity 0-1

        Returns:
            Configured QgsMarkerSymbol
        """
        # Get QGIS shape enum value
        qgis_shape = self.SHAPE_MAP.get(shape, QgsSimpleMarkerSymbolLayer.Circle)

        # Convert hex color to QColor
        qcolor = QColor(color)

        # Create symbol with simple properties
        symbol = QgsMarkerSymbol.createSimple({
            'name': self._shape_enum_to_name(qgis_shape),
            'color': color,
            'outline_color': '#000000',
            'outline_width': '0.2',
        })

        # Set size (convert pixels to mm)
        size_mm = size * self.PIXEL_TO_MM
        symbol.setSize(size_mm)

        # Set opacity
        symbol.setOpacity(opacity)

        # Apply rotation for triangle variants
        if shape in self.SHAPE_ROTATION:
            rotation = self.SHAPE_ROTATION[shape]
            symbol_layer = symbol.symbolLayer(0)
            if isinstance(symbol_layer, QgsSimpleMarkerSymbolLayer):
                symbol_layer.setAngle(rotation)

        return symbol

    def _shape_enum_to_name(self, shape_enum: int) -> str:
        """Convert QgsSimpleMarkerSymbolLayer enum to name string"""
        names = {
            QgsSimpleMarkerSymbolLayer.Circle: 'circle',
            QgsSimpleMarkerSymbolLayer.Square: 'square',
            QgsSimpleMarkerSymbolLayer.Diamond: 'diamond',
            QgsSimpleMarkerSymbolLayer.Cross: 'cross',
            QgsSimpleMarkerSymbolLayer.Cross2: 'cross2',
            QgsSimpleMarkerSymbolLayer.Triangle: 'triangle',
            QgsSimpleMarkerSymbolLayer.Pentagon: 'pentagon',
            QgsSimpleMarkerSymbolLayer.Hexagon: 'hexagon',
            QgsSimpleMarkerSymbolLayer.Star: 'star',
        }
        return names.get(shape_enum, 'circle')

    def _build_value_lookup(
        self,
        entries: List[Dict],
        attr: str,
        default_value: Any
    ) -> Dict[str, Any]:
        """
        Build lookup dict from category value to attribute value.

        Args:
            entries: List of entry dicts
            attr: Attribute name to extract ('shape', 'size')
            default_value: Default value if not found

        Returns:
            Dict mapping category values to attribute values
        """
        lookup = {'__default__': default_value}

        for entry in entries:
            if entry.get('isDefault'):
                lookup['__default__'] = entry.get(attr, default_value)
                continue

            value = entry.get('categoryValue', '')
            if value:
                lookup[value] = entry.get(attr, default_value)

        return lookup

    def get_style_summary(self, styles: Dict[str, Any]) -> str:
        """
        Get a human-readable summary of the styles.

        Args:
            styles: Style configuration from web app

        Returns:
            Summary string
        """
        color_field = styles.get('color', {}).get('field', 'None')
        shape_field = styles.get('shape', {}).get('field', 'None')
        size_field = styles.get('size', {}).get('field', 'None')
        opacity = styles.get('globalOpacity', 1.0)

        color_entries = len(styles.get('color', {}).get('entries', []))

        return (
            f"Color: {color_field} ({color_entries} entries)\n"
            f"Shape: {shape_field}\n"
            f"Size: {size_field}\n"
            f"Opacity: {opacity:.0%}"
        )
