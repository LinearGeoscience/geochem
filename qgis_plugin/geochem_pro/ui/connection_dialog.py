"""
Connection Settings Dialog for GeoChem QGIS Plugin
"""

from typing import Tuple, Optional
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLineEdit, QSpinBox, QPushButton, QLabel,
    QGroupBox, QCheckBox, QDialogButtonBox
)
from PyQt5.QtCore import Qt


class ConnectionDialog(QDialog):
    """
    Dialog for configuring connection settings.
    """

    def __init__(self, parent=None, host: str = "localhost", port: int = 8000):
        super().__init__(parent)
        self.setWindowTitle("GeoChem Connection Settings")
        self.setMinimumWidth(350)

        self._host = host
        self._port = port
        self._auto_reconnect = True

        self._setup_ui()

    def _setup_ui(self):
        """Set up the dialog UI"""
        layout = QVBoxLayout(self)

        # Server settings
        server_group = QGroupBox("Server")
        server_layout = QFormLayout(server_group)

        self.host_input = QLineEdit(self._host)
        self.host_input.setPlaceholderText("localhost or IP address")
        server_layout.addRow("Host:", self.host_input)

        self.port_input = QSpinBox()
        self.port_input.setRange(1, 65535)
        self.port_input.setValue(self._port)
        server_layout.addRow("Port:", self.port_input)

        layout.addWidget(server_group)

        # Connection options
        options_group = QGroupBox("Options")
        options_layout = QVBoxLayout(options_group)

        self.auto_reconnect_check = QCheckBox("Auto-reconnect on connection loss")
        self.auto_reconnect_check.setChecked(self._auto_reconnect)
        options_layout.addWidget(self.auto_reconnect_check)

        self.auto_sync_check = QCheckBox("Auto-sync data on connect")
        self.auto_sync_check.setChecked(True)
        options_layout.addWidget(self.auto_sync_check)

        layout.addWidget(options_group)

        # Connection info
        info_label = QLabel(
            "<small>The GeoChem application should be running "
            "with the API server enabled.</small>"
        )
        info_label.setWordWrap(True)
        info_label.setStyleSheet("color: #6b7280;")
        layout.addWidget(info_label)

        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def get_settings(self) -> dict:
        """Get the configured settings"""
        return {
            'host': self.host_input.text().strip(),
            'port': self.port_input.value(),
            'auto_reconnect': self.auto_reconnect_check.isChecked(),
            'auto_sync': self.auto_sync_check.isChecked(),
        }

    def get_connection(self) -> Tuple[str, int]:
        """Get host and port tuple"""
        return (self.host_input.text().strip(), self.port_input.value())

    @staticmethod
    def get_connection_settings(
        parent=None,
        host: str = "localhost",
        port: int = 8000
    ) -> Optional[dict]:
        """
        Static method to show dialog and return settings.

        Returns:
            Settings dict if OK was clicked, None if cancelled
        """
        dialog = ConnectionDialog(parent, host, port)
        if dialog.exec_() == QDialog.Accepted:
            return dialog.get_settings()
        return None
