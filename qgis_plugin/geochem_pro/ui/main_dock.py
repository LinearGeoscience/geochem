"""
Main Dock Widget for GeoChem QGIS Plugin
Provides the primary UI for plugin interaction
"""

from typing import Optional, List, Dict, Any
from PyQt5.QtWidgets import (
    QDockWidget, QWidget, QVBoxLayout, QHBoxLayout,
    QTabWidget, QGroupBox, QLabel, QPushButton,
    QComboBox, QLineEdit, QSpinBox, QDoubleSpinBox,
    QCheckBox, QListWidget, QListWidgetItem,
    QFormLayout, QFrame, QProgressBar, QMessageBox,
    QFileDialog, QSizePolicy
)
from PyQt5.QtCore import pyqtSignal, Qt, QSize
from PyQt5.QtGui import QIcon, QColor
from qgis.core import QgsVectorLayer, QgsProject


class StatusIndicator(QFrame):
    """Simple status indicator widget"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(12, 12)
        self.setFrameShape(QFrame.StyledPanel)
        self._connected = False
        self._update_style()

    def set_connected(self, connected: bool):
        self._connected = connected
        self._update_style()

    def _update_style(self):
        color = '#22c55e' if self._connected else '#ef4444'
        self.setStyleSheet(f'''
            QFrame {{
                background-color: {color};
                border-radius: 6px;
                border: 1px solid #e5e7eb;
            }}
        ''')


class GeochemDockWidget(QDockWidget):
    """
    Main dock widget for GeoChem plugin.

    Provides:
    - Connection status and controls
    - Data sync controls
    - Styling options
    - Export functionality
    """

    # Signals
    connect_requested = pyqtSignal(str, int)  # host, port
    disconnect_requested = pyqtSignal()
    sync_requested = pyqtSignal()
    style_changed = pyqtSignal(dict)  # style config
    export_requested = pyqtSignal(dict)  # export config
    selection_sync_requested = pyqtSignal()
    load_webapp_style_requested = pyqtSignal()  # Request to load style from web app
    export_pathfinders_requested = pyqtSignal(str)  # filepath for pathfinder export

    def __init__(self, parent=None):
        super().__init__("GeoChem", parent)
        self.setObjectName("GeochemProDock")
        self.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)

        self._layer: Optional[QgsVectorLayer] = None
        self._is_connected = False

        self._setup_ui()
        self._connect_signals()

    def _setup_ui(self):
        """Set up the dock widget UI"""
        # Main container
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        # Connection section
        layout.addWidget(self._create_connection_section())

        # Tab widget for main content
        self.tabs = QTabWidget()
        self.tabs.addTab(self._create_data_tab(), "Data")
        self.tabs.addTab(self._create_style_tab(), "Style")
        self.tabs.addTab(self._create_export_tab(), "Export")
        layout.addWidget(self.tabs)

        # Status bar
        layout.addWidget(self._create_status_bar())

        self.setWidget(container)
        self._update_ui_state()

    def _create_connection_section(self) -> QWidget:
        """Create the connection controls section"""
        group = QGroupBox("Connection")
        layout = QVBoxLayout(group)

        # Host/port row
        conn_layout = QHBoxLayout()

        self.status_indicator = StatusIndicator()
        conn_layout.addWidget(self.status_indicator)

        self.host_input = QLineEdit("localhost")
        self.host_input.setPlaceholderText("Host")
        self.host_input.setMaximumWidth(120)
        conn_layout.addWidget(self.host_input)

        conn_layout.addWidget(QLabel(":"))

        self.port_input = QSpinBox()
        self.port_input.setRange(1, 65535)
        self.port_input.setValue(8000)
        self.port_input.setMaximumWidth(70)
        conn_layout.addWidget(self.port_input)

        self.connect_btn = QPushButton("Connect")
        self.connect_btn.setMaximumWidth(80)
        conn_layout.addWidget(self.connect_btn)

        conn_layout.addStretch()
        layout.addLayout(conn_layout)

        return group

    def _create_data_tab(self) -> QWidget:
        """Create the data sync tab"""
        widget = QWidget()
        layout = QVBoxLayout(widget)

        # Coordinate fields
        coord_group = QGroupBox("Coordinate Fields")
        coord_layout = QFormLayout(coord_group)

        self.x_field_combo = QComboBox()
        self.x_field_combo.setEditable(True)
        self.x_field_combo.setCurrentText("x")
        coord_layout.addRow("X Field:", self.x_field_combo)

        self.y_field_combo = QComboBox()
        self.y_field_combo.setEditable(True)
        self.y_field_combo.setCurrentText("y")
        coord_layout.addRow("Y Field:", self.y_field_combo)

        self.z_field_combo = QComboBox()
        self.z_field_combo.setEditable(True)
        self.z_field_combo.addItem("")  # Empty option for 2D
        self.z_field_combo.setCurrentText("")
        self.z_field_combo.setToolTip("Optional: Set Z field for 3D points (for Qgis2threejs)")
        coord_layout.addRow("Z Field (3D):", self.z_field_combo)

        self.crs_combo = QComboBox()
        self.crs_combo.addItems([
            "Project CRS",  # Use current project CRS
            "EPSG:4326 (WGS 84)",
            "EPSG:32632 (UTM 32N)",
            "EPSG:32633 (UTM 33N)",
            "EPSG:28350 (GDA94 MGA Zone 50)",
            "EPSG:28351 (GDA94 MGA Zone 51)",
            "EPSG:28352 (GDA94 MGA Zone 52)",
            "EPSG:28353 (GDA94 MGA Zone 53)",
            "EPSG:28354 (GDA94 MGA Zone 54)",
            "EPSG:28355 (GDA94 MGA Zone 55)",
            "EPSG:28356 (GDA94 MGA Zone 56)",
            "EPSG:7850 (GDA2020 MGA Zone 50)",
            "EPSG:7851 (GDA2020 MGA Zone 51)",
            "EPSG:7852 (GDA2020 MGA Zone 52)",
            "EPSG:7853 (GDA2020 MGA Zone 53)",
            "EPSG:7854 (GDA2020 MGA Zone 54)",
            "EPSG:7855 (GDA2020 MGA Zone 55)",
            "EPSG:7856 (GDA2020 MGA Zone 56)",
        ])
        # Default to Project CRS - most common use case
        self.crs_combo.setCurrentIndex(0)
        coord_layout.addRow("CRS:", self.crs_combo)

        layout.addWidget(coord_group)

        # Sync controls
        sync_group = QGroupBox("Data Sync")
        sync_layout = QVBoxLayout(sync_group)

        btn_layout = QHBoxLayout()
        self.sync_btn = QPushButton("Sync Data")
        self.sync_btn.setEnabled(False)
        btn_layout.addWidget(self.sync_btn)

        self.sync_selection_btn = QPushButton("Sync Selection")
        self.sync_selection_btn.setEnabled(False)
        btn_layout.addWidget(self.sync_selection_btn)

        sync_layout.addLayout(btn_layout)

        self.sync_progress = QProgressBar()
        self.sync_progress.setVisible(False)
        sync_layout.addWidget(self.sync_progress)

        layout.addWidget(sync_group)

        # Layer info
        info_group = QGroupBox("Layer Info")
        info_layout = QFormLayout(info_group)

        self.feature_count_label = QLabel("0")
        info_layout.addRow("Features:", self.feature_count_label)

        self.field_count_label = QLabel("0")
        info_layout.addRow("Fields:", self.field_count_label)

        layout.addWidget(info_group)

        layout.addStretch()
        return widget

    def _create_style_tab(self) -> QWidget:
        """Create the styling tab"""
        widget = QWidget()
        layout = QVBoxLayout(widget)

        # Web App Style sync section (at top for prominence)
        webapp_group = QGroupBox("Web App Style")
        webapp_layout = QVBoxLayout(webapp_group)

        self.load_webapp_style_btn = QPushButton("Load Style from Web App")
        self.load_webapp_style_btn.setEnabled(False)
        self.load_webapp_style_btn.setToolTip(
            "Apply the same styling configured in the GeoChem web app.\n"
            "First sync styles from the web app's Attribute Manager."
        )
        webapp_layout.addWidget(self.load_webapp_style_btn)

        self.webapp_style_info = QLabel("Not loaded")
        self.webapp_style_info.setWordWrap(True)
        self.webapp_style_info.setStyleSheet("color: #666; font-size: 10px;")
        webapp_layout.addWidget(self.webapp_style_info)

        layout.addWidget(webapp_group)

        # Style type selection
        type_group = QGroupBox("Manual Style")
        type_layout = QVBoxLayout(type_group)

        self.style_type_combo = QComboBox()
        self.style_type_combo.addItems([
            "Single Symbol",
            "Classification",
            "Graduated",
            "Cluster",
            "High Grade Highlight"
        ])
        type_layout.addWidget(self.style_type_combo)

        layout.addWidget(type_group)

        # Column selection
        col_group = QGroupBox("Column")
        col_layout = QVBoxLayout(col_group)

        self.style_column_combo = QComboBox()
        col_layout.addWidget(self.style_column_combo)

        layout.addWidget(col_group)

        # Style options
        options_group = QGroupBox("Options")
        options_layout = QFormLayout(options_group)

        self.num_classes_spin = QSpinBox()
        self.num_classes_spin.setRange(2, 20)
        self.num_classes_spin.setValue(5)
        options_layout.addRow("Classes:", self.num_classes_spin)

        self.class_method_combo = QComboBox()
        self.class_method_combo.addItems([
            "Jenks (Natural Breaks)",
            "Quantile",
            "Equal Interval",
            "Standard Deviation",
            "Pretty Breaks"
        ])
        options_layout.addRow("Method:", self.class_method_combo)

        self.color_ramp_combo = QComboBox()
        self.color_ramp_combo.addItems([
            "Viridis", "Plasma", "Inferno", "Magma",
            "Blues", "Reds", "Greens", "RdYlGn"
        ])
        options_layout.addRow("Color Ramp:", self.color_ramp_combo)

        self.threshold_spin = QDoubleSpinBox()
        self.threshold_spin.setRange(0, 1000000)
        self.threshold_spin.setDecimals(4)
        options_layout.addRow("Threshold:", self.threshold_spin)

        layout.addWidget(options_group)

        # Apply button
        self.apply_style_btn = QPushButton("Apply Style")
        self.apply_style_btn.setEnabled(False)
        layout.addWidget(self.apply_style_btn)

        layout.addStretch()
        return widget

    def _create_export_tab(self) -> QWidget:
        """Create the export tab"""
        widget = QWidget()
        layout = QVBoxLayout(widget)

        # Export options
        options_group = QGroupBox("Export Options")
        options_layout = QVBoxLayout(options_group)

        self.include_style_check = QCheckBox("Include current style")
        self.include_style_check.setChecked(True)
        options_layout.addWidget(self.include_style_check)

        self.selected_only_check = QCheckBox("Selected features only")
        options_layout.addWidget(self.selected_only_check)

        # Layer name
        name_layout = QHBoxLayout()
        name_layout.addWidget(QLabel("Layer name:"))
        self.export_name_input = QLineEdit("GeoChem_Export")
        name_layout.addWidget(self.export_name_input)
        options_layout.addLayout(name_layout)

        layout.addWidget(options_group)

        # Multiple styles
        styles_group = QGroupBox("Additional Styles")
        styles_layout = QVBoxLayout(styles_group)

        self.export_styles_list = QListWidget()
        self.export_styles_list.setMaximumHeight(100)
        styles_layout.addWidget(self.export_styles_list)

        style_btn_layout = QHBoxLayout()
        self.add_style_btn = QPushButton("Add Current Style")
        self.add_style_btn.setEnabled(False)
        style_btn_layout.addWidget(self.add_style_btn)

        self.clear_styles_btn = QPushButton("Clear")
        style_btn_layout.addWidget(self.clear_styles_btn)
        styles_layout.addLayout(style_btn_layout)

        layout.addWidget(styles_group)

        # Export button
        self.export_btn = QPushButton("Export to GeoPackage")
        self.export_btn.setEnabled(False)
        layout.addWidget(self.export_btn)

        # Pathfinder export section
        pathfinder_group = QGroupBox("Pathfinder Export")
        pathfinder_layout = QVBoxLayout(pathfinder_group)

        self.export_pathfinders_btn = QPushButton("Export Pathfinders to GeoPackage")
        self.export_pathfinders_btn.setEnabled(False)
        self.export_pathfinders_btn.setToolTip(
            "Export all pathfinder element layers to a single GeoPackage with embedded styles"
        )
        pathfinder_layout.addWidget(self.export_pathfinders_btn)

        self.pathfinder_info_label = QLabel("No pathfinder layers loaded")
        self.pathfinder_info_label.setStyleSheet("color: #666; font-size: 10px;")
        pathfinder_layout.addWidget(self.pathfinder_info_label)

        layout.addWidget(pathfinder_group)

        layout.addStretch()
        return widget

    def _create_status_bar(self) -> QWidget:
        """Create the status bar at the bottom"""
        frame = QFrame()
        frame.setFrameShape(QFrame.StyledPanel)
        layout = QHBoxLayout(frame)
        layout.setContentsMargins(4, 2, 4, 2)

        self.status_label = QLabel("Not connected")
        layout.addWidget(self.status_label)
        layout.addStretch()

        return frame

    def _connect_signals(self):
        """Connect internal signals"""
        self.connect_btn.clicked.connect(self._on_connect_clicked)
        self.sync_btn.clicked.connect(self._on_sync_clicked)
        self.sync_selection_btn.clicked.connect(self.selection_sync_requested.emit)
        self.apply_style_btn.clicked.connect(self._on_apply_style)
        self.export_btn.clicked.connect(self._on_export_clicked)
        self.add_style_btn.clicked.connect(self._on_add_style)
        self.clear_styles_btn.clicked.connect(self._on_clear_styles)
        self.style_type_combo.currentIndexChanged.connect(self._on_style_type_changed)
        self.load_webapp_style_btn.clicked.connect(self.load_webapp_style_requested.emit)
        self.export_pathfinders_btn.clicked.connect(self._on_export_pathfinders_clicked)

    def _on_connect_clicked(self):
        """Handle connect/disconnect button click"""
        if self._is_connected:
            self.disconnect_requested.emit()
        else:
            host = self.host_input.text().strip()
            port = self.port_input.value()
            self.connect_requested.emit(host, port)

    def _on_sync_clicked(self):
        """Handle sync button click"""
        self.sync_progress.setVisible(True)
        self.sync_progress.setRange(0, 0)  # Indeterminate
        self.sync_requested.emit()

    def _on_apply_style(self):
        """Handle apply style button click"""
        style_type = self.style_type_combo.currentIndex()
        column = self.style_column_combo.currentText()

        config = {
            'column': column,
        }

        if style_type == 0:  # Single Symbol
            config['type'] = 'single'
        elif style_type == 1:  # Classification
            config['type'] = 'classification'
        elif style_type == 2:  # Graduated
            config['type'] = 'graduated'
            config['classes'] = self.num_classes_spin.value()
            methods = ['jenks', 'quantile', 'equal', 'stddev', 'pretty']
            config['method'] = methods[self.class_method_combo.currentIndex()]
            config['color_ramp'] = self.color_ramp_combo.currentText().lower()
        elif style_type == 3:  # Cluster
            config['type'] = 'cluster'
        elif style_type == 4:  # High Grade
            config['type'] = 'high_grade'
            config['threshold'] = self.threshold_spin.value()

        self.style_changed.emit(config)

    def _on_export_clicked(self):
        """Handle export button click"""
        filepath, _ = QFileDialog.getSaveFileName(
            self,
            "Export to GeoPackage",
            self.export_name_input.text() + ".gpkg",
            "GeoPackage (*.gpkg)"
        )

        if not filepath:
            return

        config = {
            'filepath': filepath,
            'layer_name': self.export_name_input.text(),
            'include_style': self.include_style_check.isChecked(),
            'selected_only': self.selected_only_check.isChecked(),
            'styles': self._get_export_styles(),
        }

        self.export_requested.emit(config)

    def _on_add_style(self):
        """Add current style to export list"""
        style_type = self.style_type_combo.currentText()
        column = self.style_column_combo.currentText()

        if not column and style_type != "Single Symbol":
            return

        name = f"{style_type} - {column}" if column else style_type
        item = QListWidgetItem(name)
        item.setData(Qt.UserRole, {
            'name': name,
            'type': style_type.lower().replace(' ', '_'),
            'column': column,
        })
        self.export_styles_list.addItem(item)

    def _on_clear_styles(self):
        """Clear export styles list"""
        self.export_styles_list.clear()

    def _on_export_pathfinders_clicked(self):
        """Handle export pathfinders button click"""
        filepath, _ = QFileDialog.getSaveFileName(
            self,
            "Export Pathfinders to GeoPackage",
            "Pathfinders_Export.gpkg",
            "GeoPackage (*.gpkg)"
        )

        if not filepath:
            return

        self.export_pathfinders_requested.emit(filepath)

    def _on_style_type_changed(self, index: int):
        """Update UI based on style type selection"""
        # Show/hide options based on style type
        graduated = (index == 2)
        high_grade = (index == 4)

        self.num_classes_spin.setEnabled(graduated)
        self.class_method_combo.setEnabled(graduated)
        self.color_ramp_combo.setEnabled(graduated)
        self.threshold_spin.setEnabled(high_grade)

    def _get_export_styles(self) -> List[Dict[str, Any]]:
        """Get list of styles to export"""
        styles = []
        for i in range(self.export_styles_list.count()):
            item = self.export_styles_list.item(i)
            style_data = item.data(Qt.UserRole)
            if style_data:
                styles.append(style_data)
        return styles

    def _update_ui_state(self):
        """Update UI elements based on current state"""
        self.connect_btn.setText("Disconnect" if self._is_connected else "Connect")
        self.status_indicator.set_connected(self._is_connected)

        has_layer = self._layer is not None
        self.sync_btn.setEnabled(self._is_connected)
        self.sync_selection_btn.setEnabled(self._is_connected and has_layer)
        self.apply_style_btn.setEnabled(has_layer)
        self.export_btn.setEnabled(has_layer)
        self.add_style_btn.setEnabled(has_layer)
        self.load_webapp_style_btn.setEnabled(self._is_connected and has_layer)

        status = "Connected" if self._is_connected else "Not connected"
        if has_layer:
            status += f" | {self._layer.featureCount()} features"
        self.status_label.setText(status)

    # =========================================================================
    # Public Methods
    # =========================================================================

    def set_connected(self, connected: bool):
        """Update connected state"""
        self._is_connected = connected
        self._update_ui_state()

    def set_layer(self, layer: Optional[QgsVectorLayer]):
        """Set the current layer"""
        self._layer = layer
        self._update_ui_state()

        if layer:
            # Update field combos
            field_names = [field.name() for field in layer.fields()]

            self.x_field_combo.clear()
            self.x_field_combo.addItems(field_names)
            self.y_field_combo.clear()
            self.y_field_combo.addItems(field_names)
            self.z_field_combo.clear()
            self.z_field_combo.addItem("")  # Empty option for 2D
            self.z_field_combo.addItems(field_names)
            self.style_column_combo.clear()
            self.style_column_combo.addItems(field_names)

            # Try to select common coordinate field names
            for name in ['x', 'X', 'longitude', 'lon', 'easting', 'EAST']:
                if name in field_names:
                    self.x_field_combo.setCurrentText(name)
                    break

            for name in ['y', 'Y', 'latitude', 'lat', 'northing', 'NORTH']:
                if name in field_names:
                    self.y_field_combo.setCurrentText(name)
                    break

            # Try to detect Z field (elevation, RL, depth)
            for name in ['RL', 'rl', 'Elevation', 'elevation', 'ELEVATION', 'Z', 'z',
                         'z_mid', 'Z_MID', 'Depth', 'depth', 'DEPTH', 'elev', 'alt', 'altitude']:
                if name in field_names:
                    self.z_field_combo.setCurrentText(name)
                    break

            # Update info labels
            self.feature_count_label.setText(str(layer.featureCount()))
            self.field_count_label.setText(str(len(field_names)))

    def populate_fields_from_columns(self, columns: list):
        """
        Populate coordinate field combos from API columns.
        Call this after connecting to populate dropdowns before syncing.
        """
        field_names = [col.get('name', '') for col in columns if col.get('name')]

        self.x_field_combo.clear()
        self.x_field_combo.addItems(field_names)
        self.y_field_combo.clear()
        self.y_field_combo.addItems(field_names)
        self.z_field_combo.clear()
        self.z_field_combo.addItem("")  # Empty option for 2D
        self.z_field_combo.addItems(field_names)
        self.style_column_combo.clear()
        self.style_column_combo.addItems(field_names)

        # Try to auto-detect coordinate fields by name
        x_candidates = ['East', 'east', 'EAST', 'x', 'X', 'longitude', 'lon', 'easting', 'Easting', 'EASTING']
        y_candidates = ['North', 'north', 'NORTH', 'y', 'Y', 'latitude', 'lat', 'northing', 'Northing', 'NORTHING']
        z_candidates = ['RL', 'rl', 'Elevation', 'elevation', 'ELEVATION', 'Z', 'z',
                        'z_mid', 'Z_MID', 'Depth', 'depth', 'DEPTH', 'elev', 'alt', 'altitude']

        for name in x_candidates:
            if name in field_names:
                self.x_field_combo.setCurrentText(name)
                break

        for name in y_candidates:
            if name in field_names:
                self.y_field_combo.setCurrentText(name)
                break

        for name in z_candidates:
            if name in field_names:
                self.z_field_combo.setCurrentText(name)
                break

        # Also try to detect by role
        for col in columns:
            role = col.get('role', '')
            name = col.get('name', '')
            if role == 'East' or role == 'Easting':
                self.x_field_combo.setCurrentText(name)
            elif role == 'North' or role == 'Northing':
                self.y_field_combo.setCurrentText(name)
            elif role in ['RL', 'Elevation', 'Z', 'Depth']:
                self.z_field_combo.setCurrentText(name)

    def get_x_field(self) -> str:
        """Get selected X coordinate field"""
        return self.x_field_combo.currentText()

    def get_y_field(self) -> str:
        """Get selected Y coordinate field"""
        return self.y_field_combo.currentText()

    def get_z_field(self) -> str:
        """Get selected Z coordinate field (empty string if none)"""
        return self.z_field_combo.currentText()

    def get_crs(self) -> str:
        """Get selected CRS"""
        crs_text = self.crs_combo.currentText()
        if crs_text == "Project CRS":
            # Use current project CRS
            project_crs = QgsProject.instance().crs()
            if project_crs.isValid():
                return project_crs.authid()
            return "EPSG:4326"  # Fallback
        # Extract EPSG code from display text
        return crs_text.split()[0] if crs_text else "EPSG:4326"

    def sync_started(self):
        """Called when sync starts"""
        self.sync_progress.setVisible(True)
        self.sync_progress.setRange(0, 0)
        self.sync_btn.setEnabled(False)

    def sync_completed(self, count: int):
        """Called when sync completes"""
        self.sync_progress.setVisible(False)
        self.sync_btn.setEnabled(True)
        self.feature_count_label.setText(str(count))
        self.status_label.setText(f"Synced {count} features")

    def sync_failed(self, message: str):
        """Called when sync fails"""
        self.sync_progress.setVisible(False)
        self.sync_btn.setEnabled(True)
        QMessageBox.warning(self, "Sync Failed", message)

    def update_webapp_style_info(self, info: str):
        """Update the web app style info label"""
        self.webapp_style_info.setText(info)

    def webapp_style_applied(self, style_type: str):
        """Called when web app style is successfully applied"""
        self.status_label.setText(f"Applied {style_type} style from web app")

    def webapp_style_failed(self, message: str):
        """Called when web app style application fails"""
        QMessageBox.warning(self, "Style Error", message)

    def update_pathfinder_info(self, layer_count: int, element_names: List[str] = None):
        """Update the pathfinder export section info"""
        if layer_count > 0:
            if element_names:
                elements_str = ", ".join(element_names[:5])
                if len(element_names) > 5:
                    elements_str += f"... (+{len(element_names) - 5} more)"
                self.pathfinder_info_label.setText(f"{layer_count} layers: {elements_str}")
            else:
                self.pathfinder_info_label.setText(f"{layer_count} pathfinder layers loaded")
            self.export_pathfinders_btn.setEnabled(True)
        else:
            self.pathfinder_info_label.setText("No pathfinder layers loaded")
            self.export_pathfinders_btn.setEnabled(False)

    def pathfinder_layers_created(self, count: int):
        """Called when pathfinder layers are created"""
        self.update_pathfinder_info(count)
        self.status_label.setText(f"Created {count} pathfinder layers")
