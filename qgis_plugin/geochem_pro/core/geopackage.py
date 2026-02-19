"""
Geopackage Export Manager for GeoChem QGIS Plugin
Handles saving styled layers to geopackage format with embedded styles
"""

import os
import sqlite3
from typing import Optional, List, Dict, Any
from PyQt5.QtCore import QVariant
from qgis.core import (
    QgsVectorLayer,
    QgsVectorFileWriter,
    QgsProject,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransformContext,
    QgsMapLayerStyle,
    QgsMessageLog,
    Qgis
)


class GeopackageExporter:
    """
    Exports GeoChem layers to styled Geopackage files.

    Features:
    - Export layer data to GeoPackage format
    - Embed QML styles in the GeoPackage
    - Support multiple named styles
    - Preserve layer styling that will auto-load in QGIS
    """

    def __init__(self, layer: QgsVectorLayer):
        """
        Initialize exporter with a layer.

        Args:
            layer: QgsVectorLayer to export
        """
        self.layer = layer

    def export(
        self,
        filepath: str,
        layer_name: Optional[str] = None,
        include_style: bool = True,
        selected_only: bool = False,
        overwrite: bool = True
    ) -> Dict[str, Any]:
        """
        Export layer to Geopackage with embedded style.

        Args:
            filepath: Output file path (.gpkg)
            layer_name: Name for the layer in the geopackage (defaults to layer name)
            include_style: Whether to embed the style in the geopackage
            selected_only: Export only selected features
            overwrite: Overwrite existing file

        Returns:
            Dict with 'success', 'message', 'feature_count', 'filepath'
        """
        result = {
            'success': False,
            'message': '',
            'feature_count': 0,
            'filepath': filepath
        }

        layer_name = layer_name or self.layer.name()

        # Ensure .gpkg extension
        if not filepath.lower().endswith('.gpkg'):
            filepath += '.gpkg'
            result['filepath'] = filepath

        # Handle existing file
        if os.path.exists(filepath):
            if overwrite:
                try:
                    os.remove(filepath)
                except Exception as e:
                    result['message'] = f"Cannot remove existing file: {str(e)}"
                    return result
            else:
                result['message'] = "File exists and overwrite=False"
                return result

        try:
            # Set up save options
            options = QgsVectorFileWriter.SaveVectorOptions()
            options.driverName = "GPKG"
            options.layerName = layer_name
            options.fileEncoding = "UTF-8"

            if selected_only:
                options.onlySelectedFeatures = True

            # Write the layer
            error_code, error_message = QgsVectorFileWriter.writeAsVectorFormatV3(
                self.layer,
                filepath,
                QgsCoordinateTransformContext(),
                options
            )[:2]

            if error_code != QgsVectorFileWriter.NoError:
                result['message'] = f"Export failed: {error_message}"
                QgsMessageLog.logMessage(
                    f"GeoPackage export error: {error_message}",
                    "GeoChem",
                    Qgis.Warning
                )
                return result

            # Count features
            if selected_only:
                result['feature_count'] = self.layer.selectedFeatureCount()
            else:
                result['feature_count'] = self.layer.featureCount()

            # Embed style if requested
            if include_style:
                style_result = self._embed_style(filepath, layer_name)
                if not style_result['success']:
                    QgsMessageLog.logMessage(
                        f"Style embedding warning: {style_result['message']}",
                        "GeoChem",
                        Qgis.Warning
                    )

            result['success'] = True
            result['message'] = f"Exported {result['feature_count']} features to {filepath}"

            QgsMessageLog.logMessage(
                f"Successfully exported layer to {filepath}",
                "GeoChem",
                Qgis.Info
            )

            return result

        except Exception as e:
            result['message'] = f"Export error: {str(e)}"
            QgsMessageLog.logMessage(
                f"GeoPackage export exception: {str(e)}",
                "GeoChem",
                Qgis.Critical
            )
            return result

    def export_with_multiple_styles(
        self,
        filepath: str,
        styles: List[Dict[str, Any]],
        layer_name: Optional[str] = None,
        selected_only: bool = False
    ) -> Dict[str, Any]:
        """
        Export with multiple named styles.

        Args:
            filepath: Output file path
            styles: List of style configurations, each with:
                - 'name': Style name
                - 'type': 'classification', 'graduated', 'cluster', 'high_grade'
                - 'column': Column to style by
                - Additional type-specific options
            layer_name: Layer name in geopackage
            selected_only: Export only selected features

        Returns:
            Dict with 'success', 'message', 'styles_added'
        """
        from .style_manager import GeochemStyleManager

        result = {
            'success': False,
            'message': '',
            'styles_added': 0,
            'filepath': filepath
        }

        layer_name = layer_name or self.layer.name()

        # Ensure .gpkg extension
        if not filepath.lower().endswith('.gpkg'):
            filepath += '.gpkg'
            result['filepath'] = filepath

        # First export the data without style
        export_result = self.export(
            filepath,
            layer_name,
            include_style=False,
            selected_only=selected_only
        )

        if not export_result['success']:
            return export_result

        result['feature_count'] = export_result['feature_count']

        if not styles:
            result['success'] = True
            result['message'] = "Exported without styles"
            return result

        # Apply and save each style
        style_manager = GeochemStyleManager(self.layer)

        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()

            # Ensure layer_styles table exists
            self._create_styles_table(cursor)

            for i, style_config in enumerate(styles):
                style_name = style_config.get('name', f'Style {i + 1}')
                style_type = style_config.get('type', 'single')
                column = style_config.get('column')

                try:
                    # Apply style to layer
                    self._apply_style_config(style_manager, style_config)

                    # Capture QML
                    map_style = QgsMapLayerStyle()
                    map_style.readFromLayer(self.layer)
                    qml_content = map_style.xmlData()

                    # Insert style into database
                    is_default = (i == 0)
                    description = f"{style_type} style"
                    if column:
                        description += f" on {column}"

                    cursor.execute('''
                        INSERT OR REPLACE INTO layer_styles
                        (f_table_name, styleName, styleQML, useAsDefault, description)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (layer_name, style_name, qml_content, is_default, description))

                    result['styles_added'] += 1

                except Exception as e:
                    QgsMessageLog.logMessage(
                        f"Failed to add style '{style_name}': {str(e)}",
                        "GeoChem",
                        Qgis.Warning
                    )

            conn.commit()
            conn.close()

            result['success'] = True
            result['message'] = f"Exported with {result['styles_added']} styles"

            QgsMessageLog.logMessage(
                f"Exported layer with {result['styles_added']} styles to {filepath}",
                "GeoChem",
                Qgis.Info
            )

            return result

        except Exception as e:
            result['message'] = f"Style export error: {str(e)}"
            QgsMessageLog.logMessage(
                f"Multi-style export exception: {str(e)}",
                "GeoChem",
                Qgis.Critical
            )
            return result

    def add_style_to_existing(
        self,
        filepath: str,
        style_name: str,
        layer_name: Optional[str] = None,
        make_default: bool = False
    ) -> Dict[str, Any]:
        """
        Add current layer style to an existing geopackage.

        Args:
            filepath: GeoPackage file path
            style_name: Name for the style
            layer_name: Layer name in geopackage
            make_default: Set as default style

        Returns:
            Dict with 'success', 'message'
        """
        result = {'success': False, 'message': ''}

        if not os.path.exists(filepath):
            result['message'] = f"File not found: {filepath}"
            return result

        layer_name = layer_name or self.layer.name()

        try:
            # Capture current style
            map_style = QgsMapLayerStyle()
            map_style.readFromLayer(self.layer)
            qml_content = map_style.xmlData()

            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()

            # Ensure table exists
            self._create_styles_table(cursor)

            # If making default, unset other defaults first
            if make_default:
                cursor.execute('''
                    UPDATE layer_styles
                    SET useAsDefault = 0
                    WHERE f_table_name = ?
                ''', (layer_name,))

            # Insert or replace style
            cursor.execute('''
                INSERT OR REPLACE INTO layer_styles
                (f_table_name, styleName, styleQML, useAsDefault, description)
                VALUES (?, ?, ?, ?, ?)
            ''', (layer_name, style_name, qml_content, make_default, 'Added from QGIS'))

            conn.commit()
            conn.close()

            result['success'] = True
            result['message'] = f"Style '{style_name}' added to {filepath}"

            return result

        except Exception as e:
            result['message'] = f"Error adding style: {str(e)}"
            return result

    def list_styles(self, filepath: str, layer_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List styles in a geopackage.

        Args:
            filepath: GeoPackage file path
            layer_name: Filter by layer name (None for all)

        Returns:
            List of style info dicts
        """
        styles = []

        if not os.path.exists(filepath):
            return styles

        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()

            # Check if styles table exists
            cursor.execute('''
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='layer_styles'
            ''')
            if not cursor.fetchone():
                conn.close()
                return styles

            if layer_name:
                cursor.execute('''
                    SELECT styleName, useAsDefault, description, update_time
                    FROM layer_styles
                    WHERE f_table_name = ?
                ''', (layer_name,))
            else:
                cursor.execute('''
                    SELECT f_table_name, styleName, useAsDefault, description, update_time
                    FROM layer_styles
                ''')

            for row in cursor.fetchall():
                if layer_name:
                    styles.append({
                        'name': row[0],
                        'is_default': bool(row[1]),
                        'description': row[2],
                        'updated': row[3]
                    })
                else:
                    styles.append({
                        'layer': row[0],
                        'name': row[1],
                        'is_default': bool(row[2]),
                        'description': row[3],
                        'updated': row[4]
                    })

            conn.close()

        except Exception as e:
            QgsMessageLog.logMessage(
                f"Error listing styles: {str(e)}",
                "GeoChem",
                Qgis.Warning
            )

        return styles

    # =========================================================================
    # Private Methods
    # =========================================================================

    def _embed_style(self, filepath: str, layer_name: str) -> Dict[str, Any]:
        """Embed current layer style into the geopackage"""
        result = {'success': False, 'message': ''}

        try:
            # Get current style as QML
            map_style = QgsMapLayerStyle()
            map_style.readFromLayer(self.layer)
            qml_content = map_style.xmlData()

            # Connect to geopackage SQLite database
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()

            # Create layer_styles table
            self._create_styles_table(cursor)

            # Insert style
            cursor.execute('''
                INSERT OR REPLACE INTO layer_styles
                (f_table_name, styleName, styleQML, useAsDefault, description)
                VALUES (?, ?, ?, 1, ?)
            ''', (layer_name, 'default', qml_content, 'Default GeoChem style'))

            conn.commit()
            conn.close()

            result['success'] = True
            result['message'] = 'Style embedded successfully'

        except Exception as e:
            result['message'] = str(e)

        return result

    def _create_styles_table(self, cursor):
        """Create the layer_styles table if it doesn't exist"""
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

    def _apply_style_config(self, style_manager, config: Dict[str, Any]):
        """Apply a style configuration to the layer"""
        style_type = config.get('type', 'single')
        column = config.get('column')

        if style_type == 'classification' or style_type == 'categorical':
            colors = config.get('colors')
            style_manager.apply_classification_style(column, custom_colors=colors)

        elif style_type == 'graduated':
            num_classes = config.get('classes', 5)
            method = config.get('method', 'jenks')
            color_ramp = config.get('color_ramp', 'viridis')
            style_manager.apply_graduated_style(column, num_classes, method, color_ramp)

        elif style_type == 'cluster':
            colors = config.get('colors')
            style_manager.apply_cluster_style(column, custom_colors=colors)

        elif style_type == 'high_grade':
            threshold = config.get('threshold', 0)
            highlight_color = config.get('highlight_color', '#dc2626')
            normal_color = config.get('normal_color', '#3b82f6')
            style_manager.highlight_high_grades(
                column, threshold, highlight_color, normal_color=normal_color
            )

        elif style_type == 'single':
            color = config.get('color', '#3b82f6')
            size = config.get('size', 3.0)
            style_manager.apply_single_symbol(color=color, size=size)

        else:
            # Default single symbol
            style_manager.apply_single_symbol()


def quick_export(
    layer: QgsVectorLayer,
    filepath: str,
    include_style: bool = True
) -> bool:
    """
    Quick export function for simple use cases.

    Args:
        layer: Layer to export
        filepath: Output path
        include_style: Include current style

    Returns:
        bool: Success status
    """
    exporter = GeopackageExporter(layer)
    result = exporter.export(filepath, include_style=include_style)
    return result['success']
