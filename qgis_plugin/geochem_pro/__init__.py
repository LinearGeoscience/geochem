"""
GeoChem QGIS Plugin
Real-time integration with GeoChem geochemical analysis application
"""

def classFactory(iface):
    """
    Load the GeochemPlugin class.

    :param iface: A QGIS interface instance.
    :type iface: QgsInterface
    """
    from .geochem_plugin import GeochemPlugin
    return GeochemPlugin(iface)
