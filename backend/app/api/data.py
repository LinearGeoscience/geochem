from fastapi import APIRouter, UploadFile, File, HTTPException
# Try to use optimized version
try:
    from app.core.data_manager_optimized import DataManagerOptimized as DataManager
    print("[OK] Using OPTIMIZED DataManager")
except ImportError:
    from app.core.data_manager import DataManager
    print("[INFO] Using standard DataManager")

import shutil
import os
import numpy as np
import pandas as pd
from typing import Dict, Any, List
from pydantic import BaseModel

router = APIRouter()
data_manager = DataManager()

class ColumnUpdate(BaseModel):
    column: str
    role: str = None
    alias: str = None

def decode_with_fallback(content: bytes) -> str:
    """Try multiple encodings to decode file content."""
    encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252', 'iso-8859-1']
    for encoding in encodings:
        try:
            decoded = content.decode(encoding)
            print(f"[ENCODING] Successfully decoded using: {encoding}")
            return decoded
        except (UnicodeDecodeError, AttributeError):
            continue
    # Last resort: latin-1 never fails
    return content.decode('latin-1', errors='replace')


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        import io

        # OPTIMIZED: Read file directly in memory without disk I/O
        print(f"Reading {file.filename} ({file.size/1024/1024:.1f} MB) to memory...")
        content = await file.read()

        # Check if it's an ioGAS .gas file
        if file.filename.endswith('.gas'):
            return await upload_iogas_file_internal(content, file.filename)

        if file.filename.endswith('.csv'):
            # Try multiple encodings for CSV files
            decoded = decode_with_fallback(content)
            df = pd.read_csv(io.StringIO(decoded), low_memory=False)
        else:
            df = pd.read_excel(io.BytesIO(content))

        # Load into data manager
        data_manager.df = df
        data_manager._detect_column_types()
        data_manager._auto_detect_roles()
        data_manager._guess_aliases()

        # Return ALL data for flat file upload - this fixes the 100-row limit issue
        all_data = df.replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records')
        print(f"[UPLOAD FLAT] Returning {len(all_data)} rows (full dataset)")

        result = {
            "success": True,
            "rows": len(df),
            "columns": len(df.columns),
            "data": all_data,  # Full dataset
            "preview": all_data[:5] if len(all_data) > 5 else all_data,  # Keep preview for backwards compat
            "column_info": data_manager.get_column_info()  # Include full column info
        }

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])

        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


async def upload_iogas_file_internal(content: bytes, filename: str):
    """Internal handler for ioGAS .gas file uploads."""
    from app.core.iogas_parser import parse_iogas_file

    print(f"[ioGAS] Processing {filename} ({len(content)/1024/1024:.1f} MB)...")

    # Parse the ioGAS file
    result = parse_iogas_file(content)

    if not result.get('success'):
        raise HTTPException(status_code=400, detail=result.get('error', 'Failed to parse ioGAS file'))

    # Load into data manager for subsequent operations
    import io
    # Recreate dataframe from the parsed data
    df = pd.DataFrame(result['data'])
    data_manager.df = df
    data_manager._detect_column_types()
    data_manager._auto_detect_roles()
    data_manager._guess_aliases()

    print(f"[ioGAS] Successfully loaded {result['rows']} rows, {result['columns']} columns")
    print(f"[ioGAS] ioGAS version: {result.get('iogas_metadata', {}).get('version', 'unknown')}")

    return result


@router.post("/upload/iogas")
async def upload_iogas_file(file: UploadFile = File(...)):
    """
    Upload an ioGAS .gas project file.

    The .gas format is a ZIP archive containing:
    - data.csv: The actual data
    - metadata.xml: Column definitions, attributes, special column mappings
    - version.txt: ioGAS version
    - changelog.txt: Audit trail
    """
    try:
        if not file.filename.endswith('.gas'):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Expected .gas file."
            )

        content = await file.read()
        return await upload_iogas_file_internal(content, file.filename)

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload/drillhole")
async def upload_drillhole(
    collar: UploadFile = File(...),
    survey: UploadFile = File(...),
    assay: UploadFile = File(...)
):
    try:
        # Try to use optimized version, fall back to original if not available
        try:
            from app.core.drillhole_manager_optimized import DrillholeManagerOptimized
            print("[OK] Using ULTRA-OPTIMIZED DrillholeManager (75-90x faster)")
            use_optimized = True
        except ImportError:
            from app.core.drillhole_manager import DrillholeManager
            print("[INFO] Using original DrillholeManager (optimized version not found)")
            use_optimized = False

        import io
        import time

        # Add comprehensive logging
        from datetime import datetime
        print("\n" + "="*60)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] DRILLHOLE UPLOAD STARTED")
        print(f"Files received - Collar: {collar.size/1024/1024:.1f}MB, "
              f"Survey: {survey.size/1024/1024:.1f}MB, "
              f"Assay: {assay.size/1024/1024:.1f}MB")
        print("="*60)

        upload_start = time.time()

        # OPTIMIZED: Read files directly in memory without disk I/O
        async def read_file_optimized(file):
            file_start = time.time()
            print(f"[CHECKPOINT 1] Reading {file.filename} ({file.size/1024/1024:.1f} MB) to memory...")

            try:
                content = await file.read()
                print(f"[CHECKPOINT 2] File read into memory in {time.time()-file_start:.2f}s")

                if file.filename.endswith('.csv'):
                    # Use StringIO for CSV files - much faster than disk I/O
                    print(f"[CHECKPOINT 3] Parsing CSV...")
                    df = pd.read_csv(io.StringIO(content.decode('utf-8')),
                                    low_memory=False)  # Faster for known types
                else:
                    # Use BytesIO for Excel files
                    print(f"[CHECKPOINT 3] Parsing Excel...")
                    df = pd.read_excel(io.BytesIO(content))

                print(f"[CHECKPOINT 4] Loaded {len(df)} rows, {len(df.columns)} columns in {time.time()-file_start:.2f}s")
                return df
            except Exception as e:
                print(f"[ERROR] Failed to read {file.filename}: {e}")
                import traceback
                traceback.print_exc()
                raise

        # Read all files
        print("\n[PHASE 1] READING FILES")
        collar_df = await read_file_optimized(collar)
        survey_df = await read_file_optimized(survey)
        assay_df = await read_file_optimized(assay)

        upload_time = time.time() - upload_start
        print(f"[PHASE 1 COMPLETE] Files loaded in {upload_time:.2f} seconds\n")

        # Check memory usage
        import psutil
        process = psutil.Process()
        mem_mb = process.memory_info().rss / 1024 / 1024
        print(f"[MEMORY] Current usage: {mem_mb:.1f} MB")

        # Process with desurvey
        print("\n[PHASE 2] DESURVEY PROCESSING")
        print(f"Data sizes - Collars: {len(collar_df)}, Surveys: {len(survey_df)}, Assays: {len(assay_df)}")
        desurvey_start = time.time()

        try:
            if use_optimized:
                dh_manager = DrillholeManagerOptimized()
                # Use parallel processing for large datasets
                use_parallel = len(collar_df) > 100
                print(f"[INFO] Using optimized desurvey with parallel={use_parallel}")
                result_df = dh_manager.desurvey(collar_df, survey_df, assay_df, use_parallel=use_parallel)
            else:
                dh_manager = DrillholeManager()
                print(f"[INFO] Using standard desurvey")
                result_df = dh_manager.desurvey(collar_df, survey_df, assay_df)
        except Exception as e:
            print(f"[ERROR] Desurvey failed: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Desurvey processing failed: {str(e)}")

        if result_df.empty:
             print("[WARNING] Desurvey returned empty dataframe")
             raise HTTPException(status_code=400, detail="Desurvey failed: No matching holes found")

        desurvey_time = time.time() - desurvey_start
        print(f"[PHASE 2 COMPLETE] Desurvey completed in {desurvey_time:.2f}s, {len(result_df)} records")

        # Check memory again
        mem_mb = process.memory_info().rss / 1024 / 1024
        print(f"[MEMORY] After desurvey: {mem_mb:.1f} MB")

        # OPTIMIZED: Load into DataManager more efficiently
        print("\n[PHASE 3] CONFIGURING DATA")
        config_start = time.time()

        print("[CHECKPOINT 5] Loading into DataManager...")
        data_manager.df = result_df

        print("[CHECKPOINT 6] Detecting properties (types, roles, aliases)...")
        # Use _detect_all_properties which includes _convert_mostly_numeric_columns
        # This handles columns like Au_ppm_Plot that have mixed text/numeric values
        if hasattr(data_manager, '_detect_all_properties'):
            data_manager._detect_all_properties()
        else:
            # Fallback for non-optimized manager
            data_manager._detect_column_types()
            data_manager._auto_detect_roles()
            data_manager._guess_aliases()

        config_time = time.time() - config_start
        total_time = time.time() - upload_start

        print(f"\n{'='*60}")
        print("PERFORMANCE SUMMARY")
        print(f"{'='*60}")
        print(f"File Upload:    {upload_time:.2f}s")
        print(f"Desurvey:       {desurvey_time:.2f}s")
        print(f"Configuration:  {config_time:.2f}s")
        print(f"TOTAL TIME:     {total_time:.2f}s")
        print(f"Records:        {len(result_df)}")
        print(f"Speed:          {len(result_df)/total_time:.0f} records/second")
        print(f"{'='*60}\n")

        # Return ALL data, not just preview - this fixes the 100-row limit issue
        all_data = data_manager.df.replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records')
        print(f"[UPLOAD DRILLHOLE] Returning {len(all_data)} rows (full dataset)")

        return {
            "success": True,
            "rows": len(data_manager.df),
            "columns": len(data_manager.df.columns),
            "data": all_data,  # Full dataset
            "preview": all_data[:5] if len(all_data) > 5 else all_data,  # Keep preview for backwards compat
            "column_info": data_manager.get_column_info(),  # Include full column info for frontend
            "performance": {
                "upload_time": round(upload_time, 2),
                "desurvey_time": round(desurvey_time, 2),
                "total_time": round(total_time, 2)
            }
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/columns")
async def get_columns() -> List[Dict[str, Any]]:
    print(f"[DEBUG /columns] Data manager id: {id(data_manager)}, df is None: {data_manager.df is None}")
    if data_manager.df is not None:
        print(f"[DEBUG /columns] df shape: {data_manager.df.shape}")
    result = data_manager.get_column_info()
    print(f"[DEBUG /columns] Returning {len(result)} columns")
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
    print(f"[DEBUG /data] Data manager id: {id(data_manager)}, df is None: {data_manager.df is None}")
    df = data_manager.get_data()
    if df is None:
        print("[DEBUG /data] Returning empty list (df is None)")
        return []
    print(f"[DEBUG /data] Returning {min(limit, len(df))} rows from df with shape {df.shape}")
    return df.head(limit).replace({pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}).to_dict(orient='records')
