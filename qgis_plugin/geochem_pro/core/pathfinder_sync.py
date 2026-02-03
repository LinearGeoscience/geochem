"""
Pathfinder Synchronization Manager for GeoChem Pro QGIS Plugin
Handles syncing pathfinder element layers from web app to QGIS.

Based on Dr. Scott Halley's pathfinder chemistry methodology.
"""

from typing import Dict, Any, List, Optional
from PyQt5.QtCore import QObject, pyqtSignal, QVariant
from PyQt5.QtGui import QColor
from qgis.core import (
    QgsVectorLayer,
    QgsField,
    QgsFeature,
    QgsGeometry,
    QgsPointXY,
    QgsPoint,
    QgsProject,
    QgsLayerTreeGroup,
    QgsCoordinateReferenceSystem,
    QgsMarkerSymbol,
    QgsSimpleMarkerSymbolLayer,
    QgsGraduatedSymbolRenderer,
    QgsRendererRange,
    QgsMessageLog,
    QgsVectorFileWriter,
    QgsCoordinateTransformContext,
    Qgis
)
import sqlite3
import os


class PathfinderSyncManager(QObject):
    """
    Manages pathfinder element layers in QGIS.

    Creates a layer group for pathfinder elements and applies graduated styling
    based on Scott Halley's crustal abundance thresholds.
    """

    # Signals
    layers_created = pyqtSignal(int)  # number of layers created
    layers_removed = pyqtSignal()
    export_completed = pyqtSignal(str)  # filepath
    error_occurred = pyqtSignal(str)

    # Scott Halley's anomaly thresholds (same as frontend pathfinderConstants.ts)
    ANOMALY_THRESHOLDS = {
        'Mo': {'background': 1, 'x2': 2, 'x3': 3, 'x5': 5},
        'W': {'background': 1, 'x2': 3, 'x3': 6, 'x5': 10},
        'Sn': {'background': 1.5, 'x2': 2.5, 'x3': 5, 'x5': 8},
        'Bi': {'background': 0.1, 'x2': 0.2, 'x3': 0.5, 'x5': 1},
        'Te': {'background': 0.1, 'x2': 0.2, 'x3': 0.5, 'x5': 1},
        'As': {'background': 10, 'x2': 20, 'x3': 50, 'x5': 100},
        'Sb': {'background': 1, 'x2': 2, 'x3': 3, 'x5': 5},
        'Ag': {'background': 0.05, 'x2': 0.1, 'x3': 0.2, 'x5': 0.5},
        'Pb': {'background': 15, 'x2': 30, 'x3': 60, 'x5': 100},
        'Zn': {'background': 100, 'x2': 200, 'x3': 300, 'x5': 500},
        'Cu': {'background': 60, 'x2': 100, 'x3': 200, 'x5': 300},
        'In': {'background': 0.05, 'x2': 0.1, 'x3': 0.2, 'x5': 0.3},
        'Cd': {'background': 0.1, 'x2': 0.2, 'x3': 0.5, 'x5': 1},
        'Li': {'background': 15, 'x2': 25, 'x3': 40, 'x5': 50},
        'Cs': {'background': 1.5, 'x2': 4, 'x3': 6, 'x5': 10},
        'Tl': {'background': 0.5, 'x2': 1, 'x3': 2, 'x5': 4}
    }

    # Crustal abundance values (ppm)
    CRUSTAL_ABUNDANCE = {
        'Mo': 0.5, 'W': 0.5, 'Sn': 1.5, 'Bi': 0.05, 'Te': 0.001,
        'As': 5, 'Sb': 0.5, 'Ag': 0.01, 'Pb': 20, 'Zn': 50,
        'Cu': 50, 'In': 0.1, 'Cd': 0.1, 'Li': 20, 'Cs': 2, 'Tl': 1
    }

    # Anomaly class colors (matching frontend)
    ANOMALY_COLORS = {
        'background': '#3288bd',
        '2x': '#66c2a5',
        '3x': '#abdda4',
        '5x': '#fdae61',
        '10x': '#d53e4f'
    }

    # Layer group name
    GROUP_NAME = "Pathfinder"

    # Index field name for tracking original row indices
    INDEX_FIELD = '_geochem_idx'

    def __init__(self, connection_manager, data_sync_manager=None, parent=None):
        super().__init__(parent)
        self.connection = connection_manager
        self.data_sync = data_sync_manager  # Optional - can work without it
        self._pathfinder_group: Optional[QgsLayerTreeGroup] = None
        self._element_layers: Dict[str, QgsVectorLayer] = {}
        self._cached_data: List[Dict] = []  # Cache data from backend

    def create_pathfinder_layers(self, config: Dict[str, Any]) -> int:
        """
        Create layers for selected pathfinder elements.

        Fetches data directly from the backend - does NOT require a pre-existing
        data layer in QGIS.

        Args:
            config: Configuration from frontend containing:
                - elements: List of element symbols
                - xField, yField, zField: Coordinate fields
                - normalization: 'none', 'sc', or 'k'
                - scColumn, kColumn: Normalization columns
                - elementColumnMapping: Dict mapping elements to data columns

        Returns:
            Number of layers created
        """
        elements = config.get('elements', [])
        if not elements:
            self.error_occurred.emit("No pathfinder elements specified")
            return 0

        # Fetch data directly from backend
        try:
            self._cached_data = self.connection.fetch_data()
            if not self._cached_data:
                self.error_occurred.emit("No data available from backend. Load data in web app first.")
                return 0
            QgsMessageLog.logMessage(
                f"Fetched {len(self._cached_data)} rows from backend",
                "GeoChem Pro",
                Qgis.Info
            )
        except Exception as e:
            self.error_occurred.emit(f"Failed to fetch data: {str(e)}")
            return 0

        # Get or create layer group
        group = self._get_or_create_group()

        # Remove existing pathfinder layers from group
        self._clear_group_layers(group)

        x_field = config.get('xField', 'x')
        y_field = config.get('yField', 'y')
        z_field = config.get('zField')
        element_mapping = config.get('elementColumnMapping', {})

        QgsMessageLog.logMessage(
            f"Coordinate fields: x={x_field}, y={y_field}, z={z_field}",
            "GeoChem Pro",
            Qgis.Info
        )
        QgsMessageLog.logMessage(
            f"Element mapping: {element_mapping}",
            "GeoChem Pro",
            Qgis.Info
        )

        # Check which columns exist in data
        available_columns = set()
        if self._cached_data:
            available_columns = set(self._cached_data[0].keys())
            QgsMessageLog.logMessage(
                f"Available columns ({len(available_columns)}): {sorted(list(available_columns))[:20]}...",
                "GeoChem Pro",
                Qgis.Info
            )

            # Check if coordinate fields exist
            if x_field not in available_columns:
                self.error_occurred.emit(f"X coordinate field '{x_field}' not found in data")
                return 0
            if y_field not in available_columns:
                self.error_occurred.emit(f"Y coordinate field '{y_field}' not found in data")
                return 0
            if z_field and z_field not in available_columns:
                QgsMessageLog.logMessage(
                    f"Z coordinate field '{z_field}' not found, creating 2D layers",
                    "GeoChem Pro",
                    Qgis.Warning
                )
                z_field = None

        created_count = 0

        for element in elements:
            # Get the data column for this element
            element_column = element_mapping.get(element) or element

            # Check if column exists in data
            if element_column not in available_columns:
                QgsMessageLog.logMessage(
                    f"Column '{element_column}' not found for element {element}, skipping",
                    "GeoChem Pro",
                    Qgis.Warning
                )
                continue

            # Create layer for this element directly from cached data
            layer = self._create_element_layer_from_data(
                element, element_column,
                x_field, y_field, z_field
            )

            if layer and layer.featureCount() > 0:
                # Apply pathfinder styling
                self._apply_pathfinder_style(layer, element, element_column)

                # Add to project and group
                QgsProject.instance().addMapLayer(layer, False)
                group.addLayer(layer)

                self._element_layers[element] = layer
                created_count += 1
                QgsMessageLog.logMessage(
                    f"Created layer for {element} with {layer.featureCount()} features",
                    "GeoChem Pro",
                    Qgis.Info
                )
            else:
                QgsMessageLog.logMessage(
                    f"No valid features for element {element}",
                    "GeoChem Pro",
                    Qgis.Warning
                )

        if created_count > 0:
            QgsMessageLog.logMessage(
                f"Created {created_count} pathfinder layers",
                "GeoChem Pro",
                Qgis.Info
            )
            self.layers_created.emit(created_count)

        return created_count

    def _get_or_create_group(self) -> QgsLayerTreeGroup:
        """Get or create the Pathfinder layer group at the top of layer tree."""
        root = QgsProject.instance().layerTreeRoot()

        # Look for existing group
        for child in root.children():
            if isinstance(child, QgsLayerTreeGroup) and child.name() == self.GROUP_NAME:
                self._pathfinder_group = child
                return child

        # Create new group at top
        group = root.insertGroup(0, self.GROUP_NAME)
        self._pathfinder_group = group
        return group

    def _clear_group_layers(self, group: QgsLayerTreeGroup):
        """Remove all layers from the group."""
        # Remove from project and clear tracking dict
        for element, layer in list(self._element_layers.items()):
            if layer:
                try:
                    QgsProject.instance().removeMapLayer(layer.id())
                except:
                    pass

        self._element_layers.clear()

        # Also remove any remaining children in the group
        for child in list(group.children()):
            group.removeChildNode(child)

    def _create_element_layer_from_data(
        self,
        element: str,
        element_column: str,
        x_field: str,
        y_field: str,
        z_field: Optional[str]
    ) -> Optional[QgsVectorLayer]:
        """
        Create a memory layer for a single pathfinder element from cached data.
        """
        try:
            # Determine geometry type
            geom_type = "PointZ" if z_field else "Point"
            crs = "EPSG:4326"  # Default CRS, can be made configurable

            # Create memory layer
            layer_name = f"{element}_pathfinder"
            layer = QgsVectorLayer(
                f"{geom_type}?crs={crs}",
                layer_name,
                "memory"
            )

            if not layer.isValid():
                QgsMessageLog.logMessage(
                    f"Failed to create valid layer for {element}",
                    "GeoChem Pro",
                    Qgis.Warning
                )
                return None

            provider = layer.dataProvider()

            # Add fields: index, element value, coordinates
            from qgis.core import QgsFields
            fields = QgsFields()
            fields.append(QgsField(self.INDEX_FIELD, QVariant.Int))
            fields.append(QgsField(element_column, QVariant.Double))
            fields.append(QgsField('x', QVariant.Double))
            fields.append(QgsField('y', QVariant.Double))
            if z_field:
                fields.append(QgsField('z', QVariant.Double))

            provider.addAttributes(fields)
            layer.updateFields()

            # Create features from cached data
            features = []
            for idx, row in enumerate(self._cached_data):
                x_val = row.get(x_field)
                y_val = row.get(y_field)
                elem_val = row.get(element_column)

                # Skip if missing coordinates or element value
                if x_val is None or y_val is None or elem_val is None:
                    continue

                try:
                    x = float(x_val)
                    y = float(y_val)
                    elem = float(elem_val)
                except (ValueError, TypeError):
                    continue

                feature = QgsFeature(layer.fields())

                if z_field:
                    z_val = row.get(z_field)
                    try:
                        z = float(z_val) if z_val is not None else 0.0
                    except (ValueError, TypeError):
                        z = 0.0
                    point = QgsPoint(x, y, z)
                    feature.setGeometry(QgsGeometry(point))
                    feature.setAttributes([idx, elem, x, y, z])
                else:
                    feature.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))
                    feature.setAttributes([idx, elem, x, y])

                features.append(feature)

            if features:
                provider.addFeatures(features)
                layer.updateExtents()
                QgsMessageLog.logMessage(
                    f"Added {len(features)} features to {element} layer",
                    "GeoChem Pro",
                    Qgis.Info
                )

            return layer

        except Exception as e:
            QgsMessageLog.logMessage(
                f"Error creating layer for {element}: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return None

    def _create_element_layer(
        self,
        base_layer: QgsVectorLayer,
        element: str,
        element_column: str,
        x_field: str,
        y_field: str,
        z_field: Optional[str]
    ) -> Optional[QgsVectorLayer]:
        """
        Create a memory layer for a single pathfinder element.

        Copies features from base layer with the element value.
        """
        try:
            # Determine geometry type
            geom_type = "PointZ" if z_field else "Point"
            crs = base_layer.crs().authid()

            # Create memory layer
            layer_name = f"{element}_pathfinder"
            layer = QgsVectorLayer(
                f"{geom_type}?crs={crs}",
                layer_name,
                "memory"
            )

            if not layer.isValid():
                return None

            provider = layer.dataProvider()

            # Add fields: index, element value
            from qgis.core import QgsFields
            fields = QgsFields()
            fields.append(QgsField(self.INDEX_FIELD, QVariant.Int))
            fields.append(QgsField(element_column, QVariant.Double))
            fields.append(QgsField('x', QVariant.Double))
            fields.append(QgsField('y', QVariant.Double))
            if z_field:
                fields.append(QgsField('z', QVariant.Double))

            provider.addAttributes(fields)
            layer.updateFields()

            # Copy features from base layer
            features = []
            x_idx = base_layer.fields().indexFromName(x_field)
            y_idx = base_layer.fields().indexFromName(y_field)
            z_idx = base_layer.fields().indexFromName(z_field) if z_field else -1
            elem_idx = base_layer.fields().indexFromName(element_column)
            idx_idx = base_layer.fields().indexFromName(self.INDEX_FIELD)

            for base_feature in base_layer.getFeatures():
                x_val = base_feature.attribute(x_idx)
                y_val = base_feature.attribute(y_idx)
                elem_val = base_feature.attribute(elem_idx)
                original_idx = base_feature.attribute(idx_idx) if idx_idx >= 0 else base_feature.id()

                # Skip if missing coordinates or element value
                if x_val is None or y_val is None or elem_val is None:
                    continue

                try:
                    x = float(x_val)
                    y = float(y_val)
                    elem = float(elem_val)
                except (ValueError, TypeError):
                    continue

                feature = QgsFeature(layer.fields())

                if z_field and z_idx >= 0:
                    z_val = base_feature.attribute(z_idx)
                    try:
                        z = float(z_val) if z_val is not None else 0.0
                    except (ValueError, TypeError):
                        z = 0.0
                    point = QgsPoint(x, y, z)
                    feature.setGeometry(QgsGeometry(point))
                    feature.setAttributes([original_idx, elem, x, y, z])
                else:
                    feature.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))
                    feature.setAttributes([original_idx, elem, x, y])

                features.append(feature)

            if features:
                provider.addFeatures(features)
                layer.updateExtents()

            return layer

        except Exception as e:
            QgsMessageLog.logMessage(
                f"Error creating layer for {element}: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return None

    def _apply_pathfinder_style(
        self,
        layer: QgsVectorLayer,
        element: str,
        element_column: str
    ):
        """
        Apply graduated symbology based on anomaly thresholds.

        Uses 5 ranges: background, 2x, 3x, 5x, 10x+ crustal abundance.
        """
        if element not in self.ANOMALY_THRESHOLDS:
            # Unknown element - use single symbol
            return

        thresholds = self.ANOMALY_THRESHOLDS[element]
        ranges = []

        # Define the 5 ranges
        range_defs = [
            (0, thresholds['background'], 'Background', self.ANOMALY_COLORS['background']),
            (thresholds['background'], thresholds['x2'], '2x Crustal', self.ANOMALY_COLORS['2x']),
            (thresholds['x2'], thresholds['x3'], '3x Crustal', self.ANOMALY_COLORS['3x']),
            (thresholds['x3'], thresholds['x5'], '5x Crustal', self.ANOMALY_COLORS['5x']),
            (thresholds['x5'], 999999, '10x+ Crustal', self.ANOMALY_COLORS['10x']),
        ]

        for lower, upper, label, color in range_defs:
            symbol = self._create_marker_symbol(color)
            range_obj = QgsRendererRange(lower, upper, symbol, label, True)
            ranges.append(range_obj)

        renderer = QgsGraduatedSymbolRenderer(element_column, ranges)
        layer.setRenderer(renderer)
        layer.triggerRepaint()

    def _create_marker_symbol(self, color: str, size: float = 3.0) -> QgsMarkerSymbol:
        """Create a simple marker symbol with the given color."""
        symbol = QgsMarkerSymbol.createSimple({
            'name': 'circle',
            'color': color,
            'outline_color': '#000000',
            'outline_width': '0.2',
        })
        symbol.setSize(size)
        return symbol

    def remove_all_pathfinder_layers(self):
        """Remove all pathfinder layers and the group."""
        if self._pathfinder_group:
            self._clear_group_layers(self._pathfinder_group)

            # Remove the group itself
            root = QgsProject.instance().layerTreeRoot()
            root.removeChildNode(self._pathfinder_group)
            self._pathfinder_group = None

        self.layers_removed.emit()
        QgsMessageLog.logMessage("Removed all pathfinder layers", "GeoChem Pro", Qgis.Info)

    def get_pathfinder_layers(self) -> List[QgsVectorLayer]:
        """Get list of current pathfinder layers."""
        return list(self._element_layers.values())

    def export_to_geopackage(self, filepath: str, include_styles: bool = True) -> Dict[str, Any]:
        """
        Export all pathfinder layers to a single GeoPackage.

        Args:
            filepath: Output file path (.gpkg)
            include_styles: Whether to embed styles

        Returns:
            Dict with 'success', 'message', 'layer_count'
        """
        result = {
            'success': False,
            'message': '',
            'layer_count': 0,
            'filepath': filepath
        }

        layers = self.get_pathfinder_layers()
        if not layers:
            result['message'] = "No pathfinder layers to export"
            return result

        # Ensure .gpkg extension
        if not filepath.lower().endswith('.gpkg'):
            filepath += '.gpkg'
            result['filepath'] = filepath

        # Remove existing file
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception as e:
                result['message'] = f"Cannot remove existing file: {str(e)}"
                return result

        try:
            exported_count = 0

            for i, layer in enumerate(layers):
                options = QgsVectorFileWriter.SaveVectorOptions()
                options.driverName = "GPKG"
                options.layerName = layer.name()
                options.fileEncoding = "UTF-8"

                # First layer creates file, subsequent layers append
                if i > 0:
                    options.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteLayer

                error_code, error_message = QgsVectorFileWriter.writeAsVectorFormatV3(
                    layer,
                    filepath,
                    QgsCoordinateTransformContext(),
                    options
                )[:2]

                if error_code != QgsVectorFileWriter.NoError:
                    QgsMessageLog.logMessage(
                        f"Error exporting {layer.name()}: {error_message}",
                        "GeoChem Pro",
                        Qgis.Warning
                    )
                    continue

                exported_count += 1

            # Embed styles if requested
            if include_styles and exported_count > 0:
                self._embed_all_styles(filepath, layers)

            result['success'] = exported_count > 0
            result['layer_count'] = exported_count
            result['message'] = f"Exported {exported_count} pathfinder layers to {filepath}"

            if result['success']:
                self.export_completed.emit(filepath)
                QgsMessageLog.logMessage(result['message'], "GeoChem Pro", Qgis.Info)

            return result

        except Exception as e:
            result['message'] = f"Export error: {str(e)}"
            QgsMessageLog.logMessage(result['message'], "GeoChem Pro", Qgis.Critical)
            return result

    def _embed_all_styles(self, filepath: str, layers: List[QgsVectorLayer]):
        """Embed styles for all layers into the GeoPackage."""
        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()

            # Create layer_styles table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS layer_styles (
                    id INTEGER PRIMARY KEY,
                    f_table_catalog TEXT,
                    f_table_schema TEXT,
                    f_table_name TEXT NOT NULL,
                    f_geometry_column TEXT,
                    styleName TEXT NOT NULL,
                    styleQML TEXT,
                    styleSLD TEXT,
                    useAsDefault BOOLEAN,
                    description TEXT,
                    owner TEXT,
                    ui TEXT,
                    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(f_table_name, styleName)
                )
            ''')

            from qgis.core import QgsMapLayerStyle

            for layer in layers:
                # Get style as QML
                map_style = QgsMapLayerStyle()
                map_style.readFromLayer(layer)
                qml_content = map_style.xmlData()

                # Insert style
                cursor.execute('''
                    INSERT OR REPLACE INTO layer_styles
                    (f_table_name, styleName, styleQML, useAsDefault, description)
                    VALUES (?, ?, ?, 1, ?)
                ''', (layer.name(), 'default', qml_content, 'Pathfinder anomaly style'))

            conn.commit()
            conn.close()

        except Exception as e:
            QgsMessageLog.logMessage(
                f"Error embedding styles: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
