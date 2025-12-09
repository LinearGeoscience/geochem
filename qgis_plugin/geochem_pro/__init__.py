"""
GeoChem Pro QGIS Plugin
Real-time integration with GeoChem Pro geochemical analysis application
"""

def classFactory(iface):
    """
    Load the GeochemProPlugin class.

    :param iface: A QGIS interface instance.
    :type iface: QgsInterface
    """
    from .geochem_pro import GeochemProPlugin
    return GeochemProPlugin(iface)
