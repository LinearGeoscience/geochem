"""
Export Options Dialog for GeoChem QGIS Plugin
"""

from typing import Optional, Dict, Any, List
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLineEdit, QPushButton, QLabel, QGroupBox,
    QCheckBox, QDialogButtonBox, QListWidget,
    QListWidgetItem, QComboBox, QFileDialog,
    QSpinBox, QDoubleSpinBox
)
from PyQt5.QtCore import Qt
from qgis.core import QgsVectorLayer


class ExportDialog(QDialog):
    """
    Dialog for configuring GeoPackage export options.
    """

    def __init__(
        self,
        parent=None,
        layer: Optional[QgsVectorLayer] = None,
        default_name: str = "GeoChem_Export"
    ):
        super().__init__(parent)
        self.setWindowTitle("Export to GeoPackage")
        self.setMinimumWidth(450)

        self._layer = layer
        self._default_name = default_name
        self._styles: List[Dict[str, Any]] = []

        self._setup_ui()

    def _setup_ui(self):
        """Set up the dialog UI"""
        layout = QVBoxLayout(self)

        # Output file
        file_group = QGroupBox("Output")
        file_layout = QHBoxLayout(file_group)

        self.filepath_input = QLineEdit()
        self.filepath_input.setPlaceholderText("Select output file...")
        file_layout.addWidget(self.filepath_input)

        browse_btn = QPushButton("Browse...")
        browse_btn.clicked.connect(self._browse_file)
        file_layout.addWidget(browse_btn)

        layout.addWidget(file_group)

        # Layer settings
        layer_group = QGroupBox("Layer")
        layer_layout = QFormLayout(layer_group)

        self.layer_name_input = QLineEdit(self._default_name)
        layer_layout.addRow("Name:", self.layer_name_input)

        self.selected_only_check = QCheckBox()
        if self._layer:
            selected_count = self._layer.selectedFeatureCount()
            self.selected_only_check.setText(f"({selected_count} selected)")
            self.selected_only_check.setEnabled(selected_count > 0)
        layer_layout.addRow("Selected only:", self.selected_only_check)

        layout.addWidget(layer_group)

        # Style options
        style_group = QGroupBox("Styles")
        style_layout = QVBoxLayout(style_group)

        self.include_style_check = QCheckBox("Include current style")
        self.include_style_check.setChecked(True)
        style_layout.addWidget(self.include_style_check)

        # Style list
        self.style_list = QListWidget()
        self.style_list.setMaximumHeight(120)
        style_layout.addWidget(self.style_list)

        # Style controls
        style_btn_layout = QHBoxLayout()

        self.add_style_btn = QPushButton("Add Style...")
        self.add_style_btn.clicked.connect(self._add_style)
        style_btn_layout.addWidget(self.add_style_btn)

        self.remove_style_btn = QPushButton("Remove")
        self.remove_style_btn.clicked.connect(self._remove_style)
        style_btn_layout.addWidget(self.remove_style_btn)

        style_btn_layout.addStretch()
        style_layout.addLayout(style_btn_layout)

        layout.addWidget(style_group)

        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _browse_file(self):
        """Open file browser for output file"""
        filepath, _ = QFileDialog.getSaveFileName(
            self,
            "Export to GeoPackage",
            self.layer_name_input.text() + ".gpkg",
            "GeoPackage (*.gpkg)"
        )
        if filepath:
            self.filepath_input.setText(filepath)

    def _add_style(self):
        """Add a style to the export list"""
        if not self._layer:
            return

        # Simple style addition dialog
        from PyQt5.QtWidgets import QInputDialog

        style_types = [
            "Classification",
            "Graduated",
            "Cluster",
            "High Grade"
        ]

        style_type, ok = QInputDialog.getItem(
            self,
            "Add Style",
            "Style type:",
            style_types,
            0,
            False
        )

        if not ok:
            return

        # Get column
        fields = [f.name() for f in self._layer.fields()]
        column, ok = QInputDialog.getItem(
            self,
            "Select Column",
            "Column:",
            fields,
            0,
            False
        )

        if not ok:
            return

        # Get style name
        name, ok = QInputDialog.getText(
            self,
            "Style Name",
            "Name:",
            text=f"{style_type} - {column}"
        )

        if not ok or not name:
            return

        style_config = {
            'name': name,
            'type': style_type.lower().replace(' ', '_'),
            'column': column,
        }

        self._styles.append(style_config)

        item = QListWidgetItem(name)
        item.setData(Qt.UserRole, style_config)
        self.style_list.addItem(item)

    def _remove_style(self):
        """Remove selected style from list"""
        current = self.style_list.currentRow()
        if current >= 0:
            self.style_list.takeItem(current)
            if current < len(self._styles):
                self._styles.pop(current)

    def _on_accept(self):
        """Validate and accept dialog"""
        if not self.filepath_input.text().strip():
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.warning(
                self,
                "Missing Output",
                "Please specify an output file."
            )
            return

        self.accept()

    def get_export_config(self) -> Dict[str, Any]:
        """Get the export configuration"""
        # Collect styles from list
        styles = []
        for i in range(self.style_list.count()):
            item = self.style_list.item(i)
            style_data = item.data(Qt.UserRole)
            if style_data:
                styles.append(style_data)

        return {
            'filepath': self.filepath_input.text().strip(),
            'layer_name': self.layer_name_input.text().strip(),
            'selected_only': self.selected_only_check.isChecked(),
            'include_style': self.include_style_check.isChecked(),
            'styles': styles,
        }

    @staticmethod
    def get_export_settings(
        parent=None,
        layer: Optional[QgsVectorLayer] = None,
        default_name: str = "GeoChem_Export"
    ) -> Optional[Dict[str, Any]]:
        """
        Static method to show dialog and return config.

        Returns:
            Export config dict if OK was clicked, None if cancelled
        """
        dialog = ExportDialog(parent, layer, default_name)
        if dialog.exec_() == QDialog.Accepted:
            return dialog.get_export_config()
        return None
