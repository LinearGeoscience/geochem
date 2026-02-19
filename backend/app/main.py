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

logger.info("GeoChem API — Build: 2025-11-27 v3 — %s", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

app = FastAPI(
    title="GeoChem API",
    description="Backend for the Professional Geochemical Analysis Dashboard",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex="http://(localhost|127\.0\.0\.1):517.*",  # Allow any Vite port on localhost or 127.0.0.1
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
from app.api import data, analysis, drillhole, websocket, logging_interval
app.include_router(data.router, prefix="/api/data", tags=["data"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(drillhole.router, prefix="/api/drillhole", tags=["drillhole"])
app.include_router(websocket.router, prefix="/api/qgis", tags=["qgis"])
app.include_router(logging_interval.router, prefix="/api/logging", tags=["logging"])


