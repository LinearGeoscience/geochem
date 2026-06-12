"""
JSON message protocol handler.
Modeled after ioGAS gaslinkclient_base.py.
Parses incoming messages, routes to typed signals, constructs outgoing messages.
"""

import json
from qgis.PyQt.QtCore import QObject, pyqtSignal

from ..support import logger
from .transport import WebSocketTransport


class GeochemProtocol(QObject):
    """
    Handles the GeoChem WebSocket JSON protocol.
    Connected to a WebSocketTransport for raw I/O.
    """

    # Typed signals for each incoming message type
    state_synced = pyqtSignal(dict)
    data_available = pyqtSignal(int, int)       # rows, columns
    data_response = pyqtSignal(list, list)      # data, columns
    data_too_large = pyqtSignal(int)            # total_rows — use REST instead
    columns_response = pyqtSignal(list)
    selection_received = pyqtSignal(list)        # indices
    classification_received = pyqtSignal(str, dict)  # column, assignments
    styles_available = pyqtSignal(dict)
    pathfinders_available = pyqtSignal(dict)
    data_update = pyqtSignal(dict)
    error_received = pyqtSignal(str)

    def __init__(self, transport: WebSocketTransport):
        super().__init__()
        self.transport = transport
        self.transport.message_received.connect(self._on_message)

    # Known message types for dispatch
    _KNOWN_TYPES = {
        "state_sync", "data_available", "data_response",
        "columns_response", "selection", "classification",
        "styles_available", "pathfinders_available",
        "data_update", "error", "ping",
    }

    def _on_message(self, raw: str):
        """Parse incoming JSON and route to appropriate handler."""
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            logger.log_warning(f"Malformed JSON: {raw[:200]}", "protocol")
            return

        msg_type = message.get("type", "")
        if msg_type in self._KNOWN_TYPES:
            handler_name = f"_handle_{msg_type}"
            handler = getattr(self, handler_name, None)
            if handler:
                handler(message)
        else:
            logger.log_debug(f"Unhandled message type: {msg_type}", "protocol")

    # --- Incoming message handlers ---

    def _handle_state_sync(self, msg):
        self.state_synced.emit(msg)

    def _handle_data_available(self, msg):
        rows = msg.get("rows", 0)
        cols = msg.get("columns", 0)
        self.data_available.emit(rows, cols)

    def _handle_data_response(self, msg):
        if msg.get("use_rest"):
            self.data_too_large.emit(msg.get("total_rows", 0))
            return
        data = msg.get("data", [])
        columns = msg.get("columns", [])
        self.data_response.emit(data, columns)

    def _handle_columns_response(self, msg):
        columns = msg.get("columns", [])
        self.columns_response.emit(columns)

    def _handle_selection(self, msg):
        indices = msg.get("indices", [])
        source = msg.get("source", "")
        # Only process selections from frontend, not our own echoes
        if source == "frontend":
            self.selection_received.emit(indices)

    def _handle_classification(self, msg):
        column = msg.get("column", "")
        assignments = msg.get("assignments", {})
        self.classification_received.emit(column, assignments)

    def _handle_styles_available(self, msg):
        self.styles_available.emit(msg)

    def _handle_pathfinders_available(self, msg):
        self.pathfinders_available.emit(msg)

    def _handle_data_update(self, msg):
        self.data_update.emit(msg.get("payload", {}))

    def _handle_error(self, msg):
        self.error_received.emit(msg.get("message", "Unknown error"))

    def _handle_ping(self, msg):
        self.send_pong()

    # --- Outgoing messages ---

    def send_selection(self, indices):
        self.transport.send_json({
            "type": "selection",
            "indices": indices,
            "source": "qgis",
        })

    def request_state(self):
        self.transport.send_json({"type": "request_state"})

    def request_data(self):
        self.transport.send_json({"type": "request_data"})

    def request_columns(self):
        self.transport.send_json({"type": "request_columns"})

    def send_pong(self):
        self.transport.send_json({"type": "pong"})
