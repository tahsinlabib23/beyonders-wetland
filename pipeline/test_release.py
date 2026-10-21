"""Release regressions; no network or real-scene downloads."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import numpy as np
from rasterio.transform import from_origin
from hls_reference import area_supported_metrics
from network_retry import remote_call
from baseline_water_experiment import screen_candidates
from publish_study import clean, display_geometry, publish


class ReleaseChecks(unittest.TestCase):
    def test_remote_retry_is_bounded(self):
        operation = Mock(side_effect=[TimeoutError(), TimeoutError(), "ok"])
        sleep = Mock()
        self.assertEqual(remote_call(operation, sleep=sleep), "ok")
        self.assertEqual(operation.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_requests_timeout_type_is_retried(self):
        class Timeout(Exception):
            pass
        operation = Mock(side_effect=[Timeout("temporary"), "ok"])
        self.assertEqual(remote_call(operation, sleep=Mock()), "ok")
        self.assertEqual(operation.call_count, 2)

    def test_validation_error_not_retried(self):
        operation = Mock(side_effect=ValueError("grid mismatch"))
        with self.assertRaises(ValueError):
            remote_call(operation, sleep=Mock())
        self.assertEqual(operation.call_count, 1)

    def test_unknown_baseline_is_not_dry(self):
        result = screen_candidates(np.ones(3, bool), np.array([1, 0, 0]), np.array([1, 1, 0]))
        np.testing.assert_array_equal(result["eligible_new_water_candidates"], [False, True, False])
        np.testing.assert_array_equal(result["unassessed_baseline"], [False, False, True])

    def test_zero_area_is_preserved(self):
        grid = from_origin(0, 60, 30, 30)
        native = {"index": np.zeros((2, 2)), "valid": np.ones((2, 2), bool), "crs": "EPSG:32646", "transform": grid}
        result = area_supported_metrics(np.zeros((2, 2)), np.ones((2, 2)), np.ones((2, 2)),
                                       {"transform": grid, "crs": "EPSG:32646"}, native, native, 0)
        self.assertEqual(result["radar_candidate_area_km2"], 0)
        self.assertEqual(result["native_hls_pixels_assessed"], 4)
        self.assertIsNone(result["f1"])

    def test_private_paths_redacted(self):
        self.assertEqual(clean({"path": "C:\\Users\\operator\\private.tif"})["path"], "private.tif")
        with self.assertRaises(ValueError):
            clean("access_token=secret")

    def test_invalid_publication_identifier(self):
        with self.assertRaises(ValueError):
            publish("../outside", "v1")

    def test_geometry_derivative_preserves_statistics(self):
        data = {"features": [{"geometry": {"type": "Polygon", "coordinates": [[[91,25],[91.01,25],[91.01,25.01],[91,25.01],[91,25]]]}, "properties": {"area_km2": 3.5}}]}
        output = display_geometry(data, 10)
        self.assertEqual(output["features"][0]["properties"]["area_km2"], 3.5)
        self.assertTrue(output["display_geometry"]["not_for_measurement"])

    def test_published_checksums_and_no_science_files(self):
        root = Path(__file__).parent.parent / "public/studies"
        if not (root / "catalog.json").exists():
            self.skipTest("No published catalog yet")
        import hashlib
        catalog = json.loads((root / "catalog.json").read_text())
        for entry in catalog["studies"]:
            self.assertEqual(entry.get("hazard_type"), "wetland_flood_change")
            folder = root / entry["path"]
            publication = json.loads((folder / "publication.json").read_text())
            self.assertFalse(publication["reference_validated"])
            for name, info in publication["artifacts"].items():
                path = folder / name
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), info["sha256"])
                self.assertNotIn(path.suffix, (".tif", ".h5"))


if __name__ == "__main__":
    unittest.main()
