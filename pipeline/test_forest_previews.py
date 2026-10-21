"""Offline tests for real-raster quicklook rendering; fixtures are temporary only."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image

from forest_previews import render_run_previews


class ForestPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run = self.root / "run"
        self.run.mkdir()
        self.profile = {"driver": "GTiff", "height": 48, "width": 48, "count": 1,
                        "dtype": "float32", "crs": "EPSG:32646",
                        "transform": Affine(20, 0, 300000, 0, -20, 2700000), "nodata": np.nan}
        self.mask = np.zeros((48, 48), dtype=np.uint8)
        self.mask[8:40, 8:40] = 1
        with rasterio.open(self.run / "forest_mask.tif", "w", **{**self.profile, "dtype": "uint8", "nodata": 0}) as dst:
            dst.write(self.mask, 1)
        self.observations = []
        for idx, day in enumerate(("2026-06-30", "2026-07-12", "2026-07-24")):
            hh = np.full((48, 48), -10 + idx * 0.3, dtype=np.float32)
            hv = np.full((48, 48), -17 + idx * 0.2, dtype=np.float32)
            hh[:5, :] = np.nan
            quality = np.ones((48, 48), dtype=np.uint8)
            quality[12:15, 12:15] = 0
            paths = {}
            for channel, values in (("hh", hh), ("hv", hv)):
                name = f"{day}_{channel}.tif"
                with rasterio.open(self.run / name, "w", **self.profile) as dst:
                    dst.write(values, 1)
                paths[channel] = name
            quality_name = f"{day}_quality.tif"
            with rasterio.open(self.run / quality_name, "w", **{**self.profile, "dtype": "uint8", "nodata": 0}) as dst:
                dst.write(quality, 1)
            self.observations.append({"date": day, "scene_id": f"NISAR_REAL_SCENE_{idx}",
                "hh_path": paths["hh"], "hv_path": paths["hv"], "quality_mask_path": quality_name})
        self.manifest_path = self.run / "forest_manifest.json"
        self.manifest_path.write_text(json.dumps({"site": {"name": "Temporary test AOI", "forest_mask_path": "forest_mask.tif",
            "forest_mask_source": "TEST FIXTURE ONLY", "bbox": [-1, -1, -0.9, -0.9]}, "observations": self.observations}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_quicklooks_are_rendered_from_input_rasters_with_transparent_exclusions(self):
        output = self.run / "previews"
        summary = render_run_previews(self.manifest_path, output, max_dimension=64)
        self.assertEqual(summary["status"], "AVAILABLE")
        self.assertEqual(summary["count"], 6)
        self.assertEqual(summary["requestedCount"], 6)
        self.assertEqual(summary["source"], "NISAR_L2_GCOV_PROVISIONAL_V1")
        self.assertEqual(len(list(output.glob("*.png"))), 6)
        metadata = json.loads((output / "2026-06-30_hh.json").read_text(encoding="utf-8"))
        self.assertTrue(metadata["available"])
        self.assertFalse(metadata["isClassification"])
        self.assertEqual(metadata["dataSource"], "NISAR_L2_GCOV_PROVISIONAL_V1")
        self.assertEqual(metadata["sceneId"], "NISAR_REAL_SCENE_0")
        image = np.array(Image.open(output / "2026-06-30_hh.png").convert("RGBA"))
        self.assertTrue(np.any(image[..., 3] > 0))
        self.assertTrue(np.any(image[..., 3] == 0))
        second_meta = json.loads((output / "2026-07-12_hh.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["scaleMinDb"], second_meta["scaleMinDb"])
        self.assertEqual(metadata["scaleMaxDb"], second_meta["scaleMaxDb"])

    def test_no_valid_forest_pixels_yields_unavailable_images_not_placeholders(self):
        empty_mask = np.zeros_like(self.mask)
        with rasterio.open(self.run / "forest_mask.tif", "w", **{**self.profile, "dtype": "uint8", "nodata": 0}) as dst:
            dst.write(empty_mask, 1)
        summary = render_run_previews(self.manifest_path, self.run / "empty-previews", max_dimension=64)
        self.assertEqual(summary["status"], "UNAVAILABLE")
        self.assertEqual(summary["count"], 0)
        self.assertEqual(summary["requestedCount"], 6)
        self.assertEqual(list((self.run / "empty-previews").glob("*.png")), [])
        meta = json.loads((self.run / "empty-previews" / "2026-06-30_hh.json").read_text(encoding="utf-8"))
        self.assertFalse(meta["available"])
        self.assertIn("No valid masked pixels", meta["message"])


if __name__ == "__main__":
    unittest.main()
