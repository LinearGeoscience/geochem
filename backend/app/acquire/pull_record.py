"""The pull record: what an Acquire import read, written to the processing log.

Who and when, which connection profile, server and database, the filters,
the query version, a checksum of the field map used, the row count per table
and a SHA-256 checksum of the three frames, so a later reader can tell
whether two imports read the same data the same way.
"""
from __future__ import annotations

import datetime as dt
import getpass
import hashlib
import json
import os

import pandas as pd

from app.acquire import queries


def frame_sha256(df: pd.DataFrame) -> str:
    """SHA-256 of a frame's columns and values (CSV text, full float precision)."""
    text = df.to_csv(index=False, lineterminator="\n", float_format="%.17g", na_rep="")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def frames_sha256(frames: dict[str, pd.DataFrame]) -> str:
    """One checksum over collar, survey and assay, in that order."""
    h = hashlib.sha256()
    for name in queries.TABLES:
        h.update(f"## {name}\n".encode("utf-8"))
        h.update(frame_sha256(frames[name]).encode("ascii"))
    return h.hexdigest()


def windows_user() -> str:
    """The signed-in user (sign-in gateway in server mode), else the Windows account."""
    from app.acquire import host
    user = host.signed_in_user()
    if user:
        return user
    domain = os.environ.get("USERDOMAIN", "")
    name = getpass.getuser()
    return f"{domain}\\{name}" if domain else name


def build(frames: dict[str, pd.DataFrame], filters, profile: dict, field_map: dict) -> dict:
    """The pull record for one Acquire preview / import (profile: the connection profile used)."""
    hole_col = field_map["collar"]["columns"]["hole_id"]
    collar = frames["collar"]
    return {
        "source": "Acquire",
        "pulled_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "user": windows_user(),
        "profile": profile.get("name", ""),
        "server": profile.get("server", ""),
        "database": profile.get("database", ""),
        "filters": filters.as_record(),
        "query_version": queries.QUERY_VERSION,
        "mapping_version": profile.get("version"),
        "field_map_sha256": hashlib.sha256(
            json.dumps(field_map, sort_keys=True, default=str).encode("utf-8")).hexdigest(),
        "holes": int(collar[hole_col].nunique()) if hole_col in collar.columns else 0,
        "rows": {name: int(len(frames[name])) for name in queries.TABLES},
        "sha256": frames_sha256(frames),
        "sha256_per_table": {name: frame_sha256(frames[name]) for name in queries.TABLES},
    }
