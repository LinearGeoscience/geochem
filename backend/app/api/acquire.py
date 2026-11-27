"""Data Import > Acquire (SQL): connection profiles, connection test, Detect fields,
filter lists and preview.

Laptops keep their own connection profiles (app/acquire/profiles.py) and can
edit them here. In server mode the admin's profile from the server's settings
is used, nothing typed on the screen is ever connected to, and the
editing routes (PUT / DELETE profiles, detect, objects, sample) answer 403.

/preview pulls collar, survey and assay for the chosen holes (read-only, fixed
SELECTs: app/acquire/queries.py), keeps them in the same preview cache as the
Drillhole tab's file upload, and answers exactly like /api/drillhole/preview,
plus the field map, the pull record and the hole count. The frontend then calls
the existing /api/drillhole/process with the preview_token and the field map,
so desurvey and loading are the Drillhole tab's own code.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import pandas as pd
from fastapi import APIRouter, Body, HTTPException, Query as Q

from app.acquire import connection, detect, frames, host, profiles, pull_record, queries
from app.api.drillhole import preview_payload
from app.core.parsing import clean_for_json

logger = logging.getLogger(__name__)

router = APIRouter()

READ_ONLY_MESSAGE = ("This server runs in server mode: the Acquire connection is set by the administrator "
                     "and can't be changed here.")


def _server_mode() -> bool:
    return host.server_mode()


def _refuse_in_server_mode():
    if _server_mode():
        raise HTTPException(status_code=403, detail=READ_ONLY_MESSAGE)


def _profile_for_use(name: str | None) -> dict:
    """The profile to connect with: the admin's in server mode, else the named saved one."""
    if _server_mode():
        return profiles.admin_profile()
    if not name:
        raise profiles.ProfileError("Choose a connection profile")
    return profiles.load_profile(name)


def _typed_profile(body: dict) -> dict:
    """A profile as sent from the Connection section (possibly unsaved or incomplete)."""
    p = (body or {}).get("profile")
    if not isinstance(p, dict):
        raise profiles.ProfileError("Send the connection as {'profile': {...}}")
    p = dict(p)
    p.setdefault("name", "Unsaved profile")
    if not p.get("name"):
        p["name"] = "Unsaved profile"
    return profiles.normalise(p)


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, connection.AcquireUnavailable):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, frames.NoHoles):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (profiles.ProfileError, ValueError)) and not isinstance(
            exc, (queries.MappingError, frames.ColumnClash, frames.DuplicateResults)):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, (queries.MappingError, frames.ColumnClash, frames.DuplicateResults)):
        return HTTPException(status_code=422, detail=str(exc))
    logger.exception("Acquire request failed", exc_info=exc)
    return HTTPException(status_code=502, detail=connection.friendly(exc))


async def _run(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except Exception as exc:  # noqa: BLE001 - mapped to a status code with a readable message
        raise _http(exc) from exc


# ------------------------------------------------------------------ profiles

def _profiles_index() -> dict:
    out = {"server_mode": _server_mode(), "editable": not _server_mode(), "profiles": [], "admin": None,
           "admin_error": None, "template": None}
    if _server_mode():
        try:
            out["admin"] = profiles.summary(profiles.admin_profile())
        except profiles.ProfileError as exc:
            out["admin_error"] = str(exc)
        return out
    out["profiles"] = profiles.list_profiles()
    out["template"] = profiles.template()
    return out


@router.get("/profiles")
async def list_profiles():
    """The saved profiles (laptop) or the admin profile (server mode), and whether editing is allowed."""
    return await _run(_profiles_index)


@router.get("/profiles/{name}")
async def get_profile(name: str):
    def load():
        if _server_mode():
            p = profiles.admin_profile()
            if p["name"].lower() != name.lower():
                raise profiles.ProfileError(f"There's no connection profile called {name!r}")
            return p
        return profiles.load_profile(name)
    return await _run(load)


@router.put("/profiles/{name}")
async def put_profile(name: str, body: dict = Body(...)):
    """Save a complete profile under `name`. Body: {profile, rename_from?, create?}."""
    _refuse_in_server_mode()

    def save():
        p = dict((body or {}).get("profile") or {})
        p["name"] = name
        if body.get("create"):
            return profiles.create_profile(p)
        return profiles.save_profile(p, old_name=body.get("rename_from") or None)
    return await _run(save)


@router.delete("/profiles/{name}")
async def delete_profile(name: str):
    _refuse_in_server_mode()
    await _run(profiles.delete_profile, name)
    return {"deleted": name}


# ------------------------------------------------------------------ connection

def _test(body: dict) -> dict:
    if _server_mode():
        p = profiles.admin_profile()
    else:
        try:
            p = _typed_profile(body)
        except profiles.ProfileError as exc:
            return {"ok": False, "message": str(exc), "map_problems": [], "incomplete": []}
    incomplete = profiles.field_map_problems(p["field_map"])
    out = connection.test(p, p["field_map"] if not incomplete else None)
    out["incomplete"] = incomplete
    return out


@router.post("/test")
async def test_connection(body: dict = Body(default={})):
    """Connect with the profile as typed (laptop) or the admin profile (server mode).
    Answers who you are, the SQL Server version, whether the login can write, and
    which field-map names the database doesn't have. Always 200; `ok` says how it went."""
    return await _run(_test, body)


def _catalog(p: dict) -> pd.DataFrame:
    conn, _ = connection.open_checked(p)
    try:
        return connection.fetch_frame(conn, queries.catalog())
    finally:
        conn.close()


def _detect(body: dict) -> dict:
    p = _typed_profile(body)
    conn, _ = connection.open_checked(p)
    try:
        cat = connection.fetch_frame(conn, queries.catalog())
        result = detect.detect(cat)
        lookup = connection.lookup_object(conn)
        fm = result["field_map"]
        samples = {}
        for key, spec in (("collar", fm.get("collar")), ("survey", fm.get("survey")), ("assay", fm.get("assay")),
                          ("samples", (fm.get("assay") or {}).get("samples"))):
            if spec and spec.get("object"):
                obj = lookup(spec.get("schema") or fm.get("schema") or "dbo", spec["object"])
                if obj is not None:
                    samples[key] = connection.fetch_frame(conn, queries.sample(obj))
        detect.refine_with_samples(result, samples)
    finally:
        conn.close()
    result["samples"] = {k: {"columns": [str(c) for c in df.columns], "rows": clean_for_json(df)}
                         for k, df in samples.items()}
    result["objects"] = _object_list(cat)
    result["incomplete"] = profiles.field_map_problems(result["field_map"])
    return result


@router.post("/detect")
async def detect_fields(body: dict = Body(...)):
    """Suggest a field map from the database's catalogue (laptops only)."""
    _refuse_in_server_mode()
    return await _run(_detect, body)


def _object_list(cat: pd.DataFrame) -> list[dict]:
    out = []
    for o in detect.objects_from_catalog(cat):
        out.append({"schema": o.schema, "name": o.name, "type": o.type, "columns": [c for c, _ in o.columns]})
    return out


@router.post("/objects")
async def list_objects(body: dict = Body(...)):
    """Every table and view with its columns, for the field map editor (laptops only)."""
    _refuse_in_server_mode()
    return await _run(lambda: {"objects": _object_list(_catalog(_typed_profile(body)))})


def _sample(body: dict) -> dict:
    p = _typed_profile(body)
    schema, name = (body.get("schema") or "dbo"), body.get("object") or ""
    conn, _ = connection.open_checked(p)
    try:
        obj = connection.lookup_object(conn)(schema, name)
        if obj is None:
            raise queries.MappingError(f"There's no table or view {schema}.{name}")
        df = connection.fetch_frame(conn, queries.sample(obj))
    finally:
        conn.close()
    return {"schema": obj.schema, "object": obj.name, "columns": list(obj.columns), "rows": clean_for_json(df)}


@router.post("/sample")
async def sample_rows(body: dict = Body(...)):
    """The first 5 rows of one table or view (laptops only). Body: {profile, schema, object}."""
    _refuse_in_server_mode()
    return await _run(_sample, body)


# ------------------------------------------------------------------ health, options, preview

def _health(name: str | None) -> dict:
    out = {"configured": False, "reachable": False, "ok": False, "server": "", "database": "",
           "message": "", "missing": [], "profile": name or ""}
    try:
        p = _profile_for_use(name)
    except profiles.ProfileError as exc:
        out["message"] = str(exc)
        return out
    out.update(configured=True, server=p["server"], database=p["database"], profile=p["name"])
    incomplete = profiles.field_map_problems(p["field_map"])
    t = connection.test(p, p["field_map"] if not incomplete else None)
    out["reachable"] = bool(t.get("user"))
    out["missing"] = t["map_problems"] + incomplete
    out["ok"] = t["ok"] and not out["missing"]
    out["message"] = t["message"] if not out["missing"] else "; ".join(out["missing"])
    return out


@router.get("/health")
async def acquire_health(profile: str | None = Q(default=None)):
    """Is the profile (or, in server mode, the admin's) set up and readable? Always 200."""
    return await asyncio.to_thread(_health, profile)


def _text(value):
    if value is None or (not isinstance(value, str) and pd.isna(value)):  # None, NaN, NaT
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    return str(value)


def _options(name: str | None) -> dict:
    p = _profile_for_use(name)
    conn, _ = connection.open_checked(p)
    try:
        vm = connection.verified(conn, profiles.require_complete(p)["field_map"])
        df = connection.fetch_frame(conn, queries.options(vm))
    finally:
        conn.close()
    mapped = {k: bool(vm.fm["filters"].get(k)) for k in profiles.FILTER_KEYS}
    combos = []
    for r in df.to_dict(orient="records"):
        combos.append({**{k: (_text(r.get(k)) if mapped[k] else None) for k in profiles.LIST_FILTERS},
                       "holes": int(r["holes"]),
                       **{f"{e}_{k}": _text(r.get(f"{e}_{k}")) for k in profiles.DATE_FILTERS
                          for e in ("first", "last")}})
    ranges = {}
    for k in profiles.DATE_FILTERS:
        firsts = [c[f"first_{k}"] for c in combos if c[f"first_{k}"]]
        lasts = [c[f"last_{k}"] for c in combos if c[f"last_{k}"]]
        ranges[k] = {"min": min(firsts) if firsts else None, "max": max(lasts) if lasts else None}
    return {"profile": p["name"], "combos": combos, "mapped": mapped,
            "drilled": ranges["drilled"], "modified": ranges["modified"]}


@router.get("/options")
async def acquire_options(profile: str | None = Q(default=None)):
    """Each combination of the mapped list filters with its hole count and date ranges."""
    return await _run(_options, profile)


def _pull(body: dict) -> tuple[dict, dict, dict]:
    p = profiles.require_complete(_profile_for_use(body.get("profile")))
    f = frames.filters_from_request(body, p["field_map"])
    conn, _ = connection.open_checked(p)
    try:
        vm = connection.verified(conn, p["field_map"])
        tables = frames.pull_frames(conn, vm, f)
    finally:
        conn.close()
    record = pull_record.build(tables, f, p, vm.fm)
    return tables, vm.fm, {"profile": p, "record": record}


@router.post("/preview")
async def acquire_preview(body: dict = Body(...)):
    """Filters -> collar / survey / assay in the shared preview cache.

    Body: {profile (laptop), projects, prospects, hole_types, programs: [..],
    drilled_from, drilled_to, modified_from, modified_to: "YYYY-MM-DD", hole_ids: [..]};
    at least one filter.
    """
    tables, fm, extra = await _run(_pull, body or {})
    token = uuid.uuid4().hex
    host.keep_preview(token, tables)
    out = preview_payload(token, tables["collar"], tables["survey"], tables["assay"])
    out["field_map"] = queries.process_field_map(fm)
    out["negate_dip"] = fm.get("dip") == "positive_down"
    out["holes"] = extra["record"]["holes"]
    out["pull_record"] = extra["record"]
    logger.info("Acquire preview (%s): %d holes, rows %s", extra["profile"]["name"], out["holes"],
                extra["record"]["rows"])
    return out
