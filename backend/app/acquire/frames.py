"""Acquire filters -> the three DataFrames the Drillhole tab's file pickers would give.

The collar query picks the holes; survey and assay rows are then read for
exactly those holes, by the profile's field map (queries.py).

Assays come in one of three layouts (profile field_map.assay.layout):
- wide: one row per sample interval, one column per analyte (as read)
- long / long_joined: one row per result; `pivot_long` turns them into one row
  per sample interval, one column per analyte ("Li2O_pct" from element "Li2O"
  and unit "pct"), applying the preferred-result and below-detection rules.
Then `shape_columns` applies the profile's column rules (drop columns, drop or
strip name suffixes, rename), and `normalise_like_csv` makes the frames look as
if they'd been read from a CSV by the Drillhole tab (pandas.read_csv), so the
rest of the import (rename, desurvey, set_data) sees the same thing either way.
"""
from __future__ import annotations

import datetime as dt
import decimal
import io
from dataclasses import asdict, dataclass, field

import pandas as pd

from app.acquire import queries
from app.acquire.profiles import DATE_FILTERS, LIST_FILTERS
from app.core.parsing import is_text_dtype


class NoHoles(ValueError):
    """No collar matches the filters."""


class DuplicateResults(ValueError):
    """A sample has several results for one analyte and the profile has no preferred-result rule."""


class ColumnClash(ValueError):
    """Two columns would end up with the same name."""


@dataclass
class Filters:
    projects: list[str] = field(default_factory=list)
    prospects: list[str] = field(default_factory=list)
    hole_types: list[str] = field(default_factory=list)
    programs: list[str] = field(default_factory=list)
    drilled_from: dt.date | None = None
    drilled_to: dt.date | None = None
    modified_from: dt.date | None = None
    modified_to: dt.date | None = None
    hole_ids: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (self.projects or self.prospects or self.hole_types or self.programs or self.drilled_from
                    or self.drilled_to or self.modified_from or self.modified_to or self.hole_ids)

    def as_record(self) -> dict:
        """For the pull record (dates as text; a long hole list is counted, not copied)."""
        rec = asdict(self)
        for k in ("drilled_from", "drilled_to", "modified_from", "modified_to"):
            rec[k] = getattr(self, k).isoformat() if getattr(self, k) else None
        if len(self.hole_ids) > 50:
            rec["hole_ids"] = self.hole_ids[:50] + [f"... {len(self.hole_ids) - 50} more"]
        rec["hole_id_count"] = len(self.hole_ids)
        return rec


_LIST_FIELDS = {"project": "projects", "prospect": "prospects", "hole_type": "hole_types", "program": "programs"}
_LABELS = {"project": "project", "prospect": "prospect", "hole_type": "hole type", "program": "program",
           "drilled": "drilled date", "modified": "modified date"}


def _text_list(body: dict, key: str) -> list[str]:
    value = body.get(key) or []
    if not isinstance(value, list):
        raise ValueError(f"'{key}' must be a list")
    out, seen = [], set()
    for item in value:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _date(body: dict, key: str) -> dt.date | None:
    value = body.get(key)
    if value in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError(f"'{key}' must be a date like 2026-01-31") from exc


def filters_from_request(body: dict, field_map: dict | None = None) -> Filters:
    """Check a /preview request body and turn it into Filters (ValueError = 400).
    With a field map, a filter the profile doesn't map is refused."""
    f = Filters(projects=_text_list(body, "projects"), prospects=_text_list(body, "prospects"),
                hole_types=_text_list(body, "hole_types"), programs=_text_list(body, "programs"),
                drilled_from=_date(body, "drilled_from"), drilled_to=_date(body, "drilled_to"),
                modified_from=_date(body, "modified_from"), modified_to=_date(body, "modified_to"),
                hole_ids=_text_list(body, "hole_ids"))
    for k in DATE_FILTERS:
        lo, hi = getattr(f, f"{k}_from"), getattr(f, f"{k}_to")
        if lo and hi and lo > hi:
            raise ValueError(f"The {_LABELS[k]} 'from' date is after the 'to' date")
    if f.is_empty():
        raise ValueError("Choose at least one filter, or paste a hole list")
    for key in ("projects", "prospects", "hole_types", "programs", "hole_ids"):
        queries.joined(getattr(f, key))  # length / separator checks
    if field_map is not None:
        mapped = field_map.get("filters") or {}
        for k in LIST_FILTERS:
            if getattr(f, _LIST_FIELDS[k]) and not mapped.get(k):
                raise ValueError(f"This profile has no {_LABELS[k]} column, so it can't filter on it")
        for k in DATE_FILTERS:
            if (getattr(f, f"{k}_from") or getattr(f, f"{k}_to")) and not mapped.get(k):
                raise ValueError(f"This profile has no {_LABELS[k]} column, so it can't filter on it")
    return f


# ------------------------------------------------------------- CSV-like types

def _as_datetime(series: pd.Series) -> pd.Series | None:
    """A column of datetime objects as datetime64, else None."""
    values = series.dropna()
    if len(values) and all(isinstance(x, (dt.datetime, dt.date)) for x in values):
        return pd.to_datetime(series)
    return None


def normalise_like_csv(df: pd.DataFrame, date_format: str) -> pd.DataFrame:
    """The frame as pandas.read_csv would give it from a CSV of the same values.

    - dates -> text in `date_format`
    - Decimal -> float; an all-blank column -> float NaN (read_csv does this)
    - text columns go through read_csv itself, so its NA words, blanks and
      number detection apply exactly as for an uploaded file
    - numeric columns are left as they are (float64 at full precision)
    """
    out = df.copy()
    text_cols = []
    for col in out.columns:
        s = out[col]
        if not pd.api.types.is_datetime64_any_dtype(s) and is_text_dtype(s.dtype):
            converted = _as_datetime(s)
            if converted is not None:
                s = converted
            elif any(isinstance(x, decimal.Decimal) for x in s.dropna()):
                out[col] = pd.to_numeric(s.map(lambda x: float(x) if isinstance(x, decimal.Decimal) else x))
                continue
        if pd.api.types.is_datetime64_any_dtype(s):
            out[col] = s.dt.strftime(date_format).astype(object).where(s.notna(), None)
            text_cols.append(col)
        elif s.isna().all():
            out[col] = pd.Series(float("nan"), index=out.index, dtype="float64")
        elif is_text_dtype(s.dtype):
            text_cols.append(col)
    if text_cols and len(out):
        buf = io.StringIO()
        out[text_cols].to_csv(buf, index=False)
        buf.seek(0)
        reread = pd.read_csv(buf)
        reread.index = out.index
        for col in text_cols:
            out[col] = reread[col]
    return out


# ------------------------------------------------------------- long -> wide

def pivot_long(df: pd.DataFrame, assay: dict) -> pd.DataFrame:
    """One row per result -> one row per sample interval, one column per analyte.

    `df` is the long-layout query result: the sample columns under their own
    names plus __element, __value and optionally __unit, __priority, __bdl.
    Analyte columns are named element, or element_unit when there's a unit.
    """
    a = queries.LONG_ALIASES
    src = assay["samples"]["columns"] if assay["layout"] == "long_joined" else assay["columns"]
    keys = list(dict.fromkeys(src[r] for r in ("hole_id", "from", "to", "sample_id") if src.get(r)))
    if df.empty:
        return pd.DataFrame(columns=keys)
    d = df.copy()
    element = d[a["element"]].astype("string").str.strip()
    if a["unit"] in d.columns:
        unit = d[a["unit"]].astype("string").str.strip()
        name = (element + "_" + unit).where(unit.notna() & (unit != ""), element)
    else:
        name = element
    d["__analyte"] = name
    d = d[d["__analyte"].notna() & (d["__analyte"] != "")]
    d["__v"] = pd.to_numeric(d[a["value"]], errors="coerce")

    bdl = assay.get("bdl") or {}
    if bdl.get("column") and a["bdl"] in d.columns:
        flagged = d[a["bdl"]].astype("string").str.strip().isin([str(x) for x in bdl["values"]])
        if bdl["write_as"] == "half":
            d.loc[flagged, "__v"] = d.loc[flagged, "__v"].abs() / 2
        elif bdl["write_as"] == "negative":
            d.loc[flagged, "__v"] = -d.loc[flagged, "__v"].abs()

    group = keys + ["__analyte"]
    rule = (assay.get("preferred") or {}).get("rule", "none")
    if rule in ("lowest", "highest"):
        d["__p"] = pd.to_numeric(d[a["priority"]], errors="coerce")
        d = d.sort_values("__p", ascending=(rule == "lowest"), na_position="last", kind="stable")
        d = d.drop_duplicates(group, keep="first")
    elif rule == "first":
        d = d.drop_duplicates(group, keep="first")
    else:
        dup = d.duplicated(group, keep=False)
        if dup.any():
            first = d.loc[dup].iloc[0]
            raise DuplicateResults(
                f"Sample {', '.join(str(first[k]) for k in keys)} has more than one {first['__analyte']} result. "
                "Choose a preferred-result rule in the profile's field map.")

    order = list(dict.fromkeys(d["__analyte"]))
    wide = d.pivot(index=keys, columns="__analyte", values="__v").reset_index()
    wide.columns.name = None
    clash = [c for c in order if c in keys]
    if clash:
        raise ColumnClash(f"Analyte {clash[0]!r} has the same name as a sample column")
    wide = wide[keys + order]
    return wide.sort_values(keys[:2], kind="stable").reset_index(drop=True)


# ------------------------------------------------------------- column rules

def shaped_name(column: str, keep: set, rules: dict) -> str | None:
    """The column's name after the profile's column rules, or None if dropped.
    Columns in `keep` (the mapped hole ID, from, to ...) are kept as they are."""
    if column in keep:
        return column
    if column in set(rules.get("drop_columns") or []):
        return None
    if any(column.endswith(s) for s in rules.get("drop_suffixes") or []):
        return None
    name = column
    for suffix in rules.get("strip_suffixes") or []:
        if name.endswith(suffix) and len(name) > len(suffix):
            name = name[: -len(suffix)]
            break
    rename = rules.get("rename") or {}
    return rename.get(column, rename.get(name, name))


def shape_columns(df: pd.DataFrame, keep, rules: dict) -> pd.DataFrame:
    """Drop, strip suffixes and rename columns by the profile's column rules.
    Raises ColumnClash rather than silently merging two columns into one name."""
    keep = set(keep)
    names = {c: shaped_name(str(c), keep, rules or {}) for c in df.columns}
    kept = {c: n for c, n in names.items() if n is not None}
    seen: dict[str, str] = {}
    for col, name in kept.items():
        key = name.lower()  # desurvey lowercases every name
        if key in seen:
            raise ColumnClash(f"Columns {seen[key]} and {col} would both become {name} "
                              "(check the profile's assay column rules)")
        seen[key] = col
    return df[list(kept)].rename(columns=kept)


def assay_keep_columns(assay: dict) -> list[str]:
    src = assay["samples"]["columns"] if assay["layout"] == "long_joined" else assay["columns"]
    return [c for r, c in src.items() if c and r in ("hole_id", "from", "to", "sample_id")]


# ------------------------------------------------------------------ the pull

def _keep_survey_priority(survey: pd.DataFrame, spec: dict) -> pd.DataFrame:
    rule = spec.get("priority") or {}
    if not rule.get("column") or survey.empty:
        return survey
    cols = spec["columns"]
    p = pd.to_numeric(survey[rule["column"]], errors="coerce")
    order = survey.assign(__p=p).sort_values("__p", ascending=rule["keep"] == "lowest", na_position="last",
                                             kind="stable")
    kept = order.drop_duplicates([cols["hole_id"], cols["depth"]], keep="first").drop(columns="__p")
    return kept.sort_values([cols["hole_id"], cols["depth"]], kind="stable").reset_index(drop=True)


def pull_frames(conn, vm: queries.VerifiedMap, filters: Filters) -> dict[str, pd.DataFrame]:
    """{collar, survey, assay} DataFrames for the holes matching `filters`.
    Raises NoHoles when no collar matches."""
    from app.acquire.connection import fetch_frame

    fm = vm.fm
    collar = fetch_frame(conn, queries.collar(vm, filters))
    hole_col = fm["collar"]["columns"]["hole_id"]
    holes = [str(h) for h in collar[hole_col].dropna().unique()] if hole_col in collar.columns else []
    if not holes:
        raise NoHoles("No Acquire holes match these filters")
    survey = _keep_survey_priority(fetch_frame(conn, queries.survey(vm, holes)), fm["survey"])
    assay = fetch_frame(conn, queries.assay(vm, holes))
    if fm["assay"]["layout"] in ("long", "long_joined"):
        assay = pivot_long(assay, fm["assay"])
    assay = shape_columns(assay, assay_keep_columns(fm["assay"]), fm["assay"].get("column_rules") or {})
    fmt = fm.get("date_format") or "%Y-%m-%d"
    return {name: normalise_like_csv(frame, fmt)
            for name, frame in (("collar", collar), ("survey", survey), ("assay", assay))}
