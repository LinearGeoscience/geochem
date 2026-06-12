"""
Configuration, settings, and constants for the GeoChem QGIS plugin.
"""

from qgis.core import QgsSettings

PLUGIN_NAME = "GeoChem Integration"
PLUGIN_TAG = "GeoChem"

# Default connection settings
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 8000

# API paths (relative to http://host:port)
API_DATA = "/api/data/data"
API_COLUMNS = "/api/data/columns"
API_HEALTH = "/api/qgis/health"
API_QGIS_DATA = "/api/qgis/data"
API_QGIS_COLUMNS = "/api/qgis/columns"
API_QGIS_STYLES = "/api/qgis/styles"
API_QGIS_PATHFINDERS = "/api/qgis/pathfinders"
API_QGIS_SELECTION = "/api/qgis/selection"

# WebSocket path
WS_PATH = "/ws/qgis"

# Layer naming
LIVE_LAYER_SUFFIX = " [GeoChem]"
INDEX_FIELD = "_geochem_idx"

# Settings keys (persisted via QgsSettings)
SETTINGS_PREFIX = "geochem_pro"


def get_setting(key, default=None):
    s = QgsSettings()
    return s.value(f"{SETTINGS_PREFIX}/{key}", default)


def set_setting(key, value):
    s = QgsSettings()
    s.setValue(f"{SETTINGS_PREFIX}/{key}", value)


def get_host():
    return get_setting("host", DEFAULT_HOST)


def get_port():
    return int(get_setting("port", DEFAULT_PORT))


def set_host(host):
    set_setting("host", host)


def set_port(port):
    set_setting("port", int(port))


def get_base_url():
    return f"http://{get_host()}:{get_port()}"


def get_ws_url():
    return f"ws://{get_host()}:{get_port()}{WS_PATH}"
