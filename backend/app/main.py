"""GeoChem API — backend for the Professional Geochemical Analysis Dashboard.

SINGLE-USER CONTRACT (by design, decided 2026-07-13): this backend serves ONE
local user. Dataset state lives in process-wide singletons (DataManager,
DrillholeManager, the QGIS sync cache) — a new upload replaces the previous
dataset for every connected client, and nothing persists across restarts
(the frontend re-syncs via POST /api/data/sync). Do not point multiple users
at a shared instance; run one backend per user instead.
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

# Configure root logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

from app.core.version import read_version

APP_VERSION = read_version()
logger.info("GeoChem %s — API started %s", APP_VERSION, datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

app = FastAPI(
    title="GeoChem API",
    description="Backend for the Professional Geochemical Analysis Dashboard",
    version=APP_VERSION
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):517.*",  # Allow any Vite port on localhost or 127.0.0.1
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "GeoChem API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/health")
async def api_health_check():
    """Health check endpoint for QGIS plugin compatibility"""
    return {"status": "ok"}

# Include routers
from app.api import data, drillhole, websocket, logging_interval, projects, updates
app.include_router(data.router, prefix="/api/data", tags=["data"])
app.include_router(drillhole.router, prefix="/api/drillhole", tags=["drillhole"])
app.include_router(websocket.router, prefix="/api/qgis", tags=["qgis"])
app.include_router(logging_interval.router, prefix="/api/logging", tags=["logging"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(updates.router, prefix="/api", tags=["updates"])


