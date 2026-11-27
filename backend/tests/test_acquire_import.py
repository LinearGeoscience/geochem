"""Data Import > Acquire (SQL): queries, the read-only guard, frames for wide and
long assay layouts, the pull record, the API, and Acquire frames vs the same
data uploaded as CSV files. No database: a fake connection answers from two
made-up company layouts (acquire_helpers)."""
import asyncio
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd
from fastapi import HTTPException

from app.acquire import connection, frames, host, profiles, pull_record, queries
from app.acquire.host import ACQUIRE_ENV
from app.api import acquire as api
from tests import acquire_helpers as h


def lookup_for(tables):
    def lookup(schema, name):
        hit = next((n for n in tables if n.lower() == name.lower()), None)
        return queries.CatalogObject(schema, hit, tuple(tables[hit].columns)) if hit else None
    return lookup


def verified(profile, tables):
    p = profiles.require_complete(profile)
    return queries.verify_field_map(p["field_map"], lookup_for(tables))


class TempProfiles(unittest.TestCase):
    """Each test gets its own profiles folder and no shipped examples (laptop mode)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.examples = Path(self.tmp) / "examples"
        self.examples.mkdir()
        shutil.copy(profiles.TEMPLATE_FILE, self.examples / "_template.json")
        self.patches = [
            mock.patch.dict(os.environ, {ACQUIRE_ENV["profiles_dir"]: str(Path(self.tmp) / "profiles"),
                                         ACQUIRE_ENV["server"]: "", ACQUIRE_ENV["database"]: "",
                                         ACQUIRE_ENV["profile"]: ""}),
            mock.patch.object(profiles, "EXAMPLES_DIR", self.examples),
            mock.patch.object(host, "server_mode", lambda: False),
        ]
        for p in self.patches:
            p.start()
        self.session = host.enter_session("test-acquire")

    def tearDown(self):
        host.leave_session(self.session)
        for p in reversed(self.patches):
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def save(self, profile):
        return profiles.save_profile(profile)


class Queries(unittest.TestCase):
    def setUp(self):
        self.vm = verified(h.wide_profile(), h.wide_company())

    def test_filter_values_are_parameters_never_sql(self):
        f = frames.Filters(projects=["TP", "T'Q"], hole_ids=["X1", "X2"],
                           drilled_from=pd.Timestamp("2026-01-01").date())
        q = queries.collar(self.vm, f)
        self.assertEqual(len(q.params), q.sql.count("?"))
        self.assertEqual(q.params[0], "TP|T'Q")
        self.assertEqual(q.params[8], "X1|X2")
        for value in ("T'Q", "X1", "2026"):
            self.assertNotIn(value, q.sql)
        self.assertIsNone(q.params[2])

    def test_long_hole_list_is_one_parameter(self):
        holes = [f"H{i:05d}" for i in range(5000)]
        q = queries.assay(self.vm, holes)
        self.assertEqual(q.params[0], "|".join(holes))
        self.assertIn("STRING_SPLIT", q.sql)
        self.assertNotIn("H00001", q.sql)
        self.assertEqual(q.sql.count("?"), len(q.params))  # hole list + QAQC values

    def test_every_built_statement_passes_the_select_guard(self):
        f = frames.Filters(projects=["TP"])
        for vm in (self.vm, verified(h.joined_profile(), h.long_company()),
                   verified(h.long_profile(), h.long_company())):
            for q in (queries.options(vm), queries.collar(vm, f), queries.survey(vm, ["A"]), queries.assay(vm, ["A"])):
                self.assertIn(q.name, queries.NAMES)
                queries.assert_select_only(q.sql)
                self.assertEqual(q.sql.count("?"), len(q.params), q.name)
        for q in (queries.whoami(), queries.permissions(), queries.database_exists("X"), queries.catalog(),
                  queries.object_columns("dbo", "X")):
            queries.assert_select_only(q.sql)

    def test_select_guard_refuses_writes(self):
        for sql in ("INSERT INTO t VALUES (1)", "SELECT 1; DROP TABLE t", "UPDATE t SET a = 1",
                    "DELETE FROM t", "EXEC sp_who", "SELECT * INTO x FROM t", "WITH a AS (SELECT 1) DELETE FROM t",
                    "SELECT 1 /* ; */; TRUNCATE TABLE t", "SET NOCOUNT ON", "DECLARE @a int", "xp_cmdshell 'dir'"):
            with self.assertRaises(ValueError, msg=sql):
                queries.assert_select_only(sql)
        # words or ; inside strings and [quoted names] are data, not SQL
        queries.assert_select_only("SELECT 'please update me' AS note")
        queries.assert_select_only("SELECT t.[DELETE;--x]]y] FROM [dbo].[t] t")

    def test_list_values_are_checked(self):
        with self.assertRaises(ValueError):
            queries.joined(["A|B"])
        with self.assertRaises(ValueError):
            queries.joined(["x" * (queries.MAX_ITEM_LENGTH + 1)])
        with self.assertRaises(ValueError):
            queries.joined(["h"] * (queries.MAX_LIST_ITEMS + 1))
        self.assertIsNone(queries.joined([]))

    def test_only_fixed_queries_run(self):
        conn = h.FakeConnection()
        with self.assertRaises(ValueError):
            connection.fetch_frame(conn, queries.Query("free_text", "SELECT 1"))
        with self.assertRaises(ValueError):
            connection.fetch_frame(conn, "SELECT 1")
        with self.assertRaises(ValueError):
            connection.fetch_frame(conn, queries.Query("collar", "DELETE FROM x"))
        self.assertEqual(conn.log, [])

    def test_unmapped_filters_are_left_out_of_the_sql(self):
        vm = verified(h.joined_profile(), h.long_company())
        sql = queries.collar(vm, frames.Filters(projects=["P1"])).sql
        self.assertNotIn("f.prospects IS NULL OR", sql)
        self.assertNotIn("modified_from IS NULL OR", sql)


class Verify(unittest.TestCase):
    def test_names_not_in_the_database_are_refused(self):
        p = h.wide_profile()
        p["field_map"]["collar"]["columns"]["rl"] = "NoSuchColumn"
        p["field_map"]["survey"]["object"] = "NoSuchTable"
        with self.assertRaises(queries.MappingError) as cm:
            verified(p, h.wide_company())
        self.assertIn("NoSuchColumn", str(cm.exception))
        self.assertIn("NoSuchTable", str(cm.exception))

    def test_catalogue_spelling_is_used(self):
        p = h.wide_profile()
        p["field_map"]["collar"]["object"] = "dh_collar"
        p["field_map"]["collar"]["columns"]["hole_id"] = "HOLEID"
        vm = verified(p, h.wide_company())
        self.assertEqual(vm.fm["collar"]["object"], "DH_COLLAR")
        self.assertEqual(vm.fm["collar"]["columns"]["hole_id"], "HoleID")


class Filters(unittest.TestCase):
    def test_request_checks(self):
        with self.assertRaises(ValueError):
            frames.filters_from_request({})
        with self.assertRaises(ValueError):
            frames.filters_from_request({"drilled_from": "2026-02-01", "drilled_to": "2026-01-01"})
        with self.assertRaises(ValueError):
            frames.filters_from_request({"modified_from": "31/01/2026"})
        with self.assertRaises(ValueError):
            frames.filters_from_request({"projects": "TP"})
        f = frames.filters_from_request({"hole_ids": [" A1 ", "A2", "A1", ""], "drilled_to": "2026-01-31"})
        self.assertEqual(f.hole_ids, ["A1", "A2"])

    def test_unmapped_filter_is_refused(self):
        fm = h.joined_profile()["field_map"]
        with self.assertRaisesRegex(ValueError, "prospect"):
            frames.filters_from_request({"prospects": ["X"]}, fm)
        with self.assertRaisesRegex(ValueError, "modified"):
            frames.filters_from_request({"modified_from": "2026-01-01"}, fm)
        frames.filters_from_request({"projects": ["P1"]}, fm)

    def test_record_shortens_long_hole_lists(self):
        rec = frames.Filters(hole_ids=[f"H{i}" for i in range(120)]).as_record()
        self.assertEqual(rec["hole_id_count"], 120)
        self.assertEqual(len(rec["hole_ids"]), 51)


class Frames(unittest.TestCase):
    def test_normalised_frame_matches_read_csv_of_the_same_values(self):
        raw = h.wide_company()["DH_COLLAR"]
        ours = frames.normalise_like_csv(raw, "%Y-%m-%d")
        theirs = pd.read_csv(pd.io.common.BytesIO(h.export_csv(raw, "%Y-%m-%d")))
        h.assert_same_dataset(self, ours, theirs, keys=("holeid",))
        self.assertEqual(ours.loc[0, "DateDrilled"], "2024-04-06")
        self.assertTrue(pd.isna(ours.loc[1, "Comments"]))

    def test_wide_pull_filters_and_leaves_out_qaqc(self):
        conn = h.FakeConnection()
        vm = verified(h.wide_profile(), h.wide_company())
        out = frames.pull_frames(conn, vm, frames.Filters(projects=["TP"]))
        self.assertEqual(sorted(out["collar"]["HoleID"]), ["TDD001", "TDD002", "TRC003"])
        self.assertNotIn("STD1", set(out["assay"]["SampleID"]))
        self.assertNotIn("SampleType", out["assay"].columns)  # column rule
        self.assertEqual(len(out["assay"]), 6)
        self.assertEqual(conn.commits, 0)
        self.assertGreaterEqual(conn.rollbacks, 3)

    def test_date_filters(self):
        vm = verified(h.wide_profile(), h.wide_company())
        out = frames.pull_frames(h.FakeConnection(), vm, frames.Filters(
            drilled_from=pd.Timestamp("2025-01-01").date(), drilled_to=pd.Timestamp("2025-12-31").date()))
        self.assertEqual(list(out["collar"]["HoleID"]), ["TDD002"])

    def test_no_holes(self):
        vm = verified(h.wide_profile(), h.wide_company())
        with self.assertRaises(frames.NoHoles):
            frames.pull_frames(h.FakeConnection(), vm, frames.Filters(projects=["NONE"]))

    def test_joined_long_pull_pivots_with_rules(self):
        vm = verified(h.joined_profile(), h.long_company())
        out = frames.pull_frames(h.FakeConnection(h.long_company()), vm, frames.Filters(projects=["P1"]))
        a = out["assay"].set_index("SampNo")
        self.assertEqual(list(out["assay"].columns), ["BHID", "mFrom", "mTo", "SampNo", "Li2O_pct", "Au_ppm"])
        self.assertEqual(a.loc["A1", "Li2O_pct"], 1.6)       # priority 1 beats priority 2
        self.assertEqual(a.loc["A1", "Au_ppm"], 0.01)        # '<0.02' written as half
        self.assertEqual(a.loc["A2", "Au_ppm"], 0.005)
        self.assertTrue(pd.isna(a.loc["A3", "Au_ppm"]))
        self.assertNotIn("QC1", a.index)                     # QAQC sample left out
        s = out["survey"]
        self.assertEqual(len(s), 3)                          # lowest priority kept per depth
        self.assertEqual(s.loc[(s.BHID == "B1") & (s.SurvDepth == 50), "Inclination"].item(), 61.0)

    def test_single_table_long_pull(self):
        vm = verified(h.long_profile(), h.long_company())
        out = frames.pull_frames(h.FakeConnection(h.long_company()), vm, frames.Filters(projects=["P1"]))
        self.assertEqual(set(out["assay"]["SampNo"]), {"A1", "A2", "A3", "QC1"})  # no QAQC rule here


class PivotRules(unittest.TestCase):
    def setUp(self):
        self.assay = h.long_profile()["field_map"]["assay"]
        self.rows = pd.DataFrame({
            "BHID": ["B1", "B1", "B1"], "mFrom": [0.0, 0.0, 0.0], "mTo": [1.0, 1.0, 1.0], "SampNo": ["A1"] * 3,
            "__element": ["Li2O", "Li2O", "Au"], "__value": [1.5, 1.6, "0.02"], "__unit": ["pct", "pct", None],
            "__priority": [2, 1, 1], "__bdl": [None, None, "<"],
        })

    def test_lowest_highest_first_none(self):
        self.assertEqual(frames.pivot_long(self.rows, self.assay)["Li2O_pct"].item(), 1.6)
        hi = dict(self.assay, preferred={"rule": "highest", "column": "Priority"})
        self.assertEqual(frames.pivot_long(self.rows, hi)["Li2O_pct"].item(), 1.5)
        first = dict(self.assay, preferred={"rule": "first", "column": None})
        self.assertEqual(frames.pivot_long(self.rows, first)["Li2O_pct"].item(), 1.5)
        none = dict(self.assay, preferred={"rule": "none", "column": None})
        with self.assertRaisesRegex(frames.DuplicateResults, "Li2O_pct"):
            frames.pivot_long(self.rows, none)

    def test_units_and_below_detection(self):
        out = frames.pivot_long(self.rows, self.assay)
        self.assertEqual(out["Au"].item(), 0.01)  # no unit -> element name; '<' -> half
        neg = dict(self.assay, bdl={"column": "Flag", "values": ["<"], "write_as": "negative"})
        self.assertEqual(frames.pivot_long(self.rows, neg)["Au"].item(), -0.02)
        as_is = dict(self.assay, bdl={"column": "Flag", "values": ["<"], "write_as": "as_is"})
        self.assertEqual(frames.pivot_long(self.rows, as_is)["Au"].item(), 0.02)


class ColumnRules(unittest.TestCase):
    def test_drop_strip_rename_and_keep(self):
        rules = {"drop_columns": ["Junk"], "drop_suffixes": ["_job"], "strip_suffixes": ["_best"],
                 "rename": {"SGReading": "SG"}}
        df = pd.DataFrame(columns=["Hole", "From", "To", "Junk", "Li_job", "Ag_ppm_best", "SGReading", "Cu_pct"])
        out = frames.shape_columns(df, ["Hole", "From", "To"], rules)
        self.assertEqual(list(out.columns), ["Hole", "From", "To", "Ag_ppm", "SG", "Cu_pct"])
        kept = frames.shape_columns(pd.DataFrame(columns=["Hole", "From", "To"]), ["Hole", "From", "To"],
                                    {"drop_columns": ["Hole"], "rename": {"From": "X"}})
        self.assertEqual(list(kept.columns), ["Hole", "From", "To"])

    def test_two_columns_with_one_name_stop_the_import(self):
        df = pd.DataFrame(columns=["Hole", "From", "To", "Cu_ppm_best", "CU_PPM"])
        with self.assertRaises(frames.ColumnClash):
            frames.shape_columns(df, ["Hole", "From", "To"], {"strip_suffixes": ["_best"]})


class PullRecord(unittest.TestCase):
    def test_counts_checksum_and_profile(self):
        p = profiles.require_complete(h.wide_profile())
        vm = queries.verify_field_map(p["field_map"], lookup_for(h.wide_company()))
        f = frames.Filters(projects=["TP"])
        tables = frames.pull_frames(h.FakeConnection(), vm, f)
        rec = pull_record.build(tables, f, p, vm.fm)
        again = pull_record.build({k: v.copy() for k, v in tables.items()}, f, p, vm.fm)
        self.assertEqual(rec["rows"], {"collar": 3, "survey": 6, "assay": 6})
        self.assertEqual((rec["profile"], rec["server"], rec["database"]),
                         ("Company A", "sql.example.test", "EXAMPLE_DB"))
        self.assertEqual(rec["query_version"], queries.QUERY_VERSION)
        self.assertEqual(len(rec["field_map_sha256"]), 64)
        self.assertEqual(rec["sha256"], again["sha256"])
        changed = {k: v.copy() for k, v in tables.items()}
        changed["assay"].loc[changed["assay"].index[1], "Li2O_pct"] += 1e-9
        self.assertNotEqual(pull_record.frames_sha256(changed), rec["sha256"])


class Api(TempProfiles):
    def setUp(self):
        super().setUp()
        self.save(h.wide_profile())
        self.connect = mock.patch.object(connection, "connect", side_effect=h.fake_connect(h.wide_company()))
        self.connect.start()

    def tearDown(self):
        self.connect.stop()
        super().tearDown()

    def test_profiles_index(self):
        out = asyncio.run(api.list_profiles())
        self.assertFalse(out["server_mode"])
        self.assertTrue(out["editable"])
        self.assertEqual([p["name"] for p in out["profiles"]], ["Company A"])
        self.assertTrue(out["profiles"][0]["complete"])
        self.assertEqual(out["template"]["name"], "New profile")

    def test_health(self):
        self.assertFalse(asyncio.run(api.acquire_health(None))["ok"])
        out = asyncio.run(api.acquire_health("Company A"))
        self.assertTrue(out["ok"], out)

    def test_test_connection_reports_user_version_and_writes(self):
        out = asyncio.run(api.test_connection({"profile": h.wide_profile()}))
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["user"], "DOMAIN\\someone")
        self.assertEqual(out["version"], "16.0.1")
        self.assertFalse(out["can_write"])
        self.assertEqual(out["map_problems"], [])
        with mock.patch.object(connection, "connect", side_effect=h.fake_connect(h.wide_company(), can_write=True)):
            self.assertTrue(asyncio.run(api.test_connection({"profile": h.wide_profile()}))["can_write"])

    def test_test_connection_bad_input_and_missing_database(self):
        bad = dict(h.wide_profile(), server="host;Trusted_Connection=no")
        out = asyncio.run(api.test_connection({"profile": bad}))
        self.assertFalse(out["ok"])
        self.assertIn("can't contain", out["message"])
        nodb = dict(h.wide_profile(), database="OTHER_DB")
        out = asyncio.run(api.test_connection({"profile": nodb}))
        self.assertFalse(out["ok"])
        self.assertIn("no database", out["message"])

    def test_preview_needs_a_profile_and_a_filter(self):
        with self.assertRaises(HTTPException) as cm:
            asyncio.run(api.acquire_preview({"projects": ["TP"]}))
        self.assertEqual(cm.exception.status_code, 400)
        with self.assertRaises(HTTPException) as cm:
            asyncio.run(api.acquire_preview({"profile": "Company A"}))
        self.assertEqual(cm.exception.status_code, 400)

    def test_preview_when_unreachable_is_503(self):
        with mock.patch.object(connection, "connect",
                               side_effect=connection.AcquireUnavailable("Can't reach the SQL Server")), \
                self.assertRaises(HTTPException) as cm:
            asyncio.run(api.acquire_preview({"profile": "Company A", "projects": ["TP"]}))
        self.assertEqual(cm.exception.status_code, 503)

    def test_preview_has_the_drillhole_preview_shape(self):
        out = asyncio.run(api.acquire_preview({"profile": "Company A", "projects": ["TP"]}))
        for table, rows in (("collar", 3), ("survey", 6), ("assay", 6)):
            self.assertEqual(set(out[table]), {"columns", "preview", "required_fields", "total_rows"})
            self.assertEqual(out[table]["total_rows"], rows)
        self.assertTrue(host.has_preview(out["preview_token"]))
        self.assertEqual(out["field_map"]["assay"], {"hole_id": "HoleID", "from": "DepthFrom", "to": "DepthTo"})
        self.assertFalse(out["negate_dip"])
        self.assertEqual(out["pull_record"]["profile"], "Company A")

    def test_no_matching_holes_is_404(self):
        with self.assertRaises(HTTPException) as cm:
            asyncio.run(api.acquire_preview({"profile": "Company A", "projects": ["NONE"]}))
        self.assertEqual(cm.exception.status_code, 404)

    def test_options(self):
        out = asyncio.run(api.acquire_options("Company A"))
        self.assertEqual(sum(c["holes"] for c in out["combos"]), 4)
        self.assertTrue(all(out["mapped"].values()))
        self.assertEqual(out["drilled"], {"min": "2024-04-06", "max": "2026-08-14"})


class SameAsCsvUpload(TempProfiles):
    """Acquire frames through /api/drillhole/process == the same tables uploaded as CSV files."""

    def run_both(self, profile, tables, csvs, request):
        self.save(profile)
        with mock.patch.object(connection, "connect", side_effect=h.fake_connect(tables)):
            pre = asyncio.run(api.acquire_preview(dict(request, profile=profile["name"])))
        via_acquire = h.process(pre["field_map"], preview_token=pre["preview_token"], negate_dip=pre["negate_dip"])
        via_csv = h.process(pre["field_map"], csv_files=csvs, negate_dip=pre["negate_dip"])
        h.assert_same_dataset(self, via_acquire, via_csv)
        again = h.process(pre["field_map"], preview_token=pre["preview_token"], negate_dip=pre["negate_dip"])
        h.assert_same_dataset(self, via_acquire, again)
        return via_acquire

    def test_wide_company(self):
        raw = h.wide_company()
        assay = raw["DH_ASSAY"][raw["DH_ASSAY"].SampleType != "STD"].drop(columns="SampleType")
        csvs = {"collar": h.export_csv(raw["DH_COLLAR"], "%Y-%m-%d"),
                "survey": h.export_csv(raw["DH_SURVEY"], "%Y-%m-%d"), "assay": h.export_csv(assay, "%Y-%m-%d")}
        out = self.run_both(h.wide_profile(), raw, csvs, {"projects": ["TP", "TQ"]})
        self.assertEqual(len(out), 7)

    def test_long_company_joined(self):
        raw = h.long_company()
        survey = raw["Surveys"][raw["Surveys"].Priority == 1]
        assay = pd.DataFrame({"BHID": ["B1", "B1", "B2"], "mFrom": [0.0, 1.0, 0.0], "mTo": [1.0, 2.0, 1.0],
                              "SampNo": ["A1", "A2", "A3"], "Li2O_pct": [1.6, 0.8, 2.2],
                              "Au_ppm": [0.01, 0.005, None]})
        csvs = {"collar": h.export_csv(raw["Collars"], "%Y-%m-%d"), "survey": h.export_csv(survey, "%Y-%m-%d"),
                "assay": h.export_csv(assay, "%Y-%m-%d")}
        out = self.run_both(h.joined_profile(), raw, csvs, {"projects": ["P1"]})
        self.assertEqual(len(out), 3)
        self.assertLess(out["Z"].max(), 310.0)  # positive-down dips were negated: holes go down


if __name__ == "__main__":
    unittest.main()
