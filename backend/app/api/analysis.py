"""
Analysis endpoints for statistical calculations
"""
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np
import logging
from app.core.data_manager import DataManager

logger = logging.getLogger(__name__)

router = APIRouter()
data_manager = DataManager()


class CorrelationRequest(BaseModel):
    columns: List[str]
    method: str = "pearson"


@router.get("/stats/summary")
async def get_summary_stats(columns: Optional[List[str]] = Query(None)):
    """
    Get summary statistics for specified columns

    Args:
        columns: List of column names to analyze. If None, analyze all numeric columns.

    Returns:
        Dict with column names as keys and stats dict as values
    """
    df = data_manager.get_data()
    if df is None:
        # Return empty result instead of error when no data loaded
        return {}

    # If no columns specified, use all numeric columns
    if columns is None:
        columns = df.select_dtypes(include=[np.number]).columns.tolist()

    # Filter to only numeric columns that exist
    valid_columns = [col for col in columns if col in df.columns and pd.api.types.is_numeric_dtype(df[col])]

    if not valid_columns:
        # Return empty result instead of error - the column might not be numeric
        return {}
    
    results = {}
    
    for col in valid_columns:
        series = df[col].dropna()  # Remove NaN for statistics
        
        if len(series) == 0:
            results[col] = {
                "count": 0,
                "min": None,
                "max": None,
                "mean": None,
                "median": None,
                "std": None,
                "p10": None,
                "p25": None,
                "p75": None,
                "p90": None
            }
        else:
            results[col] = {
                "count": int(len(series)),
                "min": float(series.min()),
                "max": float(series.max()),
                "mean": float(series.mean()),
                "median": float(series.median()),
                "std": float(series.std()),
                "p10": float(series.quantile(0.10)),
                "p25": float(series.quantile(0.25)),
                "p75": float(series.quantile(0.75)),
                "p90": float(series.quantile(0.90))
            }
    
    return results


@router.post("/stats/correlation")
async def get_correlation_matrix(request: CorrelationRequest):
    """
    Calculate correlation matrix for specified columns

    Args:
        request: CorrelationRequest with columns and method

    Returns:
        {
            "columns": List[str],  # Column names in order
            "matrix": List[List[float]]  # 2D correlation matrix
        }
    """
    df = data_manager.get_data()
    if df is None:
        # Return empty result when no data
        return {"columns": [], "matrix": []}

    if request.method not in ["pearson", "spearman"]:
        raise HTTPException(status_code=400, detail="Method must be 'pearson' or 'spearman'")

    # Filter to only numeric columns that exist
    valid_columns = [col for col in request.columns if col in df.columns and pd.api.types.is_numeric_dtype(df[col])]

    if len(valid_columns) < 2:
        # Return empty result when not enough columns
        return {"columns": valid_columns, "matrix": []}
    
    # Calculate correlation matrix
    corr_df = df[valid_columns].corr(method=request.method)
    
    # Convert to list format, handling NaN
    matrix = corr_df.fillna(0).values.tolist()
    
    return {
        "columns": valid_columns,
        "matrix": matrix
    }
