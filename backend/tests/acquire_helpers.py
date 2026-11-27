"""Shared bits for the Acquire import tests: two made-up "company" databases
(one with wide assays, one with long assays), their profiles, a fake pyodbc
connection that answers the fixed queries from them, and "load both ways and
compare" through the real /api/drillhole/process endpoint.
Made-up companies, holes, coordinates and values only."""
from __future__ import annotations

import asyncio
import copy
import datetime as dt
import io
import json
import re

import numpy as np
import pandas as pd
from fastapi import UploadFile

_Q = r"\[((?:[^\]]|\]\])*)\]"  # a [quoted] name, ]] = ]


def _unq(s: str) -> str:
    return s.replace("]]", "]")


# ------------------------------------------------------------------ company A: wide assays

def wide_company() -> dict[str, pd.DataFrame]:
    collar = pd.DataFrame({
        "HoleID": ["TDD001", "TDD002", "TRC003", "TDD004"],
        "Project": ["TP", "TP", "TP", "TQ"],
        "Prospect": ["North", "North", "South", None],
        "HoleType": ["DD", "DD", "RC", "DD"],
        "Programme": [None, "P26", "P26", None],
        "DateDrilled": [dt.datetime(2024, 4, 6), dt.datetime(2025, 1, 2), None, dt.datetime(2026, 8, 14)],
        "LastModified": [dt.datetime(2026, 1, 1)] * 4,
        "Easting": [500000.125, 500050.0, 500100.5, 500200.0],
        "Northing": [7600000.375, 7600020.0, 7600040.25, 7600060.0],
        "Elevation": [33.943, 35.0, 36.5, 40.0],
        "Comments": ["first, with a comma", "", None, 'quote "x"'],
    })
    survey = pd.DataFrame({
        "HoleID": ["TDD001", "TDD001", "TDD001", "TDD002", "TRC003", "TRC003", "TDD004"],
        "Depth": [0.0, 10.0, 30.0, 0.0, 0.0, 20.0, 0.0],
        "Dip": [-35.41, -35.05, -34.0, -60.0, -90.0, -88.0, -55.0],
        "Azimuth": [270.08, 270.17, 271.0, 90.0, 0.0, 2.5, 45.0],
    })
    assay = pd.DataFrame({
        "HoleID": ["TDD001", "TDD001", "TDD001", "TDD001", "TDD002", "TRC003", "TRC003", "TDD004"],
        "SampleID": ["S1", "S2", "S3", "STD1", "S4", "S5", "S6", "S7"],
        "DepthFrom": [0.0, 0.5, 1.13, 1.86, 0.0, 0.0, 1.0, 0.0],
        "DepthTo": [0.5, 1.13, 1.86, 1.86, 1.0, 1.0, 2.0, 1.0],
        "SampleType": ["NS", "Core", "Core", "STD", "Core", "Chips", "Chips", "Core"],
        "Li2O_pct": [None, 1.234567890123, 0.019054, 2.5, 3.42327, None, 0.000054, 2.0],
        "Au_ppm": [None, 0.25, 0.5, 9.9, 1.5, None, None, None],
        "Cu_pct": [None, 0.01, 0.02, 0.5, None, 0.03, 0.04, None],
        "Te_ppm": [None] * 8,  # an analyte with no results at all
    })
    return {"DH_COLLAR": collar, "DH_SURVEY": survey, "DH_ASSAY": assay}


def wide_profile(name: str = "Company A") -> dict:
    return {
        "name": name, "server": "sql.example.test", "database": "EXAMPLE_DB",
        "field_map": {
            "schema": "dbo", "date_format": "%Y-%m-%d", "dip": "negative_down",
            "collar": {"object": "DH_COLLAR", "columns": {"hole_id": "HoleID", "easting": "Easting",
                                                          "northing": "Northing", "rl": "Elevation"}},
            "survey": {"object": "DH_SURVEY", "columns": {"hole_id": "HoleID", "depth": "Depth", "dip": "Dip",
                                                          "azimuth": "Azimuth"}, "priority": None},
            "assay": {"layout": "wide", "object": "DH_ASSAY",
                      "columns": {"hole_id": "HoleID", "from": "DepthFrom", "to": "DepthTo"},
                      "preferred": {"rule": "none", "column": None}, "bdl": None,
                      "qaqc": {"column": "SampleType", "exclude": ["STD", "BLK"]},
                      "column_rules": {"drop_columns": ["SampleType"]}},
            "filters": {"project": "Project", "prospect": "Prospect", "hole_type": "HoleType",
                        "program": "Programme", "drilled": "DateDrilled", "modified": "LastModified"},
        },
    }


# ------------------------------------------------------------------ company B: long assays

def long_company() -> dict[str, pd.DataFrame]:
    collars = pd.DataFrame({
        "BHID": ["B1", "B2"], "Collar_E": [400000.0, 400100.0], "Collar_N": [6500000.0, 6500100.0],
        "Collar_RL": [300.0, 310.0], "ProjectCode": ["P1", "P1"], "StartDate": [dt.datetime(2025, 5, 1)] * 2,
    })
    surveys = pd.DataFrame({
        "BHID": ["B1", "B1", "B1", "B2"], "SurvDepth": [0.0, 50.0, 50.0, 0.0],
        "Inclination": [60.0, 61.0, 59.0, 90.0],  # positive down
        "Azi": [180.0, 181.0, 179.0, 0.0], "Priority": [1, 1, 2, 1],
    })
    samples = pd.DataFrame({
        "SampNo": ["A1", "A2", "A3", "QC1"], "BHID": ["B1", "B1", "B2", "B2"],
        "mFrom": [0.0, 1.0, 0.0, 1.0], "mTo": [1.0, 2.0, 1.0, 1.0], "QCType": [None, None, None, "BLANK"],
    })
    results = pd.DataFrame({
        "SampNo": ["A1", "A1", "A1", "A2", "A2", "A3", "QC1"],
        "Analyte": ["Li2O", "Li2O", "Au", "Li2O", "Au", "Li2O", "Li2O"],
        "Units": ["pct", "pct", "ppm", "pct", "ppm", "pct", "pct"],
        "Value": [1.5, 1.6, 0.02, 0.8, 0.01, 2.2, 0.0],
        "Priority": [2, 1, 1, 1, 1, 1, 1],
        "Flag": [None, None, "<", None, "<", None, None],
    })
    single = samples.merge(results, on="SampNo").drop(columns="QCType")
    return {"Collars": collars, "Surveys": surveys, "Samples": samples, "Results": results, "AssayLong": single}


def joined_profile(name: str = "Company B") -> dict:
    return {
        "name": name, "server": "sql.example.test", "database": "EXAMPLE_DB",
        "field_map": {
            "schema": "dbo", "date_format": "%Y-%m-%d", "dip": "positive_down",
            "collar": {"object": "Collars", "columns": {"hole_id": "BHID", "easting": "Collar_E",
                                                        "northing": "Collar_N", "rl": "Collar_RL"}},
            "survey": {"object": "Surveys", "columns": {"hole_id": "BHID", "depth": "SurvDepth",
                                                        "dip": "Inclination", "azimuth": "Azi"},
                       "priority": {"column": "Priority", "keep": "lowest"}},
            "assay": {"layout": "long_joined", "object": "Results",
                      "columns": {"sample_id": "SampNo", "element": "Analyte", "value": "Value", "unit": "Units"},
                      "samples": {"object": "Samples", "columns": {"sample_id": "SampNo", "hole_id": "BHID",
                                                                   "from": "mFrom", "to": "mTo"}},
                      "preferred": {"rule": "lowest", "column": "Priority"},
                      "bdl": {"column": "Flag", "values": ["<"], "write_as": "half"},
                      "qaqc": {"column": "QCType", "exclude": ["BLANK", "STD"]}},
            "filters": {"project": "ProjectCode", "drilled": "StartDate"},
        },
    }


def long_profile(name: str = "Company B single") -> dict:
    p = joined_profile(name)
    a = p["field_map"]["assay"]
    a.update(layout="long", object="AssayLong", qaqc=None,
             columns={"hole_id": "BHID", "from": "mFrom", "to": "mTo", "sample_id": "SampNo",
                      "element": "Analyte", "value": "Value", "unit": "Units"})
    a.pop("samples")
    return p


# ------------------------------------------------------------------ fake database

def _sql_type(s: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(s) or s.dropna().map(lambda v: isinstance(v, dt.datetime)).all() \
            and s.notna().any():
        return "datetime"
    if pd.api.types.is_integer_dtype(s):
        return "int"
    if pd.api.types.is_float_dtype(s) or (s.isna().all()):
        return "float"
    return "varchar"


def catalog_frame(tables: dict[str, pd.DataFrame], schema: str = "dbo") -> pd.DataFrame:
    rows = []
    for name, df in tables.items():
        for col in df.columns:
            rows.append((schema, name, "BASE TABLE", col, _sql_type(df[col])))
    return pd.DataFrame(rows, columns=["TABLE_SCHEMA", "TABLE_NAME", "TABLE_TYPE", "COLUMN_NAME", "DATA_TYPE"])


def _records(df: pd.DataFrame):
    return [tuple(None if (v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NaT) else v
                  for v in row) for row in df.astype(object).itertuples(index=False)]


class FakeCursor:
    """Answers the fixed Acquire queries from in-memory tables (a small reading of
    exactly the SQL shapes queries.py builds)."""

    def __init__(self, db: "FakeConnection"):
        self.db, self.description, self._rows = db, None, []

    def _set(self, df: pd.DataFrame):
        self.description = [(c,) for c in df.columns]
        self._rows = _records(df)

    def _table(self, sql: str, alias: str) -> pd.DataFrame:
        m = re.search(rf"\[dbo\]\.{_Q} {alias}\b", sql)
        return self.db.tables[_unq(m.group(1))]

    def execute(self, sql, *params):
        self.db.log.append((sql, params))
        t = self.db.tables
        if "sys.databases" in sql:
            return self._set(pd.DataFrame({"name": [d for d in self.db.databases if d == params[0]]}))
        if "SUSER_SNAME" in sql:
            return self._set(pd.DataFrame([{"login_name": "DOMAIN\\someone", "database_name": "EXAMPLE_DB",
                                            "product_version": "16.0.1", "edition": "Developer",
                                            "is_owner": 0, "is_writer": 1 if self.db.can_write else 0}]))
        if "fn_my_permissions" in sql:
            perms = ["CONNECT", "SELECT"] + (["INSERT", "UPDATE", "DELETE"] if self.db.can_write else [])
            return self._set(pd.DataFrame({"permission_name": perms}))
        if "INFORMATION_SCHEMA.TABLES t JOIN" in sql:
            return self._set(catalog_frame(t))
        if "INFORMATION_SCHEMA.COLUMNS c WHERE" in sql:
            cat = catalog_frame(t)
            hit = cat[(cat.TABLE_SCHEMA.str.lower() == params[0].lower()) & (cat.TABLE_NAME.str.lower() == params[1].lower())]
            return self._set(hit[["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE"]])
        if sql.startswith("SELECT TOP"):
            return self._set(t[_unq(re.search(rf"\.{_Q}$", sql).group(1))].head(5))
        if "COUNT(*) AS [holes]" in sql:
            return self._set(self._options(sql))
        if sql.startswith("WITH f AS"):
            return self._set(self._collar(sql, params))
        return self._set(self._rows_for_holes(sql, params))

    def _options(self, sql):
        df = self._table(sql, "t")
        lists = [(_unq(c), _unq(a)) for c, a in re.findall(rf"t\.{_Q} AS {_Q}", sql)
                 if _unq(a) in ("project", "prospect", "hole_type", "program")]
        dates = [(f, _unq(c), _unq(a)) for f, c, a in re.findall(rf"(MIN|MAX)\(t\.{_Q}\) AS {_Q}", sql)]
        keys = [c for c, _ in lists]
        g = df.groupby(keys, dropna=False) if keys else df.assign(_k=1).groupby("_k")
        out = g.size().rename("holes").reset_index()
        for f, c, a in dates:
            out[a] = (g[c].min() if f == "MIN" else g[c].max()).values
        out = out.rename(columns={c: a for c, a in lists})
        return out.drop(columns=[c for c in ("_k",) if c in out.columns])

    def _collar(self, sql, params):
        df = self._table(sql, "t")
        for col, param, i in ((c, p, ["projects", "prospects", "hole_types", "programs"].index(p))
                              for c, p in re.findall(rf"t\.{_Q} IN \(SELECT value FROM STRING_SPLIT\(f\.(\w+)", sql)
                              if p != "hole_ids"):
            if params[i]:
                df = df[df[_unq(col)].isin(params[i].split("|"))]
        for col, key in re.findall(rf"t\.{_Q} >= f\.(\w+)_from", sql):
            lo = params[4] if key == "drilled" else params[6]
            hi = params[5] if key == "drilled" else params[7]
            vals = pd.to_datetime(df[_unq(col)])
            if lo:
                df = df[vals >= pd.Timestamp(lo)]
                vals = vals[vals >= pd.Timestamp(lo)]
            if hi:
                df = df[vals < pd.Timestamp(hi) + pd.Timedelta(days=1)]
        hole = re.search(rf"t\.{_Q} IN \(SELECT value FROM STRING_SPLIT\(f\.hole_ids", sql)
        if params[8]:
            df = df[df[_unq(hole.group(1))].isin(params[8].split("|"))]
        return df

    def _rows_for_holes(self, sql, params):
        holes = params[0].split("|")
        joined = " JOIN " in sql
        select = sql[len("SELECT "): sql.index(" FROM ")]
        if joined:
            s, r = self._table(sql, "s"), self._table(sql, "r")
            rc, sc = (_unq(x) for x in re.search(rf"ON r\.{_Q} = s\.{_Q}", sql).groups())
            df = s.add_prefix("s.").merge(r.add_prefix("r."), left_on=f"s.{sc}", right_on=f"r.{rc}")
            alias = "s"
        else:
            df = self._table(sql, "t").add_prefix("t.")
            alias = "t"
        hole = _unq(re.search(rf"WHERE {alias}\.{_Q} IN", sql).group(1))
        df = df[df[f"{alias}.{hole}"].astype(str).isin(holes)]
        qc = re.search(rf"AND \({alias}\.{_Q} IS NULL OR", sql)
        if qc:
            col = f"{alias}.{_unq(qc.group(1))}"
            df = df[df[col].isna() | ~df[col].isin(params[1].split("|"))]
        if select == "t.*":
            out = df.rename(columns=lambda c: c[2:])
        else:
            cols = {}
            for a, c, as_ in re.findall(rf"(\w)\.{_Q}(?: AS {_Q})?", select):
                cols[as_ and _unq(as_) or _unq(c)] = df[f"{a}.{_unq(c)}"]
            out = pd.DataFrame(cols)
        return out.reset_index(drop=True)

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class FakeConnection:
    def __init__(self, tables=None, databases=("EXAMPLE_DB",), can_write=False):
        self.tables = tables if tables is not None else wide_company()
        self.databases, self.can_write = list(databases), can_write
        self.log, self.closed, self.rollbacks, self.commits = [], False, 0, 0

    def cursor(self):
        return FakeCursor(self)

    def rollback(self):
        self.rollbacks += 1

    def commit(self):  # pragma: no cover - must never be called
        self.commits += 1
        raise AssertionError("the Acquire import must never commit")

    def close(self):
        self.closed = True


def fake_connect(tables=None, **kw):
    """A stand-in for connection.connect that hands out fresh fake connections."""
    def connect(cs):
        return FakeConnection(copy.deepcopy(tables) if tables is not None else None, **kw)
    return connect


# ------------------------------------------------------------------ load and compare

def export_csv(df: pd.DataFrame, date_format: str) -> bytes:
    """A table written as a CSV export of the same values."""
    return df.to_csv(index=False, date_format=date_format).encode("utf-8")


def _upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name)


def process(field_map: dict, *, preview_token: str | None = None, csv_files: dict | None = None,
            negate_dip: bool = False) -> pd.DataFrame:
    """Run the real /api/drillhole/process and return a copy of the loaded dataset."""
    from app.api.data import data_manager
    from app.api.drillhole import process_with_mapping

    files = {k: _upload(f"{k}.csv", v) for k, v in (csv_files or {}).items()}
    asyncio.run(process_with_mapping(
        collar=files.get("collar"), survey=files.get("survey"), assay=files.get("assay"),
        collar_mapping=json.dumps(field_map["collar"]), survey_mapping=json.dumps(field_map["survey"]),
        assay_mapping=json.dumps(field_map["assay"]), negate_dip="true" if negate_dip else "false",
        preview_token=preview_token))
    return data_manager.df.copy()


def assert_same_dataset(test, a: pd.DataFrame, b: pd.DataFrame, keys=("hole_id", "from")):
    """Same columns, rows and values (text exact, numbers to full precision, X/Y/Z to 1 um)."""
    test.assertEqual(sorted(map(str, a.columns)), sorted(map(str, b.columns)))
    lower = {str(c).lower(): c for c in a.columns}
    sort_cols = [lower[k] for k in keys if k in lower]
    a = a.sort_values(sort_cols).reset_index(drop=True)
    b = b[a.columns].sort_values(sort_cols).reset_index(drop=True)
    test.assertEqual(len(a), len(b))
    for col in a.columns:
        x, y = a[col], b[col]
        if pd.api.types.is_numeric_dtype(x) and pd.api.types.is_numeric_dtype(y):
            tol = 1e-6 if str(col).upper() in ("X", "Y", "Z") else 1e-12
            np.testing.assert_allclose(x.to_numpy(float), y.to_numpy(float), rtol=tol, atol=tol,
                                       equal_nan=True, err_msg=str(col))
        else:
            xs = x.astype(object).where(x.notna(), None).map(lambda v: None if v is None else str(v))
            ys = y.astype(object).where(y.notna(), None).map(lambda v: None if v is None else str(v))
            test.assertEqual(xs.tolist(), ys.tolist(), str(col))
