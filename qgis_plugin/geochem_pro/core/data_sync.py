"""
Data Synchronization Manager for GeoChem QGIS Plugin
Handles syncing data between GeoChem and QGIS layers
"""

from typing import Dict, Any, List, Optional, Tuple
from PyQt5.QtCore import QObject, pyqtSignal, QVariant, QMetaType
from qgis.core import (
    QgsVectorLayer,
    QgsField,
    QgsFeature,
    QgsGeometry,
    QgsPointXY,
    QgsPoint,
    QgsProject,
    QgsCoordinateReferenceSystem,
    QgsWkbTypes,
    QgsFields,
    QgsFeatureRequest,
    QgsExpression,
    QgsMessageLog,
    Qgis
)


class DataSyncManager(QObject):
    """
    Manages data synchronization between GeoChem and QGIS.

    Handles:
    - Creating memory layers from GeoChem data
    - Syncing data updates
    - Managing selection synchronization
    - Updating classifications
    """

    # Signals
    sync_started = pyqtSignal()
    sync_completed = pyqtSignal(int)  # number of features synced
    sync_error = pyqtSignal(str)
    selection_sync_started = pyqtSignal()
    selection_sync_completed = pyqtSignal(int)  # number selected
    classification_updated = pyqtSignal(str)  # column name

    # Index field name for tracking original row indices
    INDEX_FIELD = '_geochem_idx'

    def __init__(self, connection_manager, parent=None):
        super().__init__(parent)
        self.connection = connection_manager
        self.layer: Optional[QgsVectorLayer] = None
        self._columns_info: List[Dict[str, str]] = []
        self._x_field: str = 'x'
        self._y_field: str = 'y'
        self._z_field: Optional[str] = None  # Optional Z field for 3D points
        self._crs: str = 'EPSG:4326'

        # Connect to connection manager signals
        self.connection.selection_changed.connect(self._on_selection_changed)
        self.connection.classification_changed.connect(self._on_classification_changed)
        self.connection.data_received.connect(self._on_data_received)

    def set_coordinate_fields(self, x_field: str, y_field: str, z_field: Optional[str] = None):
        """Set the coordinate field names"""
        self._x_field = x_field
        self._y_field = y_field
        self._z_field = z_field if z_field and z_field.strip() else None

    def set_crs(self, crs: str):
        """Set the coordinate reference system"""
        self._crs = crs

    def create_layer(
        self,
        name: str = "GeoChem Data",
        x_field: Optional[str] = None,
        y_field: Optional[str] = None,
        z_field: Optional[str] = None,
        crs: Optional[str] = None,
        add_to_project: bool = True
    ) -> Optional[QgsVectorLayer]:
        """
        Create a new memory layer for GeoChem data.

        Args:
            name: Layer name
            x_field: X coordinate field name (defaults to stored value)
            y_field: Y coordinate field name (defaults to stored value)
            z_field: Z coordinate field name for 3D points (optional)
            crs: Coordinate reference system (defaults to stored value)
            add_to_project: Whether to add layer to current project

        Returns:
            Created QgsVectorLayer or None on failure
        """
        if x_field:
            self._x_field = x_field
        if y_field:
            self._y_field = y_field
        if z_field is not None:
            self._z_field = z_field if z_field.strip() else None
        if crs:
            self._crs = crs

        try:
            # Fetch column metadata from GeoChem
            self._columns_info = self.connection.fetch_columns()

            if not self._columns_info:
                self.sync_error.emit("No columns received from GeoChem")
                return None

            # Create memory layer - use PointZ if z_field is set for 3D support
            geom_type = "PointZ" if self._z_field else "Point"
            self.layer = QgsVectorLayer(
                f"{geom_type}?crs={self._crs}",
                name,
                "memory"
            )

            if not self.layer.isValid():
                self.sync_error.emit("Failed to create memory layer")
                return None

            provider = self.layer.dataProvider()

            # Build fields list
            fields = QgsFields()

            # Add index tracking field (use QMetaType.Type to avoid deprecation warning)
            fields.append(QgsField(self.INDEX_FIELD, QMetaType.Type.Int))

            # Add data fields
            for col in self._columns_info:
                col_name = col.get('name', '')
                col_type = col.get('type', 'text')

                if not col_name:
                    continue

                # Map GeoChem types to QMetaType.Type (avoids deprecation warning)
                if col_type in ['numeric', 'float', 'double']:
                    qtype = QMetaType.Type.Double
                elif col_type in ['integer', 'int']:
                    qtype = QMetaType.Type.Int
                else:
                    qtype = QMetaType.Type.QString

                fields.append(QgsField(col_name, qtype))

            provider.addAttributes(fields)
            self.layer.updateFields()

            # Add to project if requested
            if add_to_project:
                QgsProject.instance().addMapLayer(self.layer)

            QgsMessageLog.logMessage(
                f"Created layer '{name}' with {len(self._columns_info)} fields",
                "GeoChem",
                Qgis.Info
            )

            return self.layer

        except Exception as e:
            self.sync_error.emit(f"Failed to create layer: {str(e)}")
            QgsMessageLog.logMessage(
                f"Layer creation error: {str(e)}",
                "GeoChem",
                Qgis.Critical
            )
            return None

    def sync_data(
        self,
        filter_indices: Optional[List[int]] = None,
        clear_existing: bool = True
    ) -> int:
        """
        Sync data from GeoChem to QGIS layer.

        Args:
            filter_indices: Optional list of indices to sync (None = all)
            clear_existing: Whether to clear existing features first

        Returns:
            Number of features synced
        """
        if not self.layer:
            self.sync_error.emit("No layer available. Call create_layer first.")
            return 0

        self.sync_started.emit()

        try:
            # Fetch data from GeoChem
            data = self.connection.fetch_data()

            if not data:
                self.sync_error.emit("No data received from GeoChem")
                return 0

            QgsMessageLog.logMessage(
                f"Received {len(data)} rows from GeoChem",
                "GeoChem",
                Qgis.Info
            )

            provider = self.layer.dataProvider()

            # Clear existing features if requested
            if clear_existing:
                provider.truncate()

            # Build features
            features = []
            skipped_no_coords = 0
            skipped_invalid = 0

            for i, row in enumerate(data):
                # Apply filter if provided
                if filter_indices is not None and i not in filter_indices:
                    continue

                try:
                    # Get coordinates
                    x_val = row.get(self._x_field)
                    y_val = row.get(self._y_field)

                    # Parse coordinates
                    x = self._parse_numeric(x_val)
                    y = self._parse_numeric(y_val)

                    if x is None or y is None:
                        skipped_no_coords += 1
                        continue

                    # Create feature with 2D or 3D geometry
                    feature = QgsFeature(self.layer.fields())

                    if self._z_field:
                        # 3D point with Z coordinate
                        z_val = row.get(self._z_field)
                        z = self._parse_numeric(z_val) if z_val is not None else 0.0
                        point = QgsPoint(x, y, z if z is not None else 0.0)
                        feature.setGeometry(QgsGeometry(point))
                    else:
                        # 2D point
                        feature.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))

                    # Set index field
                    feature.setAttribute(self.INDEX_FIELD, i)

                    # Set other attributes
                    for col in self._columns_info:
                        col_name = col.get('name', '')
                        if not col_name or col_name == self.INDEX_FIELD:
                            continue

                        field_idx = self.layer.fields().indexFromName(col_name)
                        if field_idx < 0:
                            continue

                        value = row.get(col_name)
                        field = self.layer.fields().field(field_idx)

                        if value is not None:
                            if field.type() == QVariant.Double:
                                parsed = self._parse_numeric(value)
                                feature.setAttribute(field_idx, parsed)
                            elif field.type() == QVariant.Int:
                                parsed = self._parse_numeric(value)
                                feature.setAttribute(field_idx, int(parsed) if parsed else None)
                            else:
                                feature.setAttribute(field_idx, str(value))

                    features.append(feature)

                except Exception as e:
                    skipped_invalid += 1
                    continue

            # Add features to layer
            if features:
                success, added = provider.addFeatures(features)
                if not success:
                    self.sync_error.emit("Failed to add features to layer")
                    return 0

            self.layer.updateExtents()

            # Log summary
            total_synced = len(features)
            QgsMessageLog.logMessage(
                f"Synced {total_synced} features "
                f"(skipped: {skipped_no_coords} no coords, {skipped_invalid} invalid)",
                "GeoChem",
                Qgis.Info
            )

            self.sync_completed.emit(total_synced)
            return total_synced

        except Exception as e:
            error_msg = f"Sync failed: {str(e)}"
            self.sync_error.emit(error_msg)
            QgsMessageLog.logMessage(error_msg, "GeoChem", Qgis.Critical)
            return 0

    def update_classification(self, column: str, assignments: Dict[int, str]):
        """
        Update classification field values from GeoChem.

        Args:
            column: Classification column name
            assignments: Dict mapping row indices to class values
        """
        if not self.layer:
            return

        try:
            # Check if field exists, create if not
            field_idx = self.layer.fields().indexFromName(column)
            if field_idx < 0:
                provider = self.layer.dataProvider()
                provider.addAttributes([QgsField(column, QMetaType.Type.QString)])
                self.layer.updateFields()
                field_idx = self.layer.fields().indexFromName(column)

            # Update features
            self.layer.startEditing()

            for feature in self.layer.getFeatures():
                idx = feature.attribute(self.INDEX_FIELD)
                if idx is not None and idx in assignments:
                    self.layer.changeAttributeValue(
                        feature.id(),
                        field_idx,
                        assignments[idx]
                    )

            self.layer.commitChanges()
            self.classification_updated.emit(column)

            QgsMessageLog.logMessage(
                f"Updated {len(assignments)} classifications in '{column}'",
                "GeoChem",
                Qgis.Info
            )

        except Exception as e:
            self.layer.rollBack()
            QgsMessageLog.logMessage(
                f"Classification update failed: {str(e)}",
                "GeoChem",
                Qgis.Warning
            )

    def sync_selection_to_qgis(self, indices: List[int]):
        """
        Sync selection from GeoChem to QGIS layer.

        Args:
            indices: List of row indices to select
        """
        if not self.layer:
            return

        self.selection_sync_started.emit()

        try:
            if not indices:
                self.layer.removeSelection()
                self.selection_sync_completed.emit(0)
                return

            # Build expression to select by index
            indices_str = ','.join(map(str, indices))
            expression = f'"{self.INDEX_FIELD}" IN ({indices_str})'

            self.layer.selectByExpression(expression)

            selected_count = self.layer.selectedFeatureCount()
            self.selection_sync_completed.emit(selected_count)

        except Exception as e:
            QgsMessageLog.logMessage(
                f"Selection sync failed: {str(e)}",
                "GeoChem",
                Qgis.Warning
            )

    def get_selected_indices(self) -> List[int]:
        """
        Get indices of currently selected features in QGIS.

        Returns:
            List of GeoChem row indices
        """
        if not self.layer:
            return []

        indices = []
        for feature in self.layer.selectedFeatures():
            idx = feature.attribute(self.INDEX_FIELD)
            if idx is not None:
                indices.append(int(idx))

        return indices

    def send_selection_to_geochem(self):
        """Send current QGIS selection to GeoChem"""
        indices = self.get_selected_indices()
        self.connection.send_selection(indices)

    def get_layer(self) -> Optional[QgsVectorLayer]:
        """Get the current layer"""
        return self.layer

    def get_field_names(self) -> List[str]:
        """Get list of field names in the layer"""
        if not self.layer:
            return []
        return [field.name() for field in self.layer.fields()]

    def get_numeric_fields(self) -> List[str]:
        """Get list of numeric field names"""
        if not self.layer:
            return []

        numeric_fields = []
        for field in self.layer.fields():
            if field.type() in [QVariant.Double, QVariant.Int, QVariant.LongLong]:
                if field.name() != self.INDEX_FIELD:
                    numeric_fields.append(field.name())

        return numeric_fields

    def get_categorical_fields(self) -> List[str]:
        """Get list of categorical/string field names"""
        if not self.layer:
            return []

        cat_fields = []
        for field in self.layer.fields():
            if field.type() == QVariant.String:
                cat_fields.append(field.name())

        return cat_fields

    def get_unique_values(self, field_name: str) -> List[Any]:
        """Get unique values for a field"""
        if not self.layer:
            return []

        field_idx = self.layer.fields().indexFromName(field_name)
        if field_idx < 0:
            return []

        return list(self.layer.uniqueValues(field_idx))

    def get_field_statistics(self, field_name: str) -> Dict[str, float]:
        """
        Get basic statistics for a numeric field.

        Returns:
            Dict with min, max, mean, count
        """
        if not self.layer:
            return {}

        field_idx = self.layer.fields().indexFromName(field_name)
        if field_idx < 0:
            return {}

        values = []
        for feature in self.layer.getFeatures():
            val = feature.attribute(field_idx)
            if val is not None:
                try:
                    values.append(float(val))
                except (ValueError, TypeError):
                    pass

        if not values:
            return {}

        return {
            'min': min(values),
            'max': max(values),
            'mean': sum(values) / len(values),
            'count': len(values)
        }

    # =========================================================================
    # Private Methods
    # =========================================================================

    def _parse_numeric(self, value: Any) -> Optional[float]:
        """Parse a value to numeric, handling various formats"""
        if value is None:
            return None

        if isinstance(value, (int, float)):
            return float(value)

        if isinstance(value, str):
            # Handle empty strings
            if not value.strip():
                return None

            # Handle common non-numeric markers
            if value.upper() in ['NA', 'N/A', 'NULL', '-', '--', '']:
                return None

            try:
                # Remove common formatting
                cleaned = value.replace(',', '').replace(' ', '').strip()
                # Handle < or > prefixes (detection limits)
                if cleaned.startswith('<') or cleaned.startswith('>'):
                    cleaned = cleaned[1:]
                return float(cleaned)
            except ValueError:
                return None

        return None

    def _on_selection_changed(self, indices: List[int]):
        """Handle selection change from GeoChem"""
        self.sync_selection_to_qgis(indices)

    def _on_classification_changed(self, column: str, assignments: Dict[int, str]):
        """Handle classification change from GeoChem"""
        self.update_classification(column, assignments)

    def _on_data_received(self, payload: Dict[str, Any]):
        """Handle data update from GeoChem"""
        # Optionally auto-sync on data updates
        pass
