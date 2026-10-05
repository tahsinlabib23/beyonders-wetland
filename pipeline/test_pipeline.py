"""Offline regression checks. Run with the existing pipeline Python environment."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import Transformer
from shapely.geometry import shape, box

from main import ROOT, run_pipeline, load_config
from extract_gcov import extract_polarization_to_tiff
from preprocess import apply_masks
from raster_utils import atomic_json, read_rasters, area_km2, remove_small_regions
from output_reader import current_run
from probe_pixel import probe_pixel
from threshold_sensitivity import run_sensitivity_sweep
from search_nisar import select_compatible_scenes


class PipelineChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.sandbox.name)
        cls.first = cls.folder/"first"
        cls.second = cls.folder/"second"
        cls.manifest = run_pipeline(output_root=cls.first)
        run_pipeline(output_root=cls.second)
        cls.artifacts, _ = current_run(cls.first)
        cls.config = load_config()

    @classmethod
    def tearDownClass(cls):
        cls.sandbox.cleanup()

    def read(self, name):
        return json.loads((self.artifacts/name).read_text(encoding="utf-8"))

    def test_repeatable_observations_and_statistics(self):
        second, _ = current_run(self.second)
        for name in ("wetland_pulse.json", "patches_final.geojson", "sensitivity_results.json"):
            self.assertEqual((self.artifacts/name).read_bytes(), (second/name).read_bytes())
        self.assertEqual(self.manifest["observation_count"], 8)
        self.assertEqual(self.manifest["data_source"], "SIMULATED_DEMO")
        case_study = self.read("case_study.json")
        self.assertEqual(case_study["data_source"], "SIMULATED_DEMO")
        self.assertTrue(case_study["title"].startswith("SIMULATED DEMO"))
        self.assertEqual(case_study["product_maturity"], "SIMULATED")
        self.assertFalse(case_study["reference_validation"]["reference_validated"])

    def test_masks_area_stats_and_geographic_geometry(self):
        pulse = self.read("wetland_pulse.json")
        self.assertAlmostEqual(pulse["wetland_area_km2"], 12.96)
        for index, observation in enumerate(self.read("observations.json")):
            features = self.read(observation["patches_file"])["features"]
            self.assertAlmostEqual(sum(f["properties"]["area_km2"] for f in features), pulse["dates"][index]["area_km2"])
            self.assertEqual(len(features), pulse["dates"][index]["patches"])
            with rasterio.open(self.artifacts/observation["rasters"]["after_hh"]) as src:
                values = src.read(1)
                self.assertTrue(np.isnan(values[:8, :8]).all())
                self.assertTrue(np.isnan(values[:, 58:62]).all())
            with rasterio.open(self.artifacts/observation["classification_file"]) as src:
                classes = src.read(1)
                self.assertTrue((classes[:, 58:62] == 0).all())
                self.assertTrue((classes[:8, :8] == 0).all())
            for feature in features:
                patch = feature["properties"]
                self.assertAlmostEqual(patch["area_km2"], patch["pixel_count"]*.0004)
                self.assertAlmostEqual(patch["hh_after"]-patch["hh_before"], patch["delta_hh"])
                self.assertAlmostEqual(patch["hv_after"]-patch["hv_before"], patch["delta_hv"])
                self.assertFalse(patch["reference_validated"])
                lat, lng = patch["centroid"]
                self.assertTrue(24 < lat < 25 and 92 < lng < 92.1)
                geometry = shape(feature["geometry"])
                for polygon in getattr(geometry, "geoms", [geometry]):
                    self.assertTrue(polygon.exterior.is_ccw)

    def test_sweep_matches_detection_and_is_monotone(self):
        sweep = self.read("sensitivity_results.json")
        peak = self.read("wetland_pulse.json")["peak"]
        base = next(r for r in sweep["thresholds"] if r["delta_db"] == 2.5)
        self.assertAlmostEqual(base["area_km2"], peak["area_km2"])
        self.assertEqual(base["patches"], len(self.read("patches_final.geojson")["features"]))
        areas = [r["area_km2"] for r in sweep["thresholds"]]
        self.assertEqual(areas, sorted(areas, reverse=True))

    def test_probe_matches_published_classification(self):
        observations = self.read("observations.json")
        for observation in observations:
            with rasterio.open(self.artifacts/observation["classification_file"]) as src:
                values = src.read(1)
                row, col = np.argwhere(values == 1)[0]
                x, y = src.xy(int(row), int(col))
                lng, lat = Transformer.from_crs(src.crs, 4326, always_xy=True).transform(x, y)
            probe = probe_pixel(lat, lng, observation["date"], self.first)
            self.assertTrue(probe["valid"])
            self.assertEqual(probe["classification"], "OPEN_WATER")
            self.assertEqual(probe["data_source"], "SIMULATED")
            self.assertAlmostEqual(probe["hh_after"]-probe["hh_before"], probe["delta_hh"], places=4)
        self.assertFalse(probe_pixel(0, 0, output_root=self.first)["valid"])
        with rasterio.open(self.artifacts/observations[0]["rasters"]["after_hh"]) as src:
            x, y = src.xy(90, 59)
            lng, lat = Transformer.from_crs(src.crs, 4326, always_xy=True).transform(x, y)
        self.assertFalse(probe_pixel(lat, lng, output_root=self.first)["valid"])
        with self.assertRaises(ValueError):
            probe_pixel(24, 91, "1900-01-01", self.first)
        with self.assertRaises(RuntimeError):
            probe_pixel(24, 91, output_root=self.first, run_id="0"*32)

    def test_missing_projection_and_polarization_fail_closed(self):
        for missing in ("projection", "HVHV"):
            source = self.folder/f"broken_{missing}.h5"
            source.write_bytes((self.artifacts/"before.h5").read_bytes())
            with h5py.File(source, "a") as handle:
                del handle[f"science/LSAR/GCOV/grids/frequencyA/{missing}"]
            target = self.folder/f"protected_{missing}.tif"
            target.write_bytes(b"previous file must not be silently reused")
            with self.assertRaises(KeyError):
                extract_polarization_to_tiff(source, "frequencyA", "HVHV", target)
            self.assertEqual(target.read_bytes(), b"previous file must not be silently reused")
            self.assertFalse(target.with_name(target.name+".partial.tif").exists())

    def test_signed_coordinate_spacing(self):
        source = self.folder/"ascending_y.h5"
        source.write_bytes((self.artifacts/"before.h5").read_bytes())
        with h5py.File(source, "a") as handle:
            group = handle["science/LSAR/GCOV/grids/frequencyA"]
            values = group["HHHH"][:]
            group["HHHH"][:] = values[::-1]
            group["yCoordinates"][:] = group["yCoordinates"][:][::-1]
            group["yCoordinateSpacing"][()] = 20
        target = self.folder/"ascending.tif"
        extract_polarization_to_tiff(source, "frequencyA", "HHHH", target)
        with rasterio.open(target) as src:
            self.assertEqual(src.transform.e, 20)
            self.assertEqual(src.crs.to_epsg(), 32646)

    def test_aoi_reads_only_subset(self):
        target = self.folder/"subset.tif"
        extract_polarization_to_tiff(self.artifacts/"before.h5", "frequencyA", "HHHH", target,
                                     bbox=(92.055, 24.62, 92.065, 24.63))
        with rasterio.open(target) as src:
            self.assertTrue(0 < src.width < 200 and 0 < src.height < 200)

    def test_mismatched_grid_and_nonbinary_mask_rejected(self):
        original = self.artifacts/"before_hh.tif"
        with rasterio.open(original) as src:
            profile = src.profile.copy()
            values = src.read(1)
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
        profile["transform"] = from_origin(0, 0, 20, 20)
        shifted = self.folder/"shifted.tif"
        with rasterio.open(shifted, "w", **profile) as dst:
            dst.write(values, 1)
        with self.assertRaises(ValueError):
            read_rasters([original, shifted])
        with self.assertRaises(ValueError):
            apply_masks(original, quality_mask_path=shifted, out_tiff=self.folder/"masked.tif")
        with rasterio.open(original) as src:
            profile = src.profile.copy()
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
        invalid_mask = self.folder/"nonbinary.tif"
        with rasterio.open(invalid_mask, "w", **profile) as dst:
            dst.write(np.full(values.shape, 2, dtype="float32"), 1)
        with self.assertRaises(ValueError):
            apply_masks(original, quality_mask_path=invalid_mask, out_tiff=self.folder/"masked.tif")

    def test_minimum_regions_and_empty_sensitivity(self):
        grid = np.zeros((30, 30), dtype="uint8")
        grid[0:5, 0:5] = 1
        grid[10:20, 10:20] = 2
        cleaned = remove_small_regions(grid, 50)
        self.assertFalse((cleaned == 1).any())
        self.assertEqual(int((cleaned == 2).sum()), 100)
        before_hh, before_hv = self.artifacts/"before_hh_masked.tif", self.artifacts/"before_hv_masked.tif"
        result = run_sensitivity_sweep(before_hh, before_hh, before_hv, before_hv, self.config,
                                       out_json=self.folder/"empty.json", data_source="SIMULATED_DEMO")
        self.assertTrue(all(r["area_km2"] == r["patches"] == 0 for r in result["thresholds"]))
        self.assertEqual(result["stability_verdict"], "SENSITIVE")

    def test_failed_run_is_unavailable_and_lock_released(self):
        config = copy.deepcopy(self.config)
        config["demo"]["pixel_spacing_m"] = -1
        path = self.folder/"invalid.yaml"
        import yaml
        path.write_text(yaml.safe_dump(config), encoding="utf-8")
        output = self.folder/"failure"
        with self.assertRaises(ValueError):
            run_pipeline(path, output_root=output)
        manifest = json.loads((output/"last_attempt.json").read_text())
        self.assertEqual(manifest["status"], "FAILED")
        self.assertFalse((output/"current_run.json").exists())
        self.assertFalse((output/".run.lock").exists())
        with self.assertRaises(RuntimeError):
            current_run(output)
        with self.assertRaises(RuntimeError):
            probe_pixel(24, 91, output_root=output)

    def test_atomic_json_rejects_nan_and_preserves_destination(self):
        destination = self.folder/"atomic.json"
        atomic_json(destination, {"value": 1})
        with self.assertRaises(ValueError):
            atomic_json(destination, {"value": float("nan")})
        self.assertEqual(json.loads(destination.read_text()), {"value": 1})

    def test_compatible_pair_selection(self):
        def granule(timestamp, track="053", pol="DHDV"):
            return {"umm": {"GranuleUR": f"NISAR_L_L2_PR_GCOV_001_{track}_A_076_4020_{pol}_A_{timestamp}_{timestamp}_EP0042_P_F_J_001.h5"}}
        inputs = [granule("20260724T000000"), granule("20260712T000000", track="055"),
                  granule("20260712T000000"), granule("20260701T000000", pol="DVDV")]
        before, after = select_compatible_scenes(inputs, self.config)
        self.assertEqual(before[0]["date"], "2026-07-12")
        self.assertEqual(after[0]["date"], "2026-07-24")
        with self.assertRaises(ValueError):
            select_compatible_scenes(inputs[:2], self.config)

    def test_geographic_and_projected_area_units(self):
        self.assertAlmostEqual(area_km2(box(0, 0, 20, 20), "EPSG:32646"), .0004)
        self.assertTrue(0 < area_km2(box(91.5, 24.6, 91.501, 24.601), "EPSG:4326") < .02)


if __name__ == "__main__":
    unittest.main()
