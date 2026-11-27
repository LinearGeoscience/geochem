"""Detect fields: suggest a field map from a database's catalogue (INFORMATION_SCHEMA).

Read-only: it only looks at table, view and column names and types (and, in
the API, a TOP 5 sample of the chosen tables). Every suggestion has a
confidence (0-100); the user checks the map in the editor before saving it.

Column roles reuse core/columns.py's drillhole patterns (hole ID, east / north /
RL, depth / dip / azimuth, from / to) plus the patterns below for the rest.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from app.acquire.profiles import FILTER_KEYS, REQUIRED
from app.core.columns import get_column_patterns, normalize_column_name

NUMERIC_TYPES = {"int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money", "smallmoney"}
DATE_TYPES = {"date", "datetime", "datetime2", "smalldatetime", "datetimeoffset"}
TEXT_TYPES = {"char", "varchar", "nchar", "nvarchar", "text", "ntext"}

EXTRA_PATTERNS = {
    "sample_id": [("sampleid", 100), ("sample_id", 100), ("sampleno", 95), ("sampno", 90), ("sampnum", 90),
                  ("samplenumber", 95), ("sample", 60)],
    "element": [("element", 100), ("analyte", 100), ("assaytype", 90), ("assaycode", 85), ("analysis", 60),
                ("name", 40)],
    "value": [("value", 100), ("result", 90), ("assayvalue", 100), ("grade", 70)],
    "unit": [("unit", 100), ("uom", 90)],
    "priority": [("priority", 100), ("rank", 90), ("preferred", 80)],
    "qaqc": [("sampletype", 100), ("qctype", 100), ("qaqc", 100), ("checktype", 90), ("qccode", 90)],
}
FILTER_PATTERNS = {
    "project": [("projectcode", 100), ("project", 95)],
    "prospect": [("prospect", 100), ("deposit", 70), ("target", 40)],
    "hole_type": [("drillholetype", 100), ("holetype", 90), ("drilltype", 90), ("drillmethod", 80)],
    "program": [("drillprogram", 100), ("programme", 95), ("program", 95), ("campaign", 80)],
    "drilled": [("startdate", 100), ("datestart", 100), ("drilldate", 95), ("datedrilled", 95),
                ("collardate", 80), ("enddate", 60), ("datefini", 60)],
    "modified": [("lastmodified", 100), ("modifieddate", 100), ("datemodified", 100), ("lastupdated", 95),
                 ("modified", 90), ("updated", 80), ("changed", 70)],
}
OBJECT_HINTS = {
    "collar": [("collar", 10), ("holelocation", 10), ("header", 6), ("hole", 4)],
    "survey": [("survey", 10), ("downhole", 4)],
    "assay": [("assay", 10), ("sample", 5), ("geochem", 6), ("result", 4)],
    "samples": [("sample", 10), ("interval", 5)],
    "results": [("assay", 10), ("result", 8), ("value", 4)],
}
GENERIC_HINT = [("export", 3)]
NUMERIC_ROLES = {"easting", "northing", "rl", "depth", "dip", "azimuth", "from", "to"}


@dataclass
class Obj:
    schema: str
    name: str
    type: str
    columns: list = field(default_factory=list)  # [(name, data_type)]

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.name}"


def objects_from_catalog(cat: pd.DataFrame) -> list[Obj]:
    out: dict[tuple, Obj] = {}
    for r in cat.itertuples(index=False):
        k = (str(r.TABLE_SCHEMA), str(r.TABLE_NAME))
        if k not in out:
            out[k] = Obj(k[0], k[1], str(r.TABLE_TYPE))
        out[k].columns.append((str(r.COLUMN_NAME), str(r.DATA_TYPE).lower()))
    return list(out.values())


def _patterns(table: str, role: str):
    base = get_column_patterns({"samples": "assay", "results": "assay"}.get(table, table)).get(role)
    return base or EXTRA_PATTERNS.get(role) or FILTER_PATTERNS.get(role) or []


def _type_ok(role: str, dtype: str) -> bool:
    if role in NUMERIC_ROLES or role == "priority":
        return dtype in NUMERIC_TYPES
    if role in ("drilled", "modified"):
        return dtype in DATE_TYPES or dtype in TEXT_TYPES
    if role in ("project", "prospect", "hole_type", "program", "qaqc", "unit"):
        return dtype in TEXT_TYPES
    return True


def role_candidates(obj: Obj, table: str, role: str) -> list[tuple[str, int]]:
    """Columns of `obj` that could hold `role`, best first: [(column, confidence)]."""
    # Patterns are compared the way names are: lower case, no _ or spaces
    pats = [(normalize_column_name(p), w) for p, w in _patterns(table, role)]
    found = []
    for i, (col, dtype) in enumerate(obj.columns):
        if not _type_ok(role, dtype):
            continue
        n = normalize_column_name(col)
        best = max((w + (5 if n == p else 0) for p, w in pats if p in n), default=0)
        if best:
            found.append((col, min(best, 100), i))
    found.sort(key=lambda t: (-t[1], t[2]))
    return [(c, w) for c, w, _ in found]


def assign(obj: Obj, table: str, roles) -> tuple[dict, dict, dict]:
    """Best distinct column per role: ({role: column}, {role: confidence}, {role: [alternatives]})."""
    used, cols, conf, alts = set(), {}, {}, {}
    for role in roles:
        cands = [(c, w) for c, w in role_candidates(obj, table, role) if c not in used]
        alts[role] = [c for c, _ in cands]
        if cands:
            cols[role], conf[role] = cands[0]
            used.add(cands[0][0])
    return cols, conf, alts


def _hint(obj: Obj, table: str) -> int:
    n = normalize_column_name(obj.name)
    return max((w for p, w in OBJECT_HINTS.get(table, []) if p in n), default=0) + \
        max((w for p, w in GENERIC_HINT if p in n), default=0)


def score(obj: Obj, table: str, roles) -> tuple[float, dict, dict, dict]:
    cols, conf, alts = assign(obj, table, roles)
    if len(cols) < len(roles):
        return 0.0, cols, conf, alts
    return sum(conf.values()) / len(roles) + _hint(obj, table), cols, conf, alts


def _numeric_extra(obj: Obj, used) -> int:
    return sum(1 for c, t in obj.columns if t in NUMERIC_TYPES and c not in used)


def _ranked(objs, table, roles, extra=None):
    out = []
    for o in objs:
        s, cols, conf, alts = score(o, table, roles)
        if s <= 0:
            continue
        if extra:
            s += extra(o, cols)
        out.append((s, o, cols, conf, alts))
    out.sort(key=lambda t: (-t[0], t[1].key))
    return out


def detect(cat: pd.DataFrame) -> dict:
    """Suggest a field map. Returns {field_map, confidence, candidates, alternatives, hints}."""
    objs = objects_from_catalog(cat)
    hints: list[str] = []
    confidence: dict[str, float] = {}
    alternatives: dict[str, list] = {}
    candidates: dict[str, list] = {}
    fm: dict = {"schema": "dbo", "date_format": "%Y-%m-%d", "dip": "negative_down", "filters": {}}

    def take(table, ranked, label=None):
        label = label or table
        candidates[label] = [{"schema": o.schema, "name": o.name, "score": round(s, 1)} for s, o, *_ in ranked[:10]]
        if not ranked:
            hints.append(f"No table or view looks like the {label} table.")
            return None
        s, o, cols, conf, alts = ranked[0]
        confidence[f"{label}.object"] = round(min(s, 100), 1)
        for r, w in conf.items():
            confidence[f"{label}.{r}"] = w
            alternatives[f"{label}.{r}"] = alts[r]
        return o, cols

    collar = take("collar", _ranked(objs, "collar", REQUIRED["collar"]))
    survey = take("survey", _ranked(objs, "survey", REQUIRED["survey"]))
    fm["collar"] = {"schema": collar[0].schema, "object": collar[0].name, "columns": collar[1]} if collar else \
        {"object": "", "columns": {}}
    fm["survey"] = {"schema": survey[0].schema, "object": survey[0].name, "columns": survey[1], "priority": None} \
        if survey else {"object": "", "columns": {}, "priority": None}
    if survey:
        pri = role_candidates(survey[0], "survey", "priority")
        if pri:
            fm["survey"]["priority"] = {"column": pri[0][0], "keep": "lowest"}
            hints.append(f"Surveys: several readings per depth are resolved by the lowest {pri[0][0]}; check this.")

    # Assays: wide, long (one table) or long joined to a samples table
    wide = _ranked(objs, "assay", REQUIRED[("assay", "wide")],
                   extra=lambda o, cols: min(_numeric_extra(o, set(cols.values())), 40) / 2)
    wide = [w for w in wide if _numeric_extra(w[1], set(w[2].values())) >= 3]
    long_ = _ranked(objs, "assay", REQUIRED[("assay", "long")])
    samples = _ranked(objs, "samples", REQUIRED["samples"])
    results = _ranked(objs, "results", REQUIRED[("assay", "long_joined")])
    results = [r for r in results if not samples or r[1].key != samples[0][1].key]
    options = []
    if wide:
        options.append(("wide", wide[0][0]))
    if long_:
        options.append(("long", long_[0][0] + 10))
    if samples and results:
        options.append(("long_joined", (samples[0][0] + results[0][0]) / 2 + 5))
    layout = max(options, key=lambda t: t[1])[0] if options else "wide"
    assay: dict = {"layout": layout, "preferred": {"rule": "none", "column": None}, "bdl": None, "qaqc": None,
                   "column_rules": {"drop_columns": [], "drop_suffixes": [], "strip_suffixes": [], "rename": {}}}
    if layout == "wide":
        a = take("assay", wide)
        assay.update(schema=a[0].schema if a else "dbo", object=a[0].name if a else "",
                     columns=a[1] if a else {})
        home = a[0] if a else None
    elif layout == "long":
        a = take("assay", long_)
        o, cols = a
        extra, _, _ = assign(o, "assay", ("sample_id", "unit"))
        cols.update({k: c for k, c in extra.items() if c not in cols.values()})
        assay.update(schema=o.schema, object=o.name, columns=cols)
        home = o
    else:
        s = take("samples", samples)
        r = take("assay", results)
        o, cols = r
        unit = role_candidates(o, "results", "unit")
        if unit and unit[0][0] not in cols.values():
            cols["unit"] = unit[0][0]
        assay.update(schema=o.schema, object=o.name, columns=cols,
                     samples={"schema": s[0].schema, "object": s[0].name, "columns": s[1]})
        home = s[0]
    candidates.setdefault("assay", [])
    if layout != "wide":
        res_obj = next((x for x in objs if x.name == assay["object"] and x.schema == assay["schema"]), None)
        pri = role_candidates(res_obj, "results", "priority") if res_obj else []
        if pri:
            assay["preferred"] = {"rule": "lowest", "column": pri[0][0]}
            hints.append(f"Assays: several results per sample and analyte are resolved by the lowest {pri[0][0]}; "
                         "check this, or use a view that already picks the preferred result.")
        else:
            hints.append("Assays: no priority column found; the import stops if a sample has two results "
                         "for one analyte (choose a preferred-result rule if it does).")
    if home is not None:
        qc = role_candidates(home, "assay", "qaqc")
        if qc:
            hints.append(f"QAQC: {home.name}.{qc[0][0]} may mark blanks, standards and duplicates; "
                         "enter the values to leave out if it does.")
    fm["assay"] = assay

    if collar:
        used = set(fm["collar"]["columns"].values())
        for k in FILTER_KEYS:
            c = [(col, w) for col, w in role_candidates(collar[0], "collar", k) if col not in used]
            fm["filters"][k] = c[0][0] if c else None
            if c:
                confidence[f"filters.{k}"] = c[0][1]
                alternatives[f"filters.{k}"] = [col for col, _ in c]
                used.add(c[0][0])
    else:
        fm["filters"] = {k: None for k in FILTER_KEYS}
    return {"field_map": fm, "confidence": confidence, "candidates": candidates,
            "alternatives": alternatives, "hints": hints}


def refine_with_samples(result: dict, samples: dict) -> dict:
    """Use TOP 5 samples of the chosen tables: swap an all-blank coordinate / survey
    column for the next candidate that has values, and read the dip convention."""
    fm = result["field_map"]
    for table, roles in (("collar", ("easting", "northing", "rl")), ("survey", ("depth", "dip", "azimuth"))):
        rows = samples.get(table)
        if rows is None or rows.empty:
            continue
        cols = fm[table]["columns"]
        for role in roles:
            col = cols.get(role)
            if col in rows.columns and rows[col].notna().any():
                continue
            for alt in result["alternatives"].get(f"{table}.{role}", []):
                if alt in rows.columns and rows[alt].notna().any() and alt not in cols.values():
                    result["hints"].append(f"{table}: {col} was blank in the first rows, so {alt} is suggested "
                                           f"for {role}.")
                    cols[role] = alt
                    break
    rows = samples.get("survey")
    dip_col = fm["survey"]["columns"].get("dip")
    if rows is not None and dip_col in getattr(rows, "columns", []):
        dips = pd.to_numeric(rows[dip_col], errors="coerce").dropna()
        dips = dips[dips != 0]
        if len(dips) and (dips > 0).mean() > 0.5:
            fm["dip"] = "positive_down"
            result["hints"].append("Survey dips are mostly positive in the first rows: dip set to positive-down.")
    return result
