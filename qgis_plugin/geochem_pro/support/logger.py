"""
Logging to QGIS message log and optional file.
Modeled after ioGAS gassupport.py logging.
"""

from qgis.core import QgsMessageLog, Qgis

PLUGIN_TAG = "GeoChem"

# Log levels: 0=info, 1=warning, 2=error, 3=debug
LEVEL_MAP = {
    0: Qgis.Info,
    1: Qgis.Warning,
    2: Qgis.Critical,
    3: Qgis.Info,
}


def log(message, level=0, source=""):
    prefix = f"[{source}] " if source else ""
    qgis_level = LEVEL_MAP.get(level, Qgis.Info)
    QgsMessageLog.logMessage(f"{prefix}{message}", PLUGIN_TAG, qgis_level)


def log_info(message, source=""):
    log(message, 0, source)


def log_warning(message, source=""):
    log(message, 1, source)


def log_error(message, source=""):
    log(message, 2, source)


def log_debug(message, source=""):
    log(message, 3, source)
