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


_RL_EXACT = {'rl', 'elevation', 'elev', 'z'}
_RL_LAST = re.compile(r"(^| )(rl|elevation|elev)$")


def collar_rl_candidates(columns: List[str], hole_col=None) -> List[str]:
    """Columns that may hold the collar RL, the likeliest first.

    'RL' / 'Elevation' / 'Z' themselves come before names that end in them
    ('NAT_RL', 'Collar RL'), and those before names that only hold the word
    ('RL_Method', 'Elev_Source': usually a note about the RL, not the RL).
    """
    ranked = []
    for c in columns:
        if c == hole_col:
            continue
        tokens, lower = role_tokens(c), str(c).lower()
        if tokens in _RL_EXACT:
            rank = 0
        elif _RL_LAST.search(tokens):
            rank = 1
        elif DATASET_ROLE_PATTERNS['Elevation'].search(tokens):
            rank = 2
        elif lower.startswith('rl') or 'elev' in lower or (lower.endswith('rl') and len(lower) > 2 and lower[:-2].isalpha()):
            rank = 3
        else:
            continue
        ranked.append((rank, c))
    return [c for _, c in sorted(ranked, key=lambda rc: rc[0])]


def identify_collar_columns(columns: List[str], is_numeric=None):
    """Return (hole_col, east_col, north_col, rl_col) for a collar file.

    `is_numeric(column)`, when given, says whether a column holds numbers: the
    RL is then the likeliest-named column that does, so a text column such as
    'RL_Method' ahead of the RL is passed over.
    """
    cols_lower = {c: str(c).lower() for c in columns}

    hole_col = find_hole_column(columns)
    east_col = next((c for c, cl in cols_lower.items() if cl == 'easting' or 'east' in cl),
                    next((c for c, cl in cols_lower.items() if cl == 'x'), None))
    north_col = next((c for c, cl in cols_lower.items() if cl == 'northing' or 'north' in cl),
                     next((c for c, cl in cols_lower.items() if cl == 'y'), None))
    # RL by whole tokens: 'NAT_RL', 'MGA_RL', 'Collar RL', 'RL', 'Elevation',
    # 'Z'. The old rule (name starts with 'rl' or contains 'elev') missed
    # 'NAT_RL' and every collar was silently put at 0 m.
    candidates = collar_rl_candidates(columns, hole_col)
    rl_col = next((c for c in candidates if is_numeric is None or is_numeric(c)),
                  candidates[0] if candidates else None)
    return hole_col, east_col, north_col, rl_col


class ColumnDetectionError(ValueError):
    """A required desurvey column could not be identified by name."""


def _first_with_token(columns: List[str], tokens: set, exclude: set = frozenset()) -> Optional[str]:
    """First column whose tokenised name contains one of `tokens` and none of `exclude`."""
    for c in columns:
        toks = set(role_tokens(c).split())
        if toks & tokens and not toks & exclude:
            return c
    return None


def _require(found: Optional[str], what: str, file_type: str, columns: List[str]) -> str:
    if found is None:
        raise ColumnDetectionError(
            f"Could not find the {what} column in the {file_type} file "
            f"(columns: {', '.join(map(str, columns[:20]))}). Use the column mapper to choose it.")
    return found


# Whole-token matching ('Dip_deg' -> {'dip','deg'}, 'mFrom' -> {'m','from'}).
# The old substring/positional rules used azimuth as dip for 'Dip_deg',
# missed 'mFrom', and took 'S_Total' as To. A column that is not found by
# name is an error, never a guess by position.
_DEPTH_TOKENS = {'depth', 'md', 'mdepth', 'depthm', 'distance', 'dist', 'at'}
_DIP_TOKENS = {'dip', 'incl', 'inclination', 'inc'}
_AZI_TOKENS = {'azi', 'azim', 'azimuth', 'az', 'bearing', 'azimuthtrue', 'azimuthmag'}
_FROM_TOKENS = {'from', 'mfrom', 'fromm', 'depthfrom'}
_TO_TOKENS = {'to', 'mto', 'tom', 'depthto'}


def identify_survey_columns(columns: List[str]):
    """Return (depth_col, dip_col, azi_col) for a survey file.

    Raises ColumnDetectionError when a column cannot be identified by name.
    """
    hole = find_hole_column(columns)
    rest = [c for c in columns if c != hole]
    dip_col = _require(_first_with_token(rest, _DIP_TOKENS), 'dip', 'survey', columns)
    azi_col = _require(_first_with_token([c for c in rest if c != dip_col], _AZI_TOKENS),
                       'azimuth', 'survey', columns)
    depth_col = _require(
        _first_with_token([c for c in rest if c not in (dip_col, azi_col)], _DEPTH_TOKENS),
        'depth', 'survey', columns)
    return depth_col, dip_col, azi_col


def identify_assay_columns(columns: List[str]):
    """Return (from_col, to_col) for an assay file.

    Raises ColumnDetectionError when a column cannot be identified by name.
    """
    from_col = _require(_first_with_token(columns, _FROM_TOKENS), 'From', 'assay', columns)
    to_col = _require(_first_with_token([c for c in columns if c != from_col], _TO_TOKENS, exclude=_FROM_TOKENS),
                      'To', 'assay', columns)
    return from_col, to_col
