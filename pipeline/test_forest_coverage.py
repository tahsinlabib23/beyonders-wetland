"""Coverage scan and discovery series-options tests. Catalog records are synthetic fixtures shaped like CMR UMM-G
results; they prove the grouping/verdict logic, not that NASA's live catalog contains any particular scene."""
from __future__ import annotations

import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import forest_workflow as fw
from test_forest_run_integration import Fixture


def record(day: str, track: str = "043", direction: str = "A", frame: str = "034", release: str = "P05023", lon=1.0, lat=2.0, size=0.2) -> dict:
    stamp = day.replace("-", "")
    name = f"NISAR_L2_PR_GCOV_032_{track}_{direction}_{frame}_4005_DHDH_A_{stamp}T000000_{stamp}T000100_{release}_N_F_J_001.h5"
    pts = [(lon, lat), (lon + size, lat), (lon + size, lat + size), (lon, lat + size), (lon, lat)]
    poly = [{"Longitude": x, "Latitude": y} for x, y in pts]
    return {"umm": {"GranuleUR": name, "SpatialExtent": {"HorizontalSpatialDomain": {"Geometry": {"GPolygons": [{"Boundary": {"Points": poly}}]}}}}}


def scan(catalog, **overrides):
    request = {"bbox": [0.9, 1.9, 1.3, 2.3], "startDate": "2026-06-17", "endDate": "2026-10-12", **overrides}
    fake = SimpleNamespace(search_data=lambda **kw: list(catalog))
    with patch.dict(sys.modules, {"earthaccess": fake}):
        return fw.scan_coverage(request)


class ScanTests(unittest.TestCase):
    def test_groups_by_track_and_flags_which_stacks_have_enough_dates(self):
        cat = [record(d) for d in ("2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17")] + \
              [record(d, track="120", frame="050") for d in ("2026-07-01", "2026-07-13")]
        out = scan(cat)
        self.assertEqual(out["status"], "OK")
        self.assertEqual(out["stackCount"], 2)
        self.assertEqual(out["usableStackCount"], 1)
        top = out["stacks"][0]
        self.assertEqual((top["track"], top["count"], top["sufficient"]), ("043", 4, True))
        self.assertEqual(top["longestGapDays"], 24)
        self.assertFalse(out["stacks"][1]["sufficient"])
        self.assertEqual(out["scope"]["catalogHits"], 6)
        self.assertIn("nothing has been downloaded", out["message"])

    def test_stack_footprint_is_clipped_to_the_searched_window(self):
        out = scan([record(d, size=5.0) for d in ("2026-06-30", "2026-07-12", "2026-07-24")])
        w, s, e, n = out["stacks"][0]["bbox"]
        self.assertGreaterEqual(w, 0.9 - 1e-9); self.assertLessEqual(e, 1.3 + 1e-9)
        self.assertGreaterEqual(s, 1.9 - 1e-9); self.assertLessEqual(n, 2.3 + 1e-9)

    def test_empty_catalog_is_reported_without_claiming_anything_beyond_the_window(self):
        out = scan([])
        self.assertEqual(out["status"], "EMPTY")
        self.assertIn("says nothing about other places", out["message"])
        self.assertEqual(out["stacks"], [])

    def test_scenes_without_a_three_date_stack_are_insufficient_not_ready(self):
        out = scan([record("2026-06-30"), record("2026-07-12")])
        self.assertEqual(out["status"], "INSUFFICIENT_OBSERVATIONS")
        self.assertEqual(out["usableStackCount"], 0)

    def test_dates_outside_the_window_are_excluded(self):
        out = scan([record("2026-05-01"), record("2026-06-30"), record("2026-07-12"), record("2026-07-24")])
        self.assertEqual(out["stacks"][0]["count"], 3)

    def test_unparseable_granules_are_counted_not_hidden(self):
        bad = {"umm": {"GranuleUR": "NOT_A_NISAR_NAME.h5"}}
        out = scan([bad, record("2026-06-30"), record("2026-07-12"), record("2026-07-24")])
        self.assertEqual(out["rejectedGranules"], 1)

    def test_hitting_the_catalog_limit_is_flagged_as_possibly_incomplete(self):
        out = scan([record("2026-06-30")] * 2000)
        self.assertTrue(out["scope"]["truncated"])
        self.assertIn("may be incomplete", out["message"])

    def test_oversized_or_invalid_windows_are_refused_instead_of_silently_truncated(self):
        for bad in ([-10, -10, 10, 10], [5, 5, 4, 4], [0, 0, "a", 1], [0, 0, 1]):
            with self.assertRaises(fw.WorkflowError):
                fw.validate_scan_request({"bbox": bad, "startDate": "2026-06-17", "endDate": "2026-10-12"})
        with self.assertRaises(fw.WorkflowError):
            fw.validate_scan_request({"bbox": [0, 0, 1, 1], "startDate": "2026-10-12", "endDate": "2026-06-17"})

    def test_same_date_overlapping_granules_count_once(self):
        out = scan([record("2026-06-30"), record("2026-06-30", lon=1.05), record("2026-07-12"), record("2026-07-24")])
        self.assertEqual(out["stacks"][0]["count"], 3)


class DiscoveryOptionsTests(unittest.TestCase):
    def test_discovery_lists_every_compatible_stack_and_says_which_one_it_used(self):
        main = [record(d) for d in ("2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17")]
        other = [record(d, track="120") for d in ("2026-07-01", "2026-07-13")]
        fake = SimpleNamespace(search_data=lambda **kw: main + other)
        request = {"siteName": "Synthetic AOI", "bbox": [1.0, 2.0, 1.04, 2.04], "startDate": "2026-06-17", "endDate": "2026-10-12"}
        with patch.dict(sys.modules, {"earthaccess": fake}):
            out = fw.search_compatible_series(request)
        self.assertEqual(out["status"], "READY")
        self.assertEqual(len(out["seriesOptions"]), 2)
        self.assertEqual(out["seriesOptions"][0]["id"], out["usedSeriesId"])
        self.assertEqual(out["seriesOptions"][0]["count"], 4)
        self.assertEqual({o["track"] for o in out["seriesOptions"]}, {"043", "120"})
        self.assertTrue(json.dumps(out))  # JSON-serialisable for the job file


class CoverageWorkerTests(unittest.TestCase):
    def test_coverage_job_completes_without_touching_runs_or_the_current_pointer(self):
        fx = Fixture(self)
        fx.fake_earthaccess.search_data = lambda **kw: [record(d) for d in ("2026-06-30", "2026-07-12", "2026-07-24")]
        jobs = fx.output / "jobs"; jobs.mkdir(parents=True)
        job_id = "7" * 32
        (jobs / f"{job_id}_request.json").write_text(json.dumps({"action": "coverage", "request": {"bbox": [0.9, 1.9, 1.3, 2.3], "startDate": "2026-06-17", "endDate": "2026-10-12"}}))
        (jobs / f"{job_id}.json").write_text(json.dumps({"id": job_id, "action": "coverage", "status": "QUEUED"}))
        self.assertEqual(fw.run_worker(job_id), 0)
        job = json.loads((jobs / f"{job_id}.json").read_text())
        self.assertEqual(job["status"], "COMPLETE")
        self.assertEqual(job["result"]["usableStackCount"], 1)
        self.assertFalse((fx.output / "runs").exists())
        self.assertFalse((fx.output / "current_run.json").exists())
        self.assertNotIn("auth", fx.calls)  # a public catalog scan never asks for Earthdata credentials


if __name__ == "__main__":
    unittest.main()
