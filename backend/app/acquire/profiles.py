"""Acquire connection profiles: server, database, driver options and the field map.

Every company sets up Acquire differently, so a profile says where its
collars, surveys and assays are (tables or views, and which columns hold
what). Profiles hold names only, never SQL: queries.py fills its fixed query
shapes from them after checking every name against the database.

Where they live
- Laptops: one JSON file per profile in the user's own folder, set by the
  profiles_dir setting (default: an acquire_profiles folder inside the app's
  folder in the user's roaming AppData). The example profiles shipped in
  app/acquire/profiles/ (all but _template.json) are copied there when the
  folder is empty; a blank server or database in an example is filled from the
  server / database settings.
- Server mode: one admin profile, the file named by the profile setting, with
  the server / database settings overriding its server and database. Nothing
  can be edited from the screen.

The settings' names (environment variables, settings file) are in
the app's settings (app/acquire/host.py: ACQUIRE_ENV, SETTINGS_FILE).
"""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path

from app.acquire import validation as v
from app.acquire.host import ACQUIRE_ENV, SETTINGS_FILE, acquire_settings

EXAMPLES_DIR = Path(__file__).with_name("profiles")
TEMPLATE_FILE = EXAMPLES_DIR / "_template.json"
PROFILE_VERSION = 1
DEFAULT_DRIVER = "ODBC Driver 18 for SQL Server"

LAYOUTS = ("wide", "long", "long_joined")
FILTER_KEYS = ("project", "prospect", "hole_type", "program", "drilled", "modified")
LIST_FILTERS = ("project", "prospect", "hole_type", "program")
DATE_FILTERS = ("drilled", "modified")
PREFERRED_RULES = ("none", "lowest", "highest", "first")
BDL_WRITE = ("half", "negative", "as_is")
DIP_CONVENTIONS = ("negative_down", "positive_down")

# Required (and optional) roles per table. For the assay table they depend on the layout.
REQUIRED = {
    "collar": ("hole_id", "easting", "northing", "rl"),
    "survey": ("hole_id", "depth", "dip", "azimuth"),
    ("assay", "wide"): ("hole_id", "from", "to"),
    ("assay", "long"): ("hole_id", "from", "to", "element", "value"),
    ("assay", "long_joined"): ("sample_id", "element", "value"),
    "samples": ("sample_id", "hole_id", "from", "to"),
}
OPTIONAL = {
    ("assay", "long"): ("sample_id", "unit"),
    ("assay", "long_joined"): ("unit",),
}

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,59}$")
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


class ProfileError(ValueError):
    """A profile that can't be used or saved; the message is for the screen."""


# ------------------------------------------------------------------ checking

def check_profile_name(name: str) -> str:
    n = (name or "").strip()
    if not _NAME_RE.match(n) or n.endswith((".", " ")) or n.lower() in _RESERVED:
        raise ProfileError("Profile names may use letters, digits, spaces, - _ and . "
                           "(up to 60 characters, starting with a letter or digit).")
    return n


def _names(value, where: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
        raise ProfileError(f"{where} must be a list of names")
    return list(value)


def _table_problems(spec, key: str, required, optional=()) -> list[str]:
    problems = []
    if not isinstance(spec, dict):
        return [f"{key}: not set"]
    if not spec.get("object"):
        problems.append(f"{key}: choose a table or view")
    cols = spec.get("columns") or {}
    if not isinstance(cols, dict):
        return problems + [f"{key}: columns must map roles to column names"]
    for role in required:
        if not cols.get(role):
            problems.append(f"{key}: choose the {role.replace('_', ' ')} column")
    for role, col in cols.items():
        if role not in tuple(required) + tuple(optional) and col:
            problems.append(f"{key}: unknown role {role!r}")
    return problems


def field_map_problems(fm) -> list[str]:
    """What's missing or wrong in a field map (empty list = complete).
    Names are checked against the database separately (queries.verify_field_map)."""
    if not isinstance(fm, dict):
        return ["field map: not set"]
    problems = []
    problems += _table_problems(fm.get("collar"), "collar", REQUIRED["collar"])
    survey = fm.get("survey") or {}
    problems += _table_problems(survey, "survey", REQUIRED["survey"])
    pri = survey.get("priority") if isinstance(survey, dict) else None
    if pri and (not pri.get("column") or pri.get("keep") not in ("lowest", "highest")):
        problems.append("survey: the priority rule needs a column and keep = lowest or highest")

    assay = fm.get("assay") or {}
    layout = assay.get("layout") if isinstance(assay, dict) else None
    if layout not in LAYOUTS:
        problems.append("assay: choose the layout (wide, long, or long joined to samples)")
    else:
        problems += _table_problems(assay, "assay", REQUIRED[("assay", layout)], OPTIONAL.get(("assay", layout), ()))
        if layout == "long_joined":
            problems += _table_problems(assay.get("samples"), "samples", REQUIRED["samples"])
        pref = assay.get("preferred") or {"rule": "none"}
        if pref.get("rule") not in PREFERRED_RULES:
            problems.append("assay: preferred-result rule must be none, lowest, highest or first")
        elif pref.get("rule") in ("lowest", "highest") and not pref.get("column"):
            problems.append("assay: the preferred-result rule needs its priority column")
        bdl = assay.get("bdl")
        if bdl and (not bdl.get("column") or not bdl.get("values") or bdl.get("write_as") not in BDL_WRITE):
            problems.append("assay: the below-detection rule needs a column, flag values and write_as")
        qaqc = assay.get("qaqc")
        if qaqc and (not qaqc.get("column") or not qaqc.get("exclude")):
            problems.append("assay: the QAQC exclusion needs a column and the values to leave out")
        try:
            rules = assay.get("column_rules") or {}
            for k in ("drop_columns", "drop_suffixes", "strip_suffixes"):
                _names(rules.get(k), f"assay column_rules.{k}")
            ren = rules.get("rename") or {}
            if not isinstance(ren, dict) or not all(isinstance(a, str) and isinstance(b, str) and b
                                                    for a, b in ren.items()):
                problems.append("assay: column_rules.rename must map names to names")
        except ProfileError as exc:
            problems.append(str(exc))

    filters = fm.get("filters") or {}
    if not isinstance(filters, dict):
        problems.append("filters: must map filter names to columns")
    else:
        for k in filters:
            if k not in FILTER_KEYS:
                problems.append(f"filters: unknown filter {k!r}")
    if fm.get("dip", "negative_down") not in DIP_CONVENTIONS:
        problems.append("dip: must be negative_down or positive_down")
    for name in object_and_column_names(fm):
        try:
            v.check_name(name)
        except v.InputError as exc:
            problems.append(str(exc))
    return problems


def object_and_column_names(fm: dict) -> list[str]:
    """Every database name a field map uses (for checks)."""
    out = []
    if not isinstance(fm, dict):
        return out
    for key in ("collar", "survey", "assay"):
        spec = fm.get(key) or {}
        if not isinstance(spec, dict):
            continue
        out += [x for x in (spec.get("schema"), spec.get("object")) if x]
        out += [c for c in (spec.get("columns") or {}).values() if c]
        if key == "assay":
            sm = spec.get("samples") or {}
            out += [x for x in (sm.get("schema"), sm.get("object")) if x]
            out += [c for c in (sm.get("columns") or {}).values() if c]
            for sub in ("preferred", "bdl", "qaqc"):
                col = (spec.get(sub) or {}).get("column")
                if col:
                    out.append(col)
        if key == "survey":
            col = (spec.get("priority") or {}).get("column")
            if col:
                out.append(col)
    out += [c for c in (fm.get("filters") or {}).values() if c]
    return out


def normalise(profile: dict) -> dict:
    """A profile with defaults filled in and its connection fields checked (not its completeness)."""
    if not isinstance(profile, dict):
        raise ProfileError("A profile must be a JSON object")
    p = copy.deepcopy(profile)
    p["name"] = check_profile_name(p.get("name", ""))
    p["version"] = PROFILE_VERSION
    p["server"] = (p.get("server") or "").strip()
    p["database"] = (p.get("database") or "").strip()
    try:
        if p["server"]:
            v.check_server(p["server"])
        if p["database"]:
            v.check_database(p["database"])
    except v.InputError as exc:
        raise ProfileError(str(exc)) from exc
    driver = (p.get("driver") or DEFAULT_DRIVER).strip()
    if any(c in driver for c in ";{}=") or len(driver) > 100:
        raise ProfileError("The ODBC driver name can't contain ; { } or =")
    p["driver"] = driver
    p["encrypt"] = bool(p.get("encrypt", True))
    p["trust_server_certificate"] = bool(p.get("trust_server_certificate", True))
    fm = p.get("field_map") or {}
    if not isinstance(fm, dict):
        raise ProfileError("field_map must be a JSON object")
    fm.setdefault("schema", "dbo")
    fm.setdefault("date_format", "%Y-%m-%d")
    fm.setdefault("dip", "negative_down")
    fm.setdefault("filters", {})
    p["field_map"] = fm
    return p


def require_complete(profile: dict) -> dict:
    p = normalise(profile)
    problems = field_map_problems(p["field_map"])
    if problems:
        raise ProfileError("The field map isn't complete: " + "; ".join(problems[:6]))
    return p


def summary(p: dict) -> dict:
    return {"name": p["name"], "server": p.get("server", ""), "database": p.get("database", ""),
            "complete": not field_map_problems(p.get("field_map"))}


# ------------------------------------------------------------------ storage

def profiles_dir() -> Path:
    return Path(acquire_settings()["profiles_dir"])


def _path(name: str) -> Path | None:
    """The file of a saved profile (names are matched case-insensitively, as on Windows)."""
    key = check_profile_name(name).lower()
    d = profiles_dir()
    if not d.is_dir():
        return None
    return next((f for f in d.glob("*.json") if f.stem.lower() == key), None)


def _read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ProfileError(f"Can't read the profile file {path.name}: {exc}") from exc
    if isinstance(data, dict):
        data.setdefault("name", path.stem)
    return normalise(data)


def _write(path: Path, profile: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def seed_examples() -> list[str]:
    """Copy the shipped example profiles into an empty profiles folder; returns their names."""
    d = profiles_dir()
    if d.is_dir() and any(d.glob("*.json")):
        return []
    s = acquire_settings()
    seeded = []
    for src in sorted(EXAMPLES_DIR.glob("*.json")):
        if src.name.startswith("_"):
            continue
        p = _read(src)
        if not p["server"] and s["server"]:
            p["server"] = s["server"]
        if not p["database"] and s["database"]:
            p["database"] = s["database"]
        _write(d / f"{p['name']}.json", p)
        seeded.append(p["name"])
    return seeded


def list_profiles() -> list[dict]:
    seed_examples()
    d = profiles_dir()
    out = []
    files = sorted(d.glob("*.json"), key=lambda f: f.stem.lower()) if d.is_dir() else []
    for f in files:
        try:
            out.append(summary(_read(f)))
        except ProfileError as exc:
            out.append({"name": f.stem, "server": "", "database": "", "complete": False, "error": str(exc)})
    return out


def load_profile(name: str) -> dict:
    seed_examples()
    path = _path(name)
    if path is None:
        raise ProfileError(f"There's no connection profile called {name!r}")
    return _read(path)


def save_profile(profile: dict, old_name: str | None = None) -> dict:
    """Save a complete profile. With old_name (a rename), the old file is removed.
    Refuses to overwrite a different existing profile of the same name."""
    p = require_complete(profile)
    existing = _path(p["name"])
    old = _path(old_name) if old_name else None
    if old_name and old is None:
        raise ProfileError(f"There's no connection profile called {old_name!r}")
    if old_name and existing is not None and existing != old:
        raise ProfileError(f"A profile called {p['name']!r} already exists")
    if old is not None:
        old.unlink()
    elif existing is not None:
        existing.unlink()  # saving over itself (possibly with new letter case)
    _write(profiles_dir() / f"{p['name']}.json", p)
    return p


def create_profile(profile: dict) -> dict:
    """Save a new complete profile; refuses an existing name."""
    p = require_complete(profile)
    if _path(p["name"]) is not None:
        raise ProfileError(f"A profile called {p['name']!r} already exists")
    _write(profiles_dir() / f"{p['name']}.json", p)
    return p


def delete_profile(name: str) -> None:
    path = _path(name)
    if path is None:
        raise ProfileError(f"There's no connection profile called {name!r}")
    path.unlink()


def template() -> dict:
    """The blank starting profile (app/acquire/profiles/_template.json)."""
    data = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8-sig"))
    data["name"] = data.get("name") or "New profile"
    return normalise(data)


# ------------------------------------------------------------------ server mode

def admin_profile() -> dict:
    """The profile the server uses (the profile setting), with the settings' server / database."""
    s = acquire_settings()
    if not s["profile"]:
        raise ProfileError(f"Acquire isn't set up on this server ({ACQUIRE_ENV['profile']} in {SETTINGS_FILE}).")
    path = Path(s["profile"])
    if not path.is_file():
        raise ProfileError(f"The Acquire profile file set in {ACQUIRE_ENV['profile']} wasn't found.")
    p = _read(path)
    if s["server"]:
        p["server"] = s["server"]
    if s["database"]:
        p["database"] = s["database"]
    try:
        v.check_server(p["server"])
        v.check_database(p["database"])
    except v.InputError as exc:
        raise ProfileError(f"The server's Acquire settings aren't usable: {exc}") from exc
    problems = field_map_problems(p["field_map"])
    if problems:
        raise ProfileError("The server's Acquire profile isn't complete: " + "; ".join(problems[:4]))
    return p
