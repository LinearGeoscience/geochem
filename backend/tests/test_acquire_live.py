"""Acquire (SQL) import against a real Acquire database. Both classes SKIP
unless set up, so the normal test run needs no database:

- Live: needs the Acquire server / database settings (ACQUIRE_ENV in
  app/acquire/host.py) set and the server reachable. The field map comes from
  the profile file in TEST_PROFILE_ENV, else the first example shipped in
  app/acquire/profiles/; the env server and database override its own.
  Pulls the smallest project + prospect it finds.
- ReferenceExport: also needs REFERENCE_DIR_ENV pointing at a folder
  with collar.csv, survey.csv, assay.csv (a drillhole CSV export from Acquire
  with the same column names as the profile's tables) and holes.txt (one hole
  ID per line). Importing those holes through the Acquire tab must give the
  same dataset as importing the CSVs through the Drillhole tab, once the
  exported assay.csv has the profile's column rules applied.

No server, database or hole names in here: they come from the environment.
Read-only: only the fixed SELECTs in app/acquire/queries.py run.
"""
import asyncio
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

from app.acquire import connection, frames, host, profiles, queries
from app.acquire.host import ACQUIRE_ENV, ACQUIRE_ENV_PREFIX
from app.api import acquire as api
from tests import acquire_helpers as h

_ready = None
# Test-only variables (the app's own are in ACQUIRE_ENV)
TEST_PROFILE_ENV = ACQUIRE_ENV_PREFIX + "TEST_PROFILE"
REFERENCE_DIR_ENV = ACQUIRE_ENV_PREFIX + "REFERENCE_DIR"


def live_profile() -> dict | None:
    path = os.environ.get(TEST_PROFILE_ENV, "").strip()
    if path:
        p = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    else:
        files = [f for f in sorted(profiles.EXAMPLES_DIR.glob("*.json")) if not f.name.startswith("_")]
        if not files:
            return None
        p = json.loads(files[0].read_text(encoding="utf-8-sig"))
    p["server"] = os.environ.get(ACQUIRE_ENV["server"], "").strip() or p.get("server", "")
    p["database"] = os.environ.get(ACQUIRE_ENV["database"], "").strip() or p.get("database", "")
    return profiles.normalise(p)


def acquire_ready():
    global _ready
    if not os.environ.get(ACQUIRE_ENV["server"], "").strip():
        return False, f"{ACQUIRE_ENV['server']} isn't set", None
    p = live_profile()
    if p is None:
        return False, "no profile to test with", None
    if _ready is None:
        t = connection.test(p, p["field_map"])
        _ready = (t["ok"] and not t["map_problems"], t["message"] + " " + "; ".join(t["map_problems"]))
    return _ready[0], _ready[1], p


class LiveBase(unittest.TestCase):
    def setUp(self):
        ok, why, p = acquire_ready()
        if not ok:
            self.skipTest(f"Acquire not available: {why}")
        self.profile = p
        self.tmp = tempfile.mkdtemp()
        self.patches = [mock.patch.dict(os.environ, {ACQUIRE_ENV["profiles_dir"]: self.tmp}),
                        mock.patch.object(host, "server_mode", lambda: False)]
        for x in self.patches:
            x.start()
        profiles.save_profile(p)
        self.token = host.enter_session("test-acquire-live")

    def tearDown(self):
        host.leave_session(self.token)
        for x in reversed(self.patches):
            x.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)


class Live(LiveBase):
    def test_options_preview_and_import(self):
        name = self.profile["name"]
        opts = asyncio.run(api.acquire_options(name))
        combos = [c for c in opts["combos"] if c["project"] and c["prospect"] and 0 < c["holes"] <= 20]
        self.assertTrue(combos, "no small project + prospect to test with")
        pick = min(combos, key=lambda c: c["holes"])
        expected = sum(c["holes"] for c in opts["combos"]
                       if c["project"] == pick["project"] and c["prospect"] == pick["prospect"])

        pre = asyncio.run(api.acquire_preview({"profile": name, "projects": [pick["project"]],
                                               "prospects": [pick["prospect"]]}))
        self.assertEqual(pre["holes"], expected)
        self.assertEqual(pre["collar"]["total_rows"], expected)
        rec = pre["pull_record"]
        self.assertEqual(rec["query_version"], queries.QUERY_VERSION)
        self.assertEqual(rec["profile"], name)
        self.assertEqual(len(rec["sha256"]), 64)
        for table, fields in pre["field_map"].items():
            names = {c["name"] for c in pre[table]["columns"]}
            self.assertTrue(set(fields.values()) <= names, table)

        if pre["survey"]["total_rows"] and pre["assay"]["total_rows"]:
            df = h.process(pre["field_map"], preview_token=pre["preview_token"], negate_dip=pre["negate_dip"])
            self.assertGreater(len(df), 0)
            self.assertTrue(np.isfinite(df["X"].to_numpy(float)).any())


class ReferenceExport(LiveBase):
    def setUp(self):
        ref = os.environ.get(REFERENCE_DIR_ENV, "").strip()
        names = ("collar.csv", "survey.csv", "assay.csv", "holes.txt")
        if not ref or not all((Path(ref) / n).is_file() for n in names):
            self.skipTest(f"{REFERENCE_DIR_ENV} with collar.csv, survey.csv, assay.csv, holes.txt not set")
        super().setUp()
        self.ref = Path(ref)

    def test_acquire_import_equals_csv_export_import(self):
        holes = [line.strip() for line in (self.ref / "holes.txt").read_text(encoding="utf-8-sig").splitlines()
                 if line.strip()]
        pre = asyncio.run(api.acquire_preview({"profile": self.profile["name"], "hole_ids": holes}))
        via_acquire = h.process(pre["field_map"], preview_token=pre["preview_token"], negate_dip=pre["negate_dip"])
        csvs = {t: (self.ref / f"{t}.csv").read_bytes() for t in queries.TABLES}
        # Give the exported assay.csv the profile's column rules, as the import does
        a = self.profile["field_map"]["assay"]
        assay = frames.shape_columns(pd.read_csv(io.BytesIO(csvs["assay"])), frames.assay_keep_columns(a),
                                     a.get("column_rules") or {})
        csvs["assay"] = assay.to_csv(index=False).encode("utf-8")
        via_csv = h.process(pre["field_map"], csv_files=csvs, negate_dip=pre["negate_dip"])
        h.assert_same_dataset(self, via_acquire, via_csv)


if __name__ == "__main__":
    unittest.main()
