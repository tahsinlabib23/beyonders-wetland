"""Offline tests for real-data forest workflow gates and spatial prep.

Synthetic rasters/CMR records here are isolated test fixtures only. They are never
written to the runtime output folder or served by the application.
"""
from __future__ import annotations

import json
from datetime import date
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import rasterio
from affine import Affine

from forest_workflow import (
    WorkflowError,
    _compatibility_record,
    build_worldcover_forest_mask,
    search_compatible_series,
    validate_request,
    worldcover_tile_url,
    worldcover_tiles_for_bbox,
)
from search_nisar import scene_identity
from forest_optical_reference import compute_hls_indices, _evaluate_pair


class ForestWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def request(self, **overrides):
        data = {
            "siteName": "Test Forest AOI",
            "bbox": [1.0, 2.0, 1.1, 2.1],
            "startDate": "2026-06-17",
            "endDate": "2026-10-12",
        }
        data.update(overrides)
        return data

    def test_request_defaults_and_detector_settings_are_recorded(self):
        result = validate_request(self.request())
        self.assertEqual(result["thresholdDb"], 2.5)
        self.assertEqual(result["robustMultiplier"], 3.0)
        self.assertEqual(result["minimumRegionPixels"], 20)
        self.assertEqual(result["minimumValidFraction"], 0.7)
        custom = validate_request(self.request(thresholdDb=3.2, robustMultiplier=2.5,
                                               minimumRegionPixels=45, minimumValidFraction=0.85))
        self.assertEqual(custom["thresholdDb"], 3.2)
        self.assertEqual(custom["minimumRegionPixels"], 45)
        self.assertEqual(custom["minimumValidFraction"], 0.85)

    def test_request_rejects_large_or_invalid_areas_without_expanding_scope(self):
        for bbox in ([1, 2, 1.21, 2.1], [1, 2, 1.1, 2.21], [2, 2, 1, 3],
                     [float("nan"), 2, 1.1, 2.1], [181, 2, 181.1, 2.1]):
            with self.subTest(bbox=bbox), self.assertRaises(WorkflowError):
                validate_request(self.request(bbox=bbox))

    def test_uploaded_geojson_boundary_controls_search_extent_and_is_validated(self):
        boundary = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"source": "test fixture"},
            "geometry": {"type": "Polygon", "coordinates": [[[1.02, 2.01], [1.08, 2.01], [1.08, 2.08], [1.02, 2.08], [1.02, 2.01]]]}}]}
        result = validate_request(self.request(bbox=[1, 2, 1.1, 2.1], boundaryGeoJson=boundary))
        self.assertEqual(result["bbox"], [1.02, 2.01, 1.08, 2.08])
        self.assertEqual(result["boundaryGeoJson"]["features"][0]["properties"]["source"], "test fixture")
        invalid = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [[[1, 2], [1.1, 2.1], [1.1, 2], [1, 2.1], [1, 2]]]}}]}
        with self.assertRaisesRegex(WorkflowError, "invalid polygon geometry"):
            validate_request(self.request(boundaryGeoJson=invalid))

    def test_request_rejects_future_dates_and_bad_thresholds(self):
        with self.assertRaisesRegex(WorkflowError, "future"):
            validate_request(self.request(endDate="2999-12-31"))
        with self.assertRaisesRegex(WorkflowError, "on or before"):
            validate_request(self.request(startDate="2026-08-01", endDate="2026-07-01"))
        for field, value in (("thresholdDb", 0.1), ("robustMultiplier", 9),
                             ("minimumRegionPixels", 2.5), ("minimumValidFraction", 1.2)):
            with self.subTest(field=field), self.assertRaises(WorkflowError):
                validate_request(self.request(**{field: value}))

    def test_worldcover_3_degree_tile_names_cover_edges_and_southern_western_tiles(self):
        self.assertEqual(worldcover_tiles_for_bbox([78, 10, 78.1, 10.1]), ["N09E078"])
        self.assertEqual(worldcover_tiles_for_bbox([-63, -4, -62.9, -3.9]), ["S06W063"])
        self.assertEqual(worldcover_tiles_for_bbox([-0.1, -0.1, 0.1, 0.1]),
                         ["S03W003", "S03E000", "N00W003", "N00E000"])
        self.assertEqual(worldcover_tile_url("N09E078"),
            "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N09E078_Map.tif")
        with self.assertRaises(ValueError):
            worldcover_tile_url("../../secret")

    def _write_raster(self, path, values, profile):
        with rasterio.open(path, "w", **profile) as destination:
            destination.write(values, 1)
        return path

    def test_worldcover_mask_uses_real_class_codes_clips_aoi_and_writes_aligned_mask(self):
        profile = {"driver": "GTiff", "height": 60, "width": 60, "count": 1,
                   "dtype": "uint8", "crs": "EPSG:4326",
                   "transform": Affine(0.0005, 0, 0, 0, -0.0005, 0.03), "nodata": 0}
        values = np.full((60, 60), 40, dtype=np.uint8)
        values[0:20, 0:20] = 10
        values[20:40, 20:40] = 95
        tile = self._write_raster(self.root / "tile.tif", values, profile)
        reference = self._write_raster(self.root / "reference.tif", np.ones((60, 60), dtype=np.float32),
            {**profile, "dtype": "float32", "nodata": np.nan})
        output = self.root / "forest_mask.tif"
        with patch("forest_workflow.download_worldcover_tile", return_value=tile):
            report = build_worldcover_forest_mask([0, 0, 0.03, 0.03], reference, output, self.root / "cache")
        self.assertTrue(output.is_file())
        with rasterio.open(output) as opened:
            mask = opened.read(1)
            self.assertEqual(opened.crs.to_epsg(), 4326)
            self.assertEqual(opened.transform, profile["transform"])
            self.assertEqual(int(mask.sum()), 800)
            self.assertEqual(set(np.unique(mask)), {0, 1})
        self.assertEqual(report["classes"], [10, 95])
        self.assertEqual(report["forestPixelCount"], 800)
        self.assertIn("WorldCover 2021", report["dataset"])

    def test_worldcover_mask_clips_to_uploaded_polygon_not_its_bounding_box(self):
        profile = {"driver": "GTiff", "height": 60, "width": 60, "count": 1,
                   "dtype": "uint8", "crs": "EPSG:4326",
                   "transform": Affine(0.0005, 0, 0, 0, -0.0005, 0.03), "nodata": 0}
        tile = self._write_raster(self.root / "treecover.tif", np.full((60, 60), 10, dtype=np.uint8), profile)
        reference = self._write_raster(self.root / "reference.tif", np.ones((60, 60), dtype=np.float32),
            {**profile, "dtype": "float32", "nodata": np.nan})
        boundary = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0.015, 0], [0.015, 0.03], [0, 0.03], [0, 0]]]}}]}
        output = self.root / "forest_mask_polygon.tif"
        with patch("forest_workflow.download_worldcover_tile", return_value=tile):
            report = build_worldcover_forest_mask([0, 0, 0.03, 0.03], reference, output, self.root / "cache", boundary_geojson=boundary)
        with rasterio.open(output) as opened:
            mask = opened.read(1)
            self.assertEqual(set(np.unique(mask)), {0, 1})
            self.assertEqual(int(mask.sum()), 1800)
        self.assertEqual(report["forestPixelCount"], 1800)

    def test_worldcover_mask_fails_when_real_source_has_no_forest_classes(self):
        profile = {"driver": "GTiff", "height": 60, "width": 60, "count": 1,
                   "dtype": "uint8", "crs": "EPSG:4326",
                   "transform": Affine(0.0005, 0, 0, 0, -0.0005, 0.03), "nodata": 0}
        tile = self._write_raster(self.root / "nonforest.tif", np.full((60, 60), 40, dtype=np.uint8), profile)
        reference = self._write_raster(self.root / "reference.tif", np.ones((60, 60), dtype=np.float32),
            {**profile, "dtype": "float32", "nodata": np.nan})
        output = self.root / "forest_mask.tif"
        with patch("forest_workflow.download_worldcover_tile", return_value=tile):
            with self.assertRaisesRegex(WorkflowError, "no class-10 tree-cover"):
                build_worldcover_forest_mask([0, 0, 0.03, 0.03], reference, output, self.root / "cache")
        self.assertFalse(output.exists())

    def _granule(self, acquisition_date: str, release: str = "P05023"):
        compact = acquisition_date.replace("-", "")
        name = (f"NISAR_L2_PR_GCOV_032_043_A_034_4005_DHDH_A_"
                f"{compact}T000000_{compact}T000100_{release}_N_F_J_001.h5")
        points = [
            {"Longitude": 0.99, "Latitude": 1.99},
            {"Longitude": 1.11, "Latitude": 1.99},
            {"Longitude": 1.11, "Latitude": 2.11},
            {"Longitude": 0.99, "Latitude": 2.11},
            {"Longitude": 0.99, "Latitude": 1.99},
        ]
        return {"umm": {"GranuleUR": name, "SpatialExtent": {"HorizontalSpatialDomain": {
            "Geometry": {"GPolygons": [{"Boundary": {"Points": points}}]}}}}}

    def test_compatibility_record_uses_actual_granule_fields(self):
        name = self._granule("2026-06-30")["umm"]["GranuleUR"]
        identity = scene_identity(name, "frequencyA")
        signature = _compatibility_record(name)
        self.assertEqual(identity["date"], "2026-06-30")
        self.assertEqual(signature["track"], "043")
        self.assertEqual(signature["direction"], "A")
        self.assertEqual(signature["frame"], "034")
        self.assertEqual(signature["bandwidth"], "4005")
        self.assertEqual(signature["frequency_a_bandwidth"], "40")
        self.assertEqual(signature["frequency_b_bandwidth"], "05")
        self.assertEqual(signature["polarization_mode"], "DH")
        self.assertEqual(signature["paired_polarization_mode"], "DH")
        self.assertEqual(signature["polarization_mode_code"], "DHDH")
        self.assertEqual(signature["acquisition"], "A")
        self.assertEqual(signature["release"], "P05023")
        self.assertEqual(signature["product_maturity"], "PROVISIONAL")

    def test_live_catalog_discovery_groups_only_compatible_dates(self):
        records = [self._granule(day) for day in ("2026-06-30", "2026-07-12", "2026-07-24", "2026-08-05")]
        mock_earthaccess = SimpleNamespace(search_data=lambda **kwargs: records)
        with patch.dict(sys.modules, {"earthaccess": mock_earthaccess}):
            result = search_compatible_series(validate_request(self.request()))
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["catalogHits"], 4)
        self.assertEqual(len(result["scenes"]), 4)
        self.assertEqual([scene["date"] for scene in result["scenes"]],
                         ["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-05"])
        self.assertEqual(result["productMaturity"], "PROVISIONAL")

    def test_catalog_discovery_blocks_incompatible_or_too_short_series(self):
        two = [self._granule(day) for day in ("2026-06-30", "2026-07-12")]
        with patch.dict(sys.modules, {"earthaccess": SimpleNamespace(search_data=lambda **kwargs: two)}):
            result = search_compatible_series(validate_request(self.request()))
        self.assertEqual(result["status"], "INSUFFICIENT_OBSERVATIONS")
        self.assertEqual(len(result["selectedSceneIds"]), 2)
        self.assertEqual(result["status"], "INSUFFICIENT_OBSERVATIONS")
        split = [self._granule("2026-06-30"), self._granule("2026-07-12"),
                 self._granule("2026-07-24", release="P05024")]
        with patch.dict(sys.modules, {"earthaccess": SimpleNamespace(search_data=lambda **kwargs: split)}):
            result = search_compatible_series(validate_request(self.request()))
        self.assertEqual(result["status"], "INSUFFICIENT_OBSERVATIONS")
        self.assertEqual(len(result["selectedSceneIds"]), 2)


    def _hls_fixture(self, ndvi, nbr, date_value):
        shape = (20, 20)
        valid = np.ones(shape, dtype=bool)
        return {"identity": {"granule_id": f"HLS.{date_value}", "date": date.fromisoformat(date_value),
                             "product": "S30", "tile": "T46QGM"},
                "ndvi": np.full(shape, ndvi, dtype=np.float32),
                "nbr": np.full(shape, nbr, dtype=np.float32), "valid": valid,
                "sourceUrls": {"NIR": "https://example.invalid/test-only", "Fmask": "https://example.invalid/test-only"}}

    def test_hls_evidence_screen_supports_only_actual_clear_index_drops(self):
        forest = np.ones((20, 20), dtype=bool)
        fraction = np.zeros((20, 20), dtype=np.float32)
        fraction[5:10, 5:10] = 0.2  # 25 native HLS cells overlap candidate pixels
        before = self._hls_fixture(0.80, 0.70, "2026-06-30")
        after = self._hls_fixture(0.62, 0.53, "2026-07-10")
        result = _evaluate_pair(before, after, forest, fraction)
        self.assertEqual(result["status"], "SUPPORTS_OPTICAL_VEGETATION_CHANGE")
        self.assertFalse(result["referenceValidated"])
        self.assertLess(result["candidateMedianNdviChange"], -0.1)
        self.assertIn("not ground truth", result["note"].lower())

    def test_hls_evidence_screen_reports_no_strong_signal_without_claiming_false_alarm(self):
        forest = np.ones((20, 20), dtype=bool)
        fraction = np.zeros((20, 20), dtype=np.float32)
        fraction[5:10, 5:10] = 0.2
        before = self._hls_fixture(0.65, 0.55, "2026-06-30")
        after = self._hls_fixture(0.64, 0.54, "2026-07-10")
        result = _evaluate_pair(before, after, forest, fraction)
        self.assertEqual(result["status"], "NO_STRONG_OPTICAL_SIGNAL")
        self.assertFalse(result["referenceValidated"])
        self.assertIn("does not prove the radar candidate is false", result["summary"])

    def test_hls_evidence_screen_blocks_insufficient_clear_coverage(self):
        forest = np.ones((20, 20), dtype=bool)
        before = self._hls_fixture(0.80, 0.70, "2026-06-30")
        after = self._hls_fixture(0.50, 0.40, "2026-07-10")
        after["valid"][:18, :] = False
        fraction = np.zeros((20, 20), dtype=np.float32)
        fraction[5:10, 5:10] = 0.2
        result = _evaluate_pair(before, after, forest, fraction)
        self.assertEqual(result["status"], "INCONCLUSIVE")
        self.assertFalse(result["referenceValidated"])
        self.assertIn("below the configured screening minimum", result["summary"])

    def test_hls_ndvi_nbr_calculation_and_fmask_exclusion(self):
        nir = np.array([[8000, 3000, 7000]], dtype=np.float32)
        red = np.array([[2000, 2000, 1000]], dtype=np.float32)
        swir = np.array([[1000, 2500, 2000]], dtype=np.float32)
        qa = np.array([[0, 2, 192]], dtype=np.uint8)  # clear, cloud, high aerosol
        ndvi, nbr, valid = compute_hls_indices(nir, red, swir, qa, np.ones(qa.shape, dtype=bool))
        self.assertAlmostEqual(float(ndvi[0, 0]), 0.6, places=5)
        self.assertAlmostEqual(float(nbr[0, 0]), 7 / 9, places=5)
        self.assertTrue(bool(valid[0, 0]))
        self.assertFalse(bool(valid[0, 1]))
        self.assertFalse(bool(valid[0, 2]))
        self.assertTrue(np.isnan(ndvi[0, 1:]).all())


if __name__ == "__main__":
    unittest.main()
