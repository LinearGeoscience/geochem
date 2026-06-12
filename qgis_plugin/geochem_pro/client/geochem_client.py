"""
QGIS-specific client that bridges protocol with QGIS operations.
Modeled after ioGAS gaslinkclient_app.py.
"""

from qgis.PyQt.QtCore import QObject, QTimer

from ..comms.signals import GeochemSignals
from ..comms.transport import WebSocketTransport
from ..comms.protocol import GeochemProtocol
from ..data.data_loader import DataLoader
from ..data.geochem_data import GeochemData
from ..layer.layer_factory import LayerFactory
from ..layer.symbology import SymbologyManager
from ..layer.pathfinder import PathfinderManager
from ..support import logger, config


class GeochemClient(QObject):
    """
    QGIS application-level client. Coordinates data loading,
    layer creation, and bidirectional sync.
    Equivalent to ioGAS GasLinkClient_App.
    """

    def __init__(self, iface, signals: GeochemSignals):
        super().__init__()
        self.iface = iface
        self.signals = signals

        # Components
        self.transport = WebSocketTransport()
        self.protocol = GeochemProtocol(self.transport)
        self.data_loader = DataLoader()
        self.layer_factory = LayerFactory()
        self.symbology = SymbologyManager()
        self.pathfinder = PathfinderManager()

        # State
        self._data = None
        self._selection_guard = False  # prevent selection echo
        self._sync_timeout = None      # timeout for WebSocket data request

        # Wire transport signals
        self.transport.connected.connect(self._on_connected)
        self.transport.disconnected.connect(self._on_disconnected)
        self.transport.reconnecting.connect(self._on_reconnecting)
        self.transport.error.connect(self._on_error)

        # Wire protocol signals
        self.protocol.state_synced.connect(self._on_state_synced)
        self.protocol.data_available.connect(self._on_data_available)
        self.protocol.data_response.connect(self._on_data_response)
        self.protocol.selection_received.connect(self._on_selection_from_app)
        self.protocol.classification_received.connect(
            self._on_classification_received
        )
        self.protocol.styles_available.connect(self._on_styles_available)
        self.protocol.pathfinders_available.connect(
            self._on_pathfinders_available
        )
        self.protocol.data_too_large.connect(self._on_data_too_large)
        self.protocol.data_update.connect(self._on_data_update)

    def connect(self, host=None, port=None):
        """Connect to GeoChem backend."""
        if host:
            config.set_host(host)
        if port:
            config.set_port(port)

        self.data_loader.update_base_url()
        url = config.get_ws_url()
        logger.log_info(f"Connecting to {url}", "client")
        self.transport.connect_to(url)

    def disconnect(self):
        """Disconnect from backend."""
        self._unwire_selection()
        self.transport.disconnect_from()

    def is_connected(self):
        return self.transport.is_connected()

    # --- Data operations ---

    def sync_data(self):
        """Fetch data from backend and create/update layer."""
        self.signals.data_loading.emit()
        logger.log_info("Syncing data from backend", "client")

        # Try WebSocket request first
        if self.transport.is_connected():
            self.protocol.request_data()
            # Set timeout: if no response in 15s, fall back to REST
            self._sync_timeout = QTimer()
            self._sync_timeout.setSingleShot(True)
            self._sync_timeout.timeout.connect(self._on_sync_timeout)
            self._sync_timeout.start(15000)
            return  # Response will arrive via _on_data_response

        # Fallback to REST
        self._load_data_rest()

    def _on_sync_timeout(self):
        """WebSocket data request timed out, fall back to REST."""
        logger.log_warning(
            "WebSocket data request timed out, falling back to REST",
            "client"
        )
        self._sync_timeout = None
        self._load_data_rest()

    def _load_data_rest(self):
        """Load data via REST API (fallback)."""
        data = self.data_loader.load_data()
        if data:
            self._apply_data(data)
        else:
            self.signals.data_error.emit("No data available from backend")

    def _apply_data(self, data: GeochemData):
        """Create/update QGIS layer from GeochemData."""
        self._data = data

        if data.row_count == 0:
            self.signals.data_error.emit("Dataset is empty (0 rows)")
            return

        if not data.has_coordinates():
            self.signals.data_error.emit(
                f"No coordinate fields detected. "
                f"Available columns: {', '.join(data.column_names()[:10])}"
            )
            return

        # Preserve labeling from old layer before removing
        old_layer = self.layer_factory.get_live_layer()
        saved_labeling = None
        saved_labels_enabled = False
        if old_layer:
            labeling = old_layer.labeling()
            if labeling:
                saved_labeling = labeling.clone()
                saved_labels_enabled = old_layer.labelsEnabled()

        # Remove old layer
        self._unwire_selection()
        self.layer_factory.remove_live_layer()

        # Create new layer
        layer = self.layer_factory.create_layer(data)
        if not layer:
            self.signals.data_error.emit("Failed to create layer")
            return

        # Restore labeling if we had it
        if saved_labeling:
            layer.setLabeling(saved_labeling)
            layer.setLabelsEnabled(saved_labels_enabled)

        self.layer_factory.add_to_project(layer)
        self._wire_selection(layer)

        # Zoom to layer
        self.iface.mapCanvas().setExtent(layer.extent())
        self.iface.mapCanvas().refresh()

        self.signals.data_loaded.emit(data.row_count)

    # --- Style operations ---

    def sync_styles(self):
        """Load and apply styles from backend."""
        styles = self.data_loader.load_styles()
        if styles:
            layer = self.layer_factory.get_live_layer()
            if layer:
                result = self.symbology.apply_webapp_styles(layer, styles)
                if result:
                    self.signals.style_applied.emit(result)
            else:
                logger.log_warning("No layer to apply styles to", "client")
        else:
            logger.log_warning("No styles available from backend", "client")

    def apply_classification(self, column, custom_colors=None):
        """Apply classification styling to current layer."""
        layer = self.layer_factory.get_live_layer()
        if layer:
            self.symbology.apply_classification_style(
                layer, column, custom_colors
            )
            self.signals.style_applied.emit("classification")

    def apply_graduated(self, column, num_classes=5, ramp="viridis"):
        """Apply graduated styling to current layer."""
        layer = self.layer_factory.get_live_layer()
        if layer:
            self.symbology.apply_graduated(
                layer, column, num_classes, ramp
            )
            self.signals.style_applied.emit("graduated")

    def apply_highlight(self, column, threshold):
        """Apply high-grade highlighting."""
        layer = self.layer_factory.get_live_layer()
        if layer:
            self.symbology.highlight_high_grades(layer, column, threshold)
            self.signals.style_applied.emit("highlight")

    # --- Pathfinder operations ---

    def sync_pathfinders(self, elements=None):
        """Create pathfinder element layers."""
        if not self._data:
            logger.log_warning("No data loaded for pathfinders", "client")
            return

        count = self.pathfinder.create_layers(self._data, elements)
        self.signals.pathfinder_layers_created.emit(count)

    # --- Selection sync ---

    def _wire_selection(self, layer):
        """Wire up QGIS selection changed to sync to app."""
        layer.selectionChanged.connect(self._on_qgis_selection_changed)

    def _unwire_selection(self):
        """Unwire selection from old layer."""
        layer = self.layer_factory.get_live_layer()
        if layer:
            try:
                layer.selectionChanged.disconnect(
                    self._on_qgis_selection_changed
                )
            except TypeError:
                pass

    def _on_qgis_selection_changed(self, selected, deselected, clear):
        """Handle selection change in QGIS map."""
        if self._selection_guard:
            return

        indices = self.layer_factory.get_selected_indices()
        if self.transport.is_connected():
            self.protocol.send_selection(indices)
        self.signals.selection_to_app.emit(indices)

    def _on_selection_from_app(self, indices):
        """Handle selection change from web app."""
        self._selection_guard = True
        try:
            self.layer_factory.select_by_indices(indices)
        finally:
            self._selection_guard = False

    # --- Protocol event handlers ---

    def _on_connected(self):
        logger.log_info("Connected to GeoChem backend", "client")
        self.signals.connected.emit()

    def _on_disconnected(self):
        logger.log_info("Disconnected from GeoChem backend", "client")
        self.signals.disconnected.emit()

    def _on_reconnecting(self, attempt):
        logger.log_info(f"Reconnection attempt {attempt}", "client")
        self.signals.reconnecting.emit(attempt)

    def _on_error(self, msg):
        logger.log_error(f"Connection error: {msg}", "client")
        self.signals.connection_error.emit(msg)

    def _on_state_synced(self, state):
        """Handle initial state sync on connection."""
        # Restore selection
        selection = state.get("selection", [])
        if selection:
            self._on_selection_from_app(selection)

        # Store classifications
        classifications = state.get("classifications", {})
        for column, assignments in classifications.items():
            self.signals.classification_received.emit(column, assignments)

        # Auto-request data if available on backend and not yet loaded
        if state.get("data_available") and not self._data:
            logger.log_info(
                f"Data available on backend ({state.get('data_rows', 0)} rows), "
                "auto-syncing", "client"
            )
            self.sync_data()

    def _on_data_available(self, rows, cols):
        """Backend notifying that new data is available."""
        logger.log_info(
            f"Data available: {rows} rows, {cols} columns", "client"
        )
        self.signals.data_available.emit(rows, cols)

    def _on_data_response(self, data_rows, columns_info):
        """Handle data response from WebSocket request."""
        # Cancel sync timeout
        if self._sync_timeout:
            self._sync_timeout.stop()
            self._sync_timeout = None

        from ..data.geochem_data import GeochemColumn

        geochem_data = GeochemData()

        # Build columns
        if columns_info:
            for i, col_info in enumerate(columns_info):
                col = GeochemColumn(
                    name=col_info.get("name", f"col_{i}"),
                    data_type=DataLoader._map_type(
                        col_info.get("type", "text")
                    ),
                    role=col_info.get("role", ""),
                    alias=col_info.get("alias", ""),
                    index=i,
                )
                geochem_data.columns.append(col)
        elif data_rows:
            for i, key in enumerate(data_rows[0].keys()):
                val = data_rows[0][key]
                dtype = "numeric" if isinstance(val, (int, float)) else "text"
                geochem_data.columns.append(
                    GeochemColumn(name=key, data_type=dtype, index=i)
                )

        geochem_data.rows = data_rows
        geochem_data.detect_coordinate_fields()
        self._apply_data(geochem_data)

    def _on_data_too_large(self, total_rows):
        """Dataset too large for WebSocket, fall back to REST."""
        if self._sync_timeout:
            self._sync_timeout.stop()
            self._sync_timeout = None
        logger.log_info(
            f"Dataset too large for WebSocket ({total_rows} rows), "
            "loading via REST", "client"
        )
        self._load_data_rest()

    def _on_classification_received(self, column, assignments):
        """Handle classification update from web app."""
        self.signals.classification_received.emit(column, assignments)
        layer = self.layer_factory.get_live_layer()
        if layer:
            custom_colors = {}
            for idx_str, class_name in assignments.items():
                custom_colors[class_name] = None  # Use default colors
            self.symbology.apply_classification_style(layer, column)

    def _on_styles_available(self, msg):
        """Backend notifying styles are available."""
        self.signals.styles_received.emit(msg)

    def _on_pathfinders_available(self, msg):
        """Backend notifying pathfinders are available."""
        self.signals.pathfinders_received.emit(msg)

    def _on_data_update(self, payload):
        """Handle data update notification."""
        logger.log_info("Data update received, re-syncing", "client")
        self.sync_data()

    # --- Cleanup ---

    def cleanup(self):
        """Clean up all resources."""
        self._unwire_selection()
        self.transport.disconnect_from()
        self.pathfinder.remove_all_layers()
