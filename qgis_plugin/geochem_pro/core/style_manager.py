"""
Style Manager for GeoChem QGIS Plugin
Handles layer styling based on classifications and values
"""

from typing import Dict, List, Optional, Tuple, Any
from PyQt5.QtGui import QColor
from PyQt5.QtCore import QVariant
from qgis.core import (
    QgsVectorLayer,
    QgsCategorizedSymbolRenderer,
    QgsRendererCategory,
    QgsMarkerSymbol,
    QgsGraduatedSymbolRenderer,
    QgsGradientColorRamp,
    QgsRendererRange,
    QgsClassificationQuantile,
    QgsClassificationJenks,
    QgsClassificationEqualInterval,
    QgsClassificationStandardDeviation,
    QgsClassificationPrettyBreaks,
    QgsRuleBasedRenderer,
    QgsSymbol,
    QgsSingleSymbolRenderer,
    QgsMessageLog,
    Qgis
)


class GeochemStyleManager:
    """
    Manages layer styling for geochemical data visualization.

    Supports:
    - Categorical styling for classifications
    - Graduated styling for numeric values
    - Cluster visualization
    - High-grade highlighting
    - Custom color schemes
    """

    # Default color schemes matching GeoChem
    CLASSIFICATION_COLORS = {
        'background': '#10b981',      # Green
        'threshold': '#f59e0b',       # Amber
        'anomalous': '#ef4444',       # Red
        'high-grade': '#8b5cf6',      # Purple
        'Unclassified': '#9ca3af',    # Gray
        'Unknown': '#9ca3af',
        'None': '#9ca3af',
    }

    GRADE_COLORS = {
        'low': '#22c55e',
        'medium': '#eab308',
        'high': '#f97316',
        'very_high': '#dc2626',
    }

    CLUSTER_COLORS = [
        '#3b82f6',  # Blue
        '#ef4444',  # Red
        '#10b981',  # Green
        '#f59e0b',  # Amber
        '#8b5cf6',  # Purple
        '#ec4899',  # Pink
        '#14b8a6',  # Teal
        '#f97316',  # Orange
        '#6366f1',  # Indigo
        '#84cc16',  # Lime
    ]

    # Color ramp definitions
    COLOR_RAMPS = {
        'viridis': [
            (0.0, '#440154'),
            (0.25, '#3b528b'),
            (0.5, '#21918c'),
            (0.75, '#5ec962'),
            (1.0, '#fde725')
        ],
        'plasma': [
            (0.0, '#0d0887'),
            (0.25, '#7e03a8'),
            (0.5, '#cc4778'),
            (0.75, '#f89540'),
            (1.0, '#f0f921')
        ],
        'inferno': [
            (0.0, '#000004'),
            (0.25, '#57106e'),
            (0.5, '#bc3754'),
            (0.75, '#f98e09'),
            (1.0, '#fcffa4')
        ],
        'magma': [
            (0.0, '#000004'),
            (0.25, '#51127c'),
            (0.5, '#b73779'),
            (0.75, '#fb8861'),
            (1.0, '#fcfdbf')
        ],
        'cividis': [
            (0.0, '#002051'),
            (0.25, '#3d4f7c'),
            (0.5, '#7d7f7f'),
            (0.75, '#b9a64b'),
            (1.0, '#fdea45')
        ],
        'blues': [
            (0.0, '#f7fbff'),
            (0.25, '#c6dbef'),
            (0.5, '#6baed6'),
            (0.75, '#2171b5'),
            (1.0, '#08306b')
        ],
        'reds': [
            (0.0, '#fff5f0'),
            (0.25, '#fcbba1'),
            (0.5, '#fb6a4a'),
            (0.75, '#cb181d'),
            (1.0, '#67000d')
        ],
        'greens': [
            (0.0, '#f7fcf5'),
            (0.25, '#c7e9c0'),
            (0.5, '#74c476'),
            (0.75, '#238b45'),
            (1.0, '#00441b')
        ],
        'rdylgn': [
            (0.0, '#a50026'),
            (0.25, '#f46d43'),
            (0.5, '#ffffbf'),
            (0.75, '#66bd63'),
            (1.0, '#006837')
        ],
    }

    def __init__(self, layer: QgsVectorLayer):
        """
        Initialize style manager.

        Args:
            layer: QgsVectorLayer to manage styling for
        """
        self.layer = layer
        self._current_style_type: Optional[str] = None
        self._current_column: Optional[str] = None

    def apply_single_symbol(
        self,
        color: str = '#3b82f6',
        size: float = 3.0,
        shape: str = 'circle',
        outline_color: str = '#ffffff',
        outline_width: float = 0.5
    ):
        """
        Apply simple single symbol style.

        Args:
            color: Fill color (hex)
            size: Symbol size in mm
            shape: Symbol shape name
            outline_color: Outline color (hex)
            outline_width: Outline width in mm
        """
        symbol = self._create_marker_symbol(
            color, size, shape, outline_color, outline_width
        )
        renderer = QgsSingleSymbolRenderer(symbol)
        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'single'
        self._current_column = None

    def apply_classification_style(
        self,
        column: str,
        custom_colors: Optional[Dict[str, str]] = None,
        size: float = 3.0,
        shape: str = 'circle'
    ):
        """
        Apply categorical styling based on classification column.

        Args:
            column: Column name to style by
            custom_colors: Optional dict mapping values to colors (hex)
            size: Symbol size in mm
            shape: Symbol shape name
        """
        # Merge default and custom colors
        colors = {**self.CLASSIFICATION_COLORS}
        if custom_colors:
            colors.update(custom_colors)

        # Get unique values from layer
        field_idx = self.layer.fields().indexFromName(column)
        if field_idx < 0:
            QgsMessageLog.logMessage(
                f"Column '{column}' not found in layer",
                "GeoChem",
                Qgis.Warning
            )
            return

        unique_values = sorted(
            [str(v) for v in self.layer.uniqueValues(field_idx) if v is not None],
            key=lambda x: x.lower()
        )

        # Create categories
        categories = []
        for value in unique_values:
            color = colors.get(value, colors.get(value.lower(), '#9ca3af'))
            symbol = self._create_marker_symbol(color, size, shape)
            category = QgsRendererCategory(value, symbol, value)
            categories.append(category)

        # Add category for NULL values
        null_symbol = self._create_marker_symbol('#d1d5db', size * 0.8, shape)
        null_category = QgsRendererCategory(None, null_symbol, 'No Data')
        categories.append(null_category)

        # Apply renderer
        renderer = QgsCategorizedSymbolRenderer(column, categories)
        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'categorical'
        self._current_column = column

        QgsMessageLog.logMessage(
            f"Applied classification style to '{column}' ({len(unique_values)} classes)",
            "GeoChem",
            Qgis.Info
        )

    def apply_graduated_style(
        self,
        column: str,
        num_classes: int = 5,
        method: str = 'jenks',
        color_ramp: str = 'viridis',
        size: float = 3.0,
        shape: str = 'circle'
    ):
        """
        Apply graduated styling based on numeric column.

        Args:
            column: Column name to style by
            num_classes: Number of classes
            method: Classification method ('jenks', 'quantile', 'equal', 'stddev', 'pretty')
            color_ramp: Color ramp name
            size: Symbol size in mm
            shape: Symbol shape name
        """
        # Verify column exists and is numeric
        field_idx = self.layer.fields().indexFromName(column)
        if field_idx < 0:
            QgsMessageLog.logMessage(
                f"Column '{column}' not found",
                "GeoChem",
                Qgis.Warning
            )
            return

        field = self.layer.fields().field(field_idx)
        if field.type() not in [QVariant.Double, QVariant.Int, QVariant.LongLong]:
            QgsMessageLog.logMessage(
                f"Column '{column}' is not numeric",
                "GeoChem",
                Qgis.Warning
            )
            return

        # Create base symbol
        symbol = self._create_marker_symbol('#3b82f6', size, shape)

        # Create renderer
        renderer = QgsGraduatedSymbolRenderer()
        renderer.setClassAttribute(column)
        renderer.setSourceSymbol(symbol)

        # Set classification method
        if method == 'jenks':
            classification = QgsClassificationJenks()
        elif method == 'quantile':
            classification = QgsClassificationQuantile()
        elif method == 'stddev':
            classification = QgsClassificationStandardDeviation()
        elif method == 'pretty':
            classification = QgsClassificationPrettyBreaks()
        else:  # equal interval
            classification = QgsClassificationEqualInterval()

        renderer.setClassificationMethod(classification)

        # Set color ramp
        ramp = self._create_color_ramp(color_ramp)
        renderer.setSourceColorRamp(ramp)

        # Classify
        renderer.updateClasses(self.layer, num_classes)

        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'graduated'
        self._current_column = column

        QgsMessageLog.logMessage(
            f"Applied graduated style to '{column}' ({num_classes} classes, {method})",
            "GeoChem",
            Qgis.Info
        )

    def apply_cluster_style(
        self,
        column: str,
        custom_colors: Optional[List[str]] = None,
        size: float = 3.0,
        shape: str = 'circle'
    ):
        """
        Apply styling for cluster assignments.

        Args:
            column: Cluster assignment column name
            custom_colors: Optional list of colors for clusters
            size: Symbol size in mm
            shape: Symbol shape name
        """
        colors = custom_colors or self.CLUSTER_COLORS

        # Get unique cluster IDs
        field_idx = self.layer.fields().indexFromName(column)
        if field_idx < 0:
            QgsMessageLog.logMessage(
                f"Column '{column}' not found",
                "GeoChem",
                Qgis.Warning
            )
            return

        unique_values = sorted([
            v for v in self.layer.uniqueValues(field_idx)
            if v is not None
        ])

        # Create categories
        categories = []
        for i, cluster_id in enumerate(unique_values):
            color = colors[i % len(colors)]
            symbol = self._create_marker_symbol(color, size, shape)

            # Handle both int and string cluster IDs
            if isinstance(cluster_id, (int, float)):
                label = f"Cluster {int(cluster_id)}"
            else:
                label = str(cluster_id)

            category = QgsRendererCategory(cluster_id, symbol, label)
            categories.append(category)

        # NULL category
        null_symbol = self._create_marker_symbol('#d1d5db', size * 0.8, shape)
        null_category = QgsRendererCategory(None, null_symbol, 'Unassigned')
        categories.append(null_category)

        renderer = QgsCategorizedSymbolRenderer(column, categories)
        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'cluster'
        self._current_column = column

        QgsMessageLog.logMessage(
            f"Applied cluster style to '{column}' ({len(unique_values)} clusters)",
            "GeoChem",
            Qgis.Info
        )

    def highlight_high_grades(
        self,
        column: str,
        threshold: float,
        highlight_color: str = '#dc2626',
        highlight_size: float = 5.0,
        highlight_shape: str = 'star',
        normal_color: str = '#3b82f6',
        normal_size: float = 3.0,
        normal_shape: str = 'circle'
    ):
        """
        Create rule-based styling to highlight high grades.

        Args:
            column: Numeric column to threshold
            threshold: Values >= this are highlighted
            highlight_color: Color for high values
            highlight_size: Symbol size for high values
            highlight_shape: Symbol shape for high values
            normal_color: Color for normal values
            normal_size: Symbol size for normal values
            normal_shape: Symbol shape for normal values
        """
        # Verify column exists
        field_idx = self.layer.fields().indexFromName(column)
        if field_idx < 0:
            QgsMessageLog.logMessage(
                f"Column '{column}' not found",
                "GeoChem",
                Qgis.Warning
            )
            return

        # Create symbols
        symbol_high = self._create_marker_symbol(
            highlight_color, highlight_size, highlight_shape
        )
        symbol_normal = self._create_marker_symbol(
            normal_color, normal_size, normal_shape
        )
        symbol_null = self._create_marker_symbol(
            '#d1d5db', normal_size * 0.8, normal_shape
        )

        # Create root rule
        root_rule = QgsRuleBasedRenderer.Rule(None)

        # High grade rule
        high_rule = QgsRuleBasedRenderer.Rule(symbol_high)
        high_rule.setFilterExpression(f'"{column}" >= {threshold}')
        high_rule.setLabel(f"High Grade (>= {threshold})")
        root_rule.appendChild(high_rule)

        # Normal rule
        normal_rule = QgsRuleBasedRenderer.Rule(symbol_normal)
        normal_rule.setFilterExpression(f'"{column}" < {threshold} AND "{column}" IS NOT NULL')
        normal_rule.setLabel(f"Normal (< {threshold})")
        root_rule.appendChild(normal_rule)

        # NULL rule
        null_rule = QgsRuleBasedRenderer.Rule(symbol_null)
        null_rule.setFilterExpression(f'"{column}" IS NULL')
        null_rule.setLabel("No Data")
        root_rule.appendChild(null_rule)

        renderer = QgsRuleBasedRenderer(root_rule)
        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'high_grade'
        self._current_column = column

        QgsMessageLog.logMessage(
            f"Applied high-grade highlighting to '{column}' (threshold: {threshold})",
            "GeoChem",
            Qgis.Info
        )

    def apply_multiple_thresholds(
        self,
        column: str,
        thresholds: List[Tuple[float, str, str]],
        default_color: str = '#3b82f6',
        size: float = 3.0,
        shape: str = 'circle'
    ):
        """
        Apply rule-based styling with multiple thresholds.

        Args:
            column: Column to threshold
            thresholds: List of (value, label, color) tuples, sorted ascending
            default_color: Color for values below all thresholds
            size: Base symbol size
            shape: Symbol shape
        """
        field_idx = self.layer.fields().indexFromName(column)
        if field_idx < 0:
            return

        root_rule = QgsRuleBasedRenderer.Rule(None)

        # Add rules from highest to lowest threshold
        prev_threshold = None
        for threshold, label, color in sorted(thresholds, key=lambda x: x[0], reverse=True):
            symbol = self._create_marker_symbol(color, size, shape)
            rule = QgsRuleBasedRenderer.Rule(symbol)

            if prev_threshold is not None:
                rule.setFilterExpression(
                    f'"{column}" >= {threshold} AND "{column}" < {prev_threshold}'
                )
            else:
                rule.setFilterExpression(f'"{column}" >= {threshold}')

            rule.setLabel(label)
            root_rule.appendChild(rule)
            prev_threshold = threshold

        # Default rule for values below lowest threshold
        default_symbol = self._create_marker_symbol(default_color, size, shape)
        default_rule = QgsRuleBasedRenderer.Rule(default_symbol)
        if prev_threshold is not None:
            default_rule.setFilterExpression(
                f'"{column}" < {prev_threshold} AND "{column}" IS NOT NULL'
            )
        default_rule.setLabel("Normal")
        root_rule.appendChild(default_rule)

        # NULL rule
        null_symbol = self._create_marker_symbol('#d1d5db', size * 0.8, shape)
        null_rule = QgsRuleBasedRenderer.Rule(null_symbol)
        null_rule.setFilterExpression(f'"{column}" IS NULL')
        null_rule.setLabel("No Data")
        root_rule.appendChild(null_rule)

        renderer = QgsRuleBasedRenderer(root_rule)
        self.layer.setRenderer(renderer)
        self.layer.triggerRepaint()

        self._current_style_type = 'multi_threshold'
        self._current_column = column

    def get_current_style_info(self) -> Dict[str, Any]:
        """Get information about current style"""
        return {
            'type': self._current_style_type,
            'column': self._current_column,
            'renderer_type': type(self.layer.renderer()).__name__ if self.layer.renderer() else None
        }

    def get_available_color_ramps(self) -> List[str]:
        """Get list of available color ramp names"""
        return list(self.COLOR_RAMPS.keys())

    # =========================================================================
    # Private Methods
    # =========================================================================

    def _create_marker_symbol(
        self,
        color: str,
        size: float = 3.0,
        shape: str = 'circle',
        outline_color: str = '#ffffff',
        outline_width: float = 0.5
    ) -> QgsMarkerSymbol:
        """Create a marker symbol with the specified properties"""
        symbol = QgsMarkerSymbol.createSimple({
            'name': shape,
            'color': color,
            'outline_color': outline_color,
            'outline_width': str(outline_width),
            'size': str(size)
        })
        return symbol

    def _create_color_ramp(self, name: str) -> QgsGradientColorRamp:
        """Create a color ramp from predefined definitions"""
        stops = self.COLOR_RAMPS.get(name, self.COLOR_RAMPS['viridis'])

        color1 = QColor(stops[0][1])
        color2 = QColor(stops[-1][1])

        ramp = QgsGradientColorRamp(color1, color2)

        # Add intermediate stops
        if len(stops) > 2:
            gradient_stops = []
            for pos, hex_color in stops[1:-1]:
                from qgis.core import QgsGradientStop
                gradient_stops.append(QgsGradientStop(pos, QColor(hex_color)))
            ramp.setStops(gradient_stops)

        return ramp
