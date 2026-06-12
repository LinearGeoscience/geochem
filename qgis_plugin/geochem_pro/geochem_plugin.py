"""
Main QGIS plugin class - thin orchestrator.
Modeled after ioGAS qgisplugingas.py.
"""

import os
from qgis.PyQt.QtWidgets import QAction
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtCore import Qt

from .comms.signals import GeochemSignals
from .client.geochem_client import GeochemClient
from .ui.dock_widget import GeochemDockWidget
from .support import logger


class GeochemPlugin:
    """
    GeoChem Integration QGIS Plugin.
    Thin orchestrator that wires up client, UI, and QGIS interface.
    """

    def __init__(self, iface):
        self.iface = iface
        self.signals = GeochemSignals()
        self.client = None
        self.dock_widget = None
        self.toolbar_action = None

    def initGui(self):
        """Called by QGIS when the plugin is loaded."""
        # Icon
        icon_path = os.path.join(
            os.path.dirname(__file__), "icons", "icon.png"
        )
        icon = QIcon(icon_path) if os.path.exists(icon_path) else QIcon()

        # Toolbar action
        self.toolbar_action = QAction(icon, "GeoChem Integration", self.iface.mainWindow())
        self.toolbar_action.setCheckable(True)
        self.toolbar_action.triggered.connect(self._toggle_dock)
        self.iface.addToolBarIcon(self.toolbar_action)
        self.iface.addPluginToMenu("GeoChem", self.toolbar_action)

        # Create client
        self.client = GeochemClient(self.iface, self.signals)

        # Create dock widget
        self.dock_widget = GeochemDockWidget(self.iface, self.signals)
        self.dock_widget.set_client(self.client)
        self.dock_widget.setVisible(False)
        self.dock_widget.visibilityChanged.connect(
            lambda vis: self.toolbar_action.setChecked(vis)
        )

        self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock_widget)

        logger.log_info("GeoChem Integration plugin loaded", "plugin")

    def unload(self):
        """Called by QGIS when the plugin is unloaded."""
        # Cleanup client
        if self.client:
            self.client.cleanup()
            self.client = None

        # Remove dock widget
        if self.dock_widget:
            self.iface.removeDockWidget(self.dock_widget)
            self.dock_widget.deleteLater()
            self.dock_widget = None

        # Remove toolbar/menu
        if self.toolbar_action:
            self.iface.removeToolBarIcon(self.toolbar_action)
            self.iface.removePluginMenu("GeoChem", self.toolbar_action)
            self.toolbar_action = None

        logger.log_info("GeoChem Integration plugin unloaded", "plugin")

    def _toggle_dock(self, checked):
        """Toggle dock widget visibility."""
        if self.dock_widget:
            self.dock_widget.setVisible(checked)
