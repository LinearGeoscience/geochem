"""Drill tracking's Acquire pull (POST /api/drilltracking/acquire): collars and
surveys only, through the Acquire import's profiles, verified field map, fixed
SELECTs and pull record. No database: the Acquire tests' fake connection and
made-up company (acquire_helpers)."""
import asyncio

import datetime as dt
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app.acquire import connection, host, profiles
from app.acquire.host import ACQUIRE_ENV
from app.api import drilltracking as api
from tests import acquire_helpers as h


class DrillTrackingAcquire(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        examples = Path(self.tmp) / "examples"
        examples.mkdir()
        shutil.copy(profiles.TEMPLATE_FILE, examples / "_template.json")
        self.patches = [
            mock.patch.dict(os.environ, {ACQUIRE_ENV["profiles_dir"]: str(Path(self.tmp) / "profiles"),
                                         ACQUIRE_ENV["server"]: "", ACQUIRE_ENV["database"]: "",
                                         ACQUIRE_ENV["profile"]: ""}),
            mock.patch.object(profiles, "EXAMPLES_DIR", examples),
            mock.patch.object(host, "server_mode", lambda: False),
            mock.patch.object(connection, "connect", side_effect=h.fake_connect(h.wide_company())),
        ]
        for p in self.patches:
            p.start()
        self.session = host.enter_session("test-drilltracking")
        profiles.save_profile(h.wide_profile())

    def tearDown(self):
        host.leave_session(self.session)
        for p in reversed(self.patches):
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pull(self, body):
        return asyncio.run(api.acquire_live(body))

    def test_collars_and_surveys_of_the_filtered_holes_with_every_column(self):
        out = self.pull({"profile": "Company A", "drilled_from": "2025-01-01"})
        collar, survey = out["collar"], out["survey"]
        hole = collar["columns"].index("HoleID")
        self.assertEqual(sorted(r[hole] for r in collar["rows"]), ["TDD002", "TDD004"])
        # Every column of the collar table comes back (status, dates, comments ... for the page to find)
        self.assertIn("Comments", collar["columns"])
        self.assertIn("DateDrilled", collar["columns"])
        sh = survey["columns"].index("HoleID")
        self.assertEqual(sorted({r[sh] for r in survey["rows"]}), ["TDD002", "TDD004"])
        self.assertEqual(out["columns"]["collar"], {"hole_id": "HoleID", "easting": "Easting", "northing": "Northing", "rl": "Elevation"})
        self.assertEqual(out["columns"]["survey"], {"hole_id": "HoleID", "depth": "Depth", "dip": "Dip", "azimuth": "Azimuth"})
        self.assertTrue(out["mapped_filters"]["drilled"])
        # Text as a CSV would hold it: blanks for none, dates as the profile's date format
        dd = collar["columns"].index("DateDrilled")
        self.assertIn("2025-01-02", [r[dd] for r in collar["rows"]])
        self.assertTrue(all(isinstance(v, str) for r in collar["rows"] for v in r))

    def test_reads_no_assays(self):
        seen = []
        real = connection.fetch_frame

        def spy(conn, query):
            seen.append(query.name)
            return real(conn, query)
        with mock.patch.object(connection, "fetch_frame", side_effect=spy):
            self.pull({"profile": "Company A", "hole_ids": ["TDD001"]})
        self.assertIn("collar", seen)
        self.assertIn("survey", seen)
        self.assertNotIn("assay", seen)

    def test_pull_record(self):
        rec = self.pull({"profile": "Company A", "hole_ids": ["TDD001", "TRC003"]})["pull_record"]
        self.assertEqual(rec["source"], "Acquire")
        self.assertEqual(rec["profile"], "Company A")
        self.assertEqual(rec["holes"], 2)
        self.assertEqual(rec["rows"]["assay"], 0)
        self.assertEqual(rec["rows"]["survey"], 5)
        self.assertEqual(rec["purpose"], "drill tracking (collars and surveys)")
        self.assertEqual(len(rec["sha256"]), 64)

    def test_positive_down_dips_come_back_negative(self):
        p = h.wide_profile("Positive")
        p["field_map"]["dip"] = "positive_down"
        tables = h.wide_company()
        tables["DH_SURVEY"] = tables["DH_SURVEY"].assign(Dip=-tables["DH_SURVEY"]["Dip"])
        profiles.save_profile(p)
        with mock.patch.object(connection, "connect", side_effect=h.fake_connect(tables)):
            out = self.pull({"profile": "Positive", "hole_ids": ["TDD001"]})
        dip = out["survey"]["columns"].index("Dip")
        self.assertTrue(all(float(r[dip]) < 0 for r in out["survey"]["rows"]))

    def test_refusals(self):
        with self.assertRaises(HTTPException) as e:
            self.pull({"profile": "Company A"})
        self.assertEqual(e.exception.status_code, 400)  # no filter
        with self.assertRaises(HTTPException) as e:
            self.pull({"profile": "Company A", "hole_ids": ["NOPE"]})
        self.assertEqual(e.exception.status_code, 404)  # no holes
        with self.assertRaises(HTTPException) as e:
            self.pull({"hole_ids": ["TDD001"]})
        self.assertEqual(e.exception.status_code, 400)  # no profile on a laptop
        with self.assertRaises(HTTPException) as e:
            self.pull({"profile": "Nobody", "hole_ids": ["TDD001"]})
        self.assertEqual(e.exception.status_code, 400)  # no such profile (an incomplete one can't be saved)

    def test_server_mode_uses_the_admin_profile(self):
        admin = Path(self.tmp) / "admin.json"
        profiles._write(admin, profiles.normalise(h.wide_profile("Admin")))
        with mock.patch.object(host, "server_mode", lambda: True), \
                mock.patch.dict(os.environ, {ACQUIRE_ENV["profile"]: str(admin)}):
            out = self.pull({"profile": "Company A", "hole_ids": ["TDD001"]})
        self.assertEqual(out["profile"], "Admin")
        self.assertEqual(out["pull_record"]["profile"], "Admin")

    def test_date_filter_is_checked(self):
        with self.assertRaises(HTTPException) as e:
            self.pull({"profile": "Company A", "drilled_from": "2026-02-01", "drilled_to": "2026-01-01"})
        self.assertEqual(e.exception.status_code, 400)
        self.assertIsInstance(dt.date.fromisoformat("2026-01-01"), dt.date)


if __name__ == "__main__":
    unittest.main()
