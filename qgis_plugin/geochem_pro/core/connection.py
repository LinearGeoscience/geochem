"""
Connection Manager for GeoChem Pro QGIS Plugin
Handles WebSocket and REST connections to GeoChem Pro backend
"""

import json
import threading
import time
from typing import Optional, Dict, Any, List, Callable
from urllib.parse import urljoin

from PyQt5.QtCore import QObject, pyqtSignal, QTimer, QThread
from qgis.core import QgsMessageLog, Qgis

# Try to import requests - if not available, we'll use urllib
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    import urllib.error
    HAS_REQUESTS = False

# Try to import websocket-client
try:
    import websocket
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False


class WebSocketThread(QThread):
    """Thread for WebSocket connection to avoid blocking main thread"""

    message_received = pyqtSignal(dict)
    connected = pyqtSignal()
    disconnected = pyqtSignal()
    error = pyqtSignal(str)

    def __init__(self, url: str, parent=None):
        super().__init__(parent)
        self.url = url
        self.ws: Optional[websocket.WebSocketApp] = None
        self._running = False
        self._reconnect_delay = 5

    def run(self):
        """Run WebSocket connection in thread"""
        self._running = True

        while self._running:
            try:
                self.ws = websocket.WebSocketApp(
                    self.url,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                    on_open=self._on_open
                )
                self.ws.run_forever(ping_interval=30, ping_timeout=10)

                # If we get here, connection was lost
                if self._running:
                    QgsMessageLog.logMessage(
                        f"WebSocket disconnected, reconnecting in {self._reconnect_delay}s...",
                        "GeoChem Pro",
                        Qgis.Warning
                    )
                    time.sleep(self._reconnect_delay)

            except Exception as e:
                self.error.emit(str(e))
                if self._running:
                    time.sleep(self._reconnect_delay)

    def stop(self):
        """Stop the WebSocket thread"""
        self._running = False
        if self.ws:
            self.ws.close()

    def send(self, message: dict):
        """Send message through WebSocket"""
        if self.ws and self._running:
            try:
                self.ws.send(json.dumps(message))
            except Exception as e:
                self.error.emit(f"Failed to send message: {str(e)}")

    def _on_message(self, ws, message: str):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            self.message_received.emit(data)
        except json.JSONDecodeError as e:
            QgsMessageLog.logMessage(
                f"Invalid JSON received: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )

    def _on_error(self, ws, error):
        """Handle WebSocket error"""
        self.error.emit(str(error))

    def _on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket close"""
        self.disconnected.emit()

    def _on_open(self, ws):
        """Handle WebSocket open"""
        self.connected.emit()


class GeochemConnectionManager(QObject):
    """
    Manages connection to GeoChem Pro application.
    Supports both REST API for data fetching and WebSocket for real-time updates.
    """

    # Signals
    connected = pyqtSignal()
    disconnected = pyqtSignal()
    connection_error = pyqtSignal(str)
    data_received = pyqtSignal(dict)
    selection_changed = pyqtSignal(list)
    classification_changed = pyqtSignal(str, dict)  # column, {index: class}

    def __init__(self, host: str = "localhost", port: int = 8000, parent=None):
        super().__init__(parent)
        self.host = host
        self.port = port
        self._update_urls()

        self.is_connected = False
        self._ws_thread: Optional[WebSocketThread] = None
        self._reconnect_timer = QTimer(self)
        self._reconnect_timer.timeout.connect(self._attempt_reconnect)
        self._reconnect_interval = 5000  # 5 seconds

        # Connection status tracking
        self._last_error: Optional[str] = None
        self._connection_attempts = 0
        self._max_reconnect_attempts = 10

    def _update_urls(self):
        """Update URLs based on host and port"""
        self.base_url = f"http://{self.host}:{self.port}"
        self.ws_url = f"ws://{self.host}:{self.port}/api/qgis/ws/qgis"
        self.qgis_api_url = f"{self.base_url}/api/qgis"  # QGIS-specific endpoints
        self.data_api_url = f"{self.base_url}/api/data"  # Data endpoints

    def set_connection(self, host: str, port: int):
        """Update connection settings"""
        if self.is_connected:
            self.disconnect()

        self.host = host
        self.port = port
        self._update_urls()

    def connect(self) -> bool:
        """
        Establish connection to GeoChem Pro.
        First tests REST API, then establishes WebSocket if available.

        Returns:
            bool: True if connection successful
        """
        self._connection_attempts += 1

        # First test REST API connectivity
        if not self._test_rest_connection():
            return False

        # Establish WebSocket connection for real-time updates
        if HAS_WEBSOCKET:
            self._start_websocket()
        else:
            QgsMessageLog.logMessage(
                "websocket-client not installed. Real-time sync disabled.",
                "GeoChem Pro",
                Qgis.Warning
            )
            # Still consider connected if REST works
            self.is_connected = True
            self.connected.emit()

        return True

    def _test_rest_connection(self) -> bool:
        """Test REST API connectivity"""
        try:
            response = self._http_get(f"{self.base_url}/api/health")
            if response:
                QgsMessageLog.logMessage(
                    f"REST API connected to {self.base_url}",
                    "GeoChem Pro",
                    Qgis.Info
                )
                return True
            return False
        except Exception as e:
            self._last_error = str(e)
            self.connection_error.emit(f"REST connection failed: {str(e)}")
            return False

    def _start_websocket(self):
        """Start WebSocket connection thread"""
        if self._ws_thread and self._ws_thread.isRunning():
            self._ws_thread.stop()
            self._ws_thread.wait()

        self._ws_thread = WebSocketThread(self.ws_url, self)
        self._ws_thread.connected.connect(self._on_ws_connected)
        self._ws_thread.disconnected.connect(self._on_ws_disconnected)
        self._ws_thread.error.connect(self._on_ws_error)
        self._ws_thread.message_received.connect(self._handle_message)
        self._ws_thread.start()

    def _on_ws_connected(self):
        """Handle WebSocket connection established"""
        self.is_connected = True
        self._connection_attempts = 0
        self._reconnect_timer.stop()
        self.connected.emit()
        QgsMessageLog.logMessage(
            f"WebSocket connected to {self.ws_url}",
            "GeoChem Pro",
            Qgis.Info
        )

    def _on_ws_disconnected(self):
        """Handle WebSocket disconnection"""
        was_connected = self.is_connected
        self.is_connected = False

        if was_connected:
            self.disconnected.emit()
            # Start reconnection attempts
            if self._connection_attempts < self._max_reconnect_attempts:
                self._reconnect_timer.start(self._reconnect_interval)

    def _on_ws_error(self, error: str):
        """Handle WebSocket error"""
        self._last_error = error
        self.connection_error.emit(error)
        QgsMessageLog.logMessage(
            f"WebSocket error: {error}",
            "GeoChem Pro",
            Qgis.Warning
        )

    def _attempt_reconnect(self):
        """Attempt to reconnect"""
        if self._connection_attempts >= self._max_reconnect_attempts:
            self._reconnect_timer.stop()
            self.connection_error.emit(
                f"Max reconnection attempts ({self._max_reconnect_attempts}) reached"
            )
            return

        self.connect()

    def disconnect(self):
        """Disconnect from GeoChem Pro"""
        self._reconnect_timer.stop()

        if self._ws_thread:
            self._ws_thread.stop()
            self._ws_thread.wait(2000)  # Wait up to 2 seconds
            self._ws_thread = None

        self.is_connected = False
        self.disconnected.emit()
        QgsMessageLog.logMessage(
            "Disconnected from GeoChem Pro",
            "GeoChem Pro",
            Qgis.Info
        )

    def _handle_message(self, data: Dict[str, Any]):
        """Route incoming WebSocket messages to appropriate handlers"""
        msg_type = data.get('type')

        if msg_type == 'data_update':
            self.data_received.emit(data.get('payload', {}))

        elif msg_type == 'selection':
            # Only handle if from geochem app (not echoing our own)
            if data.get('source') != 'qgis':
                self.selection_changed.emit(data.get('indices', []))

        elif msg_type == 'classification':
            column = data.get('column')
            assignments = data.get('assignments', {})
            # Convert string keys to int
            assignments = {int(k): v for k, v in assignments.items()}
            self.classification_changed.emit(column, assignments)

        elif msg_type == 'ping':
            self.send_message({'type': 'pong'})

    def send_message(self, message: dict):
        """Send message via WebSocket"""
        if self._ws_thread:
            self._ws_thread.send(message)

    def send_selection(self, indices: List[int]):
        """Send selection indices to GeoChem Pro"""
        self.send_message({
            'type': 'selection',
            'indices': indices,
            'source': 'qgis'
        })

    # =========================================================================
    # REST API Methods
    # =========================================================================

    def _http_get(self, url: str, timeout: int = 10) -> Optional[Dict[str, Any]]:
        """
        Perform HTTP GET request.
        Works with or without requests library.
        """
        if HAS_REQUESTS:
            try:
                response = requests.get(url, timeout=timeout)
                response.raise_for_status()
                return response.json()
            except requests.RequestException as e:
                raise Exception(f"HTTP GET failed: {str(e)}")
        else:
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    return json.loads(response.read().decode('utf-8'))
            except urllib.error.URLError as e:
                raise Exception(f"HTTP GET failed: {str(e)}")

    def _http_post(self, url: str, data: dict, timeout: int = 10) -> Optional[Dict[str, Any]]:
        """Perform HTTP POST request"""
        if HAS_REQUESTS:
            try:
                response = requests.post(
                    url,
                    json=data,
                    headers={'Content-Type': 'application/json'},
                    timeout=timeout
                )
                response.raise_for_status()
                return response.json() if response.text else None
            except requests.RequestException as e:
                raise Exception(f"HTTP POST failed: {str(e)}")
        else:
            try:
                req = urllib.request.Request(
                    url,
                    data=json.dumps(data).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    content = response.read().decode('utf-8')
                    return json.loads(content) if content else None
            except urllib.error.URLError as e:
                raise Exception(f"HTTP POST failed: {str(e)}")

    def fetch_data(self) -> List[Dict[str, Any]]:
        """
        Fetch current dataset from GeoChem Pro.

        Returns:
            List of data rows as dictionaries
        """
        try:
            # Use QGIS-specific endpoint (data pushed from frontend)
            result = self._http_get(f"{self.qgis_api_url}/data")
            return result if isinstance(result, list) else result.get('data', [])
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to fetch data: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return []

    def fetch_columns(self) -> List[Dict[str, str]]:
        """
        Fetch column metadata from GeoChem Pro.

        Returns:
            List of column info dicts with 'name', 'type', 'role', 'alias'
        """
        try:
            # Use QGIS-specific endpoint (data pushed from frontend)
            result = self._http_get(f"{self.qgis_api_url}/columns")
            return result if isinstance(result, list) else result.get('columns', [])
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to fetch columns: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return []

    def fetch_classifications(self) -> Dict[str, List[str]]:
        """
        Fetch all classification columns and their unique values.

        Returns:
            Dict mapping column names to list of unique class values
        """
        try:
            result = self._http_get(f"{self.qgis_api_url}/classifications")
            return result if isinstance(result, dict) else {}
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to fetch classifications: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return {}

    def fetch_styles(self) -> Dict[str, Any]:
        """
        Fetch attribute styling configuration from GeoChem Pro.

        Returns:
            Dict with color, shape, size configs and global settings
        """
        try:
            result = self._http_get(f"{self.qgis_api_url}/styles")
            return result if isinstance(result, dict) else {}
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to fetch styles: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return {}

    def fetch_selected_indices(self) -> List[int]:
        """
        Fetch currently selected indices from GeoChem Pro.

        Returns:
            List of selected row indices
        """
        try:
            result = self._http_get(f"{self.qgis_api_url}/selection")
            return result if isinstance(result, list) else result.get('indices', [])
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to fetch selection: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return []

    def push_selection(self, indices: List[int]) -> bool:
        """
        Push selection to GeoChem Pro via REST.

        Args:
            indices: List of selected row indices

        Returns:
            bool: Success status
        """
        try:
            self._http_post(f"{self.qgis_api_url}/selection", {'indices': indices})
            return True
        except Exception as e:
            QgsMessageLog.logMessage(
                f"Failed to push selection: {str(e)}",
                "GeoChem Pro",
                Qgis.Warning
            )
            return False

    def get_last_error(self) -> Optional[str]:
        """Get the last error message"""
        return self._last_error

    def get_connection_info(self) -> Dict[str, Any]:
        """Get current connection information"""
        return {
            'host': self.host,
            'port': self.port,
            'base_url': self.base_url,
            'ws_url': self.ws_url,
            'qgis_api_url': self.qgis_api_url,
            'data_api_url': self.data_api_url,
            'is_connected': self.is_connected,
            'has_websocket': HAS_WEBSOCKET,
            'connection_attempts': self._connection_attempts,
            'last_error': self._last_error
        }
