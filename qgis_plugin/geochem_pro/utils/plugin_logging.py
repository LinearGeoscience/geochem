"""
Logging Utilities for GeoChem QGIS Plugin
Provides consistent logging throughout the plugin
"""

from typing import Optional, Any
from datetime import datetime
from enum import IntEnum
from qgis.core import QgsMessageLog, Qgis


class LogLevel(IntEnum):
    """Log level enumeration matching QGIS levels"""
    INFO = 0
    WARNING = 1
    CRITICAL = 2
    SUCCESS = 3


class PluginLogger:
    """
    Centralized logging for the GeoChem plugin.

    Provides consistent formatting and routing of log messages
    to both QGIS message log and optional file logging.
    """

    TAG = "GeoChem"
    _instance: Optional['PluginLogger'] = None
    _file_path: Optional[str] = None
    _log_to_file: bool = False
    _verbose: bool = False

    def __new__(cls):
        """Singleton pattern"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def get_logger(cls) -> 'PluginLogger':
        """Get the singleton logger instance"""
        return cls()

    def configure(
        self,
        verbose: bool = False,
        log_to_file: bool = False,
        file_path: Optional[str] = None
    ):
        """
        Configure logger settings.

        Args:
            verbose: Enable verbose (debug) logging
            log_to_file: Enable file logging
            file_path: Path to log file
        """
        self._verbose = verbose
        self._log_to_file = log_to_file
        if file_path:
            self._file_path = file_path

    def info(self, message: str, context: Optional[str] = None):
        """Log an info message"""
        self._log(message, Qgis.Info, context)

    def warning(self, message: str, context: Optional[str] = None):
        """Log a warning message"""
        self._log(message, Qgis.Warning, context)

    def error(self, message: str, context: Optional[str] = None):
        """Log an error message"""
        self._log(message, Qgis.Critical, context)

    def critical(self, message: str, context: Optional[str] = None):
        """Log a critical error message"""
        self._log(message, Qgis.Critical, context)

    def success(self, message: str, context: Optional[str] = None):
        """Log a success message"""
        self._log(message, Qgis.Success, context)

    def debug(self, message: str, context: Optional[str] = None):
        """Log a debug message (only when verbose is enabled)"""
        if self._verbose:
            self._log(f"[DEBUG] {message}", Qgis.Info, context)

    def exception(self, e: Exception, message: Optional[str] = None, context: Optional[str] = None):
        """Log an exception with traceback"""
        import traceback
        error_msg = message or "An exception occurred"
        tb = traceback.format_exc()
        full_message = f"{error_msg}: {str(e)}\n{tb}"
        self._log(full_message, Qgis.Critical, context)

    def _log(self, message: str, level: Qgis.MessageLevel, context: Optional[str] = None):
        """Internal logging method"""
        # Format message with context
        if context:
            formatted = f"[{context}] {message}"
        else:
            formatted = message

        # Log to QGIS message log
        QgsMessageLog.logMessage(formatted, self.TAG, level)

        # Log to file if enabled
        if self._log_to_file and self._file_path:
            self._log_to_file_impl(formatted, level)

    def _log_to_file_impl(self, message: str, level: Qgis.MessageLevel):
        """Write log message to file"""
        level_names = {
            Qgis.Info: 'INFO',
            Qgis.Warning: 'WARNING',
            Qgis.Critical: 'ERROR',
            Qgis.Success: 'SUCCESS',
        }

        try:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            level_name = level_names.get(level, 'INFO')

            with open(self._file_path, 'a', encoding='utf-8') as f:
                f.write(f"[{timestamp}] [{level_name}] {message}\n")
        except Exception:
            pass  # Silently fail file logging


# Module-level convenience functions
_logger = PluginLogger.get_logger()


def log_info(message: str, context: Optional[str] = None):
    """Log an info message"""
    _logger.info(message, context)


def log_warning(message: str, context: Optional[str] = None):
    """Log a warning message"""
    _logger.warning(message, context)


def log_error(message: str, context: Optional[str] = None):
    """Log an error message"""
    _logger.error(message, context)


def log_debug(message: str, context: Optional[str] = None):
    """Log a debug message"""
    _logger.debug(message, context)


def log_exception(e: Exception, message: Optional[str] = None, context: Optional[str] = None):
    """Log an exception"""
    _logger.exception(e, message, context)
