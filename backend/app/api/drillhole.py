from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np
import io
import json
from datetime import datetime

router = APIRouter()

# === VERSION MARKER - UPDATE: 2025-11-26 14:30 - RETURNS ALL DATA ===
print("[DRILLHOLE API] Loaded version: 2025-11-26 14:30 - Returns ALL data (not 100-row preview)")

# NOTE: data_manager is imported lazily inside functions to avoid circular imports
# The import `from app.api.data import data_manager` happens at function call time

def decode_with_fallback(content: bytes) -> str:
    """
    Try multiple encodings to decode file content.
    Returns decoded string or raises exception if all fail.
    """
    # Try common encodings in order of likelihood
    encodings = [
        'utf-8',           # Most common modern encoding
        'utf-8-sig',       # UTF-8 with BOM
        'latin-1',         # ISO-8859-1
        'cp1252',          # Windows Western European
        'iso-8859-15',     # Latin-9
        'cp850',           # DOS Western European
    ]

    for encoding in encodings:
        try:
            decoded = content.decode(encoding)
            print(f"[ENCODING] Successfully decoded using: {encoding}")
            return decoded
        except (UnicodeDecodeError, AttributeError):
            continue

    # If all fail, use Latin-1 (never fails but may produce garbage)
    print("[ENCODING] All encodings failed, using Latin-1 with error replacement")
    return content.decode('latin-1', errors='replace')

def parse_csv_with_detection(content: bytes, nrows: int = None) -> pd.DataFrame:
    """
    Parse CSV with automatic delimiter detection and error recovery.
    Handles various formats: CSV, TSV, semicolon, pipe, Excel exports, etc.
    """

    # First try to read directly as bytes (handles newline issues better)
    try:
        df = pd.read_csv(io.BytesIO(content), nrows=nrows, on_bad_lines='skip')
        if len(df.columns) >= 2 and len(df) > 0:
            print(f"[PARSE] Success with direct binary read, columns={len(df.columns)}")
            return df
    except:
        pass

    # Now try with decoded text
    decoded = decode_with_fallback(content)

    # Replace various newline formats to normalize
    decoded = decoded.replace('\r\n', '\n').replace('\r', '\n')

    # Try different parsing strategies
    parsing_strategies = [
        # Strategy 1: Let pandas auto-detect (best for most files)
        {'sep': None, 'engine': 'python', 'on_bad_lines': 'skip'},
        # Strategy 2: Common delimiters with explicit settings
        {'sep': ',', 'quotechar': '"', 'on_bad_lines': 'skip'},
        {'sep': '\t', 'quotechar': '"', 'on_bad_lines': 'skip'},
        {'sep': ';', 'quotechar': '"', 'on_bad_lines': 'skip'},
        {'sep': '|', 'quotechar': '"', 'on_bad_lines': 'skip'},
        # Strategy 3: Handle Excel exports (often use tabs)
        {'sep': '\t', 'quoting': 0, 'on_bad_lines': 'skip'},  # 0 = QUOTE_MINIMAL
        # Strategy 4: Skip potential metadata rows
        {'sep': None, 'engine': 'python', 'skiprows': 1, 'on_bad_lines': 'skip'},
        {'sep': None, 'engine': 'python', 'skiprows': 2, 'on_bad_lines': 'skip'},
        {'sep': ',', 'skiprows': 1, 'on_bad_lines': 'skip'},
        {'sep': '\t', 'skiprows': 1, 'on_bad_lines': 'skip'},
        # Strategy 5: Space-delimited with multiple spaces
        {'sep': '\s+', 'engine': 'python', 'on_bad_lines': 'skip'},
        # Strategy 6: Fixed-width format
        {'sep': '\s{2,}', 'engine': 'python', 'on_bad_lines': 'skip'},
    ]

    for i, strategy in enumerate(parsing_strategies):
        try:
            kwargs = strategy.copy()
            if nrows:
                kwargs['nrows'] = nrows

            df = pd.read_csv(io.StringIO(decoded), **kwargs)

            # Validate: must have at least 2 columns and some rows
            if len(df.columns) >= 2 and len(df) > 0:
                # Additional validation - check if data looks reasonable
                # Check if any column has mostly valid data
                valid_cols = 0
                for col in df.columns:
                    try:
                        non_null = df[col].dropna()
                        if len(non_null) > 0:
                            # Check if values are reasonable (not all garbage)
                            if df[col].dtype in [np.float64, np.int64, np.float32, np.int32]:
                                valid_cols += 1
                            else:
                                # For string columns, check if they're printable
                                sample = str(non_null.iloc[0])
                                if sample and any(c.isprintable() for c in sample):
                                    valid_cols += 1
                    except:
                        continue

                if valid_cols < len(df.columns) // 2:
                    print(f"[PARSE] Data appears corrupted - {valid_cols}/{len(df.columns)} valid columns")
                    continue
                delimiter_name = strategy.get('sep', 'auto-detected')
                if delimiter_name == '\t':
                    delimiter_name = 'tab'
                elif delimiter_name == '\s+':
                    delimiter_name = 'spaces'
                elif delimiter_name == '\s{2,}':
                    delimiter_name = 'fixed-width'
                skiprows = strategy.get('skiprows', 0)
                print(f"[PARSE] Success with delimiter='{delimiter_name}', skiprows={skiprows}, columns={len(df.columns)}")
                return df
        except Exception as e:
            continue

    # Last resort: try reading line by line and inferring format
    try:
        print("[PARSE] All strategies failed, trying line-by-line analysis")
        lines = decoded.split('\n')

        # Skip empty lines at the start
        while lines and not lines[0].strip():
            lines.pop(0)

        if not lines:
            raise ValueError("File appears to be empty")

        # Try to detect delimiter from first non-empty line
        first_line = lines[0]
        delimiters = [',', '\t', ';', '|']
        delimiter = ','
        max_count = 0

        for delim in delimiters:
            count = first_line.count(delim)
            if count > max_count:
                max_count = count
                delimiter = delim

        # Create a clean CSV string
        clean_lines = []
        for line in lines[:nrows] if nrows else lines:
            if line.strip():  # Skip empty lines
                clean_lines.append(line.strip())

        clean_csv = '\n'.join(clean_lines)

        df = pd.read_csv(io.StringIO(clean_csv), sep=delimiter, on_bad_lines='skip')

        if len(df.columns) >= 1 and len(df) > 0:
            print(f"[PARSE] Line-by-line analysis succeeded with delimiter='{delimiter}', columns={len(df.columns)}")
            return df

        raise ValueError("Parsed dataframe has no valid data")

    except Exception as e:
        # Final fallback: return a structured error response
        print(f"[PARSE] All parsing failed: {e}")

        # Check if it's a binary file (Excel, etc.)
        try:
            # Try to detect if it's binary
            if b'\x00' in content[:1000] or b'\xff\xfe' in content[:2] or b'\xfe\xff' in content[:2]:
                print("[PARSE] File appears to be binary (Excel, etc.)")
                error_df = pd.DataFrame({
                    'Error': ['Binary file detected'],
                    'FileType': ['Excel or other binary format'],
                    'Solution': ['Please save as CSV or text format']
                })
                return error_df
        except:
            pass

        # Return a minimal error dataframe that won't corrupt the display
        error_df = pd.DataFrame({
            'Status': ['ParseError'],
            'Message': ['Could not parse file'],
            'Details': [str(e)[:100]],  # Limit error message length
            'Suggestion': ['Check file format and encoding']
        })
        print(f"[PARSE] Returning error dataframe")
        return error_df

def parse_file_content(content: bytes, filename: str, nrows: int = None) -> pd.DataFrame:
    """
    Parse file content based on file extension.
    Supports CSV and Excel formats.
    """
    import io

    ext = filename.lower().split('.')[-1] if '.' in filename else 'csv'

    if ext in ['xlsx', 'xls']:
        # Excel file
        print(f"[PARSE] Parsing Excel file: {filename}")
        try:
            df = pd.read_excel(io.BytesIO(content), nrows=nrows)
            print(f"[PARSE] Excel parsed successfully: {len(df.columns)} columns, {len(df)} rows")
            return df
        except Exception as e:
            print(f"[PARSE] Excel parsing failed: {e}")
            raise ValueError(f"Failed to parse Excel file: {e}")
    else:
        # CSV or text file - use the robust parser
        return parse_csv_with_detection(content, nrows=nrows)


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
        print("[PREVIEW] Reading file headers for column detection...")

        # Log file info
        for file, name in [(collar, 'collar'), (survey, 'survey'), (assay, 'assay')]:
            if file.filename:
                ext = file.filename.lower().split('.')[-1] if '.' in file.filename else ''
                print(f"[PREVIEW] {name} file: {file.filename} (type: {file.content_type}, ext: {ext})")

        # Read file contents
        collar_content = await collar.read()
        survey_content = await survey.read()
        assay_content = await assay.read()

        # Parse previews (supports both CSV and Excel)
        collar_df = parse_file_content(collar_content, collar.filename, nrows=10)
        survey_df = parse_file_content(survey_content, survey.filename, nrows=10)
        assay_df = parse_file_content(assay_content, assay.filename, nrows=10)

        print(f"[PREVIEW] Collar columns: {list(collar_df.columns)}")
        print(f"[PREVIEW] Survey columns: {list(survey_df.columns)}")
        print(f"[PREVIEW] Assay columns: {list(assay_df.columns)}")

        # Analyze columns and suggest mappings
        collar_info = analyze_columns(collar_df, "collar")
        survey_info = analyze_columns(survey_df, "survey")
        assay_info = analyze_columns(assay_df, "assay")

        return {
            "collar": {
                "columns": collar_info,
                "preview": collar_df.head(5).replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records'),
                "required_fields": ["hole_id", "easting", "northing", "rl"],
                "total_rows": len(collar_df)
            },
            "survey": {
                "columns": survey_info,
                "preview": survey_df.head(5).replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records'),
                "required_fields": ["hole_id", "depth", "dip", "azimuth"],
                "total_rows": len(survey_df)
            },
            "assay": {
                "columns": assay_info,
                "preview": assay_df.head(5).replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records'),
                "required_fields": ["hole_id", "from", "to"],
                "total_rows": len(assay_df)
            }
        }

    except HTTPException:
        # Re-raise HTTP exceptions as-is (don't wrap them)
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"[ERROR] Preview failed: {error_msg}")
        print(f"[TRACEBACK] {traceback.format_exc()}")

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
        print(f"[ANALYZE] Skipping analysis for error dataframe")
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
        col_lower = col.lower().strip().replace("_", "").replace(" ", "")

        # Try to detect the role
        suggested_role = None
        confidence = 0

        for role, role_patterns in patterns.items():
            for pattern, weight in role_patterns:
                if pattern in col_lower:
                    if weight > confidence:
                        suggested_role = role
                        confidence = weight

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
            print(f"[ANALYZE] Error extracting sample values for {col}: {e}")
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

def get_column_patterns(file_type: str) -> Dict[str, List[tuple]]:
    """
    Get column name patterns for each file type with confidence weights.
    Higher weight = higher confidence in the match.
    Enhanced to handle ambiguous column names better.
    """
    if file_type == "collar":
        return {
            "hole_id": [
                # High confidence - exact matches
                ("holeid", 100), ("hole_id", 100), ("bhid", 95),
                ("dhid", 90), ("ddh", 85), ("drill_id", 85),
                ("drillhole_id", 85), ("borehole_id", 85),
                # Medium confidence - partial matches
                ("hole", 70), ("drillhole", 70), ("borehole", 70),
                ("well", 60), ("dh", 60),
                # Low confidence - generic IDs (avoid if possible)
                ("id", 20), ("recordid", 10), ("sampleid", 10),
                ("name", 15), ("number", 15), ("holenumber", 40)
            ],
            "easting": [
                # High confidence
                ("easting", 100), ("east", 95), ("x_coord", 95),
                ("xcoord", 95), ("utme", 90), ("utm_e", 90),
                ("mine_e", 85), ("collar_e", 90),
                # Medium confidence (check if it's the local grid)
                ("x", 60), ("xcoordinate", 80),
                # Low confidence (might be local grid)
                ("localx", 30), ("local_x", 30), ("gridx", 40)
            ],
            "northing": [
                # High confidence
                ("northing", 100), ("north", 95), ("y_coord", 95),
                ("ycoord", 95), ("utmn", 90), ("utm_n", 90),
                ("mine_n", 85), ("collar_n", 90),
                # Medium confidence
                ("y", 60), ("ycoordinate", 80),
                # Low confidence (might be local grid)
                ("localy", 30), ("local_y", 30), ("gridy", 40)
            ],
            "rl": [
                # High confidence
                ("rl", 100), ("collar_rl", 100), ("collarrl", 100),
                ("elevation", 95), ("elev", 90), ("collar_elev", 95),
                ("z_coord", 90), ("zcoord", 90), ("altitude", 85),
                # Medium confidence
                ("z", 60), ("height", 70), ("level", 60),
                # Low confidence
                ("vertical", 40), ("depth", 20)  # depth is usually for surveys
            ]
        }
    elif file_type == "survey":
        return {
            "hole_id": [
                # High confidence
                ("holeid", 100), ("hole_id", 100), ("bhid", 95),
                ("dhid", 90), ("ddh", 85), ("drill_id", 85),
                ("drillhole_id", 85), ("borehole_id", 85),
                # Medium confidence
                ("hole", 70), ("drillhole", 70), ("borehole", 70),
                # Low confidence - avoid generic IDs
                ("id", 20), ("recordid", 10), ("sampleid", 10)
            ],
            "depth": [
                # High confidence
                ("depth", 100), ("survey_depth", 100), ("surveydepth", 100),
                ("measured_depth", 95), ("measureddepth", 95),
                ("depth_m", 95), ("depthm", 95), ("md", 90),
                # Medium confidence
                ("distance", 70), ("dist", 60), ("length", 50),
                # Low confidence - might be something else
                ("position", 40), ("location", 30)
            ],
            "dip": [
                # High confidence
                ("dip", 100), ("inclination", 95), ("incl", 90),
                ("vertical_angle", 85), ("vert_angle", 85),
                # Medium confidence
                ("angle", 50), ("pitch", 60), ("plunge", 70),
                # Low confidence - might be azimuth
                ("vertical", 40), ("direction", 20)
            ],
            "azimuth": [
                # High confidence
                ("azimuth", 100), ("azi", 95), ("true_azi", 95),
                ("trueazimuth", 95), ("true_azimuth", 95),
                # Medium confidence
                ("bearing", 85), ("mag_azi", 80), ("magnetic_azi", 80),
                ("magneticazimuth", 80),
                # Low confidence - might be dip
                ("direction", 50), ("heading", 60), ("trend", 60)
            ]
        }
    elif file_type == "assay":
        return {
            "hole_id": [
                # High confidence
                ("holeid", 100), ("hole_id", 100), ("bhid", 95),
                ("dhid", 90), ("ddh", 85), ("drill_id", 85),
                # Medium confidence
                ("hole", 70), ("drillhole", 70),
                # Low confidence - avoid sample IDs
                ("sampleno", 10), ("sample_id", 10), ("sampleid", 10),
                ("id", 20), ("number", 15)
            ],
            "from": [
                # High confidence
                ("from", 100), ("from_m", 100), ("fromm", 100),
                ("depth_from", 95), ("depthfrom", 95),
                ("sample_from", 90), ("samplefrom", 90),
                ("start_depth", 90), ("startdepth", 90),
                # Medium confidence
                ("start", 80), ("int_from", 85), ("interval_from", 85),
                ("from_depth", 90),
                # Low confidence
                ("begin", 60), ("top", 50)
            ],
            "to": [
                # High confidence
                ("to", 100), ("to_m", 100), ("tom", 100),
                ("depth_to", 95), ("depthto", 95),
                ("sample_to", 90), ("sampleto", 90),
                ("end_depth", 90), ("enddepth", 90),
                # Medium confidence
                ("end", 80), ("int_to", 85), ("interval_to", 85),
                ("to_depth", 90),
                # Low confidence
                ("finish", 60), ("bottom", 50)
            ]
        }
    return {}

@router.post("/process")
async def process_with_mapping(
    collar: UploadFile = File(...),
    survey: UploadFile = File(...),
    assay: UploadFile = File(...),
    collar_mapping: str = Form(...),  # JSON string
    survey_mapping: str = Form(...),  # JSON string
    assay_mapping: str = Form(...)    # JSON string
):
    """
    Process drillhole data with user-specified column mappings.
    """
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

    try:
        # Parse column mappings
        collar_map = json.loads(collar_mapping)
        survey_map = json.loads(survey_mapping)
        assay_map = json.loads(assay_mapping)

        print("\n" + "="*60)
        print("[MAPPED UPLOAD] Processing with user-defined column mappings")
        print(f"Collar mapping: {collar_map}")
        print(f"Survey mapping: {survey_map}")
        print(f"Assay mapping: {assay_map}")
        print("="*60)

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

        # Read files
        print("[CHECKPOINT 1] Reading files...")
        collar_content = await collar.read()
        survey_content = await survey.read()
        assay_content = await assay.read()

        # Parse files (supports both CSV and Excel)
        collar_df = parse_file_content(collar_content, collar.filename)
        survey_df = parse_file_content(survey_content, survey.filename)
        assay_df = parse_file_content(assay_content, assay.filename)

        print(f"[CHECKPOINT 2] Files loaded - Collars: {len(collar_df)}, Surveys: {len(survey_df)}, Assays: {len(assay_df)}")

        # Rename columns to standard names for processing
        collar_df = rename_to_standard(collar_df, collar_map)
        survey_df = rename_to_standard(survey_df, survey_map)
        assay_df = rename_to_standard(assay_df, assay_map)

        print("[CHECKPOINT 3] Columns renamed to standard format")
        print(f"Collar columns: {list(collar_df.columns)[:10]}...")
        print(f"Survey columns: {list(survey_df.columns)[:10]}...")
        print(f"Assay columns: {list(assay_df.columns)[:10]}...")

        # Process with desurvey
        print("[CHECKPOINT 4] Starting desurvey processing...")

        # Create column mapping dict to pass to desurvey
        column_mapping = {
            'collar': collar_map,
            'survey': survey_map,
            'assay': assay_map
        }

        # Try to use optimized version
        try:
            from app.core.drillhole_manager_optimized import DrillholeManagerOptimized
            print("[INFO] Using optimized desurvey")
            manager = DrillholeManagerOptimized()
            use_parallel = len(collar_df) > 100
            # Pass column_mapping to tell desurvey to use standard column names
            result_df = manager.desurvey(collar_df, survey_df, assay_df, use_parallel=use_parallel, column_mapping=column_mapping)
        except ImportError:
            from app.core.drillhole_manager import DrillholeManager
            print("[INFO] Using standard desurvey")
            manager = DrillholeManager()
            # Pass column_mapping to tell desurvey to use standard column names
            result_df = manager.desurvey(collar_df, survey_df, assay_df, column_mapping=column_mapping)

        if result_df.empty:
            raise HTTPException(status_code=400, detail="No matching holes found between files")

        print(f"[CHECKPOINT 5] Desurvey complete - {len(result_df)} records processed")

        # Load into the SHARED data manager (same one used by /api/data endpoints)
        # Import lazily to avoid circular imports
        from app.api.data import data_manager
        print(f"[DEBUG] Data manager id BEFORE: {id(data_manager)}, df is None: {data_manager.df is None}")
        data_manager.df = result_df
        print(f"[DEBUG] Data manager id AFTER: {id(data_manager)}, df shape: {data_manager.df.shape}")

        # Use _detect_all_properties which includes _convert_mostly_numeric_columns
        # This converts columns like Au_ppm_Plot that have mixed text/numeric values
        if hasattr(data_manager, '_detect_all_properties'):
            data_manager._detect_all_properties()
        else:
            # Fallback for non-optimized manager
            data_manager._detect_column_types()
            data_manager._auto_detect_roles()
            data_manager._guess_aliases()
        print(f"[DEBUG] Column info count: {len(data_manager.get_column_info())}")

        print("[SUCCESS] Processing complete!")

        # Return ALL data - this fixes the 100-row limit issue
        # Use data_manager.df which has been through type conversion
        all_data = data_manager.df.replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records')
        print(f"[DEBUG /process] Returning {len(all_data)} rows to frontend (FULL dataset)")
        print(f"[DEBUG /process] Data manager df shape: {data_manager.df.shape}")
        print(f"[DEBUG /process] Data manager id: {id(data_manager)}")

        return {
            "success": True,
            "rows": len(all_data),
            "columns": len(data_manager.df.columns),
            "data": all_data,  # FULL dataset - frontend should use this
            "preview": all_data[:100] if len(all_data) > 100 else all_data,  # Keep preview for backwards compat
            "column_info": data_manager.get_column_info()
        }

    except Exception as e:
        print(f"[ERROR] Processing failed: {e}")
        import traceback
        traceback.print_exc()
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

    print(f"Renamed {len(rename_dict)} columns: {rename_dict}")

    return df_renamed