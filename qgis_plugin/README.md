# GeoChem QGIS Plugin

Real-time integration between GeoChem geochemical analysis application and QGIS.

## Features

- **Live Connection**: WebSocket-based real-time communication with GeoChem
- **Data Synchronization**: Import geochemical data directly into QGIS
- **Classification Styling**: Automatic styling based on GeoChem classifications
- **Graduated Styling**: Color-coded visualization of numeric values
- **High-Grade Highlighting**: Emphasize samples above threshold values
- **Cluster Visualization**: Display clustering analysis results
- **Selection Sync**: Bidirectional selection synchronization
- **GeoPackage Export**: Export styled layers with embedded styles

## Installation

### Prerequisites

1. QGIS 3.16 or later
2. GeoChem application running with API server enabled

### Install Dependencies

Open OSGeo4W Shell (or QGIS Python console) and run:

```bash
pip install websocket-client requests
```

### Install Plugin

1. Download or clone this repository
2. Copy the `geochem_pro` folder to your QGIS plugins directory:
   - Windows: `C:\Users\<username>\AppData\Roaming\QGIS\QGIS3\profiles\default\python\plugins\`
   - Linux: `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/`
   - macOS: `~/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins/`
3. Restart QGIS
4. Enable the plugin in Plugins > Manage and Install Plugins

## Usage

### Connecting to GeoChem

1. Start GeoChem application with the API server enabled
2. In QGIS, open the GeoChem dock panel (View > Panels > GeoChem)
3. Enter the host and port (default: localhost:8000)
4. Click "Connect"

### Syncing Data

1. Ensure you have data loaded in GeoChem
2. Configure coordinate fields (X/Y) in the Data tab
3. Select the appropriate CRS
4. Click "Sync Data"

### Styling

1. Go to the Style tab
2. Select a style type:
   - **Single Symbol**: Uniform color for all points
   - **Classification**: Category-based colors (for classification columns)
   - **Graduated**: Value-based gradient (for numeric columns)
   - **Cluster**: Cluster assignment colors
   - **High Grade**: Highlight values above threshold
3. Select the column to style by
4. Configure options (classes, method, threshold)
5. Click "Apply Style"

### Exporting

1. Go to the Export tab
2. Configure export options:
   - Include current style
   - Export selected features only
   - Add multiple named styles
3. Click "Export to GeoPackage"

## Configuration

### Connection Settings

- **Host**: GeoChem server host (default: localhost)
- **Port**: API server port (default: 8000)
- **Auto-reconnect**: Automatically reconnect on connection loss

### Coordinate Fields

- **X Field**: Column containing X/Easting coordinates
- **Y Field**: Column containing Y/Northing coordinates
- **CRS**: Coordinate Reference System of the data

## Troubleshooting

### Cannot Connect

1. Ensure GeoChem is running
2. Check that the API server is enabled in GeoChem
3. Verify firewall settings allow the connection
4. Try using IP address instead of hostname

### No Data Syncing

1. Verify data is loaded in GeoChem
2. Check that coordinate fields are correctly specified
3. Ensure coordinate values are valid numbers

### Style Not Applying

1. Verify the selected column exists and contains data
2. For graduated styles, ensure the column is numeric
3. Check QGIS message log for errors

## Development

### Project Structure

```
geochem_pro/
├── __init__.py           # Plugin initialization
├── metadata.txt          # QGIS plugin metadata
├── geochem_pro.py        # Main plugin class
├── core/
│   ├── connection.py     # Connection manager
│   ├── data_sync.py      # Data synchronization
│   ├── style_manager.py  # Layer styling
│   └── geopackage.py     # GeoPackage export
├── ui/
│   ├── main_dock.py      # Main dock widget
│   ├── connection_dialog.py
│   └── export_dialog.py
├── utils/
│   ├── color_utils.py
│   ├── geometry.py
│   └── plugin_logging.py
└── icons/
    └── *.svg
```

### Running Tests

```bash
cd qgis_plugin
pytest tests/
```

## License

Copyright (c) Linear Geoscience. All rights reserved.

## Support

For issues and feature requests, please contact support@lineargeoscience.com
or open an issue at https://github.com/lineargeoscience/geochem-qgis-plugin
