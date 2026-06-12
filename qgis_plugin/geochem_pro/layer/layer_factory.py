"""
Creates QgsVectorLayer from GeochemData objects.
Modeled after ioGAS gaslayerlogic_base.py.
"""

from qgis.PyQt.QtCore import QVariant, Qt
from qgis.core import (
    QgsVectorLayer, QgsFeature, QgsField, QgsFields,
    QgsGeometry, QgsPointXY, QgsPoint,
    QgsCoordinateReferenceSystem, QgsProject,
)

from ..support import logger, config
from ..data.geochem_data import GeochemData


class LayerFactory:
    """
    Creates and manages QGIS vector layers from GeochemData.
    Equivalent to ioGAS GasLayerLogic_Base.
    """

    def __init__(self):
        self._live_layer_id = None

    def create_layer(self, data: GeochemData, name: str = "GeoChem Data"):
        """
        Create a new in-memory point layer from GeochemData.
        Returns QgsVectorLayer or None on failure.
        """
        if not data.has_coordinates():
            logger.log_error(
                f"No coordinate fields found (x={data.x_field}, y={data.y_field})",
                "layer_factory"
            )
            return None

        layer_name = f"{name}{config.LIVE_LAYER_SUFFIX}"

        # Build layer URI with CRS
        crs = data.crs
        if crs and crs.startswith("EPSG:"):
            layer_uri = f"Point?crs={crs}"
        elif crs:
            layer_uri = f"Point?crs=EPSG:{crs}"
        else:
            layer_uri = "Point"

        layer = QgsVectorLayer(layer_uri, layer_name, "memory")

        if not crs:
            layer.setCrs(QgsCoordinateReferenceSystem())
            logger.log_warning(
                f"Layer '{layer_name}' has no CRS defined", "layer_factory"
            )

        # Set up fields
        fields = self._build_fields(data)
        provider = layer.dataProvider()
        provider.addAttributes(fields)
        layer.updateFields()

        # Sort by feature ID
        tbl_config = layer.attributeTableConfig()
        tbl_config.setSortExpression("$id")
        tbl_config.setSortOrder(Qt.AscendingOrder)
        layer.setAttributeTableConfig(tbl_config)

        # Add features
        layer.startEditing()
        geom_errors = 0
        feat_count = 0

        for row_idx, row in enumerate(data.rows):
            ftr = QgsFeature(fields)

            # Set attributes
            attrs = []
            for col in data.columns:
                val = row.get(col.name)
                if col.data_type == "numeric" and val is not None:
                    try:
                        val = float(val)
                    except (ValueError, TypeError):
                        val = None
                attrs.append(val)
            attrs.append(row_idx)  # _geochem_idx
            ftr.setAttributes(attrs)

            # Set geometry
            geom = self._make_geometry(row, data)
            if geom is None:
                geom_errors += 1
                continue
            ftr.setGeometry(geom)

            provider.addFeatures([ftr])
            feat_count += 1

        layer.commitChanges()
        layer.updateExtents()

        if geom_errors > 0:
            logger.log_warning(
                f"{geom_errors} rows skipped (bad coordinates)", "layer_factory"
            )

        logger.log_info(
            f"Created layer '{layer_name}' with {feat_count} features",
            "layer_factory"
        )
        return layer

    def add_to_project(self, layer):
        """Add layer to the current QGIS project."""
        if layer:
            QgsProject.instance().addMapLayer(layer)
            self._live_layer_id = layer.id()
            return True
        return False

    def get_live_layer(self):
        """Get the current live GeoChem layer."""
        if self._live_layer_id:
            return QgsProject.instance().mapLayer(self._live_layer_id)
        # Fallback: find by name suffix
        for lyr in QgsProject.instance().mapLayers().values():
            if lyr.name().endswith(config.LIVE_LAYER_SUFFIX):
                self._live_layer_id = lyr.id()
                return lyr
        return None

    def remove_live_layer(self):
        """Remove the current live layer from the project."""
        layer = self.get_live_layer()
        if layer:
            QgsProject.instance().removeMapLayers([layer.id()])
            self._live_layer_id = None

    def get_selected_indices(self, layer=None):
        """Get the _geochem_idx values of selected features."""
        layer = layer or self.get_live_layer()
        if not layer:
            return []
        idx_field = config.INDEX_FIELD
        indices = []
        for feat in layer.selectedFeatures():
            val = feat[idx_field]
            if val is not None:
                indices.append(int(val))
        return indices

    def select_by_indices(self, indices, layer=None):
        """Select features by their _geochem_idx values."""
        layer = layer or self.get_live_layer()
        if not layer:
            return

        idx_field = config.INDEX_FIELD
        field_idx = layer.fields().indexOf(idx_field)
        if field_idx < 0:
            return

        index_set = set(indices)
        fids = []
        for feat in layer.getFeatures():
            if feat[idx_field] in index_set:
                fids.append(feat.id())

        layer.selectByIds(fids)

    def _build_fields(self, data: GeochemData):
        """Build QgsFields from GeochemData columns."""
        fields = QgsFields()
        for col in data.columns:
            if col.data_type == "numeric":
                fields.append(QgsField(col.name, QVariant.Double))
            elif col.data_type == "integer":
                fields.append(QgsField(col.name, QVariant.Int))
            else:
                fields.append(QgsField(col.name, QVariant.String))

        # Index field for selection sync
        fields.append(QgsField(config.INDEX_FIELD, QVariant.Int))
        return fields

    def _make_geometry(self, row, data: GeochemData):
        """Create point geometry from a data row."""
        import math
        try:
            x = float(row.get(data.x_field))
            y = float(row.get(data.y_field))
        except (TypeError, ValueError):
            return None

        if math.isnan(x) or math.isnan(y) or math.isinf(x) or math.isinf(y):
            return None

        if data.has_3d():
            try:
                z = float(row.get(data.z_field))
                if not (math.isnan(z) or math.isinf(z)):
                    return QgsGeometry(QgsPoint(x, y, z))
            except (TypeError, ValueError):
                pass

        return QgsGeometry.fromPointXY(QgsPointXY(x, y))
