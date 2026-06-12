"""
GeoPackage export with embedded layer styles.
"""

import os
from qgis.core import (
    QgsVectorFileWriter, QgsProject, QgsCoordinateTransformContext,
)

from ..support import logger


def export_layer_to_geopackage(layer, filepath):
    """
    Export a QgsVectorLayer to a GeoPackage file with embedded style.
    Returns True on success, False on failure.
    """
    if not layer:
        logger.log_error("No layer to export", "geopackage")
        return False

    # Ensure .gpkg extension
    if not filepath.lower().endswith(".gpkg"):
        filepath += ".gpkg"

    # Ensure directory exists
    dirpath = os.path.dirname(filepath)
    if dirpath and not os.path.exists(dirpath):
        os.makedirs(dirpath, exist_ok=True)

    try:
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GPKG"
        options.fileEncoding = "UTF-8"

        transform_context = QgsProject.instance().transformContext()

        error_code, error_msg = QgsVectorFileWriter.writeAsVectorFormatV2(
            layer, filepath, transform_context, options
        )

        if error_code != QgsVectorFileWriter.NoError:
            logger.log_error(
                f"GeoPackage export failed: {error_msg}", "geopackage"
            )
            return False

        # Save style into the geopackage
        try:
            exported_layer = _load_gpkg_layer(filepath, layer.name())
            if exported_layer and exported_layer.isValid() and layer.renderer():
                exported_layer.setRenderer(layer.renderer().clone())
                exported_layer.saveStyleToDatabase(
                    "default", "GeoChem style", True, ""
                )
        except Exception as e:
            logger.log_warning(
                f"Style embedding failed (data still exported): {e}",
                "geopackage"
            )

        logger.log_info(f"Exported to {filepath}", "geopackage")
        return True

    except Exception as e:
        logger.log_error(f"Export failed: {e}", "geopackage")
        return False


def _load_gpkg_layer(filepath, layer_name):
    """Load a layer from a GeoPackage file (not added to project)."""
    from qgis.core import QgsVectorLayer
    uri = f"{filepath}|layername={layer_name}"
    return QgsVectorLayer(uri, layer_name, "ogr")
