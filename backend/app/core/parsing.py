"""
Shared file parsing and serialization utilities.

Single home for encoding fallback, JSON-safe NA replacement, and the robust
CSV/Excel parser previously duplicated across api/data.py, api/drillhole.py
and api/logging_interval.py.
"""

import io
import logging
import re
import warnings

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Values pandas can hold that JSON cannot
_NA_REPLACEMENTS = {pd.NA: None, np.nan: None, float('inf'): None, float('-inf'): None}


def decode_with_fallback(content: bytes) -> str:
    """
    Try multiple encodings to decode file content.
    Returns decoded string; falls back to latin-1 with replacement (never fails).
    """
    # Try common encodings in order of likelihood.
    # utf-8-sig MUST come before utf-8: a BOM is valid UTF-8, so trying plain
    # utf-8 first left the BOM as a U+FEFF prefix on the first column header,
    # silently breaking exact-name column matching (Excel-saved CSVs have BOMs).
    encodings = [
        'utf-8-sig',       # UTF-8 with BOM (strips the BOM)
        'utf-8',           # Most common modern encoding
        'latin-1',         # ISO-8859-1
        'cp1252',          # Windows Western European
        'iso-8859-15',     # Latin-9
        'cp850',           # DOS Western European
    ]

    for encoding in encodings:
        try:
            decoded = content.decode(encoding)
            logger.debug("Successfully decoded using: %s", encoding)
            return decoded
        except (UnicodeDecodeError, AttributeError):
            continue

    # If all fail, use Latin-1 (never fails but may produce garbage)
    logger.warning("All encodings failed, using Latin-1 with error replacement")
    return content.decode('latin-1', errors='replace')


def replace_na(df: pd.DataFrame) -> pd.DataFrame:
    """Replace NaN/inf/NA with None so the frame serializes to valid JSON."""
    return df.replace(_NA_REPLACEMENTS)


def clean_for_json(df: pd.DataFrame) -> list:
    """Replace NaN/inf/NA with None and return list-of-dicts records."""
    return replace_na(df).to_dict(orient='records')


# A value like "3,508" in a SEMICOLON-delimited file is a European decimal
# (never a thousands separator or field delimiter in that locale).
_EURO_DECIMAL_RE = re.compile(r'^-?\d+(?:,\d+)?$')


def _convert_euro_decimal_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Convert comma-decimal text columns to numeric (European locale).

    Only called for semicolon-delimited files. A column converts only when
    EVERY non-null value matches the numeric-with-comma pattern and at least
    one value actually contains a comma — mixed text columns are untouched.
    """
    for col in df.columns:
        if df[col].dtype != object:
            continue
        values = df[col].dropna().astype(str)
        if values.empty or not values.str.contains(',', regex=False).any():
            continue
        if values.map(lambda v: bool(_EURO_DECIMAL_RE.match(v))).all():
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(',', '.', regex=False),
                errors='coerce')
            logger.debug("Converted euro-decimal column '%s' to numeric", col)
    return df


# A strategy that has to drop more than this fraction of lines is almost
# certainly using the wrong delimiter/quoting — reject it and try the next.
MAX_SKIPPED_FRACTION = 0.10


def _read_csv(buf, **kwargs) -> pd.DataFrame:
    """pd.read_csv that counts malformed lines instead of dropping them silently.

    The count is stored in ``df.attrs['skipped_lines']`` so the upload endpoint
    can tell the user how many rows were discarded.
    """
    kwargs['on_bad_lines'] = 'warn'
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always', pd.errors.ParserWarning)
        df = pd.read_csv(buf, **kwargs)
    skipped = sum(str(w.message).count('Skipping line') for w in caught)
    df.attrs['skipped_lines'] = skipped
    if skipped:
        logger.warning("Skipped %d malformed line(s) while parsing", skipped)
    return df


def _too_many_skipped(df: pd.DataFrame) -> bool:
    skipped = df.attrs.get('skipped_lines', 0)
    return skipped > 0 and skipped > MAX_SKIPPED_FRACTION * (len(df) + skipped)


def parse_csv_with_detection(content: bytes, nrows: int = None) -> pd.DataFrame:
    """
    Parse CSV with automatic delimiter detection and error recovery.
    Handles various formats: CSV, TSV, semicolon, pipe, Excel exports, etc.
    Semicolon-delimited (European) files also get comma-decimal conversion.
    """
    # Strip a UTF-8 BOM up front — the binary fast path below reads bytes
    # directly, and pandas would otherwise keep the BOM in the first header
    if content.startswith(b'\xef\xbb\xbf'):
        content = content[3:]

    # First try to read directly as bytes (handles newline issues better)
    try:
        df = _read_csv(io.BytesIO(content), nrows=nrows)
        if len(df.columns) >= 2 and len(df) > 0 and not _too_many_skipped(df):
            logger.info("Success with direct binary read, columns=%d", len(df.columns))
            return df
    except Exception:
        pass

    # Now try with decoded text
    decoded = decode_with_fallback(content)

    # Replace various newline formats to normalize
    decoded = decoded.replace('\r\n', '\n').replace('\r', '\n')

    # European-locale signature: header row dominated by semicolons
    first_line = next((l for l in decoded.split('\n') if l.strip()), '')
    semicolon_delimited = first_line.count(';') > first_line.count(',')

    # Try different parsing strategies
    parsing_strategies = [
        # Strategy 1: Let pandas auto-detect (best for most files)
        {'sep': None, 'engine': 'python'},
        # Strategy 2: Common delimiters with explicit settings
        {'sep': ',', 'quotechar': '"'},
        {'sep': '\t', 'quotechar': '"'},
        {'sep': ';', 'quotechar': '"'},
        {'sep': '|', 'quotechar': '"'},
        # Strategy 3: Handle Excel exports (often use tabs)
        {'sep': '\t', 'quoting': 0},  # 0 = QUOTE_MINIMAL
        # Strategy 4: Skip potential metadata rows
        {'sep': None, 'engine': 'python', 'skiprows': 1},
        {'sep': None, 'engine': 'python', 'skiprows': 2},
        {'sep': ',', 'skiprows': 1},
        {'sep': '\t', 'skiprows': 1},
        # Strategy 5: Space-delimited with multiple spaces
        {'sep': r'\s+', 'engine': 'python'},
        # Strategy 6: Fixed-width format
        {'sep': r'\s{2,}', 'engine': 'python'},
    ]

    for strategy in parsing_strategies:
        try:
            kwargs = strategy.copy()
            if nrows:
                kwargs['nrows'] = nrows

            df = _read_csv(io.StringIO(decoded), **kwargs)

            # Validate: must have at least 2 columns, some rows, few dropped lines
            if len(df.columns) >= 2 and len(df) > 0 and not _too_many_skipped(df):
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
                    except Exception:
                        continue

                if valid_cols < len(df.columns) // 2:
                    logger.debug("Data appears corrupted - %d/%d valid columns", valid_cols, len(df.columns))
                    continue
                delimiter_name = strategy.get('sep', 'auto-detected')
                if delimiter_name == '\t':
                    delimiter_name = 'tab'
                elif delimiter_name == r'\s+':
                    delimiter_name = 'spaces'
                elif delimiter_name == r'\s{2,}':
                    delimiter_name = 'fixed-width'
                skiprows = strategy.get('skiprows', 0)
                logger.info("Success with delimiter='%s', skiprows=%d, columns=%d", delimiter_name, skiprows, len(df.columns))
                if semicolon_delimited:
                    df = _convert_euro_decimal_columns(df)
                return df
        except Exception:
            continue

    # Last resort: try reading line by line and inferring format
    try:
        logger.debug("All strategies failed, trying line-by-line analysis")
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

        df = _read_csv(io.StringIO(clean_csv), sep=delimiter)

        if len(df.columns) >= 1 and len(df) > 0:
            logger.info("Line-by-line analysis succeeded with delimiter='%s', columns=%d", delimiter, len(df.columns))
            if delimiter == ';':
                df = _convert_euro_decimal_columns(df)
            return df

        raise ValueError("Parsed dataframe has no valid data")

    except Exception as e:
        logger.error("All parsing failed: %s", e)
        if b'\x00' in content[:1000] or content[:2] in (b'\xff\xfe', b'\xfe\xff'):
            raise ValueError(
                "This looks like a binary file (e.g. Excel). Save it as .xlsx/.xls with the "
                "right extension, or export to CSV."
            ) from e
        raise ValueError(f"Could not parse file: {e}. Check the delimiter and encoding.") from e


def parse_file_content(content: bytes, filename: str, nrows: int = None, sheet: str = None) -> pd.DataFrame:
    """
    Parse file content based on file extension.
    Supports CSV and Excel formats. Excel reads `sheet` (default: the first);
    the workbook's sheet names and the one read are in df.attrs['sheets'] /
    df.attrs['sheet'].
    """
    ext = filename.lower().split('.')[-1] if '.' in filename else 'csv'

    if ext in ['xlsx', 'xls']:
        # Excel file
        logger.debug("Parsing Excel file: %s", filename)
        try:
            with pd.ExcelFile(io.BytesIO(content)) as book:
                sheets = [str(n) for n in book.sheet_names]
                used = sheet if sheet in sheets else sheets[0]
                df = book.parse(used, nrows=nrows)
            df.attrs['sheets'] = sheets
            df.attrs['sheet'] = used
            logger.info("Excel parsed successfully: sheet '%s' of %d, %d columns, %d rows",
                        used, len(sheets), len(df.columns), len(df))
            return df
        except Exception as e:
            logger.error("Excel parsing failed: %s", e)
            raise ValueError(f"Failed to parse Excel file: {e}")
    else:
        # CSV or text file - use the robust parser
        return parse_csv_with_detection(content, nrows=nrows)
