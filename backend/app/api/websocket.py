"""
WebSocket API for GeoChem
Provides real-time communication with QGIS plugin
"""

import json
import logging
from typing import List, Dict, Any, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Body

logger = logging.getLogger(__name__)

router = APIRouter()

# Data/styling the frontend pushes for QGIS (separate from main data_manager)
qgis_data_cache: Dict[str, Any] = {
    'data': None,        # explicit rows pushed via /sync-data; None = serve DataManager rows
    'columns': [],       # column metadata pushed via /sync-data
    'styles': {},        # attribute styling pushed via /sync-styles
    'pathfinders': {},   # pathfinder configuration pushed via /sync-pathfinders
}


class ConnectionManager:
    """Manages WebSocket connections for real-time sync"""

    def __init__(self):
        # Active connections by type
        self.qgis_connections: Set[WebSocket] = set()
        self.frontend_connections: Set[WebSocket] = set()
        # Current state
        self.current_selection: List[int] = []
        self.classifications: Dict[str, Dict[int, str]] = {}

    async def connect_qgis(self, websocket: WebSocket):
        """Accept QGIS plugin connection"""
        await websocket.accept()
        self.qgis_connections.add(websocket)

    async def connect_frontend(self, websocket: WebSocket):
        """Accept frontend connection"""
        await websocket.accept()
        self.frontend_connections.add(websocket)

    def disconnect_qgis(self, websocket: WebSocket):
        """Remove QGIS connection"""
        self.qgis_connections.discard(websocket)

    def disconnect_frontend(self, websocket: WebSocket):
        """Remove frontend connection"""
        self.frontend_connections.discard(websocket)

    async def broadcast_to_qgis(self, message: dict):
        """Send message to all QGIS connections"""
        dead_connections = set()
        for connection in self.qgis_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.add(connection)
        self.qgis_connections -= dead_connections

    async def broadcast_to_frontend(self, message: dict):
        """Send message to all frontend connections"""
        dead_connections = set()
        for connection in self.frontend_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.add(connection)
        self.frontend_connections -= dead_connections

    async def broadcast_all(self, message: dict, exclude_source: str = None):
        """Broadcast to all connections except source type"""
        if exclude_source != 'qgis':
            await self.broadcast_to_qgis(message)
        if exclude_source != 'frontend':
            await self.broadcast_to_frontend(message)


# Global connection manager
manager = ConnectionManager()


@router.websocket("/ws/qgis")
async def qgis_websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for QGIS plugin"""
    await manager.connect_qgis(websocket)
    try:
        # Send current state on connect (including data availability)
        from app.api.data import data_manager
        df = data_manager.get_data()
        has_data = df is not None and len(df) > 0
        await websocket.send_json({
            'type': 'state_sync',
            'selection': manager.current_selection,
            'classifications': manager.classifications,
            'data_available': has_data,
            'data_rows': len(df) if has_data else 0,
        })

        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("QGIS WebSocket received malformed JSON: %s", data[:200])
                await websocket.send_json({'type': 'error', 'message': 'Invalid JSON'})
                continue
            await handle_qgis_message(websocket, message)

    except WebSocketDisconnect:
        manager.disconnect_qgis(websocket)
    except Exception as e:
        logger.exception("QGIS WebSocket error: %s", type(e).__name__)
        manager.disconnect_qgis(websocket)


@router.websocket("/ws/frontend")
async def frontend_websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for frontend app"""
    await manager.connect_frontend(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("Frontend WebSocket received malformed JSON: %s", data[:200])
                await websocket.send_json({'type': 'error', 'message': 'Invalid JSON'})
                continue
            await handle_frontend_message(websocket, message)

    except WebSocketDisconnect:
        manager.disconnect_frontend(websocket)
    except Exception as e:
        logger.exception("Frontend WebSocket error: %s", type(e).__name__)
        manager.disconnect_frontend(websocket)


async def handle_qgis_message(websocket: WebSocket, message: Dict[str, Any]):
    """Handle incoming message from QGIS plugin"""
    msg_type = message.get('type')

    if msg_type == 'selection':
        # Selection change from QGIS
        indices = message.get('indices', [])
        manager.current_selection = indices
        # Broadcast to frontend
        await manager.broadcast_to_frontend({
            'type': 'selection',
            'indices': indices,
            'source': 'qgis'
        })

    elif msg_type == 'pong':
        # Keep-alive response
        pass

    elif msg_type == 'request_state':
        # QGIS requesting current state
        await websocket.send_json({
            'type': 'state_sync',
            'selection': manager.current_selection,
            'classifications': manager.classifications
        })

    elif msg_type == 'request_data':
        # QGIS requesting data directly from data manager
        from app.api.data import data_manager
        from app.core.parsing import clean_for_json
        WS_ROW_LIMIT = 50000  # Max rows to send via WebSocket
        df = data_manager.get_data()
        if df is not None:
            columns = data_manager.get_column_info()
            if len(df) > WS_ROW_LIMIT:
                # Dataset too large for WebSocket, tell plugin to use REST
                await websocket.send_json({
                    'type': 'data_response',
                    'data': [],
                    'columns': columns,
                    'use_rest': True,
                    'total_rows': len(df),
                })
            else:
                data = clean_for_json(df)
                await websocket.send_json({
                    'type': 'data_response',
                    'data': data,
                    'columns': columns
                })
        else:
            await websocket.send_json({
                'type': 'data_response',
                'data': [],
                'columns': []
            })

    elif msg_type == 'request_columns':
        # QGIS requesting column metadata
        from app.api.data import data_manager
        columns = data_manager.get_column_info()
        await websocket.send_json({
            'type': 'columns_response',
            'columns': columns if columns else []
        })


async def handle_frontend_message(websocket: WebSocket, message: Dict[str, Any]):
    """Handle incoming message from frontend"""
    msg_type = message.get('type')

    if msg_type == 'selection':
        # Selection change from frontend
        indices = message.get('indices', [])
        manager.current_selection = indices
        # Broadcast to QGIS
        await manager.broadcast_to_qgis({
            'type': 'selection',
            'indices': indices,
            'source': 'frontend'
        })

    elif msg_type == 'classification':
        # Classification update from frontend
        column = message.get('column')
        assignments = message.get('assignments', {})
        # Store and broadcast
        manager.classifications[column] = assignments
        await manager.broadcast_to_qgis({
            'type': 'classification',
            'column': column,
            'assignments': assignments
        })

    elif msg_type == 'data_update':
        # Data was updated in frontend
        await manager.broadcast_to_qgis({
            'type': 'data_update',
            'payload': message.get('payload', {})
        })


# ============================================================================
# REST API endpoints for QGIS integration
# ============================================================================

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'ok',
        'qgis_connections': len(manager.qgis_connections),
        'frontend_connections': len(manager.frontend_connections)
    }


@router.get("/selection")
async def get_selection():
    """Get current selection"""
    return {'indices': manager.current_selection}


@router.post("/selection")
async def set_selection(indices: List[int]):
    """Set selection from QGIS (via REST)"""
    manager.current_selection = indices
    await manager.broadcast_to_frontend({
        'type': 'selection',
        'indices': indices,
        'source': 'qgis'
    })
    return {'status': 'ok'}


@router.get("/classifications")
async def get_classifications():
    """Get all classification columns and values"""
    return manager.classifications


@router.post("/sync-data")
async def sync_data_from_frontend(payload: Dict[str, Any] = Body(...)):
    """
    Receive data push from frontend for QGIS sync.

    The frontend normally sends only column metadata: the rows are already in
    the backend's DataManager (pushed via /api/data/sync), so they are served
    from there instead of being uploaded twice. An explicit 'data' list is
    still accepted.
    """
    qgis_data_cache['data'] = payload.get('data')  # None -> use DataManager
    qgis_data_cache['columns'] = payload.get('columns', [])
    rows = len(_qgis_rows())

    # Notify QGIS clients that new data is available
    await manager.broadcast_to_qgis({
        'type': 'data_available',
        'rows': rows,
        'columns': len(qgis_data_cache['columns'])
    })

    return {
        'status': 'ok',
        'rows': rows,
        'columns': len(qgis_data_cache['columns'])
    }


def _qgis_rows() -> list:
    """Rows for QGIS: the explicit push if any, else the backend dataset."""
    if qgis_data_cache.get('data') is not None:
        return qgis_data_cache['data']
    from app.api.data import data_manager
    from app.core.parsing import clean_for_json
    df = data_manager.get_data()
    return clean_for_json(df) if df is not None else []


@router.get("/data")
async def get_qgis_data():
    """Get data for QGIS plugin"""
    return _qgis_rows()


@router.get("/columns")
async def get_qgis_columns():
    """Get columns for QGIS plugin"""
    return qgis_data_cache['columns']


@router.post("/sync-styles")
async def sync_styles_from_frontend(payload: Dict[str, Any] = Body(...)):
    """
    Receive attribute styling configuration from frontend for QGIS sync.
    This allows QGIS to apply the same styling as the web app.
    """
    qgis_data_cache['styles'] = payload

    # Notify QGIS clients that new styles are available
    await manager.broadcast_to_qgis({
        'type': 'styles_available',
        'has_color': bool(payload.get('color', {}).get('field')),
        'has_shape': bool(payload.get('shape', {}).get('field')),
        'has_size': bool(payload.get('size', {}).get('field')),
    })

    return {
        'status': 'ok',
        'color_field': payload.get('color', {}).get('field'),
        'shape_field': payload.get('shape', {}).get('field'),
        'size_field': payload.get('size', {}).get('field'),
    }


@router.get("/styles")
async def get_qgis_styles():
    """Get attribute styling configuration for QGIS plugin"""
    return qgis_data_cache.get('styles', {})


@router.post("/sync-pathfinders")
async def sync_pathfinders_from_frontend(payload: Dict[str, Any] = Body(...)):
    """
    Receive pathfinder configuration from frontend for QGIS sync.
    Creates styled layers for each pathfinder element.
    """
    qgis_data_cache['pathfinders'] = payload

    elements = payload.get('elements', [])

    # Notify QGIS clients that pathfinders are available
    await manager.broadcast_to_qgis({
        'type': 'pathfinders_available',
        'elements': elements,
        'count': len(elements)
    })

    return {
        'status': 'ok',
        'elements': len(elements),
        'element_list': elements
    }


@router.get("/pathfinders")
async def get_pathfinders():
    """Get pathfinder configuration for QGIS plugin"""
    return qgis_data_cache.get('pathfinders', {})


