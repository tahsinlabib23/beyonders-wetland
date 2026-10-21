"""Tests for the isolated forest analysis stage; all synthetic data stays temporary."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine

if __package__:
    from .forest_analysis import analyze_manifest
else:
    from forest_analysis import analyze_manifest


COMPAT = {
    "product": "NISAR_L2_GCOV_PROVISIONAL_V1",
    "product_maturity": "PROVISIONAL",
    "frequency": "frequencyA",
    "polarizations": ["HHHH", "HVHV"],
    "track": "043",
    "direction": "A",
    "frame": "034",
    "bandwidth": "4005",
    "frequency_a_bandwidth": "40",
    "frequency_b_bandwidth": "05",
    "polarization_mode": "DH",
    "paired_polarization_mode": "DH",
    "polarization_mode_code": "DHDH",
    "acquisition": "A",
    "release": "P05023",
}


class ForestAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.profile = {"driver": "GTiff", "height": 24, "width": 24, "count": 1,
                        "dtype": "float32", "crs": "EPSG:32646",
                        "transform": Affine(20, 0, 300000, 0, -20, 2700000), "nodata": np.nan}
        self.mask = np.ones((24, 24), dtype=np.float32)
        self.mask_path = self.write_raster("forest_mask.tif", self.mask)
        self.observations = []
        for idx, day in enumerate(("2026-06-20", "2026-07-02", "2026-07-14", "2026-07-26")):
            hh = np.full((24, 24), -10.0, dtype=np.float32)
            hv = np.full((24, 24), -16.0, dtype=np.float32)
            if idx == 2:
                hh[7:15, 8:16] = -5.0
                hv[7:15, 8:16] = -10.0
            hh_path = self.write_raster(f"hh_{idx}.tif", hh)
            hv_path = self.write_raster(f"hv_{idx}.tif", hv)
            self.observations.append({"date": day, "scene_id": f"NISAR_TEST_{idx}",
                                      "hh_path": hh_path.name, "hv_path": hv_path.name,
                                      "compatibility": dict(COMPAT)})
        self.manifest = {"site": {"name": "Test forest", "forest_mask_path": self.mask_path.name,
                                   "forest_mask_source": "test-only temporary fixture"},
                         "compatibility": dict(COMPAT), "observations": self.observations}
        self.manifest_path = self.root / "manifest.json"
        self.save_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def write_raster(self, name, values):
        path = self.root / name
        with rasterio.open(path, "w", **self.profile) as dst:
            dst.write(values, 1)
        return path

    def save_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_real_series_detects_anomaly_inside_forest_mask(self):
        result = analyze_manifest(self.manifest_path, threshold_db=2.5, minimum_region_pixels=12)
        self.assertEqual(result["readiness"]["status"], "READY")
        self.assertGreater(len(result["candidates"]), 0)
        candidate = next(candidate for candidate in result["candidates"] if candidate["date"] == "2026-07-14")
        self.assertEqual(candidate["assessment"]["state"], "POTENTIAL_STRUCTURAL_DISTURBANCE")
        self.assertEqual(candidate["assessment"]["cause"], "UNKNOWN")
        self.assertEqual(candidate["assessment"]["opticalEvidence"]["status"], "NOT_PROVIDED")
        self.assertIn(candidate["persistence"], ("SINGLE_OBSERVATION", "RECURRING", "PERSISTENT"))

    def test_less_than_three_observations_blocks_analysis(self):
        self.manifest["observations"] = self.manifest["observations"][:2]
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])

    def test_mixed_scene_signature_blocks_analysis(self):
        self.manifest["observations"][1]["compatibility"]["track"] = "999"
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])
        self.assertTrue(any(check["id"] == "compatible_series" and check["status"] == "FAIL" for check in result["readiness"]["checks"]))

    def test_malformed_observation_blocks_without_crashing(self):
        self.manifest["observations"][1] = None
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])

    def test_missing_forest_mask_blocks_analysis(self):
        self.manifest["site"]["forest_mask_path"] = "not-a-real-mask.tif"
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])

    def test_missing_forest_mask_citation_blocks_analysis(self):
        self.manifest["site"]["forest_mask_source"] = "   "
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])
        self.assertTrue(any("forest_mask_source" in check["message"] for check in result["readiness"]["checks"]))

    def test_raster_grid_mismatch_blocks_analysis(self):
        wrong_profile = dict(self.profile)
        wrong_profile["transform"] = Affine(30, 0, 300000, 0, -30, 2700000)
        bad_path = self.root / "bad_grid.tif"
        with rasterio.open(bad_path, "w", **wrong_profile) as dst:
            dst.write(np.full((24, 24), -10, dtype=np.float32), 1)
        self.manifest["observations"][0]["hh_path"] = bad_path.name
        self.save_manifest()
        result = analyze_manifest(self.manifest_path)
        self.assertEqual(result["readiness"]["status"], "BLOCKED")
        self.assertEqual(result["candidates"], [])

    def test_cli_writes_ready_analysis_and_candidate_evidence(self):
        output = self.root / "output" / "forest_analysis.json"
        script = Path(__file__).with_name("forest_analysis.py")
        completed = subprocess.run(
            [sys.executable, str(script), "--test-fixture-mode", "--manifest", str(self.manifest_path), "--output", str(output),
             "--minimum-region-pixels", "12"],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(output.is_file())
        saved = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(saved["readiness"]["status"], "READY")
        self.assertGreater(len(saved["candidates"]), 0)
        self.assertEqual(saved["candidates"][0]["assessment"]["cause"], "UNKNOWN")

    def test_cli_writes_blocked_report_without_fabricating_candidates(self):
        self.manifest["observations"] = self.manifest["observations"][:2]
        self.save_manifest()
        output = self.root / "output" / "forest_analysis.json"
        script = Path(__file__).with_name("forest_analysis.py")
        completed = subprocess.run(
            [sys.executable, str(script), "--test-fixture-mode", "--manifest", str(self.manifest_path), "--output", str(output)],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertTrue(output.is_file())
        saved = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(saved["readiness"]["status"], "BLOCKED")
        self.assertEqual(saved["candidates"], [])


    def test_cli_rejects_test_fixture_manifest_without_test_only_override(self):
        output = self.root / "output" / "must_not_be_written.json"
        script = Path(__file__).with_name("forest_analysis.py")
        completed = subprocess.run(
            [sys.executable, str(script), "--manifest", str(self.manifest_path), "--output", str(output)],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 1)
        self.assertFalse(output.exists())
        self.assertIn("only accepts manifests emitted by the real-data forest workflow", completed.stderr)

    def test_outside_forest_mask_is_not_flagged(self):
        self.mask[:, :6] = 0
        self.write_raster("forest_mask.tif", self.mask)
        hh = np.full((24, 24), -10.0, dtype=np.float32)
        hv = np.full((24, 24), -16.0, dtype=np.float32)
        hh[5:20, 0:5] = -4
        hv[5:20, 0:5] = -8
        self.write_raster("hh_2.tif", hh)
        self.write_raster("hv_2.tif", hv)
        self.save_manifest()
        result = analyze_manifest(self.manifest_path, minimum_region_pixels=5)
        self.assertTrue(all(candidate["date"] != "2026-07-14" for candidate in result["candidates"]))


if __name__ == "__main__":
    unittest.main()
