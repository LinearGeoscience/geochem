"""The fixed, read-only SELECTs the Acquire (SQL) import runs.

These builders are the only SQL the app sends to Acquire. Every statement is a
single SELECT of a fixed shape; filter values always travel as parameters (?),
never inside the SQL text. There is no free SQL anywhere: not in profiles, the
screen or the API. `connection.fetch_frame` refuses any statement that isn't
built here (`NAMES`) or that fails `assert_select_only`.

Profiles supply names only. Before any data query, `verify_field_map` looks
every table, view and column up in the database's INFORMATION_SCHEMA and
swaps in the catalogue's own spelling; a name that isn't there is refused.
The data builders only accept the resulting `VerifiedMap`. Names are quoted
like SQL Server's QUOTENAME (validation.quote: [name] with ] doubled).

Lists (projects, prospects, a pasted hole list of any length) go in as ONE
'|'-separated parameter split on the server with STRING_SPLIT, so there is no
IN (...) string and no 2100-parameter limit.

Bump QUERY_VERSION when a statement changes; it goes into every pull record.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass

from app.acquire.profiles import LIST_FILTERS
from app.acquire.validation import quote

QUERY_VERSION = "acquire-2"

LIST_SEP = "|"
MAX_LIST_ITEMS = 20000
MAX_ITEM_LENGTH = 100
SAMPLE_ROWS = 5

TABLES = ("collar", "survey", "assay")

# Internal names given to long-layout result columns (constants, not user input)
LONG_ALIASES = {"element": "__element", "value": "__value", "unit": "__unit",
                "priority": "__priority", "bdl": "__bdl"}

# Names of the statements below; connection.fetch_frame runs nothing else
NAMES = frozenset({"whoami", "permissions", "database", "catalog", "object_columns", "sample",
                   "options", "collar", "survey", "assay"})

_FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|"
    r"DENY|INTO|BACKUP|RESTORE|DBCC|OPENROWSET|OPENQUERY|OPENDATASOURCE|SHUTDOWN|KILL|"
    r"RECONFIGURE|BULK|WRITETEXT|UPDATETEXT|SET|DECLARE|USE)\b|\bSP_|\bXP_",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Query:
    name: str
    sql: str
    params: tuple = ()


class MappingError(ValueError):
    """A field map that names something the database doesn't have; message for the screen."""


def _strip_quoted(sql: str) -> str:
    """The SQL with string literals and [quoted identifiers] blanked (for the keyword check)."""
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)
    return re.sub(r"\[(?:[^\]]|\]\])*\]", "[]", sql)


def assert_select_only(sql: str) -> str:
    """Raise unless `sql` is one SELECT (or WITH ... SELECT) with no write keywords
    outside string literals and quoted names."""
    outside = re.sub(r"/\*.*?\*/", " ", _strip_quoted(sql), flags=re.S)
    outside = "\n".join(line.split("--", 1)[0] for line in outside.splitlines()).strip().rstrip(";").strip()
    if ";" in outside:
        raise ValueError("Acquire queries must be a single statement")
    if not re.match(r"^(SELECT|WITH)\b", outside, re.IGNORECASE):
        raise ValueError("Acquire queries must be SELECT statements")
    found = _FORBIDDEN_RE.search(outside)
    if found:
        raise ValueError(f"Acquire queries may not use {found.group(0).upper()}")
    return sql


def joined(values) -> str | None:
    """A list of filter values as one '|'-separated parameter (None = no filter)."""
    items = [str(x) for x in (values or []) if str(x) != ""]
    if not items:
        return None
    if len(items) > MAX_LIST_ITEMS:
        raise ValueError(f"At most {MAX_LIST_ITEMS} values per filter ({len(items)} given)")
    for item in items:
        if LIST_SEP in item:
            raise ValueError(f"Filter values can't contain '{LIST_SEP}': {item[:40]!r}")
        if len(item) > MAX_ITEM_LENGTH:
            raise ValueError(f"Filter value too long: {item[:40]!r}...")
    return LIST_SEP.join(items)


# ------------------------------------------------------- connection / catalogue

def whoami() -> Query:
    return Query("whoami", "SELECT SUSER_SNAME() AS login_name, DB_NAME() AS database_name, "
                           "CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS product_version, "
                           "CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edition, "
                           "IS_ROLEMEMBER('db_owner') AS is_owner, IS_ROLEMEMBER('db_datawriter') AS is_writer")


def permissions() -> Query:
    return Query("permissions", "SELECT permission_name FROM fn_my_permissions(NULL, 'DATABASE')")


def database_exists(database: str) -> Query:
    return Query("database", "SELECT name FROM sys.databases WHERE name = ?", (database,))


def catalog() -> Query:
    """Every table and view with its columns (Detect fields, the object lists)."""
    return Query("catalog",
                 "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.DATA_TYPE "
                 "FROM INFORMATION_SCHEMA.TABLES t JOIN INFORMATION_SCHEMA.COLUMNS c "
                 "ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME "
                 "ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION")


def object_columns(schema: str, name: str) -> Query:
    """One object's columns, with the catalogue's spelling of its schema and name."""
    return Query("object_columns",
                 "SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE "
                 "FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? "
                 "ORDER BY c.ORDINAL_POSITION", (schema, name))


def sample(obj: "CatalogObject") -> Query:
    """The first few rows of a table or view (verified via the catalogue)."""
    return Query("sample", f"SELECT TOP {SAMPLE_ROWS} * FROM {obj.sql}")


# ------------------------------------------------------- verification

@dataclass(frozen=True)
class CatalogObject:
    schema: str
    name: str
    columns: tuple  # catalogue spellings, in order

    @property
    def sql(self) -> str:
        return f"{quote(self.schema)}.{quote(self.name)}"

    def column(self, name: str) -> str:
        """The catalogue's spelling of a column (case-insensitive, as SQL Server usually is)."""
        for c in self.columns:
            if c.lower() == str(name).lower():
                return c
        raise MappingError(f"{self.schema}.{self.name} has no column {name!r}")


@dataclass(frozen=True)
class VerifiedMap:
    """A field map whose every name was found in the database (catalogue spellings)."""
    fm: dict
    objects: dict  # "collar" / "survey" / "assay" / "samples" -> CatalogObject


def verify_field_map(fm: dict, lookup) -> VerifiedMap:
    """Check every name in a complete field map against the database.

    `lookup(schema, name)` returns a CatalogObject or None (connection.lookup_object
    runs object_columns()). Raises MappingError listing everything not found.
    """
    out = copy.deepcopy(fm)
    objects, problems = {}, []
    specs = [("collar", out["collar"]), ("survey", out["survey"]), ("assay", out["assay"])]
    if out["assay"].get("layout") == "long_joined":
        specs.append(("samples", out["assay"]["samples"]))
    for key, spec in specs:
        schema = spec.get("schema") or out.get("schema") or "dbo"
        obj = lookup(schema, spec["object"])
        if obj is None:
            problems.append(f"{key}: no table or view {schema}.{spec['object']}")
            continue
        objects[key] = obj
        spec["schema"], spec["object"] = obj.schema, obj.name

        def fix(col, what):
            if not col:
                return col
            try:
                return obj.column(col)
            except MappingError:
                problems.append(f"{key}: {obj.name} has no column {col!r} ({what})")
                return col

        spec["columns"] = {role: fix(col, role) for role, col in (spec.get("columns") or {}).items()}
        if key == "survey" and spec.get("priority"):
            spec["priority"]["column"] = fix(spec["priority"]["column"], "priority")
        if key == "collar":
            out["filters"] = {k: fix(col, f"{k} filter") for k, col in (out.get("filters") or {}).items()}
        if key == "assay":
            for sub in ("preferred", "bdl"):
                if (spec.get(sub) or {}).get("column"):
                    spec[sub]["column"] = fix(spec[sub]["column"], sub)
        qaqc_home = "samples" if out["assay"].get("layout") == "long_joined" else "assay"
        if key == qaqc_home and (out["assay"].get("qaqc") or {}).get("column"):
            out["assay"]["qaqc"]["column"] = fix(out["assay"]["qaqc"]["column"], "QAQC column")
    if problems:
        raise MappingError("The field map doesn't match the database: " + "; ".join(problems[:8]))
    return VerifiedMap(out, objects)


# ------------------------------------------------------- data statements

def _col(alias: str, name: str) -> str:
    return f"{alias}.{quote(name)}"


def _filter_col(vm: VerifiedMap, key: str) -> str | None:
    col = (vm.fm.get("filters") or {}).get(key)
    return _col("t", col) if col else None


def options(vm: VerifiedMap) -> Query:
    """Each combination of the mapped list filters with its hole count and date ranges."""
    lists = [(k, _filter_col(vm, k)) for k in LIST_FILTERS if _filter_col(vm, k)]
    sel = [f"{c} AS {quote(k)}" for k, c in lists]
    sel.append("COUNT(*) AS [holes]")
    for k in ("drilled", "modified"):
        c = _filter_col(vm, k)
        if c:
            sel += [f"MIN({c}) AS {quote('first_' + k)}", f"MAX({c}) AS {quote('last_' + k)}"]
    sql = f"SELECT {', '.join(sel)} FROM {vm.objects['collar'].sql} t"
    if lists:
        sql += " GROUP BY " + ", ".join(c for _, c in lists)
    return Query("options", sql)


def collar(vm: VerifiedMap, filters) -> Query:
    """The collars matching the filters (`filters` is a frames.Filters).
    Each filter is one parameter; NULL means 'not filtered'. Unmapped filters
    can't be used (frames.filters_from_request refuses them)."""
    hole = _col("t", vm.fm["collar"]["columns"]["hole_id"])
    sep = LIST_SEP
    where = []
    for key, param in (("project", "projects"), ("prospect", "prospects"),
                       ("hole_type", "hole_types"), ("program", "programs")):
        c = _filter_col(vm, key)
        if c:
            where.append(f"(f.{param} IS NULL OR {c} IN (SELECT value FROM STRING_SPLIT(f.{param}, '{sep}')))")
    for key in ("drilled", "modified"):
        c = _filter_col(vm, key)
        if c:
            where.append(f"(f.{key}_from IS NULL OR {c} >= f.{key}_from)")
            where.append(f"(f.{key}_to IS NULL OR {c} < DATEADD(day, 1, f.{key}_to))")
    where.append(f"(f.hole_ids IS NULL OR {hole} IN (SELECT value FROM STRING_SPLIT(f.hole_ids, '{sep}')))")
    sql = (
        "WITH f AS (SELECT CAST(? AS nvarchar(max)) AS projects, CAST(? AS nvarchar(max)) AS prospects, "
        "CAST(? AS nvarchar(max)) AS hole_types, CAST(? AS nvarchar(max)) AS programs, "
        "CAST(? AS date) AS drilled_from, CAST(? AS date) AS drilled_to, "
        "CAST(? AS date) AS modified_from, CAST(? AS date) AS modified_to, "
        "CAST(? AS nvarchar(max)) AS hole_ids) "
        f"SELECT t.* FROM {vm.objects['collar'].sql} t CROSS JOIN f "
        f"WHERE {' AND '.join(where)} ORDER BY {hole}"
    )
    params = (joined(filters.projects), joined(filters.prospects), joined(filters.hole_types),
              joined(filters.programs), filters.drilled_from, filters.drilled_to,
              filters.modified_from, filters.modified_to, joined(filters.hole_ids))
    return Query("collar", sql, params)


def _holes_clause(col_sql: str) -> str:
    return f"{col_sql} IN (SELECT value FROM STRING_SPLIT(CAST(? AS nvarchar(max)), '{LIST_SEP}'))"


def survey(vm: VerifiedMap, hole_ids) -> Query:
    cols = vm.fm["survey"]["columns"]
    hole, depth = _col("t", cols["hole_id"]), _col("t", cols["depth"])
    sql = (f"SELECT t.* FROM {vm.objects['survey'].sql} t WHERE {_holes_clause(hole)} "
           f"ORDER BY {hole}, {depth}")
    return Query("survey", sql, (joined(hole_ids),))


def _qaqc(vm: VerifiedMap, alias: str) -> tuple[str, tuple]:
    q = vm.fm["assay"].get("qaqc") or {}
    if not q.get("column"):
        return "", ()
    c = _col(alias, q["column"])
    return (f" AND ({c} IS NULL OR {c} NOT IN (SELECT value FROM STRING_SPLIT(CAST(? AS nvarchar(max)), "
            f"'{LIST_SEP}')))"), (joined(q["exclude"]),)


def assay(vm: VerifiedMap, hole_ids) -> Query:
    """The assay rows of the holes, in the profile's layout:
    wide        every column of the assay table
    long        hole / from / to (/ sample ID) plus element, value (, unit, priority, flag) under internal names
    long_joined the samples table's hole / from / to / sample ID joined to the results table by sample ID
    QAQC samples are left out when the profile names a QAQC column and values."""
    a = vm.fm["assay"]
    layout, cols = a["layout"], a["columns"]
    extras = {"element": cols.get("element"), "value": cols.get("value"), "unit": cols.get("unit"),
              "priority": (a.get("preferred") or {}).get("column"), "bdl": (a.get("bdl") or {}).get("column")}
    if layout == "wide":
        hole, frm = _col("t", cols["hole_id"]), _col("t", cols["from"])
        qa_sql, qa_params = _qaqc(vm, "t")
        sql = (f"SELECT t.* FROM {vm.objects['assay'].sql} t WHERE {_holes_clause(hole)}{qa_sql} "
               f"ORDER BY {hole}, {frm}")
        return Query("assay", sql, (joined(hole_ids),) + qa_params)
    if layout == "long":
        keep = [cols[r] for r in ("hole_id", "from", "to", "sample_id") if cols.get(r)]
        sel = [_col("t", c) for c in dict.fromkeys(keep)]
        sel += [f"{_col('t', c)} AS {quote(LONG_ALIASES[k])}" for k, c in extras.items() if c]
        hole, frm = _col("t", cols["hole_id"]), _col("t", cols["from"])
        qa_sql, qa_params = _qaqc(vm, "t")
        sql = (f"SELECT {', '.join(sel)} FROM {vm.objects['assay'].sql} t WHERE {_holes_clause(hole)}{qa_sql} "
               f"ORDER BY {hole}, {frm}")
        return Query("assay", sql, (joined(hole_ids),) + qa_params)
    # long_joined
    sc = a["samples"]["columns"]
    sel = [_col("s", sc[r]) for r in ("sample_id", "hole_id", "from", "to")]
    sel += [f"{_col('r', c)} AS {quote(LONG_ALIASES[k])}" for k, c in extras.items() if c]
    hole, frm = _col("s", sc["hole_id"]), _col("s", sc["from"])
    qa_sql, qa_params = _qaqc(vm, "s")
    sql = (f"SELECT {', '.join(sel)} FROM {vm.objects['samples'].sql} s "
           f"JOIN {vm.objects['assay'].sql} r ON {_col('r', cols['sample_id'])} = {_col('s', sc['sample_id'])} "
           f"WHERE {_holes_clause(hole)}{qa_sql} ORDER BY {hole}, {frm}")
    return Query("assay", sql, (joined(hole_ids),) + qa_params)


def process_field_map(fm: dict) -> dict:
    """The column mapping /api/drillhole/process takes: {table: {standard name: column}}."""
    a = fm["assay"]
    src = a["samples"]["columns"] if a["layout"] == "long_joined" else a["columns"]
    return {
        "collar": {k: fm["collar"]["columns"][k] for k in ("hole_id", "easting", "northing", "rl")},
        "survey": {k: fm["survey"]["columns"][k] for k in ("hole_id", "depth", "dip", "azimuth")},
        "assay": {k: src[k] for k in ("hole_id", "from", "to")},
    }
