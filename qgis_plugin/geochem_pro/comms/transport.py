"""
Raw WebSocket I/O with background QThread listener.
Modeled after ioGAS gaslinkcomms.py but using WebSocket instead of TCP sockets.
"""

import json
import queue
import threading
from qgis.PyQt.QtCore import QObject, QThread, pyqtSignal

from ..support import logger


class WebSocketThread(QThread):
    """Background thread that runs the WebSocket connection loop."""

    message_received = pyqtSignal(str)
    ws_connected = pyqtSignal()
    ws_disconnected = pyqtSignal()
    ws_error = pyqtSignal(str)

    def __init__(self, url):
        super().__init__()
        self.url = url
        self._stop_requested = False
        self._ws = None
        self._send_queue = queue.Queue()
        self._ws_ready = threading.Event()

    def run(self):
        try:
            import websocket
        except ImportError:
            self.ws_error.emit(
                "websocket-client library not installed. "
                "Install via: pip install websocket-client"
            )
            return

        try:
            self._ws = websocket.WebSocketApp(
                self.url,
                on_open=self._on_open,
                on_message=self._on_message,
                on_error=self._on_error,
                on_close=self._on_close,
            )
            self._ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as e:
            self.ws_error.emit(f"WebSocket connection failed: {e}")
        finally:
            self._ws = None
            self._ws_ready.clear()
            if not self._stop_requested:
                self.ws_disconnected.emit()

    def _on_open(self, ws):
        logger.log_info("WebSocket connected", "transport")
        self._ws_ready.set()
        self.ws_connected.emit()
        # Flush any messages queued before connection was ready
        self._flush_queue(ws)

    def _on_message(self, ws, message):
        self.message_received.emit(message)

    def _on_error(self, ws, error):
        if not self._stop_requested:
            logger.log_error(f"WebSocket error: {error}", "transport")
            self.ws_error.emit(str(error))

    def _on_close(self, ws, close_status_code, close_msg):
        logger.log_info(
            f"WebSocket closed (code={close_status_code})", "transport"
        )
        self._ws_ready.clear()
        if not self._stop_requested:
            self.ws_disconnected.emit()

    def _flush_queue(self, ws):
        """Send all queued messages (called from WebSocket thread)."""
        while not self._send_queue.empty():
            try:
                text = self._send_queue.get_nowait()
                ws.send(text)
            except queue.Empty:
                break
            except Exception as e:
                logger.log_error(f"Failed to send queued message: {e}", "transport")

    def send(self, text):
        """Thread-safe send: queues message for the WebSocket thread."""
        if self._ws and self._ws_ready.is_set():
            try:
                self._ws.send(text)
            except Exception:
                # Queue for retry if direct send fails
                self._send_queue.put(text)
        else:
            self._send_queue.put(text)

    def stop(self):
        self._stop_requested = True
        self._ws_ready.clear()
        if self._ws:
            self._ws.close()


class WebSocketTransport(QObject):
    """
    Manages WebSocket connection with a background listener thread.
    Equivalent to ioGAS GasLinkComms.
    """

    message_received = pyqtSignal(str)
    connected = pyqtSignal()
    disconnected = pyqtSignal()
    reconnecting = pyqtSignal(int)  # attempt number
    error = pyqtSignal(str)

    MAX_RECONNECT_ATTEMPTS = 3
    RECONNECT_BASE_DELAY = 2000  # ms

    def __init__(self):
        super().__init__()
        self._thread = None
        self._connected = False
        self._url = None
        self._user_disconnect = False
        self._reconnect_attempt = 0
        self._reconnect_timer = None

    def connect_to(self, url):
        """Start WebSocket connection to the given URL."""
        if self._thread and self._thread.isRunning():
            self.disconnect_from()

        self._url = url
        self._user_disconnect = False
        self._reconnect_attempt = 0
        logger.log_info(f"Connecting to {url}", "transport")
        self._start_connection(url)

    def _start_connection(self, url):
        """Internal: create thread and connect."""
        self._thread = WebSocketThread(url)
        self._thread.message_received.connect(self.message_received)
        self._thread.ws_connected.connect(self._on_connected)
        self._thread.ws_disconnected.connect(self._on_disconnected)
        self._thread.ws_error.connect(self._on_error)
        self._thread.start()

    def disconnect_from(self):
        """Disconnect and stop the background thread (user-initiated)."""
        self._user_disconnect = True
        self._cancel_reconnect()
        if self._thread:
            self._thread.stop()
            self._thread.wait(3000)
            self._thread = None
        self._connected = False

    def _cancel_reconnect(self):
        """Cancel any pending reconnection attempt."""
        if self._reconnect_timer:
            self._reconnect_timer.stop()
            self._reconnect_timer = None
        self._reconnect_attempt = 0

    def send(self, text):
        """Send a text message over the WebSocket."""
        if self._thread and self._connected:
            self._thread.send(text)

    def send_json(self, obj):
        """Send a JSON-serializable object."""
        self.send(json.dumps(obj))

    def is_connected(self):
        return self._connected

    def _on_connected(self):
        self._connected = True
        self._reconnect_attempt = 0
        self.connected.emit()

    def _on_disconnected(self):
        self._connected = False
        if not self._user_disconnect and self._url:
            self._try_reconnect()
        else:
            self.disconnected.emit()

    def _on_error(self, msg):
        self._connected = False
        if not self._user_disconnect and self._url:
            self._try_reconnect()
        else:
            self.error.emit(msg)

    def _try_reconnect(self):
        """Attempt to reconnect with exponential backoff."""
        from qgis.PyQt.QtCore import QTimer
        self._reconnect_attempt += 1
        if self._reconnect_attempt > self.MAX_RECONNECT_ATTEMPTS:
            logger.log_warning(
                f"Reconnection failed after {self.MAX_RECONNECT_ATTEMPTS} attempts",
                "transport"
            )
            self._reconnect_attempt = 0
            self.disconnected.emit()
            return

        delay = self.RECONNECT_BASE_DELAY * (2 ** (self._reconnect_attempt - 1))
        logger.log_info(
            f"Reconnecting (attempt {self._reconnect_attempt}/{self.MAX_RECONNECT_ATTEMPTS}) "
            f"in {delay}ms", "transport"
        )
        self.reconnecting.emit(self._reconnect_attempt)

        self._reconnect_timer = QTimer()
        self._reconnect_timer.setSingleShot(True)
        self._reconnect_timer.timeout.connect(self._do_reconnect)
        self._reconnect_timer.start(delay)

    def _do_reconnect(self):
        """Execute the reconnection attempt."""
        self._reconnect_timer = None
        if self._user_disconnect:
            return
        if self._thread:
            self._thread.wait(1000)
            self._thread = None
        self._start_connection(self._url)
