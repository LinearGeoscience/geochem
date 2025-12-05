"""
Analysis endpoints for statistical calculations
"""
from fastapi import APIRouter, Query, HTTPException
from typing import List, Optional
import pandas as pd
import numpy as np
from .data_manager import DataManager

router = APIRouter(prefix="/api/stats", tags=["statistics"])
data_manager = DataManager()


@router.get("/summary")
async def get_summary_stats(columns: Optional[List[str]] = Query(None)):
    """
    Get summary statistics for specified columns
    
    Args:
        columns: List of column names to analyze. If None, analyze all numeric columns.
    
    Returns:
        Dict with column names as keys and stats dict as values
    """
    if not data_manager.data_loaded():
        raise HTTPException(status_code=400, detail="No data loaded")
    
    df = data_manager.df
    
    # If no columns specified, use all numeric columns
    if columns is None:
        columns = df.select_dtypes(include=[np.number]).columns.tolist()
    
    # Filter to only numeric columns that exist
    valid_columns = [col for col in columns if col in df.columns and pd.api.types.is_numeric_dtype(df[col])]
    
    if not valid_columns:
        raise HTTPException(status_code=400, detail="No valid numeric columns found")
    
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


@router.post("/correlation")
async def get_correlation_matrix(
    columns: List[str],
    method: str = "pearson"
):
    """
    Calculate correlation matrix for specified columns
    
    Args:
        columns: List of column names to correlate
        method: Correlation method - 'pearson' or 'spearman'
    
    Returns:
        {
            "columns": List[str],  # Column names in order
            "matrix": List[List[float]]  # 2D correlation matrix
        }
    """
    if not data_manager.data_loaded():
        raise HTTPException(status_code=400, detail="No data loaded")
    
    if method not in ["pearson", "spearman"]:
        raise HTTPException(status_code=400, detail="Method must be 'pearson' or 'spearman'")
    
    df = data_manager.df
    
    # Filter to only numeric columns that exist
    valid_columns = [col for col in columns if col in df.columns and pd.api.types.is_numeric_dtype(df[col])]
    
    if len(valid_columns) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 valid numeric columns")
    
    # Calculate correlation matrix
    corr_df = df[valid_columns].corr(method=method)
    
    # Convert to list format, handling NaN
    matrix = corr_df.fillna(0).values.tolist()
    
    return {
        "columns": valid_columns,
        "matrix": matrix
    }
