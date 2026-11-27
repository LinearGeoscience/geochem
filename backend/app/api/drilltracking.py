"""Drill tracking reads the holes being drilled from Acquire.

POST /api/drilltracking/acquire pulls the collars and surveys (no assays) of
the holes matching the filters, through the Acquire import's own code: the
connection profile (the admin's in server mode), its verified field map, the
fixed read-only SELECTs in app/acquire/queries.py, its survey priority rule,
CSV-like typing and the pull record. Every column of the collar and survey
tables comes back, so the drill tracking page can find the planned hole ID,
status, dates and survey method among them (its own column guessing).

Nothing is loaded into the session's dataset: drill tracking keeps its own
snapshot (frontend store/drillTrackingStore.ts).
"""
from __future__ import annotations

import logging

import pandas as pd
from fastapi import APIRouter, Body

from app.acquire import connection, frames, profiles, pull_record, queries
# The Acquire import's profile choice (admin profile in server mode) and its error-to-status mapping
from app.api.acquire import _profile_for_use, _run

logger = logging.getLogger(__name__)
router = APIRouter()


def _table(df: pd.DataFrame) -> dict:
    """A frame as a header and rows of text ('' for none), as a CSV file would read."""
    cols = [str(c) for c in df.columns]
    rows = [["" if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT else str(v) for v in row]
            for row in df.astype(object).where(df.notna(), None).itertuples(index=False, name=None)]
    return {"columns": cols, "rows": rows}


def pull_live(body: dict) -> dict:
    """Collars and surveys of the holes matching the filters (body as /api/acquire/preview's)."""
    p = profiles.require_complete(_profile_for_use(body.get("profile")))
    f = frames.filters_from_request(body, p["field_map"])
    conn, _ = connection.open_checked(p)
    try:
        vm = connection.verified(conn, p["field_map"])
        fm = vm.fm
        collar = connection.fetch_frame(conn, queries.collar(vm, f))
        hole_col = fm["collar"]["columns"]["hole_id"]
        holes = [str(h) for h in collar[hole_col].dropna().unique()] if hole_col in collar.columns else []
        if not holes:
            raise frames.NoHoles("No Acquire holes match these filters")
        survey = frames._keep_survey_priority(connection.fetch_frame(conn, queries.survey(vm, holes)), fm["survey"])
    finally:
        conn.close()
    fmt = fm.get("date_format") or "%Y-%m-%d"
    collar, survey = frames.normalise_like_csv(collar, fmt), frames.normalise_like_csv(survey, fmt)
    # Drill tracking takes dips negative downwards
    dip_col = fm["survey"]["columns"]["dip"]
    if fm.get("dip") == "positive_down" and dip_col in survey.columns:
        survey[dip_col] = -pd.to_numeric(survey[dip_col], errors="coerce")
    record = pull_record.build({"collar": collar, "survey": survey, "assay": pd.DataFrame()}, f, p, fm)
    record["purpose"] = "drill tracking (collars and surveys)"
    logger.info("Acquire pull for drill tracking (%s): %d holes, rows %s", p["name"], len(holes), record["rows"])
    return {
        "profile": p["name"],
        "collar": _table(collar), "survey": _table(survey),
        # The profile's own columns for the roles it maps (the rest are guessed on the page)
        "columns": {"collar": {k: fm["collar"]["columns"][k] for k in ("hole_id", "easting", "northing", "rl")},
                    "survey": {k: fm["survey"]["columns"][k] for k in ("hole_id", "depth", "dip", "azimuth")}},
        "mapped_filters": {k: bool((fm.get("filters") or {}).get(k)) for k in profiles.FILTER_KEYS},
        "pull_record": record,
    }


@router.post("/acquire")
async def acquire_live(body: dict = Body(...)):
    """Body: {profile (laptop), drilled_from / drilled_to / modified_from / modified_to: "YYYY-MM-DD",
    projects, prospects, hole_types, programs, hole_ids: [..]}; at least one filter."""
    return await _run(pull_live, body or {})
