"""
Pathfinder element layer creation with Scott Halley anomaly thresholds.
Adapted from the existing pathfinder_sync.py.
"""

from qgis.PyQt.QtCore import QVariant, Qt
from qgis.core import (
    QgsVectorLayer, QgsFeature, QgsField, QgsFields,
    QgsGeometry, QgsPointXY, QgsPoint,
    QgsProject, QgsLayerTreeGroup,
    QgsRuleBasedRenderer, QgsSymbol, QgsWkbTypes,
)
from qgis.PyQt.QtGui import QColor

from ..support import logger, config
from ..data.geochem_data import GeochemData

# Scott Halley anomaly thresholds (ppm)
ANOMALY_THRESHOLDS = {
    "Mo": {"background": 1, "x2": 2, "x3": 3, "x5": 5},
    "W": {"background": 1, "x2": 3, "x3": 6, "x5": 10},
    "Sn": {"background": 1.5, "x2": 2.5, "x3": 5, "x5": 8},
    "Bi": {"background": 0.1, "x2": 0.2, "x3": 0.5, "x5": 1},
    "Te": {"background": 0.1, "x2": 0.2, "x3": 0.5, "x5": 1},
    "As": {"background": 10, "x2": 20, "x3": 50, "x5": 100},
    "Sb": {"background": 1, "x2": 2, "x3": 3, "x5": 5},
    "Ag": {"background": 0.05, "x2": 0.1, "x3": 0.2, "x5": 0.5},
    "Pb": {"background": 15, "x2": 30, "x3": 60, "x5": 100},
    "Zn": {"background": 100, "x2": 200, "x3": 300, "x5": 500},
    "Cu": {"background": 60, "x2": 100, "x3": 200, "x5": 300},
    "In": {"background": 0.05, "x2": 0.1, "x3": 0.2, "x5": 0.3},
    "Cd": {"background": 0.1, "x2": 0.2, "x3": 0.5, "x5": 1},
    "Li": {"background": 15, "x2": 25, "x3": 40, "x5": 50},
    "Cs": {"background": 1.5, "x2": 4, "x3": 6, "x5": 10},
    "Tl": {"background": 0.5, "x2": 1, "x3": 2, "x5": 4},
}

ANOMALY_COLORS = {
    "background": "#3288bd",
    "2x": "#66c2a5",
    "3x": "#abdda4",
    "5x": "#fdae61",
    "10x": "#d53e4f",
}

GROUP_NAME = "GeoChem Pathfinders"


class PathfinderManager:
    """Manages pathfinder element layers."""

    def __init__(self):
        self._layer_ids = []

    def create_layers(self, data: GeochemData, elements=None):
        """
        Create pathfinder layers for specified elements.
        Returns count of layers created.
        """
        if not data.has_coordinates():
            logger.log_error("No coordinates for pathfinder layers", "pathfinder")
            return 0

        # Remove existing layers first
        self.remove_all_layers()

        # Determine which elements to create
        available_columns = {c.name.lower(): c.name for c in data.columns}
        if elements is None:
            elements = list(ANOMALY_THRESHOLDS.keys())

        # Create layer group
        root = QgsProject.instance().layerTreeRoot()
        group = root.insertGroup(0, GROUP_NAME)

        created = 0
        for element in elements:
            # Find matching column (case-insensitive)
            col_name = None
            el_lower = element.lower()
            for key, name in available_columns.items():
                if key == el_lower or key.startswith(el_lower + "_"):
                    col_name = name
                    break

            if not col_name:
                continue

            thresholds = ANOMALY_THRESHOLDS.get(element)
            if not thresholds:
                continue

            layer = self._create_element_layer(data, element, col_name, thresholds)
            if layer:
                QgsProject.instance().addMapLayer(layer, False)
                group.addLayer(layer)
                self._layer_ids.append(layer.id())
                created += 1

        logger.log_info(
            f"Created {created} pathfinder layers", "pathfinder"
        )
        return created

    def remove_all_layers(self):
        """Remove all pathfinder layers and their group."""
        # Remove layers
        for layer_id in self._layer_ids:
            try:
                QgsProject.instance().removeMapLayers([layer_id])
            except Exception:
                pass
        self._layer_ids.clear()

        # Remove group
        root = QgsProject.instance().layerTreeRoot()
        group = root.findGroup(GROUP_NAME)
        if group:
            root.removeChildNode(group)

    def _create_element_layer(self, data, element, col_name, thresholds):
        """Create a single pathfinder element layer."""
        crs = data.crs
        if crs and not crs.startswith("EPSG:"):
            crs = f"EPSG:{crs}"
        layer_uri = f"Point?crs={crs}" if crs else "Point"

        layer_name = f"{element} - Pathfinder"
        layer = QgsVectorLayer(layer_uri, layer_name, "memory")

        # Build fields: element value + index
        fields = QgsFields()
        fields.append(QgsField(col_name, QVariant.Double))
        fields.append(QgsField(config.INDEX_FIELD, QVariant.Int))

        provider = layer.dataProvider()
        provider.addAttributes(fields)
        layer.updateFields()

        # Add features
        layer.startEditing()
        for row_idx, row in enumerate(data.rows):
            val = row.get(col_name)
            if val is None:
                continue
            try:
                val = float(val)
            except (ValueError, TypeError):
                continue

            ftr = QgsFeature(fields)
            ftr.setAttributes([val, row_idx])

            # Geometry
            try:
                x = float(row.get(data.x_field))
                y = float(row.get(data.y_field))
            except (TypeError, ValueError):
                continue

            if data.has_3d():
                try:
                    z = float(row.get(data.z_field))
                    ftr.setGeometry(QgsGeometry(QgsPoint(x, y, z)))
                except (TypeError, ValueError):
                    ftr.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))
            else:
                ftr.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))

            provider.addFeatures([ftr])

        layer.commitChanges()
        layer.updateExtents()

        # Apply anomaly threshold styling
        self._apply_anomaly_style(layer, col_name, thresholds)
        return layer

    def _apply_anomaly_style(self, layer, col_name, thresholds):
        """Apply graduated anomaly threshold styling."""
        root_rule = QgsRuleBasedRenderer.Rule(None)

        bg = thresholds["background"]
        x2 = thresholds["x2"]
        x3 = thresholds["x3"]
        x5 = thresholds["x5"]
        x10 = x5 * 2  # Approximate 10x anomaly

        levels = [
            (f"< {bg} (background)", f'"{col_name}" < {bg}',
             ANOMALY_COLORS["background"], 2.5),
            (f"{bg} - {x2} (1-2x)", f'"{col_name}" >= {bg} AND "{col_name}" < {x2}',
             ANOMALY_COLORS["2x"], 3.0),
            (f"{x2} - {x3} (2-3x)", f'"{col_name}" >= {x2} AND "{col_name}" < {x3}',
             ANOMALY_COLORS["3x"], 3.5),
            (f"{x3} - {x5} (3-5x)", f'"{col_name}" >= {x3} AND "{col_name}" < {x5}',
             ANOMALY_COLORS["5x"], 4.0),
            (f">= {x5} (5x+)", f'"{col_name}" >= {x5}',
             ANOMALY_COLORS["10x"], 5.0),
        ]

        for label, expression, color, size in levels:
            symbol = QgsSymbol.defaultSymbol(QgsWkbTypes.PointGeometry).clone()
            qcolor = QColor(color)
            symbol.setColor(qcolor)
            symbol.symbolLayer(0).setStrokeColor(qcolor.darker(120))
            symbol.setSize(size * (1 / 3.78))  # px to mm

            rule = QgsRuleBasedRenderer.Rule(symbol)
            rule.setFilterExpression(expression)
            rule.setLabel(label)
            root_rule.appendChild(rule)

        renderer = QgsRuleBasedRenderer(root_rule)
        layer.setRenderer(renderer)
