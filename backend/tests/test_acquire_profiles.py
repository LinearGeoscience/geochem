"""Acquire connection profiles: server / database input checks, identifier quoting,
profile storage and seeding, the template, server mode (read-only), and Detect
fields on two made-up company layouts (one wide-assay, one long-assay)."""
import asyncio
import json
import os
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd
from fastapi import HTTPException

from app.acquire import connection, detect, host, profiles, queries
from app.acquire.host import ACQUIRE_ENV
from app.acquire import validation as v
from app.api import acquire as api
from tests import acquire_helpers as h
from tests.test_acquire_import import TempProfiles, lookup_for


class ServerAndDatabase(unittest.TestCase):
    def test_good_servers(self):
        for s in ("sqlserver", "sql.example.com", "10.0.0.5", "sql-01_a", "sqlserver\\INSTANCE",
                  "sql.example.com,1433", "sqlserver\\SQL2019,14330"):
            self.assertEqual(v.check_server(s), s)

    def test_bad_servers(self):
        for s in ("", "host;Trusted_Connection=no", "host}", "{host", "host=1", "ho st", "\"host\"", "host'",
                  "host\t", "host,99999", "host,0", "-host", "host\\", "host\\IN ST", "host;DATABASE=master",
                  "host\nx", "a" * 300):
            with self.assertRaises(v.InputError, msg=repr(s)):
                v.check_server(s)

    def test_databases(self):
        for d in ("EXAMPLE_DB", "Acquire-Prod", "db.2026", "a" * 128):
            self.assertEqual(v.check_database(d), d)
        for d in ("", "db;DROP", "db}", "{db", "db=1", "my db", "'db'", '"db"', "a" * 129):
            with self.assertRaises(v.InputError, msg=repr(d)):
                v.check_database(d)

    def test_connection_string_braces_every_value(self):
        cs = {"server": "sql.example.test", "database": "EX}AMPLE", "driver": "ODBC Driver 18 for SQL Server",
              "encrypt": True, "trust_server_certificate": True}
        s = connection.connection_string(cs)
        self.assertIn("SERVER={sql.example.test};", s)
        self.assertIn("DATABASE={EX}}AMPLE};", s)
        self.assertIn("Trusted_Connection=yes;", s)
        self.assertIn("ApplicationIntent=ReadOnly;", s)
        self.assertNotIn("PWD", s.upper())
        self.assertEqual(v.braced("a}b}"), "{a}}b}}}")

    def test_typed_values_are_checked_before_connecting(self):
        with self.assertRaises(connection.AcquireUnavailable):
            connection.connection_settings({"server": "host;Trusted_Connection=no", "database": "db"})
        with self.assertRaises(connection.AcquireUnavailable):
            connection.connection_settings({"server": "host", "database": "db;DROP"})


class Identifiers(unittest.TestCase):
    def test_quote_doubles_closing_brackets(self):
        self.assertEqual(v.quote("Assay]s"), "[Assay]]s]")
        self.assertEqual(v.quote("a]];b"), "[a]]]];b]")
        self.assertEqual(v.quote("plain"), "[plain]")
        for bad in ("", "x" * 129, "a\x00b", None):
            with self.assertRaises(v.InputError):
                v.quote(bad)

    def test_odd_names_are_quoted_in_queries_and_pass_the_guard(self):
        tables = h.wide_company()
        tables["DH]COLLAR"] = tables.pop("DH_COLLAR").rename(columns={"Project": "Proj;DROP]x"})
        p = h.wide_profile()
        p["field_map"]["collar"]["object"] = "DH]COLLAR"
        p["field_map"]["filters"]["project"] = "Proj;DROP]x"
        vm = queries.verify_field_map(profiles.require_complete(p)["field_map"], lookup_for(tables))
        from app.acquire import frames
        q = queries.collar(vm, frames.Filters(projects=["TP"]))
        self.assertIn("[dbo].[DH]]COLLAR]", q.sql)
        self.assertIn("t.[Proj;DROP]]x]", q.sql)
        queries.assert_select_only(q.sql)
        out = frames.pull_frames(h.FakeConnection(tables), vm, frames.Filters(projects=["TP"]))
        self.assertEqual(len(out["collar"]), 3)

    def test_names_not_in_the_schema_are_refused(self):
        p = h.wide_profile()
        p["field_map"]["assay"]["object"] = "DH_ASSAY]; DROP TABLE x; --"
        with self.assertRaises(queries.MappingError):
            queries.verify_field_map(profiles.require_complete(p)["field_map"], lookup_for(h.wide_company()))


class Profiles(TempProfiles):
    def test_round_trip(self):
        saved = profiles.save_profile(h.wide_profile())
        loaded = profiles.load_profile("company a")
        self.assertEqual(loaded["field_map"], saved["field_map"])
        self.assertEqual((loaded["server"], loaded["database"]), ("sql.example.test", "EXAMPLE_DB"))
        self.assertEqual(loaded["driver"], "ODBC Driver 18 for SQL Server")
        self.assertTrue(loaded["encrypt"])
        files = list((Path(self.tmp) / "profiles").glob("*.json"))
        self.assertEqual([f.name for f in files], ["Company A.json"])
        self.assertNotIn("password", files[0].read_text(encoding="utf-8").lower())

    def test_create_rename_delete(self):
        profiles.create_profile(h.wide_profile())
        with self.assertRaises(profiles.ProfileError):
            profiles.create_profile(h.wide_profile())
        profiles.save_profile(h.wide_profile("Company A2"), old_name="Company A")
        self.assertEqual([p["name"] for p in profiles.list_profiles()], ["Company A2"])
        profiles.save_profile(h.joined_profile())
        with self.assertRaises(profiles.ProfileError):  # renaming onto another profile
            profiles.save_profile(h.wide_profile("Company B"), old_name="Company A2")
        profiles.delete_profile("company a2")
        self.assertEqual([p["name"] for p in profiles.list_profiles()], ["Company B"])
        with self.assertRaises(profiles.ProfileError):
            profiles.delete_profile("Company A2")

    def test_bad_names_and_incomplete_maps_are_refused(self):
        for name in ("", "../evil", "a/b", "a\\b", "con", "LPT1", ".hidden", "x" * 61, "name.", "semi;colon"):
            with self.assertRaises(profiles.ProfileError, msg=name):
                profiles.save_profile(dict(h.wide_profile(), name=name))
        p = h.wide_profile()
        del p["field_map"]["survey"]["columns"]["dip"]
        with self.assertRaisesRegex(profiles.ProfileError, "dip"):
            profiles.save_profile(p)
        with self.assertRaisesRegex(profiles.ProfileError, "can't contain"):
            profiles.save_profile(dict(h.wide_profile(), server="host;Trusted_Connection=no"))

    def test_seeding_copies_examples_into_an_empty_folder(self):
        example = dict(h.wide_profile("Shipped example"), server="", database="")
        (self.examples / "example.json").write_text(json.dumps(example), encoding="utf-8")
        with mock.patch.dict(os.environ, {ACQUIRE_ENV["server"]: "sql.local.test",
                                          ACQUIRE_ENV["database"]: "LOCAL_DB"}):
            names = [p["name"] for p in profiles.list_profiles()]
        self.assertEqual(names, ["Shipped example"])  # _template.json isn't seeded
        p = profiles.load_profile("Shipped example")
        self.assertEqual((p["server"], p["database"]), ("sql.local.test", "LOCAL_DB"))
        profiles.delete_profile("Shipped example")
        profiles.save_profile(h.wide_profile())
        self.assertEqual([p["name"] for p in profiles.list_profiles()], ["Company A"])  # not re-seeded

    def test_template(self):
        t = profiles.template()
        self.assertEqual(t["name"], "New profile")
        self.assertEqual((t["server"], t["database"]), ("", ""))
        problems = profiles.field_map_problems(t["field_map"])
        self.assertTrue(any("collar" in p for p in problems))
        raw = json.loads(profiles.TEMPLATE_FILE.read_text(encoding="utf-8"))
        self.assertIn("notes", raw)
        for key in ("collar", "survey", "assay", "filters"):
            self.assertIn(key, raw["field_map"])
        self.assertEqual(set(raw["field_map"]["filters"]), set(profiles.FILTER_KEYS))
        text = profiles.TEMPLATE_FILE.read_text(encoding="utf-8").lower()
        self.assertNotIn("select ", text)  # names only, no SQL

    def test_api_round_trip(self):
        asyncio.run(api.put_profile("Company A", {"profile": h.wide_profile(), "create": True}))
        out = asyncio.run(api.get_profile("Company A"))
        self.assertEqual(out["field_map"]["assay"]["layout"], "wide")
        with self.assertRaises(HTTPException) as cm:
            asyncio.run(api.put_profile("Company A", {"profile": h.wide_profile(), "create": True}))
        self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(api.delete_profile("Company A"))
        self.assertEqual(asyncio.run(api.list_profiles())["profiles"], [])


class ServerMode(TempProfiles):
    def setUp(self):
        super().setUp()
        admin = Path(self.tmp) / "admin.json"
        admin.write_text(json.dumps(dict(h.wide_profile("Site Acquire"), server="", database="")), encoding="utf-8")
        self.env = mock.patch.dict(os.environ, {ACQUIRE_ENV["profile"]: str(admin),
                                                ACQUIRE_ENV["server"]: "sql.site.test",
                                                ACQUIRE_ENV["database"]: "EXAMPLE_DB"})
        self.env.start()
        self.mode = mock.patch.object(host, "server_mode", lambda: True)
        self.mode.start()

    def tearDown(self):
        self.mode.stop()
        self.env.stop()
        super().tearDown()

    def test_editing_routes_are_refused(self):
        calls = [lambda: api.put_profile("X", {"profile": h.wide_profile("X")}),
                 lambda: api.delete_profile("Site Acquire"),
                 lambda: api.detect_fields({"profile": h.wide_profile()}),
                 lambda: api.list_objects({"profile": h.wide_profile()}),
                 lambda: api.sample_rows({"profile": h.wide_profile(), "object": "DH_COLLAR"})]
        for call in calls:
            with self.assertRaises(HTTPException) as cm:
                asyncio.run(call())
            self.assertEqual(cm.exception.status_code, 403)
            self.assertIn("server mode", cm.exception.detail)

    def test_admin_profile_is_listed_read_only(self):
        out = asyncio.run(api.list_profiles())
        self.assertTrue(out["server_mode"])
        self.assertFalse(out["editable"])
        self.assertEqual(out["profiles"], [])
        self.assertEqual(out["admin"], {"name": "Site Acquire", "server": "sql.site.test",
                                        "database": "EXAMPLE_DB", "complete": True})

    def test_typed_server_is_never_used(self):
        seen = []
        fake = h.fake_connect(h.wide_company())

        def connect(cs):
            seen.append(cs["server"])
            return fake(cs)
        with mock.patch.object(connection, "connect", side_effect=connect):
            out = asyncio.run(api.test_connection({"profile": dict(h.wide_profile(), server="typed.example.test")}))
            pre = asyncio.run(api.acquire_preview({"profile": "anything", "projects": ["TP"]}))
        self.assertTrue(out["ok"], out)
        self.assertEqual(set(seen), {"sql.site.test"})
        self.assertEqual(pre["pull_record"]["profile"], "Site Acquire")

    def test_missing_admin_profile_is_explained(self):
        with mock.patch.dict(os.environ, {ACQUIRE_ENV["profile"]: ""}):
            out = asyncio.run(api.list_profiles())
        self.assertIn(ACQUIRE_ENV["profile"], out["admin_error"])


class Detect(unittest.TestCase):
    """Two made-up companies plus distractor tables."""

    def distractors(self):
        return {
            "AuditLog": pd.DataFrame({"HoleID": ["x"], "ChangedBy": ["y"], "LastModified": [pd.Timestamp(0)]}),
            "Lithology": pd.DataFrame({"HoleID": ["x"], "DepthFrom": [0.0], "DepthTo": [1.0], "Lith": ["G"]}),
            "Users": pd.DataFrame({"Name": ["n"], "Email": ["e"]}),
        }

    def test_wide_company(self):
        tables = {**h.wide_company(), **self.distractors()}
        r = detect.detect(h.catalog_frame(tables))
        fm = r["field_map"]
        self.assertEqual(fm["collar"]["object"], "DH_COLLAR")
        self.assertEqual(fm["collar"]["columns"], {"hole_id": "HoleID", "easting": "Easting",
                                                   "northing": "Northing", "rl": "Elevation"})
        self.assertEqual(fm["survey"]["object"], "DH_SURVEY")
        self.assertEqual(fm["survey"]["columns"], {"hole_id": "HoleID", "depth": "Depth", "dip": "Dip",
                                                   "azimuth": "Azimuth"})
        self.assertEqual(fm["assay"]["layout"], "wide")
        self.assertEqual(fm["assay"]["object"], "DH_ASSAY")
        self.assertEqual(fm["assay"]["columns"], {"hole_id": "HoleID", "from": "DepthFrom", "to": "DepthTo"})
        self.assertEqual(fm["filters"], {"project": "Project", "prospect": "Prospect", "hole_type": "HoleType",
                                         "program": "Programme", "drilled": "DateDrilled",
                                         "modified": "LastModified"})
        self.assertEqual(profiles.field_map_problems(fm), [])
        self.assertTrue(all(0 < c <= 100 for c in r["confidence"].values()))
        self.assertTrue(any("SampleType" in x for x in r["hints"]))  # QAQC column pointed out

    def test_long_company(self):
        tables = {k: t for k, t in h.long_company().items() if k != "AssayLong"}
        r = detect.detect(h.catalog_frame({**tables, **self.distractors()}))
        fm = r["field_map"]
        self.assertEqual(fm["collar"]["object"], "Collars")
        self.assertEqual(fm["collar"]["columns"], {"hole_id": "BHID", "easting": "Collar_E",
                                                   "northing": "Collar_N", "rl": "Collar_RL"})
        self.assertEqual(fm["survey"]["columns"], {"hole_id": "BHID", "depth": "SurvDepth", "dip": "Inclination",
                                                   "azimuth": "Azi"})
        self.assertEqual(fm["survey"]["priority"], {"column": "Priority", "keep": "lowest"})
        a = fm["assay"]
        self.assertEqual(a["layout"], "long_joined")
        self.assertEqual((a["object"], a["samples"]["object"]), ("Results", "Samples"))
        self.assertEqual(a["columns"], {"sample_id": "SampNo", "element": "Analyte", "value": "Value",
                                        "unit": "Units"})
        self.assertEqual(a["samples"]["columns"], {"sample_id": "SampNo", "hole_id": "BHID", "from": "mFrom",
                                                   "to": "mTo"})
        self.assertEqual(a["preferred"], {"rule": "lowest", "column": "Priority"})
        self.assertEqual(fm["filters"]["project"], "ProjectCode")
        self.assertEqual(fm["filters"]["drilled"], "StartDate")
        self.assertIsNone(fm["filters"]["prospect"])
        self.assertEqual(profiles.field_map_problems(fm), [])

    def test_samples_refine_dips_and_blank_coordinates(self):
        tables = h.long_company()
        tables["Collars"]["Easting"] = [None, None]  # a blank look-alike column first in line
        tables["Collars"] = tables["Collars"][["BHID", "Easting", "Collar_E", "Collar_N", "Collar_RL",
                                               "ProjectCode", "StartDate"]]
        r = detect.detect(h.catalog_frame(tables))
        self.assertEqual(r["field_map"]["collar"]["columns"]["easting"], "Easting")
        detect.refine_with_samples(r, {"collar": tables["Collars"], "survey": tables["Surveys"]})
        self.assertEqual(r["field_map"]["collar"]["columns"]["easting"], "Collar_E")
        self.assertEqual(r["field_map"]["dip"], "positive_down")

    def test_detect_route_with_a_fake_database(self):
        with mock.patch.object(host, "server_mode", lambda: False), \
                mock.patch.object(connection, "connect", side_effect=h.fake_connect(h.wide_company())):
            out = asyncio.run(api.detect_fields({"profile": {"name": "New", "server": "sql.example.test",
                                                             "database": "EXAMPLE_DB"}}))
        self.assertEqual(out["incomplete"], [])
        self.assertEqual(set(out["samples"]), {"collar", "survey", "assay"})
        self.assertLessEqual(len(out["samples"]["assay"]["rows"]), 5)
        self.assertEqual(sorted(o["name"] for o in out["objects"]), ["DH_ASSAY", "DH_COLLAR", "DH_SURVEY"])


if __name__ == "__main__":
    unittest.main()
