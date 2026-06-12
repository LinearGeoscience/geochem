"""
All symbology/rendering logic for QGIS layers.
Consolidates the old style_manager.py and style_sync.py into one module.
"""

from qgis.PyQt.QtGui import QColor
from qgis.core import (
    QgsSymbol, QgsMarkerSymbol, QgsSimpleMarkerSymbolLayer,
    QgsSimpleMarkerSymbolLayerBase,
    QgsCategorizedSymbolRenderer, QgsRendererCategory,
    QgsGraduatedSymbolRenderer, QgsRendererRange,
    QgsRuleBasedRenderer,
    QgsGradientColorRamp, QgsGradientStop, QgsWkbTypes,
)

from ..support import logger

# Web app shape name -> QGIS marker shape
SHAPE_MAP = {
    "circle": QgsSimpleMarkerSymbolLayerBase.Circle,
    "square": QgsSimpleMarkerSymbolLayerBase.Square,
    "diamond": QgsSimpleMarkerSymbolLayerBase.Diamond,
    "cross": QgsSimpleMarkerSymbolLayerBase.Cross,
    "x": QgsSimpleMarkerSymbolLayerBase.Cross2,
    "triangle-up": QgsSimpleMarkerSymbolLayerBase.Triangle,
    "triangle-down": QgsSimpleMarkerSymbolLayerBase.Triangle,
    "triangle-left": QgsSimpleMarkerSymbolLayerBase.Triangle,
    "triangle-right": QgsSimpleMarkerSymbolLayerBase.Triangle,
    "pentagon": QgsSimpleMarkerSymbolLayerBase.Pentagon,
    "hexagon": QgsSimpleMarkerSymbolLayerBase.Hexagon,
    "star": QgsSimpleMarkerSymbolLayerBase.Star,
    "hourglass": QgsSimpleMarkerSymbolLayerBase.Star,
}

SHAPE_ROTATION = {
    "triangle-down": 180,
    "triangle-left": 270,
    "triangle-right": 90,
}

PIXEL_TO_MM = 1 / 3.78

# Default colors for classification styling
CLASSIFICATION_COLORS = {
    "default": [
        "#2ecc71", "#f39c12", "#e74c3c", "#9b59b6", "#95a5a6",
        "#1abc9c", "#3498db", "#e67e22", "#c0392b", "#8e44ad",
        "#16a085", "#2980b9", "#d35400", "#7f8c8d", "#27ae60",
    ]
}

# Grade highlighting colors
GRADE_COLORS = {
    "low": "#2ecc71",
    "medium": "#f1c40f",
    "high": "#e67e22",
    "very_high": "#e74c3c",
}

# Cluster visualization palette
CLUSTER_COLORS = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
    "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4",
]

# Color ramp definitions
COLOR_RAMPS = {
    "viridis": ["#440154", "#31688e", "#35b779", "#fde725"],
    "plasma": ["#0d0887", "#9c179e", "#ed7953", "#f0f921"],
    "inferno": ["#000004", "#57106e", "#bc3754", "#fcffa4"],
    "magma": ["#000004", "#51127c", "#b73779", "#fcfdbf"],
    "cividis": ["#002051", "#525a76", "#a69d75", "#fdea45"],
    "blues": ["#f7fbff", "#6baed6", "#08306b"],
    "reds": ["#fff5f0", "#fb6a4a", "#67000d"],
    "greens": ["#f7fcf5", "#74c476", "#00441b"],
    "rdylgn": ["#d73027", "#fee08b", "#1a9850"],
}


class SymbologyManager:
    """Manages all layer symbology operations."""

    def apply_single_symbol(self, layer, color="#3388ff", size=3.0,
                            shape="circle", opacity=1.0):
        """Apply a simple single-symbol renderer."""
        symbol = self._create_marker_symbol(color, shape, size, opacity)
        layer.renderer().setSymbol(symbol)
        layer.triggerRepaint()
        logger.log_info("Applied single symbol style", "symbology")

    def apply_categorical(self, layer, field, color_map=None,
                          shape_map=None, size_map=None, opacity=1.0):
        """
        Apply categorized renderer.
        color_map: {value: "#hex"}, shape_map: {value: "shape_name"},
        size_map: {value: float}
        """
        if not field:
            return

        color_map = color_map or {}
        shape_map = shape_map or {}
        size_map = size_map or {}

        # Get unique values
        field_idx = layer.fields().indexOf(field)
        if field_idx < 0:
            logger.log_warning(f"Field '{field}' not found", "symbology")
            return

        unique_values = sorted(set(
            feat[field] for feat in layer.getFeatures()
            if feat[field] is not None
        ), key=lambda v: str(v))

        categories = []
        default_colors = CLASSIFICATION_COLORS["default"]

        for i, value in enumerate(unique_values):
            color = color_map.get(str(value),
                                  default_colors[i % len(default_colors)])
            shape = shape_map.get(str(value), "circle")
            size = size_map.get(str(value), 3.0)

            symbol = self._create_marker_symbol(color, shape, size, opacity)
            cat = QgsRendererCategory(value, symbol, str(value))
            categories.append(cat)

        renderer = QgsCategorizedSymbolRenderer(field, categories)
        layer.setRenderer(renderer)
        layer.triggerRepaint()
        logger.log_info(
            f"Applied categorical style on '{field}' ({len(categories)} categories)",
            "symbology"
        )
        return "categorical"

    def apply_graduated(self, layer, field, num_classes=5,
                        color_ramp_name="viridis", opacity=1.0):
        """Apply graduated renderer with color ramp."""
        field_idx = layer.fields().indexOf(field)
        if field_idx < 0:
            logger.log_warning(f"Field '{field}' not found", "symbology")
            return

        # Get min/max values
        values = []
        for feat in layer.getFeatures():
            val = feat[field]
            if val is not None:
                try:
                    values.append(float(val))
                except (ValueError, TypeError):
                    pass

        if not values:
            return

        min_val = min(values)
        max_val = max(values)
        if min_val == max_val:
            max_val = min_val + 1

        # Create color ramp
        ramp_colors = COLOR_RAMPS.get(color_ramp_name,
                                      COLOR_RAMPS["viridis"])
        color_ramp = self._create_color_ramp(ramp_colors)

        # Create ranges
        step = (max_val - min_val) / num_classes
        ranges = []
        for i in range(num_classes):
            lower = min_val + i * step
            upper = min_val + (i + 1) * step
            frac = i / max(num_classes - 1, 1)
            color = color_ramp.color(frac)
            color.setAlphaF(opacity)

            symbol = QgsSymbol.defaultSymbol(QgsWkbTypes.PointGeometry).clone()
            symbol.setColor(color)
            symbol.setSize(3.0)

            label = f"{lower:.2f} - {upper:.2f}"
            r = QgsRendererRange(lower, upper, symbol, label)
            ranges.append(r)

        renderer = QgsGraduatedSymbolRenderer(field, ranges)
        layer.setRenderer(renderer)
        layer.triggerRepaint()
        logger.log_info(
            f"Applied graduated style on '{field}' ({num_classes} classes)",
            "symbology"
        )
        return "graduated"

    def apply_webapp_styles(self, layer, styles_config):
        """
        Apply full styling configuration from the GeoChem web app.
        styles_config has keys: color, shape, size, opacity
        """
        if not styles_config:
            return None

        color_cfg = styles_config.get("color", {})
        shape_cfg = styles_config.get("shape", {})
        size_cfg = styles_config.get("size", {})
        opacity = styles_config.get("opacity", 1.0)

        color_field = color_cfg.get("field")
        shape_field = shape_cfg.get("field")
        size_field = size_cfg.get("field")

        if not color_field and not shape_field and not size_field:
            self.apply_single_symbol(layer, opacity=opacity)
            return "single"

        # Build per-value maps
        color_map = {}
        if color_field and "values" in color_cfg:
            for entry in color_cfg["values"]:
                color_map[str(entry.get("value", ""))] = entry.get(
                    "color", "#3388ff"
                )

        shape_map = {}
        if shape_field and "values" in shape_cfg:
            for entry in shape_cfg["values"]:
                shape_map[str(entry.get("value", ""))] = entry.get(
                    "shape", "circle"
                )

        size_map = {}
        if size_field and "values" in size_cfg:
            for entry in size_cfg["values"]:
                size_map[str(entry.get("value", ""))] = entry.get("size", 3.0)

        # Determine primary classification field
        primary_field = color_field or shape_field or size_field

        if color_cfg.get("type") == "graduated" and color_field:
            return self.apply_graduated(
                layer, color_field,
                num_classes=color_cfg.get("classes", 5),
                color_ramp_name=color_cfg.get("ramp", "viridis"),
                opacity=opacity,
            )

        return self.apply_categorical(
            layer, primary_field,
            color_map=color_map,
            shape_map=shape_map,
            size_map=size_map,
            opacity=opacity,
        )

    def apply_classification_style(self, layer, column, custom_colors=None):
        """Apply classification-based categorical styling."""
        color_map = {}
        if custom_colors:
            for val, color in custom_colors.items():
                color_map[str(val)] = color
        return self.apply_categorical(layer, column, color_map=color_map)

    def highlight_high_grades(self, layer, column, threshold):
        """Rule-based styling that highlights values above threshold."""
        root_rule = QgsRuleBasedRenderer.Rule(None)

        # Below threshold
        symbol_low = self._create_marker_symbol("#95a5a6", "circle", 2.5, 1.0)
        rule_low = QgsRuleBasedRenderer.Rule(symbol_low)
        rule_low.setFilterExpression(f'"{column}" < {threshold}')
        rule_low.setLabel(f"< {threshold}")
        root_rule.appendChild(rule_low)

        # Above threshold
        symbol_high = self._create_marker_symbol("#e74c3c", "diamond", 4.0, 1.0)
        rule_high = QgsRuleBasedRenderer.Rule(symbol_high)
        rule_high.setFilterExpression(f'"{column}" >= {threshold}')
        rule_high.setLabel(f">= {threshold}")
        root_rule.appendChild(rule_high)

        renderer = QgsRuleBasedRenderer(root_rule)
        layer.setRenderer(renderer)
        layer.triggerRepaint()
        logger.log_info(
            f"Applied high-grade highlight on '{column}' (threshold={threshold})",
            "symbology"
        )

    def apply_multiple_thresholds(self, layer, column, thresholds, colors):
        """
        Rule-based styling with multiple threshold levels.
        thresholds: list of floats, sorted ascending
        colors: list of hex color strings (len = len(thresholds) + 1)
        """
        root_rule = QgsRuleBasedRenderer.Rule(None)

        # Below first threshold
        symbol = self._create_marker_symbol(colors[0], "circle", 2.5, 1.0)
        rule = QgsRuleBasedRenderer.Rule(symbol)
        rule.setFilterExpression(f'"{column}" < {thresholds[0]}')
        rule.setLabel(f"< {thresholds[0]}")
        root_rule.appendChild(rule)

        # Between thresholds
        for i in range(len(thresholds) - 1):
            symbol = self._create_marker_symbol(
                colors[i + 1], "circle", 3.0 + i * 0.5, 1.0
            )
            rule = QgsRuleBasedRenderer.Rule(symbol)
            rule.setFilterExpression(
                f'"{column}" >= {thresholds[i]} AND "{column}" < {thresholds[i + 1]}'
            )
            rule.setLabel(f"{thresholds[i]} - {thresholds[i + 1]}")
            root_rule.appendChild(rule)

        # Above last threshold
        symbol = self._create_marker_symbol(
            colors[-1], "diamond", 3.0 + len(thresholds) * 0.5, 1.0
        )
        rule = QgsRuleBasedRenderer.Rule(symbol)
        rule.setFilterExpression(f'"{column}" >= {thresholds[-1]}')
        rule.setLabel(f">= {thresholds[-1]}")
        root_rule.appendChild(rule)

        renderer = QgsRuleBasedRenderer(root_rule)
        layer.setRenderer(renderer)
        layer.triggerRepaint()

    def _create_marker_symbol(self, color, shape_name="circle",
                              size=3.0, opacity=1.0):
        """Create a QgsMarkerSymbol from parameters."""
        symbol = QgsSymbol.defaultSymbol(QgsWkbTypes.PointGeometry).clone()

        qcolor = QColor(color) if isinstance(color, str) else color
        qcolor.setAlphaF(opacity)

        qgis_shape = SHAPE_MAP.get(shape_name,
                                   QgsSimpleMarkerSymbolLayerBase.Circle)
        rotation = SHAPE_ROTATION.get(shape_name, 0)

        symbol.symbolLayer(0).setShape(qgis_shape)
        symbol.symbolLayer(0).setFillColor(qcolor)
        symbol.symbolLayer(0).setStrokeColor(qcolor.darker(120))
        symbol.setSize(size * PIXEL_TO_MM)
        if rotation:
            symbol.setAngle(rotation)

        return symbol

    def _create_color_ramp(self, colors):
        """Create a QgsGradientColorRamp from a list of hex colors."""
        if len(colors) < 2:
            colors = ["#000000", "#ffffff"]

        color1 = QColor(colors[0])
        color2 = QColor(colors[-1])

        stops = []
        if len(colors) > 2:
            for i, c in enumerate(colors[1:-1], 1):
                frac = i / (len(colors) - 1)
                stops.append(QgsGradientStop(frac, QColor(c)))

        return QgsGradientColorRamp(color1, color2, False, stops)
