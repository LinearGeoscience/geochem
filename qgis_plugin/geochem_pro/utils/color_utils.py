"""
Color Utilities for GeoChem QGIS Plugin
Provides color manipulation and conversion functions
"""

from typing import Tuple, List, Optional
from PyQt5.QtGui import QColor
import colorsys
import math


class ColorUtils:
    """Utility class for color operations"""

    # Predefined palettes
    PALETTES = {
        'categorical': [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
        ],
        'sequential_blue': [
            '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa',
            '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
        ],
        'sequential_red': [
            '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171',
            '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
        ],
        'diverging': [
            '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf',
            '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695',
        ],
    }

    @staticmethod
    def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
        """
        Convert hex color to RGB tuple.

        Args:
            hex_color: Hex color string (e.g., '#ff0000' or 'ff0000')

        Returns:
            Tuple of (R, G, B) values (0-255)
        """
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    @staticmethod
    def rgb_to_hex(r: int, g: int, b: int) -> str:
        """
        Convert RGB to hex color string.

        Args:
            r: Red value (0-255)
            g: Green value (0-255)
            b: Blue value (0-255)

        Returns:
            Hex color string with # prefix
        """
        return f'#{r:02x}{g:02x}{b:02x}'

    @staticmethod
    def qcolor_to_hex(color: QColor) -> str:
        """Convert QColor to hex string"""
        return f'#{color.red():02x}{color.green():02x}{color.blue():02x}'

    @staticmethod
    def hex_to_qcolor(hex_color: str) -> QColor:
        """Convert hex string to QColor"""
        r, g, b = ColorUtils.hex_to_rgb(hex_color)
        return QColor(r, g, b)

    @staticmethod
    def interpolate_color(
        color1: str,
        color2: str,
        t: float
    ) -> str:
        """
        Interpolate between two colors.

        Args:
            color1: Start color (hex)
            color2: End color (hex)
            t: Interpolation factor (0.0 to 1.0)

        Returns:
            Interpolated color (hex)
        """
        r1, g1, b1 = ColorUtils.hex_to_rgb(color1)
        r2, g2, b2 = ColorUtils.hex_to_rgb(color2)

        r = int(r1 + (r2 - r1) * t)
        g = int(g1 + (g2 - g1) * t)
        b = int(b1 + (b2 - b1) * t)

        return ColorUtils.rgb_to_hex(r, g, b)

    @staticmethod
    def generate_gradient(
        color1: str,
        color2: str,
        steps: int
    ) -> List[str]:
        """
        Generate a gradient of colors between two colors.

        Args:
            color1: Start color (hex)
            color2: End color (hex)
            steps: Number of colors in gradient

        Returns:
            List of hex colors
        """
        if steps < 2:
            return [color1]

        gradient = []
        for i in range(steps):
            t = i / (steps - 1)
            gradient.append(ColorUtils.interpolate_color(color1, color2, t))

        return gradient

    @staticmethod
    def generate_distinct_colors(n: int) -> List[str]:
        """
        Generate n visually distinct colors.

        Args:
            n: Number of colors to generate

        Returns:
            List of hex colors
        """
        if n <= 10:
            return ColorUtils.PALETTES['categorical'][:n]

        colors = []
        for i in range(n):
            # Use golden ratio to spread hues
            hue = (i * 0.618033988749895) % 1.0
            # Vary saturation and lightness for more distinction
            saturation = 0.7 + (i % 3) * 0.1
            lightness = 0.5 + (i % 2) * 0.15

            r, g, b = colorsys.hls_to_rgb(hue, lightness, saturation)
            colors.append(ColorUtils.rgb_to_hex(
                int(r * 255),
                int(g * 255),
                int(b * 255)
            ))

        return colors

    @staticmethod
    def adjust_brightness(color: str, factor: float) -> str:
        """
        Adjust the brightness of a color.

        Args:
            color: Hex color
            factor: Brightness factor (>1 = lighter, <1 = darker)

        Returns:
            Adjusted hex color
        """
        r, g, b = ColorUtils.hex_to_rgb(color)

        r = min(255, max(0, int(r * factor)))
        g = min(255, max(0, int(g * factor)))
        b = min(255, max(0, int(b * factor)))

        return ColorUtils.rgb_to_hex(r, g, b)

    @staticmethod
    def get_contrast_color(background: str) -> str:
        """
        Get a contrasting text color (black or white) for a background.

        Args:
            background: Background color (hex)

        Returns:
            '#000000' or '#ffffff'
        """
        r, g, b = ColorUtils.hex_to_rgb(background)

        # Calculate relative luminance
        luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        return '#000000' if luminance > 0.5 else '#ffffff'

    @staticmethod
    def value_to_color(
        value: float,
        min_val: float,
        max_val: float,
        low_color: str = '#22c55e',
        high_color: str = '#dc2626'
    ) -> str:
        """
        Map a value to a color on a gradient.

        Args:
            value: The value to map
            min_val: Minimum value
            max_val: Maximum value
            low_color: Color for minimum
            high_color: Color for maximum

        Returns:
            Interpolated hex color
        """
        if max_val == min_val:
            return low_color

        t = max(0, min(1, (value - min_val) / (max_val - min_val)))
        return ColorUtils.interpolate_color(low_color, high_color, t)
