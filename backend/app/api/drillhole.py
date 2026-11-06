from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Dict, Any, List
import asyncio
import pandas as pd
import numpy as np
import json
import logging
import uuid

from app.core.parsing import parse_file_content, clean_for_json
from app.core.columns import get_column_patterns, suggest_role

logger = logging.getLogger(__name__)

router = APIRouter()

# NOTE: data_manager is imported lazily inside functions to avoid circular imports
# The import `from app.api.data import data_manager` happens at function call time

# Single-user preview cache: fully-parsed frames from the most recent /preview,
# reused by /process (via preview_token) so the same files aren't uploaded and
# parsed twice. Only the latest preview is kept.
_preview_cache: Dict[str, Dict[str, pd.DataFrame]] = {}

@router.post("/preview")
async def preview_drillhole_columns(
    collar: UploadFile = File(...),
    survey: UploadFile = File(...),
    assay: UploadFile = File(...)
):
    """
    Preview files and suggest column mappings.
    Returns column information and sample data for user to verify mappings.
    """
    try:
        logger.debug("Reading file headers for column detection...")

        # Log file info
        for file, name in [(collar, 'collar'), (survey, 'survey'), (assay, 'assay')]:
            if file.filename:
                ext = file.filename.lower().split('.')[-1] if '.' in file.filename else ''
                logger.debug("%s file: %s (type: %s, ext: %s)", name, file.filename, file.content_type, ext)

        # Read file contents
        collar_content = await collar.read()
        survey_content = await survey.read()
        assay_content = await assay.read()

        # Parse the FULL files off the event loop and cache the frames —
        # /process reuses them via preview_token instead of re-upload+re-parse
        collar_df = await asyncio.to_thread(parse_file_content, collar_content, collar.filename)
        survey_df = await asyncio.to_thread(parse_file_content, survey_content, survey.filename)
        assay_df = await asyncio.to_thread(parse_file_content, assay_content, assay.filename)

        preview_token = uuid.uuid4().hex
        _preview_cache.clear()
        _preview_cache[preview_token] = {
            "collar": collar_df, "survey": survey_df, "assay": assay_df,
        }

        logger.debug("Collar columns: %s", list(collar_df.columns))
        logger.debug("Survey columns: %s", list(survey_df.columns))
        logger.debug("Assay columns: %s", list(assay_df.columns))

        # Analyze columns and suggest mappings
        collar_info = analyze_columns(collar_df, "collar")
        survey_info = analyze_columns(survey_df, "survey")
        assay_info = analyze_columns(assay_df, "assay")

        return {
            "preview_token": preview_token,
            "collar": {
                "columns": collar_info,
                "preview": clean_for_json(collar_df.head(5)),
                "required_fields": ["hole_id", "easting", "northing", "rl"],
                "total_rows": len(collar_df)
            },
            "survey": {
                "columns": survey_info,
                "preview": clean_for_json(survey_df.head(5)),
                "required_fields": ["hole_id", "depth", "dip", "azimuth"],
                "total_rows": len(survey_df)
            },
            "assay": {
                "columns": assay_info,
                "preview": clean_for_json(assay_df.head(5)),
                "required_fields": ["hole_id", "from", "to"],
                "total_rows": len(assay_df)
            }
        }

    except HTTPException:
        # Re-raise HTTP exceptions as-is (don't wrap them)
        raise
    except Exception as e:
        error_msg = str(e)
        logger.exception("Preview failed: %s", error_msg)

        # Provide more specific error messages
        if "NoneType" in error_msg:
            raise HTTPException(status_code=500, detail="File reading error - files may be empty or corrupted")
        elif "decode" in error_msg.lower():
            raise HTTPException(status_code=500, detail="File encoding error - please save files as UTF-8 CSV")
        else:
            raise HTTPException(status_code=500, detail=f"Preview failed: {error_msg[:200]}")

def analyze_columns(df: pd.DataFrame, file_type: str) -> List[Dict[str, Any]]:
    """
    Analyze columns and suggest appropriate mappings based on column names and data.
    """
    columns = []

    # Check if this is an error dataframe
    if 'Error' in df.columns or 'Status' in df.columns:
        logger.debug("Skipping analysis for error dataframe")
        return [{
            "name": col,
            "type": "error",
            "suggested_role": None,
            "confidence": 0,
            "sample_values": df[col].tolist()[:3],
            "non_null_count": 0,
            "unique_count": 0
        } for col in df.columns]

    # Define patterns for each file type
    patterns = get_column_patterns(file_type)

    for col in df.columns:
        # Try to detect the role
        suggested_role, confidence = suggest_role(col, patterns)

        # Get data type and sample values
        dtype = str(df[col].dtype)

        # Safely extract sample values
        try:
            raw_values = df[col].dropna().head(3).tolist()
            # Clean sample values - ensure they're displayable
            sample_values = []
            for val in raw_values:
                if val is None:
                    sample_values.append('NULL')
                elif isinstance(val, (int, float)):
                    sample_values.append(val)
                else:
                    # Convert to string and clean
                    str_val = str(val)
                    # Remove non-printable characters
                    clean_val = ''.join(c for c in str_val if c.isprintable())
                    # Limit length
                    if len(clean_val) > 50:
                        clean_val = clean_val[:50] + '...'
                    sample_values.append(clean_val)
        except Exception as e:
            logger.debug("Error extracting sample values for %s: %s", col, e)
            sample_values = ['<error>']

        # Additional validation based on data
        if suggested_role == "depth" and df[col].dtype in [np.float64, np.int64]:
            # Check if values are positive and increasing
            if all(df[col].dropna() >= 0):
                confidence = min(100, confidence + 20)

        elif suggested_role == "dip" and df[col].dtype in [np.float64, np.int64]:
            # Check if values are in typical dip range (-90 to 90)
            if all((-90 <= df[col].dropna()) & (df[col].dropna() <= 90)):
                confidence = min(100, confidence + 20)

        elif suggested_role == "azimuth" and df[col].dtype in [np.float64, np.int64]:
            # Check if values are in azimuth range (0 to 360)
            if all((0 <= df[col].dropna()) & (df[col].dropna() <= 360)):
                confidence = min(100, confidence + 20)

        columns.append({
            "name": col,
            "type": dtype,
            "suggested_role": suggested_role,
            "confidence": confidence,
            "sample_values": sample_values,
            "non_null_count": int(df[col].notna().sum()),
            "unique_count": int(df[col].nunique())
        })

    return columns


@router.post("/process")
async def process_with_mapping(
    collar: UploadFile = File(None),
    survey: UploadFile = File(None),
    assay: UploadFile = File(None),
    collar_mapping: str = Form(...),  # JSON string
    survey_mapping: str = Form(...),  # JSON string
    assay_mapping: str = Form(...),   # JSON string
    negate_dip: str = Form("false"),
    preview_token: str = Form(None)
):
    """
    Process drillhole data with user-specified column mappings.

    Pass the preview_token returned by /preview to reuse its already-parsed
    frames (no file re-upload needed); files are only required without one.
    """
    try:
        # Parse column mappings
        collar_map = json.loads(collar_mapping)
        survey_map = json.loads(survey_mapping)
        assay_map = json.loads(assay_mapping)

        logger.info("Processing with user-defined column mappings")
        logger.info("Collar mapping: %s", collar_map)
        logger.info("Survey mapping: %s", survey_map)
        logger.info("Assay mapping: %s", assay_map)

        # Validate required fields
        required_collar = ["hole_id", "easting", "northing", "rl"]
        required_survey = ["hole_id", "depth", "dip", "azimuth"]
        required_assay = ["hole_id", "from", "to"]

        for field in required_collar:
            if field not in collar_map:
                raise HTTPException(status_code=400, detail=f"Missing required collar field: {field}")

        for field in required_survey:
            if field not in survey_map:
                raise HTTPException(status_code=400, detail=f"Missing required survey field: {field}")

        for field in required_assay:
            if field not in assay_map:
                raise HTTPException(status_code=400, detail=f"Missing required assay field: {field}")

        # Get the frames: preview cache first (no re-upload/re-parse), else files
        if preview_token and preview_token in _preview_cache:
            logger.info("Reusing parsed frames from preview cache (token=%s)", preview_token[:8])
            cached = _preview_cache[preview_token]
            # Copies: desurvey mutates its inputs in place, and the user may
            # re-process with a different mapping from the same preview
            collar_df = cached["collar"].copy()
            survey_df = cached["survey"].copy()
            assay_df = cached["assay"].copy()
        elif collar and survey and assay:
            logger.info("Reading files...")
            collar_content = await collar.read()
            survey_content = await survey.read()
            assay_content = await assay.read()

            # Parse files off the event loop (supports both CSV and Excel)
            collar_df = await asyncio.to_thread(parse_file_content, collar_content, collar.filename)
            survey_df = await asyncio.to_thread(parse_file_content, survey_content, survey.filename)
            assay_df = await asyncio.to_thread(parse_file_content, assay_content, assay.filename)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either a valid preview_token or all three files (collar, survey, assay)")

        logger.info("Files loaded - Collars: %d, Surveys: %d, Assays: %d", len(collar_df), len(survey_df), len(assay_df))

        # Rename columns to standard names for processing
        collar_df = rename_to_standard(collar_df, collar_map)
        survey_df = rename_to_standard(survey_df, survey_map)
        assay_df = rename_to_standard(assay_df, assay_map)

        logger.info("Columns renamed to standard format")
        logger.debug("Collar columns: %s...", list(collar_df.columns)[:10])
        logger.debug("Survey columns: %s...", list(survey_df.columns)[:10])
        logger.debug("Assay columns: %s...", list(assay_df.columns)[:10])

        # Negate dip values if requested (positive dip = downward -> negative dip = downward)
        should_negate_dip = negate_dip.lower() in ('true', '1', 'yes')
        if should_negate_dip and 'dip' in survey_df.columns:
            survey_df['dip'] = pd.to_numeric(survey_df['dip'], errors='coerce') * -1
            logger.info("Dip values negated (converting positive-down to negative-down convention)")

        # Process with desurvey
        logger.info("Starting desurvey processing...")

        # Create column mapping dict to pass to desurvey
        column_mapping = {
            'collar': collar_map,
            'survey': survey_map,
            'assay': assay_map
        }

        from app.core.drillhole_manager import DrillholeManager
        manager = DrillholeManager()
        use_parallel = len(collar_df) > 100
        # Desurvey off the event loop (can take seconds/minutes on big datasets);
        # column_mapping tells desurvey to use standard column names
        result_df = await asyncio.to_thread(
            manager.desurvey, collar_df, survey_df, assay_df,
            use_parallel=use_parallel, column_mapping=column_mapping)

        if result_df.empty:
            raise HTTPException(status_code=400, detail="No matching holes found between files")

        logger.info("Desurvey complete - %d records processed", len(result_df))

        # Load into the SHARED data manager (same one used by /api/data endpoints)
        # Import lazily to avoid circular imports
        from app.api.data import data_manager
        # set_data clears stale detection state and re-detects; its
        # _detect_all_properties includes _convert_mostly_numeric_columns, which
        # converts columns like Au_ppm_Plot that have mixed text/numeric values
        await asyncio.to_thread(data_manager.set_data, result_df)
        logger.debug("Column info count: %d", len(data_manager.get_column_info()))

        logger.info("Processing complete!")

        # Metadata + preview only — the frontend streams the full dataset via
        # /api/data/stream (matching the /data/upload/drillhole flow); returning
        # the whole dataset as one JSON blob caused large latency/memory spikes
        preview = clean_for_json(data_manager.df.head(100))

        return {
            "success": True,
            "rows": len(data_manager.df),
            "columns": len(data_manager.df.columns),
            "data": [],
            "preview": preview,
            "column_info": data_manager.get_column_info()
        }

    except HTTPException:
        # Preserve intentional status codes (400 validation errors were
        # previously re-wrapped as 500s by the catch-all below)
        raise
    except Exception as e:
        logger.exception("Processing failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

def rename_to_standard(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    """
    Rename dataframe columns based on mapping to standard names.
    mapping format: {"standard_name": "actual_column_name"}
    """
    # Create reverse mapping (actual -> standard)
    rename_dict = {}

    # First, rename the mapped columns
    for standard_name, actual_name in mapping.items():
        if actual_name in df.columns:
            rename_dict[actual_name] = standard_name

    # Keep other columns as-is (don't rename them)
    df_renamed = df.rename(columns=rename_dict)

    logger.debug("Renamed %d columns: %s", len(rename_dict), rename_dict)

    return df_renamed