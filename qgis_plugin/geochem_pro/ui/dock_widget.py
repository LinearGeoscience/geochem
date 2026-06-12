"""
Main dock widget for the GeoChem QGIS plugin.
Provides connection, data sync, styling, and export controls.
"""

from qgis.PyQt.QtWidgets import (
    QDockWidget, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QLineEdit, QSpinBox,
    QGroupBox, QComboBox, QFileDialog, QMessageBox,
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor
from qgis.core import Qgis

from ..comms.signals import GeochemSignals
from ..support import config


class GeochemDockWidget(QDockWidget):
    """Main dock widget with connection, data, style, and export controls."""

    def __init__(self, iface, signals: GeochemSignals, parent=None):
        super().__init__("GeoChem Integration", parent)
        self.iface = iface
        self.signals = signals
        self._client = None

        self.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)

        main_widget = QWidget()
        layout = QVBoxLayout()
        layout.setSpacing(8)

        # Connection section
        layout.addWidget(self._create_connection_group())

        # Data section
        layout.addWidget(self._create_data_group())

        # Style section
        layout.addWidget(self._create_style_group())

        # Pathfinder section
        layout.addWidget(self._create_pathfinder_group())

        # Export section
        layout.addWidget(self._create_export_group())

        layout.addStretch()
        main_widget.setLayout(layout)
        self.setWidget(main_widget)

        # Wire signals
        self.signals.connected.connect(self._on_connected)
        self.signals.disconnected.connect(self._on_disconnected)
        self.signals.reconnecting.connect(self._on_reconnecting)
        self.signals.connection_error.connect(self._on_connection_error)
        self.signals.data_loading.connect(self._on_data_loading)
        self.signals.data_loaded.connect(self._on_data_loaded)
        self.signals.data_error.connect(self._on_data_error)
        self.signals.style_applied.connect(self._on_style_applied)
        self.signals.data_available.connect(self._on_data_available)
        self.signals.pathfinder_layers_created.connect(
            self._on_pathfinders_created
        )

    def set_client(self, client):
        """Set the GeochemClient instance."""
        self._client = client

    # --- UI Creation ---

    def _create_connection_group(self):
        group = QGroupBox("Connection")
        layout = QVBoxLayout()

        # Host/port row
        row = QHBoxLayout()
        row.addWidget(QLabel("Host:"))
        self.host_input = QLineEdit(config.get_host())
        self.host_input.setPlaceholderText("localhost")
        row.addWidget(self.host_input, 2)
        row.addWidget(QLabel("Port:"))
        self.port_input = QSpinBox()
        self.port_input.setRange(1, 65535)
        self.port_input.setValue(config.get_port())
        row.addWidget(self.port_input, 1)
        layout.addLayout(row)

        # Connect button + status
        row2 = QHBoxLayout()
        self.connect_btn = QPushButton("Connect")
        self.connect_btn.clicked.connect(self._on_connect_clicked)
        row2.addWidget(self.connect_btn)
        self.status_label = QLabel("Disconnected")
        self.status_label.setStyleSheet("color: #e74c3c; font-weight: bold;")
        row2.addWidget(self.status_label)
        layout.addLayout(row2)

        group.setLayout(layout)
        return group

    def _create_data_group(self):
        group = QGroupBox("Data")
        layout = QVBoxLayout()

        self.sync_btn = QPushButton("Sync Data")
        self.sync_btn.setEnabled(False)
        self.sync_btn.clicked.connect(self._on_sync_clicked)
        layout.addWidget(self.sync_btn)

        self.data_status = QLabel("No data loaded")
        layout.addWidget(self.data_status)

        group.setLayout(layout)
        return group

    def _create_style_group(self):
        group = QGroupBox("Styling")
        layout = QVBoxLayout()

        self.style_btn = QPushButton("Load Web App Style")
        self.style_btn.setEnabled(False)
        self.style_btn.clicked.connect(self._on_style_clicked)
        layout.addWidget(self.style_btn)

        # Column selector for classification
        row = QHBoxLayout()
        row.addWidget(QLabel("Column:"))
        self.style_column_combo = QComboBox()
        row.addWidget(self.style_column_combo, 1)
        layout.addLayout(row)

        row2 = QHBoxLayout()
        self.classify_btn = QPushButton("Classify")
        self.classify_btn.setEnabled(False)
        self.classify_btn.clicked.connect(self._on_classify_clicked)
        row2.addWidget(self.classify_btn)

        self.graduated_btn = QPushButton("Graduated")
        self.graduated_btn.setEnabled(False)
        self.graduated_btn.clicked.connect(self._on_graduated_clicked)
        row2.addWidget(self.graduated_btn)
        layout.addLayout(row2)

        self.style_status = QLabel("")
        layout.addWidget(self.style_status)

        group.setLayout(layout)
        return group

    def _create_pathfinder_group(self):
        group = QGroupBox("Pathfinders")
        layout = QVBoxLayout()

        self.pathfinder_btn = QPushButton("Create Pathfinder Layers")
        self.pathfinder_btn.setEnabled(False)
        self.pathfinder_btn.clicked.connect(self._on_pathfinder_clicked)
        layout.addWidget(self.pathfinder_btn)

        self.pathfinder_status = QLabel("")
        layout.addWidget(self.pathfinder_status)

        group.setLayout(layout)
        return group

    def _create_export_group(self):
        group = QGroupBox("Export")
        layout = QVBoxLayout()

        self.export_btn = QPushButton("Export GeoPackage")
        self.export_btn.setEnabled(False)
        self.export_btn.clicked.connect(self._on_export_clicked)
        layout.addWidget(self.export_btn)

        group.setLayout(layout)
        return group

    # --- Button handlers ---

    def _on_connect_clicked(self):
        if self._client and self._client.is_connected():
            self._client.disconnect()
        elif self._client:
            host = self.host_input.text().strip() or "localhost"
            port = self.port_input.value()
            self.status_label.setText("Connecting...")
            self.status_label.setStyleSheet("color: #f39c12; font-weight: bold;")
            self.connect_btn.setEnabled(False)
            self._client.connect(host, port)

    def _on_sync_clicked(self):
        if self._client:
            self._client.sync_data()

    def _on_style_clicked(self):
        if self._client:
            self._client.sync_styles()

    def _on_classify_clicked(self):
        if self._client:
            col = self.style_column_combo.currentText()
            if col:
                self._client.apply_classification(col)

    def _on_graduated_clicked(self):
        if self._client:
            col = self.style_column_combo.currentText()
            if col:
                self._client.apply_graduated(col)

    def _on_pathfinder_clicked(self):
        if self._client:
            self._client.sync_pathfinders()

    def _on_export_clicked(self):
        if not self._client:
            return
        layer = self._client.layer_factory.get_live_layer()
        if not layer:
            QMessageBox.warning(self, "Export", "No data layer to export.")
            return

        filepath, _ = QFileDialog.getSaveFileName(
            self, "Export GeoPackage", "", "GeoPackage (*.gpkg)"
        )
        if filepath:
            from ..export.geopackage import export_layer_to_geopackage
            if export_layer_to_geopackage(layer, filepath):
                self.iface.messageBar().pushSuccess(
                    "GeoChem", f"Exported to {filepath}"
                )
            else:
                self.iface.messageBar().pushWarning(
                    "GeoChem", "Export failed"
                )

    # --- Signal handlers ---

    def _on_connected(self):
        self.status_label.setText("Connected")
        self.status_label.setStyleSheet("color: #2ecc71; font-weight: bold;")
        self.connect_btn.setText("Disconnect")
        self.connect_btn.setEnabled(True)
        self.sync_btn.setEnabled(True)
        self.style_btn.setEnabled(True)
        self.iface.messageBar().pushMessage(
            "GeoChem", "Connected to backend", level=Qgis.Success, duration=3
        )

    def _on_disconnected(self):
        self.status_label.setText("Disconnected")
        self.status_label.setStyleSheet("color: #e74c3c; font-weight: bold;")
        self.connect_btn.setText("Connect")
        self.connect_btn.setEnabled(True)
        self.sync_btn.setEnabled(False)
        self.style_btn.setEnabled(False)
        self.iface.messageBar().pushMessage(
            "GeoChem", "Disconnected from backend", level=Qgis.Info, duration=3
        )

    def _on_reconnecting(self, attempt):
        self.status_label.setText(f"Reconnecting ({attempt}/3)...")
        self.status_label.setStyleSheet("color: #f39c12; font-weight: bold;")
        self.connect_btn.setEnabled(False)

    def _on_connection_error(self, msg):
        self.status_label.setText(f"Error: {msg[:40]}")
        self.status_label.setStyleSheet("color: #e74c3c; font-weight: bold;")
        self.connect_btn.setText("Connect")
        self.connect_btn.setEnabled(True)
        self.iface.messageBar().pushWarning("GeoChem", f"Connection error: {msg}")

    def _on_data_loading(self):
        self.data_status.setText("Loading data...")
        self.sync_btn.setEnabled(False)

    def _on_data_loaded(self, count):
        self.data_status.setText(f"{count} features loaded")
        self.sync_btn.setEnabled(True)
        self.classify_btn.setEnabled(True)
        self.graduated_btn.setEnabled(True)
        self.pathfinder_btn.setEnabled(True)
        self.export_btn.setEnabled(True)
        self.iface.messageBar().pushMessage(
            "GeoChem", f"{count} features loaded", level=Qgis.Success, duration=3
        )

        # Populate column combo
        self.style_column_combo.clear()
        if self._client and self._client._data:
            for col in self._client._data.columns:
                self.style_column_combo.addItem(col.name)

    def _on_data_error(self, msg):
        self.data_status.setText(f"Error: {msg[:60]}")
        self.sync_btn.setEnabled(True)
        self.iface.messageBar().pushWarning("GeoChem", f"Data error: {msg}")

    def _on_data_available(self, rows, cols):
        self.data_status.setText(f"Data available: {rows} rows, {cols} columns")
        self.sync_btn.setEnabled(True)

    def _on_style_applied(self, style_type):
        self.style_status.setText(f"Applied: {style_type}")

    def _on_pathfinders_created(self, count):
        self.pathfinder_status.setText(f"{count} pathfinder layers created")
        self.iface.messageBar().pushMessage(
            "GeoChem", f"{count} pathfinder layers created",
            level=Qgis.Success, duration=3
        )
