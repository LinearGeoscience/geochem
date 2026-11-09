import asyncio
import logging
import json

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse

import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from app.core.data_manager import DataManager
from app.core.parsing import clean_for_json, parse_file_content, replace_na

logger = logging.getLogger(__name__)

# Maximum upload file size (500 MB)
MAX_UPLOAD_SIZE = 500 * 1024 * 1024

router = APIRouter()
data_manager = DataManager()

class ColumnUpdate(BaseModel):
    column: str
    role: str = None
    alias: str = None

class SampleRequest(BaseModel):
    sample_size: int = 10000
    method: str = "random"            # "random" | "stratified" | "drillhole"
    outlier_columns: list[str] = []   # Columns for IQR outlier detection
    classification_column: str | None = None
    drillhole_column: str | None = None
    iqr_multiplier: float = 1.5
    seed: int | None = None

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), sheet: Optional[str] = Form(None)):
    try:
        import io

        # Validate file size
        if file.size and file.size > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large ({file.size / 1024 / 1024:.1f} MB). Maximum allowed is {MAX_UPLOAD_SIZE / 1024 / 1024:.0f} MB."
            )

        logger.info("Reading %s (%.1f MB) to memory...", file.filename, (file.size or 0) / 1024 / 1024)
        content = await file.read()

        # Check if it's a .gas file
        if file.filename.endswith('.gas'):
            return await upload_interop_file_internal(content, file.filename)

        # Robust shared parser: delimiter sniffing (semicolon/tab/pipe),
        # encoding fallback, BOM stripping, euro-decimal conversion.
        # Parsing and detection run off the event loop so the server stays
        # responsive during large uploads.
        df = await asyncio.to_thread(parse_file_content, content, file.filename, None, sheet)
        sheets = df.attrs.get('sheets')
        used_sheet = df.attrs.get('sheet')

        # Load into data manager (clears stale detection state, re-detects)
        await asyncio.to_thread(data_manager.set_data, df)

        # Return metadata only — data is streamed separately via /api/data/stream
        preview = clean_for_json(df.head(20))
        logger.info("Returning metadata for %d rows (data streamed separately)", len(df))

        return {
            "success": True,
            "rows": len(df),
            "columns": len(df.columns),
            "data": [],
            "preview": preview,
            "column_info": data_manager.get_column_info(),
            "skipped_lines": int(df.attrs.get('skipped_lines', 0)),
            # Excel only: every sheet in the workbook and the one loaded
            "sheets": sheets,
            "sheet": used_sheet,
        }
    except HTTPException:
        raise
    except ValueError as e:
        # Unparseable input is a client error with a user-readable message
        logger.warning("Upload rejected: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(e))


async def upload_interop_file_internal(content: bytes, filename: str):
    """Internal handler for .gas file uploads."""
    from app.core.interop_parser import InteropParser

    logger.info("Processing .gas file %s (%.1f MB)...", filename, len(content) / 1024 / 1024)

    parser = InteropParser()
    result = await asyncio.to_thread(parser.parse, content)

    if not result.get('success'):
        raise HTTPException(status_code=400, detail=result.get('error', 'Failed to parse .gas file'))

    # The parser keeps its DataFrame — use that directly (avoids re-creating from dicts)
    await asyncio.to_thread(data_manager.set_data, parser.df)

    logger.info(".gas loaded %d rows, %d columns (version: %s)",
                result['rows'], result['columns'],
                result.get('interop_metadata', {}).get('version', 'unknown'))

    return result


@router.post("/upload/drillhole")
async def upload_drillhole(
    collar: UploadFile = File(...),
    survey: UploadFile = File(...),
    assay: UploadFile = File(...)
):
    try:
        from app.core.drillhole_manager import DrillholeManager

        import io
        import time

        logger.info("DRILLHOLE UPLOAD STARTED — Collar: %.1fMB, Survey: %.1fMB, Assay: %.1fMB",
                     (collar.size or 0) / 1024 / 1024,
                     (survey.size or 0) / 1024 / 1024,
                     (assay.size or 0) / 1024 / 1024)

        upload_start = time.time()

        async def read_file_optimized(file):
            file_start = time.time()
            logger.info("Reading %s (%.1f MB) to memory...", file.filename, (file.size or 0) / 1024 / 1024)

            try:
                content = await file.read()
                logger.debug("File read into memory in %.2fs", time.time() - file_start)

                logger.debug("Parsing %s...", file.filename)
                df = await asyncio.to_thread(parse_file_content, content, file.filename)

                logger.info("Loaded %d rows, %d columns in %.2fs", len(df), len(df.columns), time.time() - file_start)
                return df
            except Exception as e:
                logger.exception("Failed to read %s", file.filename)
                raise

        # Read all files
        logger.info("PHASE 1: READING FILES")
        collar_df = await read_file_optimized(collar)
        survey_df = await read_file_optimized(survey)
        assay_df = await read_file_optimized(assay)

        upload_time = time.time() - upload_start
        logger.info("PHASE 1 COMPLETE: Files loaded in %.2fs", upload_time)

        # Check memory usage
        try:
            import psutil
            process = psutil.Process()
            mem_mb = process.memory_info().rss / 1024 / 1024
            logger.info("Memory usage: %.1f MB", mem_mb)
        except ImportError:
            pass

        # Process with desurvey
        logger.info("PHASE 2: DESURVEY — Collars: %d, Surveys: %d, Assays: %d",
                     len(collar_df), len(survey_df), len(assay_df))
        desurvey_start = time.time()

        try:
            dh_manager = DrillholeManager()
            use_parallel = len(collar_df) > 100
            logger.info("Desurveying with parallel=%s", use_parallel)
            # Off the event loop — desurvey can take seconds/minutes
            result_df = await asyncio.to_thread(
                dh_manager.desurvey, collar_df, survey_df, assay_df, use_parallel=use_parallel)
        except Exception as e:
            logger.exception("Desurvey failed")
            raise HTTPException(status_code=500, detail=f"Desurvey processing failed: {str(e)}")

        if result_df.empty:
             logger.warning("Desurvey returned empty dataframe")
             raise HTTPException(status_code=400, detail="Desurvey failed: No matching holes found")

        desurvey_time = time.time() - desurvey_start
        logger.info("PHASE 2 COMPLETE: Desurvey in %.2fs, %d records", desurvey_time, len(result_df))

        # Check memory again
        try:
            mem_mb = process.memory_info().rss / 1024 / 1024
            logger.info("Memory after desurvey: %.1f MB", mem_mb)
        except Exception:
            pass

        # Load into DataManager
        logger.info("PHASE 3: CONFIGURING DATA")
        config_start = time.time()
        await asyncio.to_thread(data_manager.set_data, result_df)

        config_time = time.time() - config_start
        total_time = time.time() - upload_start

        logger.info("PERFORMANCE — Upload: %.2fs | Desurvey: %.2fs | Config: %.2fs | TOTAL: %.2fs | %d records (%.0f rec/s)",
                     upload_time, desurvey_time, config_time, total_time, len(result_df), len(result_df) / total_time)

        # Return metadata only — data is streamed separately via /api/data/stream
        preview = clean_for_json(data_manager.df.head(20))
        logger.info("Returning metadata for %d rows (data streamed separately)", len(data_manager.df))

        return {
            "success": True,
            "rows": len(data_manager.df),
            "columns": len(data_manager.df.columns),
            "data": [],
            "preview": preview,
            "column_info": data_manager.get_column_info(),
            "performance": {
                "upload_time": round(upload_time, 2),
                "desurvey_time": round(desurvey_time, 2),
                "total_time": round(total_time, 2)
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Drillhole upload failed")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/columns")
async def get_columns() -> List[Dict[str, Any]]:
    logger.debug("/columns — df is None: %s, shape: %s",
                 data_manager.df is None,
                 data_manager.df.shape if data_manager.df is not None else "N/A")
    result = data_manager.get_column_info()
    logger.debug("/columns — returning %d columns", len(result))
    return result

@router.post("/columns/update")
async def update_column(update: ColumnUpdate):
    if update.role is not None:
        data_manager.update_column_role(update.column, update.role)
    if update.alias is not None:
        data_manager.update_alias(update.column, update.alias)
    return {"status": "success", "columns": data_manager.get_column_info()}

@router.get("/data")
async def get_data(limit: int = 100000):
    df = data_manager.get_data()
    if df is None:
        logger.debug("/data — no data loaded, returning empty list")
        return []
    logger.debug("/data — returning %d rows from df with shape %s", min(limit, len(df)), df.shape)
    # Prefer /data/stream for large reads — this endpoint materializes JSON
    return await asyncio.to_thread(clean_for_json, df.head(limit))


@router.get("/stream")
async def stream_data():
    """Stream dataset as NDJSON (newline-delimited JSON).

    First line: {"__meta__": true, "totalRows": N}
    Subsequent lines: one JSON object per row.
    Server never materializes the full JSON string — peak memory stays at DataFrame size only.
    """
    df = data_manager.get_data()
    if df is None:
        raise HTTPException(status_code=400, detail="No data loaded")

    total_rows = len(df)
    logger.info("[stream] Starting NDJSON stream of %d rows", total_rows)

    CHUNK_SIZE = 1000  # rows per chunk

    def generate_ndjson():
        # First line: metadata
        yield json.dumps({"__meta__": True, "totalRows": total_rows}) + "\n"

        # Stream data in chunks to balance efficiency vs memory
        for start in range(0, total_rows, CHUNK_SIZE):
            end = min(start + CHUNK_SIZE, total_rows)
            chunk_df = replace_na(df.iloc[start:end])
            records = chunk_df.to_dict(orient='records')
            for record in records:
                yield json.dumps(record, default=str) + "\n"

    return StreamingResponse(
        generate_ndjson(),
        media_type="application/x-ndjson",
        headers={"X-Total-Rows": str(total_rows)},
    )


@router.post("/sync")
async def sync_data(payload: dict):
    """Re-sync frontend data into backend data_manager (e.g. after backend restart).

    Accepts column-wise data ({"columns": {name: [values]}}, preferred — much
    cheaper to serialise than row objects) or row objects ({"data": [...]}).
    """
    columns = payload.get("columns")
    rows = payload.get("data")
    if columns:
        df = await asyncio.to_thread(pd.DataFrame, columns)
    elif rows:
        df = await asyncio.to_thread(pd.DataFrame, rows)
    else:
        raise HTTPException(status_code=400, detail="No data provided")
    await asyncio.to_thread(data_manager.set_data, df)
    logger.info("[sync] Loaded %d rows, %d columns from frontend", len(df), len(df.columns))
    return {"success": True, "rows": len(df), "columns": len(df.columns)}


@router.post("/sample")
async def compute_sample(request: SampleRequest):
    """Compute representative sample indices using outlier-preserving stratified random sampling."""
    df = data_manager.get_data()
    if df is None:
        raise HTTPException(status_code=400, detail="No data loaded")

    # IQR scans + grouping over the full dataset are CPU-bound — off the loop
    return await asyncio.to_thread(_compute_sample_sync, df, request)


def _compute_sample_sync(df: pd.DataFrame, request: SampleRequest) -> dict:
    total_rows = len(df)
    sample_size = min(request.sample_size, total_rows)

    # If dataset is small enough, return all indices
    if total_rows <= sample_size:
        return {
            "indices": list(range(total_rows)),
            "total_rows": total_rows,
            "sample_size": total_rows,
            "outlier_count": 0,
            "method": request.method
        }

    rng = np.random.default_rng(request.seed)
    all_indices = np.arange(total_rows)

    # Step 1: IQR outlier detection — always include outliers
    outlier_mask = np.zeros(total_rows, dtype=bool)
    if request.outlier_columns:
        for col in request.outlier_columns:
            if col not in df.columns:
                continue
            series = pd.to_numeric(df[col], errors='coerce')
            valid = series.dropna()
            if len(valid) == 0:
                continue
            q1 = valid.quantile(0.25)
            q3 = valid.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - request.iqr_multiplier * iqr
            upper = q3 + request.iqr_multiplier * iqr
            col_outlier = (series < lower) | (series > upper)
            # Only flag rows with valid values as outliers
            col_outlier = col_outlier.fillna(False)
            outlier_mask |= col_outlier.values

    outlier_indices = all_indices[outlier_mask]
    non_outlier_indices = all_indices[~outlier_mask]
    outlier_count = len(outlier_indices)

    # If outliers exceed budget, return all outliers
    if outlier_count >= sample_size:
        selected = rng.choice(outlier_indices, size=sample_size, replace=False)
        selected.sort()
        return {
            "indices": selected.tolist(),
            "total_rows": total_rows,
            "sample_size": sample_size,
            "outlier_count": sample_size,
            "method": request.method
        }

    remaining = sample_size - outlier_count

    # Step 2: Sample non-outlier rows by method
    if request.method == "stratified" and request.classification_column:
        col = request.classification_column
        if col in df.columns:
            groups = df.iloc[non_outlier_indices].groupby(col, dropna=False)
            group_counts = groups.size()
            total_non_outlier = len(non_outlier_indices)
            sampled_non_outlier = []
            for group_name, group_df in groups:
                proportion = len(group_df) / total_non_outlier
                n_from_group = max(1, int(round(proportion * remaining)))
                n_from_group = min(n_from_group, len(group_df))
                chosen = rng.choice(group_df.index.values, size=n_from_group, replace=False)
                # Convert DataFrame index to positional indices
                sampled_non_outlier.extend(chosen.tolist())
            # Trim if we overshot due to rounding
            if len(sampled_non_outlier) > remaining:
                sampled_non_outlier = rng.choice(
                    sampled_non_outlier, size=remaining, replace=False
                ).tolist()
            sampled_non_outlier = np.array(sampled_non_outlier)
        else:
            # Fall back to random
            sampled_non_outlier = rng.choice(non_outlier_indices, size=min(remaining, len(non_outlier_indices)), replace=False)

    elif request.method == "drillhole" and request.drillhole_column:
        col = request.drillhole_column
        if col in df.columns:
            # Get hole IDs for non-outlier rows
            non_outlier_df = df.iloc[non_outlier_indices]
            hole_ids = non_outlier_df[col].unique()
            rng.shuffle(hole_ids)
            sampled_non_outlier = []
            for hole_id in hole_ids:
                hole_mask = non_outlier_df[col] == hole_id
                hole_indices = non_outlier_indices[hole_mask.values]
                if len(sampled_non_outlier) + len(hole_indices) > remaining:
                    # Only add if we haven't reached budget yet
                    if len(sampled_non_outlier) == 0:
                        sampled_non_outlier.extend(hole_indices.tolist())
                    break
                sampled_non_outlier.extend(hole_indices.tolist())
            sampled_non_outlier = np.array(sampled_non_outlier) if sampled_non_outlier else np.array([], dtype=int)
        else:
            sampled_non_outlier = rng.choice(non_outlier_indices, size=min(remaining, len(non_outlier_indices)), replace=False)

    else:
        # Default: random sampling
        sampled_non_outlier = rng.choice(non_outlier_indices, size=min(remaining, len(non_outlier_indices)), replace=False)

    # Combine outliers + sampled non-outliers
    selected = np.concatenate([outlier_indices, sampled_non_outlier]).astype(int)
    selected = np.unique(selected)
    selected.sort()

    logger.info("Sample computed: %d/%d rows (method=%s, outliers=%d)",
                len(selected), total_rows, request.method, outlier_count)

    return {
        "indices": selected.tolist(),
        "total_rows": total_rows,
        "sample_size": len(selected),
        "outlier_count": outlier_count,
        "method": request.method
    }


_BAD_SHEET_CHARS = set("[]:*?/" + chr(92))


class XlsxSheet(BaseModel):
    name: str
    rows: List[List[Any]]


class XlsxExportRequest(BaseModel):
    sheets: List[XlsxSheet]


@router.post("/export/xlsx")
async def export_xlsx(request: XlsxExportRequest):
    """Write tables (e.g. the PCA report) to an .xlsx workbook, one sheet each."""
    import io
    from openpyxl import Workbook

    if not request.sheets:
        raise HTTPException(status_code=400, detail="No sheets to export")
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    for sheet in request.sheets:
        # Excel: max 31 chars, no []:*?/\ and unique names
        title = ''.join(ch for ch in sheet.name if ch not in _BAD_SHEET_CHARS)[:31] or 'Sheet'
        base, k = title, 2
        while title.lower() in used:
            suffix = f" ({k})"
            title = base[:31 - len(suffix)] + suffix
            k += 1
        used.add(title.lower())
        ws = wb.create_sheet(title)
        for row in sheet.rows:
            ws.append([v if v is None or isinstance(v, (int, float, str, bool)) else str(v) for v in row])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="export.xlsx"'},
    )
