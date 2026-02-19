"""
GeoChem QGIS Plugin
Main plugin class that orchestrates all components
"""

import os
from typing import Optional, Dict, Any, List

from PyQt5.QtWidgets import QAction, QMessageBox, QToolBar
from PyQt5.QtGui import QIcon
from PyQt5.QtCore import Qt, QSettings

from qgis.core import (
    QgsProject,
    QgsVectorLayer,
    QgsMessageLog,
    Qgis
)
from qgis.gui import QgisInterface

from .core.connection import GeochemConnectionManager
from .core.data_sync import DataSyncManager
from .core.style_manager import GeochemStyleManager
from .core.style_sync import StyleSyncManager
from .core.geopackage import GeopackageExporter
from .core.pathfinder_sync import PathfinderSyncManager
from .ui.main_dock import GeochemDockWidget
from .ui.connection_dialog import ConnectionDialog
from .ui.export_dialog import ExportDialog
from .utils.plugin_logging import PluginLogger


class GeochemProPlugin:
    """
    Main QGIS plugin class for GeoChem integration.

    Provides:
    - Connection management to GeoChem backend
    - Data synchronization
    - Layer styling based on classifications
    - GeoPackage export with embedded styles
    - Bidirectional selection synchronization
    """

    def __init__(self, iface: QgisInterface):
        """
        Initialize the plugin.

        Args:
            iface: QGIS interface instance
        """
        self.iface = iface
        self.plugin_dir = os.path.dirname(__file__)

        # Initialize logging
        self.logger = PluginLogger.get_logger()

        # Components (initialized in initGui)
        self.connection_manager: Optional[GeochemConnectionManager] = None
        self.data_sync: Optional[DataSyncManager] = None
        self.style_manager: Optional[GeochemStyleManager] = None
        self.style_sync: Optional[StyleSyncManager] = None
        self.pathfinder_sync: Optional[PathfinderSyncManager] = None

        # UI components
        self.dock_widget: Optional[GeochemDockWidget] = None
        self.toolbar: Optional[QToolBar] = None
        self.actions: List[QAction] = []

        # Settings
        self.settings = QSettings('LinearGeoscience', 'GeochemPro')

        # State
        self._is_initialized = False

    def initGui(self):
        """Initialize the plugin GUI"""
        self.logger.info("Initializing GeoChem plugin")

        # Create toolbar
        self.toolbar = self.iface.addToolBar("GeoChem")
        self.toolbar.setObjectName("GeochemProToolbar")

        # Create actions
        self._create_actions()

        # Create dock widget
        self.dock_widget = GeochemDockWidget(self.iface.mainWindow())
        self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock_widget)

        # Connect dock widget signals
        self._connect_dock_signals()

        # Initialize connection manager
        host = self.settings.value('connection/host', 'localhost')
        port = self.settings.value('connection/port', 8000, type=int)
        self.connection_manager = GeochemConnectionManager(host, port)

        # Connect connection manager signals
        self._connect_connection_signals()

        # Initialize data sync
        self.data_sync = DataSyncManager(self.connection_manager)
        self._connect_sync_signals()

        # Initialize style sync manager
        self.style_sync = StyleSyncManager(self.connection_manager)
        self.style_sync.style_applied.connect(self._on_webapp_style_applied)
        self.style_sync.style_error.connect(self._on_webapp_style_error)

        # Initialize pathfinder sync manager
        self.pathfinder_sync = PathfinderSyncManager(
            self.connection_manager,
            self.data_sync
        )
        self.pathfinder_sync.layers_created.connect(self._on_pathfinder_layers_created)
        self.pathfinder_sync.export_completed.connect(self._on_pathfinder_export_completed)
        self.pathfinder_sync.error_occurred.connect(self._on_pathfinder_error)

        # Connect pathfinders_available signal
        self.connection_manager.pathfinders_available.connect(self._on_pathfinders_available)

        # Connect to layer selection changes
        self.iface.mapCanvas().selectionChanged.connect(self._on_qgis_selection_changed)

        self._is_initialized = True
        self.logger.info("GeoChem plugin initialized successfully")

    def unload(self):
        """Cleanup when plugin is unloaded"""
        self.logger.info("Unloading GeoChem plugin")

        # Disconnect from server
        if self.connection_manager and self.connection_manager.is_connected:
            self.connection_manager.disconnect()

        # Remove toolbar and actions
        for action in self.actions:
            self.iface.removeToolBarIcon(action)

        if self.toolbar:
            del self.toolbar

        # Remove dock widget
        if self.dock_widget:
            self.iface.removeDockWidget(self.dock_widget)
            del self.dock_widget

        self._is_initialized = False
        self.logger.info("GeoChem plugin unloaded")

    def _create_actions(self):
        """Create plugin actions"""
        # Connect action
        icon_connect = self._get_icon('connect.svg')
        self.action_connect = QAction(icon_connect, "Connect to GeoChem", self.iface.mainWindow())
        self.action_connect.setToolTip("Connect to GeoChem application")
        self.action_connect.triggered.connect(self._on_connect_action)
        self.toolbar.addAction(self.action_connect)
        self.actions.append(self.action_connect)

        # Sync action
        icon_sync = self._get_icon('sync.svg')
        self.action_sync = QAction(icon_sync, "Sync Data", self.iface.mainWindow())
        self.action_sync.setToolTip("Synchronize data from GeoChem")
        self.action_sync.triggered.connect(self._on_sync_action)
        self.action_sync.setEnabled(False)
        self.toolbar.addAction(self.action_sync)
        self.actions.append(self.action_sync)

        # Export action
        icon_export = self._get_icon('export.svg')
        self.action_export = QAction(icon_export, "Export to GeoPackage", self.iface.mainWindow())
        self.action_export.setToolTip("Export layer to styled GeoPackage")
        self.action_export.triggered.connect(self._on_export_action)
        self.action_export.setEnabled(False)
        self.toolbar.addAction(self.action_export)
        self.actions.append(self.action_export)

        # Settings action
        icon_settings = self._get_icon('settings.svg')
        self.action_settings = QAction(icon_settings, "Settings", self.iface.mainWindow())
        self.action_settings.setToolTip("Configure connection settings")
        self.action_settings.triggered.connect(self._on_settings_action)
        self.toolbar.addAction(self.action_settings)
        self.actions.append(self.action_settings)

    def _get_icon(self, name: str) -> QIcon:
        """Get icon from plugin icons directory"""
        icon_path = os.path.join(self.plugin_dir, 'icons', name)
        if os.path.exists(icon_path):
            return QIcon(icon_path)
        # Return default QGIS icon if custom icon not found
        return QIcon(':/images/themes/default/mActionZoomIn.svg')

    def _connect_dock_signals(self):
        """Connect dock widget signals to handlers"""
        self.dock_widget.connect_requested.connect(self._connect_to_geochem)
        self.dock_widget.disconnect_requested.connect(self._disconnect_from_geochem)
        self.dock_widget.sync_requested.connect(self._sync_data)
        self.dock_widget.style_changed.connect(self._apply_style)
        self.dock_widget.export_requested.connect(self._export_geopackage)
        self.dock_widget.selection_sync_requested.connect(self._sync_selection_to_geochem)
        self.dock_widget.load_webapp_style_requested.connect(self._load_webapp_style)
        self.dock_widget.export_pathfinders_requested.connect(self.export_pathfinders_to_geopackage)

    def _connect_connection_signals(self):
        """Connect connection manager signals"""
        self.connection_manager.connected.connect(self._on_connected)
        self.connection_manager.disconnected.connect(self._on_disconnected)
        self.connection_manager.connection_error.connect(self._on_connection_error)
        self.connection_manager.selection_changed.connect(self._on_selection_from_geochem)
        self.connection_manager.classification_changed.connect(self._on_classification_changed)

    def _connect_sync_signals(self):
        """Connect data sync signals"""
        self.data_sync.sync_started.connect(self._on_sync_started)
        self.data_sync.sync_completed.connect(self._on_sync_completed)
        self.data_sync.sync_error.connect(self._on_sync_error)

    # =========================================================================
    # Action Handlers
    # =========================================================================

    def _on_connect_action(self):
        """Handle connect toolbar action"""
        if self.connection_manager.is_connected:
            self._disconnect_from_geochem()
        else:
            host = self.dock_widget.host_input.text()
            port = self.dock_widget.port_input.value()
            self._connect_to_geochem(host, port)

    def _on_sync_action(self):
        """Handle sync toolbar action"""
        self._sync_data()

    def _on_export_action(self):
        """Handle export toolbar action"""
        if not self.data_sync or not self.data_sync.layer:
            QMessageBox.warning(
                self.iface.mainWindow(),
                "No Data",
                "Please sync data before exporting."
            )
            return

        config = ExportDialog.get_export_settings(
            self.iface.mainWindow(),
            self.data_sync.layer,
            "GeoChem_Export"
        )

        if config:
            self._export_geopackage(config)

    def _on_settings_action(self):
        """Handle settings toolbar action"""
        settings = ConnectionDialog.get_connection_settings(
            self.iface.mainWindow(),
            self.connection_manager.host if self.connection_manager else "localhost",
            self.connection_manager.port if self.connection_manager else 8000
        )

        if settings:
            # Save settings
            self.settings.setValue('connection/host', settings['host'])
            self.settings.setValue('connection/port', settings['port'])

            # Update connection manager
            if self.connection_manager:
                self.connection_manager.set_connection(
                    settings['host'],
                    settings['port']
                )

    # =========================================================================
    # Connection Handlers
    # =========================================================================

    def _connect_to_geochem(self, host: str, port: int):
        """Establish connection to GeoChem"""
        self.logger.info(f"Connecting to GeoChem at {host}:{port}")

        if self.connection_manager:
            self.connection_manager.set_connection(host, port)
            success = self.connection_manager.connect()

            if not success:
                QMessageBox.warning(
                    self.iface.mainWindow(),
                    "Connection Failed",
                    f"Could not connect to GeoChem at {host}:{port}.\n\n"
                    "Please ensure the GeoChem application is running."
                )

    def _disconnect_from_geochem(self):
        """Disconnect from GeoChem"""
        if self.connection_manager:
            self.connection_manager.disconnect()

    def _on_connected(self):
        """Handle successful connection"""
        self.logger.info("Connected to GeoChem")

        self.action_sync.setEnabled(True)
        self.action_export.setEnabled(True)
        self.action_connect.setText("Disconnect")
        self.action_connect.setToolTip("Disconnect from GeoChem")

        self.dock_widget.set_connected(True)

        # Populate coordinate field dropdowns from API columns
        try:
            columns = self.connection_manager.fetch_columns()
            if columns:
                self.dock_widget.populate_fields_from_columns(columns)
                self.logger.info(f"Populated {len(columns)} fields from GeoChem")
        except Exception as e:
            self.logger.warning(f"Could not fetch columns: {e}")

        self.iface.messageBar().pushSuccess(
            "GeoChem",
            "Connected successfully"
        )

    def _on_disconnected(self):
        """Handle disconnection"""
        self.logger.info("Disconnected from GeoChem")

        self.action_sync.setEnabled(False)
        self.action_export.setEnabled(False)
        self.action_connect.setText("Connect to GeoChem")
        self.action_connect.setToolTip("Connect to GeoChem application")

        self.dock_widget.set_connected(False)

        self.iface.messageBar().pushWarning(
            "GeoChem",
            "Disconnected"
        )

    def _on_connection_error(self, error: str):
        """Handle connection error"""
        self.logger.error(f"Connection error: {error}")

        self.iface.messageBar().pushCritical(
            "GeoChem",
            f"Connection error: {error}"
        )

    # =========================================================================
    # Data Sync Handlers
    # =========================================================================

    def _sync_data(self):
        """Synchronize data from GeoChem"""
        if not self.connection_manager or not self.connection_manager.is_connected:
            QMessageBox.warning(
                self.iface.mainWindow(),
                "Not Connected",
                "Please connect to GeoChem first."
            )
            return

        # Get coordinate fields from dock
        x_field = self.dock_widget.get_x_field()
        y_field = self.dock_widget.get_y_field()
        z_field = self.dock_widget.get_z_field()
        crs = self.dock_widget.get_crs()

        self.dock_widget.sync_started()

        # Create layer if needed
        if not self.data_sync.layer:
            self.data_sync.set_coordinate_fields(x_field, y_field, z_field)
            self.data_sync.set_crs(crs)
            layer = self.data_sync.create_layer(
                name="GeoChem Data",
                z_field=z_field,
                add_to_project=True
            )

            if layer:
                self.style_manager = GeochemStyleManager(layer)
                self.dock_widget.set_layer(layer)

        # Sync data
        self.data_sync.sync_data()

    def _on_sync_started(self):
        """Handle sync start"""
        self.logger.debug("Data sync started")

    def _on_sync_completed(self, count: int):
        """Handle sync completion"""
        self.logger.info(f"Data sync completed: {count} features")

        self.dock_widget.sync_completed(count)
        self.action_export.setEnabled(count > 0)

        if self.data_sync.layer:
            # Zoom to layer extent
            self.iface.mapCanvas().setExtent(self.data_sync.layer.extent())
            self.iface.mapCanvas().refresh()

        self.iface.messageBar().pushSuccess(
            "GeoChem",
            f"Synced {count} features"
        )

    def _on_sync_error(self, error: str):
        """Handle sync error"""
        self.logger.error(f"Data sync error: {error}")

        self.dock_widget.sync_failed(error)

        self.iface.messageBar().pushCritical(
            "GeoChem",
            f"Sync failed: {error}"
        )

    # =========================================================================
    # Style Handlers
    # =========================================================================

    def _apply_style(self, config: Dict[str, Any]):
        """Apply styling to the layer"""
        if not self.style_manager:
            self.logger.warning("No style manager available")
            return

        style_type = config.get('type')
        column = config.get('column')

        self.logger.debug(f"Applying style: {style_type} on {column}")

        try:
            if style_type == 'single':
                self.style_manager.apply_single_symbol()

            elif style_type == 'classification':
                self.style_manager.apply_classification_style(column)

            elif style_type == 'graduated':
                num_classes = config.get('classes', 5)
                method = config.get('method', 'jenks')
                color_ramp = config.get('color_ramp', 'viridis')
                self.style_manager.apply_graduated_style(
                    column, num_classes, method, color_ramp
                )

            elif style_type == 'cluster':
                self.style_manager.apply_cluster_style(column)

            elif style_type == 'high_grade':
                threshold = config.get('threshold', 0)
                self.style_manager.highlight_high_grades(column, threshold)

            self.iface.mapCanvas().refresh()

        except Exception as e:
            self.logger.exception(e, "Error applying style")
            QMessageBox.warning(
                self.iface.mainWindow(),
                "Style Error",
                f"Failed to apply style: {str(e)}"
            )

    def _load_webapp_style(self):
        """Load and apply styling from web app"""
        if not self.data_sync.layer:
            self.logger.warning("No layer to style")
            return

        self.logger.info("Loading style from web app...")

        # Set the layer on style sync manager
        self.style_sync.set_layer(self.data_sync.layer)

        # Fetch and apply styles
        success = self.style_sync.fetch_and_apply_styles()

        if success:
            self.iface.mapCanvas().refresh()

    def _on_webapp_style_applied(self, style_type: str):
        """Handle successful web app style application"""
        self.logger.info(f"Applied {style_type} style from web app")
        self.dock_widget.webapp_style_applied(style_type)

        # Update style info
        try:
            styles = self.connection_manager.fetch_styles()
            if styles:
                info = self.style_sync.get_style_summary(styles)
                self.dock_widget.update_webapp_style_info(info)
        except Exception as e:
            self.logger.warning(f"Could not update style info: {e}")

        self.iface.messageBar().pushSuccess(
            "GeoChem",
            f"Applied {style_type} style from web app"
        )

    def _on_webapp_style_error(self, error: str):
        """Handle web app style error"""
        self.logger.error(f"Web app style error: {error}")
        self.dock_widget.webapp_style_failed(error)

    # =========================================================================
    # Export Handlers
    # =========================================================================

    def _export_geopackage(self, config: Dict[str, Any]):
        """Export layer to GeoPackage"""
        if not self.data_sync or not self.data_sync.layer:
            return

        filepath = config.get('filepath')
        layer_name = config.get('layer_name', 'GeoChem_Export')
        include_style = config.get('include_style', True)
        selected_only = config.get('selected_only', False)
        styles = config.get('styles', [])

        self.logger.info(f"Exporting to GeoPackage: {filepath}")

        exporter = GeopackageExporter(self.data_sync.layer)

        try:
            if styles:
                result = exporter.export_with_multiple_styles(
                    filepath, styles, layer_name, selected_only
                )
            else:
                result = exporter.export(
                    filepath, layer_name, include_style, selected_only
                )

            if result['success']:
                self.iface.messageBar().pushSuccess(
                    "GeoChem",
                    result['message']
                )

                # Ask if user wants to add to project
                reply = QMessageBox.question(
                    self.iface.mainWindow(),
                    "Add to Project",
                    "Export successful. Add the exported layer to the project?",
                    QMessageBox.Yes | QMessageBox.No,
                    QMessageBox.Yes
                )

                if reply == QMessageBox.Yes:
                    exported_layer = QgsVectorLayer(
                        f"{filepath}|layername={layer_name}",
                        layer_name,
                        "ogr"
                    )
                    if exported_layer.isValid():
                        QgsProject.instance().addMapLayer(exported_layer)
            else:
                self.iface.messageBar().pushCritical(
                    "GeoChem",
                    f"Export failed: {result['message']}"
                )

        except Exception as e:
            self.logger.exception(e, "Export error")
            QMessageBox.critical(
                self.iface.mainWindow(),
                "Export Error",
                f"Failed to export: {str(e)}"
            )

    # =========================================================================
    # Selection Sync Handlers
    # =========================================================================

    def _on_qgis_selection_changed(self, layer: QgsVectorLayer):
        """Handle selection change in QGIS"""
        if not self.data_sync or layer != self.data_sync.layer:
            return

        # Send selection to GeoChem
        self._sync_selection_to_geochem()

    def _sync_selection_to_geochem(self):
        """Send current QGIS selection to GeoChem"""
        if self.data_sync:
            self.data_sync.send_selection_to_geochem()

    def _on_selection_from_geochem(self, indices: List[int]):
        """Handle selection change from GeoChem"""
        if self.data_sync:
            self.data_sync.sync_selection_to_qgis(indices)

    def _on_classification_changed(self, column: str, assignments: Dict[int, str]):
        """Handle classification update from GeoChem"""
        if self.data_sync:
            self.data_sync.update_classification(column, assignments)

            # Refresh styling if using classification style
            if self.style_manager:
                style_info = self.style_manager.get_current_style_info()
                if style_info.get('type') == 'categorical' and style_info.get('column') == column:
                    self.style_manager.apply_classification_style(column)

    # =========================================================================
    # Pathfinder Handlers
    # =========================================================================

    def _on_pathfinders_available(self, message: dict):
        """Handle pathfinders available notification from web app"""
        elements = message.get('elements', [])
        self.logger.info(f"Pathfinders available: {elements}")

        if not self.pathfinder_sync:
            self.logger.warning("Pathfinder sync manager not initialized")
            self.iface.messageBar().pushWarning(
                "GeoChem",
                "Pathfinder sync not initialized."
            )
            return

        # Fetch full pathfinder configuration
        config = self.connection_manager.fetch_pathfinders()
        self.logger.info(f"Fetched pathfinder config: {config.get('elements', []) if config else 'None'}")

        if not config or not config.get('elements'):
            self.logger.warning("No pathfinder configuration available from server")
            self.iface.messageBar().pushWarning(
                "GeoChem",
                "No pathfinder configuration received from web app."
            )
            return

        # Create pathfinder layers (fetches data directly from backend)
        self.logger.info(f"Creating pathfinder layers for elements: {config.get('elements')}")
        count = self.pathfinder_sync.create_pathfinder_layers(config)

        if count > 0:
            self.iface.messageBar().pushSuccess(
                "GeoChem",
                f"Created {count} pathfinder layers"
            )
        else:
            self.iface.messageBar().pushWarning(
                "GeoChem",
                "No pathfinder layers created. Check element column mappings in QGIS log."
            )

    def _on_pathfinder_layers_created(self, count: int):
        """Handle pathfinder layers created"""
        self.logger.info(f"Created {count} pathfinder layers")
        # Refresh map canvas
        self.iface.mapCanvas().refresh()
        # Update dock widget
        if self.dock_widget and self.pathfinder_sync:
            element_names = list(self.pathfinder_sync._element_layers.keys())
            self.dock_widget.update_pathfinder_info(count, element_names)

    def _on_pathfinder_export_completed(self, filepath: str):
        """Handle pathfinder export completion"""
        self.logger.info(f"Pathfinder layers exported to {filepath}")

        # Ask if user wants to add exported layers to project
        reply = QMessageBox.question(
            self.iface.mainWindow(),
            "Add to Project",
            f"Pathfinder layers exported successfully.\n\nAdd exported layers to project?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes
        )

        if reply == QMessageBox.Yes:
            # Load the geopackage layers
            from qgis.core import QgsVectorLayer
            import sqlite3

            try:
                # Get layer names from geopackage
                conn = sqlite3.connect(filepath)
                cursor = conn.cursor()
                cursor.execute("SELECT table_name FROM gpkg_contents WHERE data_type='features'")
                layer_names = [row[0] for row in cursor.fetchall()]
                conn.close()

                for layer_name in layer_names:
                    layer = QgsVectorLayer(
                        f"{filepath}|layername={layer_name}",
                        layer_name,
                        "ogr"
                    )
                    if layer.isValid():
                        QgsProject.instance().addMapLayer(layer)

            except Exception as e:
                self.logger.warning(f"Could not load exported layers: {e}")

    def _on_pathfinder_error(self, error: str):
        """Handle pathfinder sync error"""
        self.logger.error(f"Pathfinder error: {error}")
        self.iface.messageBar().pushCritical(
            "GeoChem",
            f"Pathfinder error: {error}"
        )

    def export_pathfinders_to_geopackage(self, filepath: str):
        """Export current pathfinder layers to GeoPackage"""
        if not self.pathfinder_sync:
            return

        result = self.pathfinder_sync.export_to_geopackage(filepath)
        if result['success']:
            self.iface.messageBar().pushSuccess(
                "GeoChem",
                result['message']
            )
        else:
            self.iface.messageBar().pushCritical(
                "GeoChem",
                f"Export failed: {result['message']}"
            )
