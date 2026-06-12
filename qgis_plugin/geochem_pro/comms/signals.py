"""
Centralized Qt signal definitions for thread-safe cross-module communication.
Modeled after ioGAS signalling_app.py.
"""

from qgis.PyQt.QtCore import QObject, pyqtSignal


class GeochemSignals(QObject):
    """
    All cross-thread communication goes through these signals.
    Single instance shared across the plugin.
    """

    # Connection lifecycle
    connected = pyqtSignal()
    disconnected = pyqtSignal()
    reconnecting = pyqtSignal(int)     # attempt number
    connection_error = pyqtSignal(str)

    # Data lifecycle
    data_loading = pyqtSignal()
    data_loaded = pyqtSignal(int)       # feature count
    data_error = pyqtSignal(str)

    # Selection sync
    selection_from_app = pyqtSignal(list)   # indices from GeoChem web app
    selection_to_app = pyqtSignal(list)     # indices from QGIS to send

    # Style sync
    styles_received = pyqtSignal(dict)
    style_applied = pyqtSignal(str)         # style type name

    # Classification
    classification_received = pyqtSignal(str, dict)  # column, assignments

    # Pathfinder
    pathfinders_received = pyqtSignal(dict)
    pathfinder_layers_created = pyqtSignal(int)

    # Logging
    log_message = pyqtSignal(str, int)      # message, level

    # Data available notification (from backend push)
    data_available = pyqtSignal(int, int)   # rows, columns

    def __init__(self):
        super().__init__()
