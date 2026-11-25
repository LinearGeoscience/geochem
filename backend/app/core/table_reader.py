"""Read one sheet of a workbook as a plain table, without loading it as the dataset.

Used to bring a second table (assays, another instrument's readings) onto the
loaded dataset: the join itself runs in the browser, where the dataset lives.

Cells are returned as JSON-safe values that keep what the cell says:
  - whole numbers stay whole (an ID typed as 1234 is 1234, not 1234.0, so it
    matches "1234" in the dataset)
  - text is returned as written ("<LOD: -1.2", "0012", "BLK-1")
  - blank cells are None; dates are ISO text
Column names are text and unique (a repeated header gets ".1", ".2").
"""
from __future__ import annotations

import datetime as _dt
import io
import math
from typing import Any, Dict, List, Optional

import pandas as pd

from app.core.parsing import unique_column_names


def _cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return int(v) if v.is_integer() and abs(v) < 2**53 else v
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, (pd.Timestamp, _dt.datetime, _dt.date)):
        if pd.isna(v):
            return None
        return v.isoformat(sep=' ') if isinstance(v, (pd.Timestamp, _dt.datetime)) else v.isoformat()
    if v is pd.NaT:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, 'item'):  # numpy scalar
        return _cell(v.item())
    return str(v)


def read_workbook_sheet(content: bytes, sheet: Optional[str] = None) -> Dict[str, Any]:
    """Read `sheet` (default: the first) of an .xlsx / .xls workbook.

    Returns {sheets, sheet, fields, rows}: every sheet name, the one read,
    the column names and the rows as lists in column order. Rows with no
    value at all are left out.
    """
    try:
        with pd.ExcelFile(io.BytesIO(content)) as book:
            sheets = [str(n) for n in book.sheet_names]
            if sheet is not None and sheet not in sheets:
                raise ValueError(f"The workbook has no sheet named '{sheet}'. Sheets: {', '.join(sheets)}")
            used = sheet if sheet is not None else sheets[0]
            df = book.parse(used, dtype=object)
    except ValueError:
        raise
    except Exception as e:  # not a workbook, corrupt file
        raise ValueError(f"Could not read the workbook: {e}") from e

    fields = unique_column_names(df.columns)
    rows: List[List[Any]] = []
    for rec in df.itertuples(index=False, name=None):
        row = [_cell(v) for v in rec]
        if any(v is not None and v != '' for v in row):
            rows.append(row)
    return {"sheets": sheets, "sheet": used, "fields": fields, "rows": rows}
