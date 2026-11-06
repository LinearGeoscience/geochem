"""
Column-role pattern tables and matchers — the single home for ALL column-name
heuristics in the backend (Phase 8 consolidated four independent systems here):

1. COLUMN_PATTERNS / suggest_role — weighted mapper suggestions for the
   drillhole/logging import previews (standard field keys like "hole_id").
2. DATASET_ROLE_PATTERNS / detect_dataset_roles — the CANONICAL dataset role
   vocabulary the frontend matches on ("ID", "East", "North", "Elevation",
   "HoleID", "From", "To", ...). Used by DataManager and InteropParser.
3. identify_collar/survey/assay_columns — desurvey input auto-detection
   (moved verbatim from DrillholeManager).

Pattern weights in COLUMN_PATTERNS are confidence scores 0-100; substring
match, highest weight wins.

NOTE: the per-file-type tables are intentionally NOT merged into one list —
each file type carries its own disambiguation weights (e.g. "depth" is the
survey depth at weight 100 but a weak collar-RL candidate at 20).
"""

import re
from typing import Dict, List, Optional, Tuple

# Shared hole-id patterns (identical across collar/survey, assay/logging differ
# only in their low-confidence tails, kept verbatim below).
_HOLE_ID_FULL = [
    ("holeid", 100), ("hole_id", 100), ("bhid", 95),
    ("dhid", 90), ("ddh", 85), ("drill_id", 85),
    ("drillhole_id", 85), ("borehole_id", 85),
    ("hole", 70), ("drillhole", 70), ("borehole", 70),
]

COLUMN_PATTERNS: Dict[str, Dict[str, List[Tuple[str, int]]]] = {
    "collar": {
        "hole_id": _HOLE_ID_FULL + [
            ("well", 60), ("dh", 60),
            ("id", 20), ("recordid", 10), ("sampleid", 10),
            ("name", 15), ("number", 15), ("holenumber", 40),
        ],
        "easting": [
            ("easting", 100), ("east", 95), ("x_coord", 95),
            ("xcoord", 95), ("utme", 90), ("utm_e", 90),
            ("mine_e", 85), ("collar_e", 90),
            ("x", 60), ("xcoordinate", 80),
            ("localx", 30), ("local_x", 30), ("gridx", 40),
        ],
        "northing": [
            ("northing", 100), ("north", 95), ("y_coord", 95),
            ("ycoord", 95), ("utmn", 90), ("utm_n", 90),
            ("mine_n", 85), ("collar_n", 90),
            ("y", 60), ("ycoordinate", 80),
            ("localy", 30), ("local_y", 30), ("gridy", 40),
        ],
        "rl": [
            ("rl", 100), ("collar_rl", 100), ("collarrl", 100),
            ("elevation", 95), ("elev", 90), ("collar_elev", 95),
            ("z_coord", 90), ("zcoord", 90), ("altitude", 85),
            ("z", 60), ("height", 70), ("level", 60),
            ("vertical", 40), ("depth", 20),  # depth is usually for surveys
        ],
    },
    "survey": {
        "hole_id": _HOLE_ID_FULL + [
            ("id", 20), ("recordid", 10), ("sampleid", 10),
        ],
        "depth": [
            ("depth", 100), ("survey_depth", 100), ("surveydepth", 100),
            ("measured_depth", 95), ("measureddepth", 95),
            ("depth_m", 95), ("depthm", 95), ("md", 90),
            ("distance", 70), ("dist", 60), ("length", 50),
            ("position", 40), ("location", 30),
        ],
        "dip": [
            ("dip", 100), ("inclination", 95), ("incl", 90),
            ("vertical_angle", 85), ("vert_angle", 85),
            ("angle", 50), ("pitch", 60), ("plunge", 70),
            ("vertical", 40), ("direction", 20),
        ],
        "azimuth": [
            ("azimuth", 100), ("azi", 95), ("true_azi", 95),
            ("trueazimuth", 95), ("true_azimuth", 95),
            ("bearing", 85), ("mag_azi", 80), ("magnetic_azi", 80),
            ("magneticazimuth", 80),
            ("direction", 50), ("heading", 60), ("trend", 60),
        ],
    },
    "assay": {
        "hole_id": [
            ("holeid", 100), ("hole_id", 100), ("bhid", 95),
            ("dhid", 90), ("ddh", 85), ("drill_id", 85),
            ("hole", 70), ("drillhole", 70),
            ("sampleno", 10), ("sample_id", 10), ("sampleid", 10),
            ("id", 20), ("number", 15),
        ],
        "from": [
            ("from", 100), ("from_m", 100), ("fromm", 100),
            ("depth_from", 95), ("depthfrom", 95),
            ("sample_from", 90), ("samplefrom", 90),
            ("start_depth", 90), ("startdepth", 90),
            ("start", 80), ("int_from", 85), ("interval_from", 85),
            ("from_depth", 90),
            ("begin", 60), ("top", 50),
        ],
        "to": [
            ("to", 100), ("to_m", 100), ("tom", 100),
            ("depth_to", 95), ("depthto", 95),
            ("sample_to", 90), ("sampleto", 90),
            ("end_depth", 90), ("enddepth", 90),
            ("end", 80), ("int_to", 85), ("interval_to", 85),
            ("to_depth", 90),
            ("finish", 60), ("bottom", 50),
        ],
    },
    "logging": {
        "hole_id": _HOLE_ID_FULL + [
            ("id", 20),
        ],
        "from": [
            ("from", 100), ("from_m", 100), ("fromm", 100),
            ("depth_from", 95), ("depthfrom", 95),
            ("start_depth", 90), ("startdepth", 90),
            ("start", 80), ("int_from", 85), ("interval_from", 85),
            ("from_depth", 90), ("begin", 60), ("top", 50),
        ],
        "to": [
            ("to", 100), ("to_m", 100), ("tom", 100),
            ("depth_to", 95), ("depthto", 95),
            ("end_depth", 90), ("enddepth", 90),
            ("end", 80), ("int_to", 85), ("interval_to", 85),
            ("to_depth", 90), ("finish", 60), ("bottom", 50),
        ],
    },
}


def get_column_patterns(file_type: str) -> Dict[str, List[Tuple[str, int]]]:
    """Column name patterns for a file type with confidence weights."""
    return COLUMN_PATTERNS.get(file_type, {})


def normalize_column_name(col: str) -> str:
    """Normalize a column name for pattern matching."""
    return col.lower().strip().replace("_", "").replace(" ", "")


def suggest_role(col: str, patterns: Dict[str, List[Tuple[str, int]]]) -> Tuple[Optional[str], int]:
    """
    Match a column name against a pattern table.
    Returns (suggested_role, confidence); (None, 0) when nothing matches.
    """
    col_lower = normalize_column_name(col)
    suggested_role = None
    confidence = 0
    for role, role_patterns in patterns.items():
        for pattern, weight in role_patterns:
            if pattern in col_lower and weight > confidence:
                suggested_role = role
                confidence = weight
    return suggested_role, confidence


# ============================================================================
# Canonical dataset roles (the vocabulary the FRONTEND matches on)
# ============================================================================

# Patterns match against a TOKENIZED name (see role_tokens): camelCase and
# separators become single spaces, lowercased — 'NAT_RL' -> 'nat rl',
# 'HoleNumber' -> 'hole number'. Matching whole tokens avoids the old
# substring false positives ('id' in 'Oxide'/'Width', 'rl' in 'Early',
# 'sample' in 'Sample_Type', 'lat' in 'Plateau').
# Order matters: first matching pattern wins per column, so HoleID is
# checked before the generic ID.
DATASET_ROLE_PATTERNS: Dict[str, "re.Pattern[str]"] = {
    "HoleID": re.compile(r"\b(hole ?(id|no|num|number|name)|holeid|dhid|bhid)\b|^(dh|bh)?hole$"),
    "ID": re.compile(r"^(?!.*\b(grid|datum|zone|batch|method|job)\b)"
                     r"(^(sample|samp|lab|site|record)? ?(id|no|num|number)$|\b(sampleid|labno|id)\b|^sample$)"),
    # "(mid|centroid|sample|pos) x" style names (e.g. mid_x) end in the axis letter
    "East": re.compile(r"\b(east|easting|eastings|utme|utm e|x coord|xcoord)\b|^x$|^(mid|centroid|sample|pos|dh|collar) x$"),
    "North": re.compile(r"\b(north|northing|northings|utmn|utm n|y coord|ycoord)\b|^y$|^(mid|centroid|sample|pos|dh|collar) y$"),
    "Elevation": re.compile(r"\b(rl|elev|elevation|z coord|zcoord|altitude)\b|^z$|^(mid|centroid|sample|pos|dh|collar) z$"),
    "Latitude": re.compile(r"\b(lat|latitude)\b"),
    "Longitude": re.compile(r"\b(lon|long|longitude)\b"),
    "From": re.compile(r"^(depth |sample |int |interval )?from( m| depth)?$|^mfrom$"),
    "To": re.compile(r"^(depth |sample |int |interval )?to( m| depth)?$|^mto$"),
}

_CAMEL_1 = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_CAMEL_2 = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")
_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")


def role_tokens(col: str) -> str:
    """'HoleNumber' -> 'hole number', 'NAT_RL' -> 'nat rl', 'BHID' -> 'bhid'."""
    s = _CAMEL_2.sub(" ", _CAMEL_1.sub(" ", str(col)))
    return _NON_ALNUM.sub(" ", s).strip().lower()


def detect_dataset_roles(columns: List[str]) -> Dict[str, str]:
    """Assign a canonical dataset role to each matching column name.

    Returns {column_name: role}; columns matching nothing are omitted.
    Multiple columns may share the same role.
    """
    column_to_role: Dict[str, str] = {}
    for col in columns:
        tokens = role_tokens(col)
        for role, pattern in DATASET_ROLE_PATTERNS.items():
            if pattern.search(tokens):
                column_to_role[col] = role
                break
    return column_to_role


# ============================================================================
# Desurvey input auto-detection (moved verbatim from DrillholeManager)
# ============================================================================

def find_hole_column(columns: List[str]) -> str:
    """Find the hole ID column (case-insensitive); falls back to the first column."""
    cols_lower = {c: str(c).lower() for c in columns}
    return next((c for c, cl in cols_lower.items() if cl == 'hole_id' or 'holeid' in cl.replace('_', '') or 'bhid' in cl),
                next((c for c, cl in cols_lower.items() if 'hole' in cl), columns[0]))


def identify_collar_columns(columns: List[str]):
    """Return (hole_col, east_col, north_col, rl_col) for a collar file."""
    cols_lower = {c: str(c).lower() for c in columns}

    hole_col = find_hole_column(columns)
    east_col = next((c for c, cl in cols_lower.items() if cl == 'easting' or 'east' in cl),
                    next((c for c, cl in cols_lower.items() if cl == 'x'), None))
    north_col = next((c for c, cl in cols_lower.items() if cl == 'northing' or 'north' in cl),
                     next((c for c, cl in cols_lower.items() if cl == 'y'), None))
    # Look for RL columns - check for 'rl' at start of column name (case insensitive)
    rl_col = next((c for c, cl in cols_lower.items() if cl.startswith('rl') or 'elev' in cl),
                  next((c for c, cl in cols_lower.items() if cl == 'z'), None))
    return hole_col, east_col, north_col, rl_col


def identify_survey_columns(columns: List[str]):
    """Return (depth_col, dip_col, azi_col) for a survey file (positional fallbacks)."""
    cols_lower = {c: str(c).lower() for c in columns}

    depth_col = next((c for c, cl in cols_lower.items() if cl == 'depth' or 'depth' in cl),
                     columns[1] if len(columns) > 1 else None)
    dip_col = next((c for c, cl in cols_lower.items() if cl == 'dip' or 'incl' in cl),
                   columns[2] if len(columns) > 2 else None)
    azi_col = next((c for c, cl in cols_lower.items() if cl == 'azimuth' or 'azi' in cl),
                   columns[3] if len(columns) > 3 else None)
    return depth_col, dip_col, azi_col


def identify_assay_columns(columns: List[str]):
    """Return (from_col, to_col) for an assay file (positional fallback for from)."""
    cols_lower = {c: str(c).lower() for c in columns}

    # Look for 'from' in column name (case insensitive)
    from_col = next((c for c, cl in cols_lower.items() if cl == 'from' or cl.startswith('from') or 'from_' in cl),
                    columns[1] if len(columns) > 1 else None)
    # Look for 'to' in column name but NOT 'from' (case insensitive)
    to_col = next((c for c, cl in cols_lower.items() if (cl == 'to' or cl.startswith('to_') or cl.startswith('to ')) and 'from' not in cl),
                  next((c for c, cl in cols_lower.items() if '_to' in cl or ' to' in cl), None))
    return from_col, to_col
