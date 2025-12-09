"""
Geometry Utilities for GeoChem Pro QGIS Plugin
Provides geometry manipulation and coordinate helpers
"""

from typing import Tuple, List, Optional, Dict, Any
from qgis.core import (
    QgsPointXY,
    QgsGeometry,
    QgsRectangle,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsProject,
    QgsFeature,
    QgsVectorLayer
)
import math


class GeometryUtils:
    """Utility class for geometry operations"""

    @staticmethod
    def create_point(x: float, y: float) -> QgsGeometry:
        """Create a point geometry from coordinates"""
        return QgsGeometry.fromPointXY(QgsPointXY(x, y))

    @staticmethod
    def point_to_coords(geometry: QgsGeometry) -> Optional[Tuple[float, float]]:
        """Extract coordinates from a point geometry"""
        if geometry.isNull() or geometry.type() != 0:  # 0 = Point
            return None
        point = geometry.asPoint()
        return (point.x(), point.y())

    @staticmethod
    def calculate_extent(points: List[Tuple[float, float]], buffer_percent: float = 0.05) -> QgsRectangle:
        """
        Calculate bounding extent for a list of points.

        Args:
            points: List of (x, y) coordinate tuples
            buffer_percent: Percentage to buffer the extent

        Returns:
            QgsRectangle extent
        """
        if not points:
            return QgsRectangle()

        x_vals = [p[0] for p in points]
        y_vals = [p[1] for p in points]

        min_x = min(x_vals)
        max_x = max(x_vals)
        min_y = min(y_vals)
        max_y = max(y_vals)

        # Add buffer
        width = max_x - min_x
        height = max_y - min_y
        buffer_x = width * buffer_percent
        buffer_y = height * buffer_percent

        return QgsRectangle(
            min_x - buffer_x,
            min_y - buffer_y,
            max_x + buffer_x,
            max_y + buffer_y
        )

    @staticmethod
    def transform_point(
        point: QgsPointXY,
        source_crs: QgsCoordinateReferenceSystem,
        dest_crs: QgsCoordinateReferenceSystem
    ) -> QgsPointXY:
        """
        Transform a point from one CRS to another.

        Args:
            point: Source point
            source_crs: Source coordinate reference system
            dest_crs: Destination coordinate reference system

        Returns:
            Transformed point
        """
        transform = QgsCoordinateTransform(
            source_crs,
            dest_crs,
            QgsProject.instance()
        )
        return transform.transform(point)

    @staticmethod
    def distance_2d(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        """Calculate 2D Euclidean distance between two points"""
        return math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)

    @staticmethod
    def point_in_extent(
        point: Tuple[float, float],
        extent: QgsRectangle
    ) -> bool:
        """Check if a point is within an extent"""
        return extent.contains(QgsPointXY(point[0], point[1]))

    @staticmethod
    def get_layer_extent(layer: QgsVectorLayer) -> QgsRectangle:
        """Get the extent of a vector layer"""
        return layer.extent()

    @staticmethod
    def features_in_extent(
        layer: QgsVectorLayer,
        extent: QgsRectangle
    ) -> List[QgsFeature]:
        """Get features within an extent"""
        request = layer.getFeatures(extent)
        return list(request)

    @staticmethod
    def nearest_feature(
        layer: QgsVectorLayer,
        point: QgsPointXY,
        max_distance: Optional[float] = None
    ) -> Optional[QgsFeature]:
        """
        Find the nearest feature to a point.

        Args:
            layer: Vector layer to search
            point: Reference point
            max_distance: Maximum search distance (None = unlimited)

        Returns:
            Nearest feature or None
        """
        nearest = None
        min_dist = float('inf')

        for feature in layer.getFeatures():
            geom = feature.geometry()
            if geom.isNull():
                continue

            dist = geom.distance(QgsGeometry.fromPointXY(point))

            if dist < min_dist:
                if max_distance is None or dist <= max_distance:
                    min_dist = dist
                    nearest = feature

        return nearest

    @staticmethod
    def calculate_centroid(features: List[QgsFeature]) -> Optional[QgsPointXY]:
        """Calculate centroid of multiple features"""
        if not features:
            return None

        total_x = 0
        total_y = 0
        count = 0

        for feature in features:
            geom = feature.geometry()
            if not geom.isNull():
                centroid = geom.centroid().asPoint()
                total_x += centroid.x()
                total_y += centroid.y()
                count += 1

        if count == 0:
            return None

        return QgsPointXY(total_x / count, total_y / count)

    @staticmethod
    def dms_to_decimal(
        degrees: float,
        minutes: float,
        seconds: float,
        direction: str = 'N'
    ) -> float:
        """
        Convert DMS coordinates to decimal degrees.

        Args:
            degrees: Degrees
            minutes: Minutes
            seconds: Seconds
            direction: N, S, E, or W

        Returns:
            Decimal degrees
        """
        decimal = abs(degrees) + minutes / 60 + seconds / 3600

        if direction.upper() in ['S', 'W']:
            decimal = -decimal

        return decimal

    @staticmethod
    def decimal_to_dms(decimal: float) -> Tuple[int, int, float, str]:
        """
        Convert decimal degrees to DMS.

        Args:
            decimal: Decimal degrees

        Returns:
            Tuple of (degrees, minutes, seconds, direction)
        """
        direction = 'N' if decimal >= 0 else 'S'
        decimal = abs(decimal)

        degrees = int(decimal)
        minutes_float = (decimal - degrees) * 60
        minutes = int(minutes_float)
        seconds = (minutes_float - minutes) * 60

        return (degrees, minutes, seconds, direction)
