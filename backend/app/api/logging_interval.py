"""
API endpoints for logging interval merge functionality.

Provides preview (column detection) and process (interval matching) endpoints
for merging categorical logging data onto assay intervals.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import asdict
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.parsing import parse_file_content, clean_for_json
from app.core.columns import get_column_patterns, suggest_role

logger = logging.getLogger(__name__)

router = APIRouter()

# Single-user preview cache: the parsed frame from the most recent /preview,
# reused by /process (via preview_token) so the file isn't uploaded and
# parsed twice. Only the latest preview is kept.
_preview_cache: Dict[str, pd.DataFrame] = {}


def _analyze_logging_columns(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Analyze logging file columns and suggest HoleID/From/To/Category roles."""
    columns = []

    patterns = get_column_patterns("logging")

    for col in df.columns:
        suggested_role, confidence = suggest_role(col, patterns)

        # Get sample values
        try:
            raw_values = df[col].dropna().head(5).tolist()
            sample_values = []
            for val in raw_values:
                if isinstance(val, (int, float)):
                    sample_values.append(val)
                else:
                    s = str(val)[:50]
                    sample_values.append(s)
        except Exception:
            sample_values = []

        columns.append({
            "name": col,
            "type": str(df[col].dtype),
            "suggested_role": suggested_role,
            "confidence": confidence,
            "sample_values": sample_values,
            "non_null_count": int(df[col].notna().sum()),
            "unique_count": int(df[col].nunique()),
        })

    return columns


def _suggest_category_column(columns_info: List[Dict], df: pd.DataFrame) -> str | None:
    """Suggest which column is the category column (non-HoleID/From/To text column)."""
    mapped_roles = {c["suggested_role"] for c in columns_info if c["suggested_role"]}
    for c in columns_info:
        if c["suggested_role"] is not None:
            continue
        # Prefer text/object columns with reasonable unique counts
        if df[c["name"]].dtype == object and c["unique_count"] > 1 and c["unique_count"] < len(df) * 0.8:
            return c["name"]
    return None


@router.post("/preview")
async def preview_logging_file(file: UploadFile = File(...)):
    """
    Parse a logging CSV/Excel file and return column info with auto-detection.
    Also detects overlapping intervals.
    """
    try:
        content = await file.read()
        df = await asyncio.to_thread(parse_file_content, content, file.filename)

        if df.empty or len(df.columns) < 3:
            raise HTTPException(status_code=400, detail="File must have at least 3 columns (HoleID, From, To)")

        preview_token = uuid.uuid4().hex
        _preview_cache.clear()
        _preview_cache[preview_token] = df

        columns_info = _analyze_logging_columns(df)
        category_suggestion = _suggest_category_column(columns_info, df)

        # Mark category suggestion
        if category_suggestion:
            for c in columns_info:
                if c["name"] == category_suggestion and c["suggested_role"] is None:
                    c["suggested_role"] = "category"
                    c["confidence"] = 60

        # Detect overlaps if we can identify the required columns
        detected_overlaps = {
            "has_overlaps": False,
            "overlap_count": 0,
            "holes_with_overlaps": [],
            "overlapping_values": [],
            "sample_overlaps": [],
        }

        # Try to auto-detect and run overlap check
        hole_col = next((c["name"] for c in columns_info if c["suggested_role"] == "hole_id"), None)
        from_col = next((c["name"] for c in columns_info if c["suggested_role"] == "from"), None)
        to_col = next((c["name"] for c in columns_info if c["suggested_role"] == "to"), None)
        cat_col = category_suggestion

        if hole_col and from_col and to_col and cat_col:
            try:
                from app.core.interval_matcher import IntervalMatcher
                matcher = IntervalMatcher()
                overlap_report = matcher.detect_overlaps(df, hole_col, from_col, to_col, cat_col)
                detected_overlaps = asdict(overlap_report)
            except Exception as e:
                logger.warning("Overlap detection failed: %s", e)

        # Preview data (first 10 rows)
        preview = clean_for_json(df.head(10))

        return {
            "preview_token": preview_token,
            "columns": columns_info,
            "preview": preview,
            "total_rows": len(df),
            "detected_overlaps": detected_overlaps,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Logging preview failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)[:200]}")


@router.post("/process")
async def process_logging_merge(
    file: UploadFile = File(None),
    mapping: str = Form(...),
    strategy: str = Form("max_overlap"),
    min_overlap_pct: float = Form(0.0),
    column_prefix: str = Form(""),
    preview_token: str = Form(None),
):
    """
    Process logging file and merge onto assay data.

    mapping: JSON string with keys hole_id, from, to, category
    strategy: max_overlap | split_columns | combine_codes
    Pass the preview_token returned by /preview to reuse its already-parsed
    frame (no file re-upload needed); the file is only required without one.
    """
    try:
        # Parse mapping
        col_mapping = json.loads(mapping)
        required = ["hole_id", "from", "to", "category"]
        for field in required:
            if field not in col_mapping:
                raise HTTPException(status_code=400, detail=f"Missing required mapping: {field}")

        # Validate strategy
        if strategy not in ("max_overlap", "split_columns", "combine_codes"):
            raise HTTPException(status_code=400, detail=f"Invalid strategy: {strategy}")

        # Get assay data from shared data manager
        from app.api.data import data_manager
        if data_manager.df is None or data_manager.df.empty:
            raise HTTPException(status_code=400, detail="No assay data loaded. Upload data first.")

        assay_df = data_manager.df

        # Find assay HoleID/From/To columns
        col_info_list = data_manager.get_column_info()
        assay_hole_col = None
        assay_from_col = None
        assay_to_col = None

        for ci in col_info_list:
            role = ci.get("role", "")
            if role == "HoleID":
                assay_hole_col = ci["name"]
            elif role == "From":
                assay_from_col = ci["name"]
            elif role == "To":
                assay_to_col = ci["name"]

        if not assay_hole_col or not assay_from_col or not assay_to_col:
            raise HTTPException(
                status_code=400,
                detail="Assay data must have HoleID, From, and To columns assigned. Check column roles.",
            )

        # Get the logging frame: preview cache first, else the uploaded file
        if preview_token and preview_token in _preview_cache:
            logger.info("Reusing parsed frame from preview cache (token=%s)", preview_token[:8])
            # Copy: process mutates the frame (numeric coercion, dropna) and the
            # user may re-process with a different mapping from the same preview
            logging_df = _preview_cache[preview_token].copy()
        elif file:
            content = await file.read()
            logging_df = await asyncio.to_thread(parse_file_content, content, file.filename)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either a valid preview_token or the logging file")

        log_hole_col = col_mapping["hole_id"]
        log_from_col = col_mapping["from"]
        log_to_col = col_mapping["to"]
        log_cat_col = col_mapping["category"]

        # Validate columns exist
        for col_name, label in [
            (log_hole_col, "HoleID"), (log_from_col, "From"),
            (log_to_col, "To"), (log_cat_col, "Category"),
        ]:
            if col_name not in logging_df.columns:
                raise HTTPException(status_code=400, detail=f"Column '{col_name}' not found in logging file")

        # Ensure numeric from/to
        logging_df[log_from_col] = pd.to_numeric(logging_df[log_from_col], errors="coerce")
        logging_df[log_to_col] = pd.to_numeric(logging_df[log_to_col], errors="coerce")
        logging_df = logging_df.dropna(subset=[log_hole_col, log_from_col, log_to_col, log_cat_col])

        logger.info(
            "Processing logging merge: %d logging rows -> %d assay rows, strategy=%s",
            len(logging_df), len(assay_df), strategy,
        )

        # Run interval matching off the event loop
        from app.core.interval_matcher import IntervalMatcher
        matcher = IntervalMatcher()
        result = await asyncio.to_thread(
            matcher.match_intervals,
            assay_df=assay_df,
            logging_df=logging_df,
            assay_hole_col=assay_hole_col,
            assay_from_col=assay_from_col,
            assay_to_col=assay_to_col,
            log_hole_col=log_hole_col,
            log_from_col=log_from_col,
            log_to_col=log_to_col,
            log_category_col=log_cat_col,
            strategy=strategy,
            min_overlap_pct=min_overlap_pct,
            column_prefix=column_prefix,
        )

        def apply_result():
            # Append new columns, then re-detect so they get proper types/roles
            for col_name, values in result.new_column_data.items():
                data_manager.df[col_name] = values
            data_manager._detect_all_properties()

        await asyncio.to_thread(apply_result)

        # Metadata + preview only — the frontend streams the updated dataset
        # via /api/data/stream instead of receiving it as one JSON blob
        return {
            "success": True,
            "columns_added": result.columns_added,
            "rows": len(data_manager.df),
            "data": [],
            "preview": clean_for_json(data_manager.df.head(20)),
            "column_info": data_manager.get_column_info(),
            "qaqc": asdict(result.qaqc),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Logging merge failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)[:200]}")
