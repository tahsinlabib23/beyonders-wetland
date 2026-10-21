"""End-to-end tests of the forest worker (`run_worker` -> `_run_analysis`).

Everything synthetic here (GeoTIFFs, catalog records, WorldCover tile) is an isolated test fixture that lives
only in a temporary directory. It is never written to the application's output folder, and success here is NOT
evidence that NASA downloads or live processing work. Network, Earthdata and HDF5 access are replaced by
fakes; the alignment, masking, manifest, detector, preview and job-record code is the real implementation.

These tests exist because the first suite passed while real jobs failed with
``'DatasetReader' object is not subscriptable`` and ``cannot access local variable 'manifest'``:
nothing exercised ``_run_analysis`` or ``align_raster_to_reference``.
"""
from __future__ import annotations

import ast
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import rasterio
from affine import Affine

import forest_workflow as fw

HERE = Path(__file__).resolve().parent
DATES = ["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17", "2026-08-29"]
BBOX = [1.0, 2.0, 1.04, 2.04]
CRS = "EPSG:4326"


def granule(day: str, release: str = "P05023") -> dict:
    compact = day.replace("-", "")
    name = f"NISAR_L2_PR_GCOV_032_043_A_034_4005_DHDH_A_{compact}T000000_{compact}T000100_{release}_N_F_J_001.h5"
    points = [{"Longitude": 0.99, "Latitude": 1.99}, {"Longitude": 1.11, "Latitude": 1.99}, {"Longitude": 1.11, "Latitude": 2.11},
              {"Longitude": 0.99, "Latitude": 2.11}, {"Longitude": 0.99, "Latitude": 1.99}]
    return {"umm": {"GranuleUR": name, "SpatialExtent": {"HorizontalSpatialDomain": {"Geometry": {"GPolygons": [{"Boundary": {"Points": points}}]}}}}}


def write_tif(path: Path, values: np.ndarray, transform: Affine, dtype: str, nodata) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=values.shape[0], width=values.shape[1], count=1,
                       dtype=dtype, crs=CRS, transform=transform, nodata=nodata) as dst:
        dst.write(values.astype(dtype), 1)
    return path


class FakeHandle:
    def close(self) -> None:
        pass


class Fixture:
    """Patches the outside world and exposes a job-submission helper."""

    def __init__(self, test: unittest.TestCase, *, fail_extraction_on: str | None = None, auth_error: Exception | None = None,
                 forest_class: int = 10, catalog_days: list[str] | None = None, output_dir: Path | None = None):
        self.test = test
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.output = Path(output_dir) if output_dir else self.root / "forest"
        self.fail_extraction_on = fail_extraction_on
        self.auth_error = auth_error
        self.forest_class = forest_class
        self.days = catalog_days if catalog_days is not None else DATES
        self.calls: list[str] = []

        records = [granule(day) for day in self.days]
        self.fake_earthaccess = SimpleNamespace(search_data=lambda **kwargs: list(records), open=lambda recs: [FakeHandle() for _ in recs])
        self.patches = [
            patch.object(fw, "OUTPUT_ROOT", self.output),
            patch.dict(sys.modules, {"earthaccess": self.fake_earthaccess}),
            patch.object(fw, "_authenticate_noninteractive", self._authenticate),
            patch.object(fw, "extract_polarization_to_tiff", self._extract_pol),
            patch.object(fw, "extract_quality_layers_to_tiff", self._extract_quality),
            patch.object(fw, "download_worldcover_tile", self._tile),
            patch("forest_optical_reference.attach_forest_optical_reference", self._optical),
        ]
        for item in self.patches:
            item.start()
            test.addCleanup(item.stop)

    # -- fakes ---------------------------------------------------------------------------------------------
    def _authenticate(self) -> None:
        self.calls.append("auth")
        if self.auth_error:
            raise self.auth_error

    def _grid(self, out_path: Path):
        # Scene 2 sits on a shifted, smaller grid so alignment has to reproject; others share the reference grid.
        if "scene_02" in Path(out_path).name:
            return Affine(0.0005, 0, 1.00025, 0, -0.0005, 2.04025), (78, 78)
        return Affine(0.0005, 0, 1.0, 0, -0.0005, 2.04), (80, 80)

    def _signal(self, out_path: Path, base: float) -> np.ndarray:
        name = Path(out_path).name
        index = int(name.split("_")[1])
        _, shape = self._grid(out_path)
        rng = np.random.default_rng(index)
        values = base + rng.normal(0, 0.15, shape)
        if index == 5:  # the last acquisition has a real-looking local drop so the detector has something to flag
            values[20:40, 20:40] -= 6.0
        return values

    def _extract_pol(self, handle, frequency, pol, out_path, bbox=None):
        self.calls.append(f"extract:{pol}:{Path(out_path).name}")
        if self.fail_extraction_on and self.fail_extraction_on in Path(out_path).name:
            raise ValueError("synthetic extraction failure for test")
        transform, _ = self._grid(out_path)
        return write_tif(out_path, self._signal(out_path, -8.0 if pol == "HHHH" else -14.0), transform, "float32", np.nan)

    def _extract_quality(self, handle, frequency, prefix, bbox=None):
        prefix = Path(prefix)
        transform, shape = self._grid(prefix.with_name(prefix.name + "_x"))
        valid = write_tif(prefix.with_name(prefix.name + "_quality_valid.tif"), np.ones(shape), transform, "uint8", 0)
        looks = write_tif(prefix.with_name(prefix.name + "_number_of_looks.tif"), np.full(shape, 8.0), transform, "float32", np.nan)
        return {"number_of_looks_path": str(looks), "quality_valid_path": str(valid), "mask_ensemble_path": None,
                "number_of_looks_valid_fraction": 1.0, "number_of_looks_median": 8.0, "number_of_looks_min": 8.0,
                "number_of_looks_max": 8.0, "mask_ensemble_counts": {}, "mask_attributes": {}, "mask_interpretation": "test"}

    def _tile(self, tile_name, cache_dir):
        return write_tif(self.root / "tile.tif", np.full((120, 120), self.forest_class, dtype="uint8"),
                         Affine(0.0005, 0, 0.99, 0, -0.0005, 2.05), "uint8", 0)

    @staticmethod
    def _optical(analysis, manifest_path, progress=None):
        return {"status": "NOT_RUN", "source": "NASA HLS L30/S30 v2.0 (fake for test)", "summary": "optical skipped in test",
                "dates": [], "referenceValidated": False}

    # -- job helpers ---------------------------------------------------------------------------------------
    def submit(self, action: str = "run", scene_ids: list[str] | None = None, request: dict | None = None, job_id: str = "a" * 32) -> str:
        jobs = self.output / "jobs"
        jobs.mkdir(parents=True, exist_ok=True)
        ids = scene_ids if scene_ids is not None else [granule(day)["umm"]["GranuleUR"] for day in self.days]
        req = request or {"siteName": "Synthetic AOI", "bbox": BBOX, "startDate": "2026-06-17", "endDate": "2026-10-12",
                          "thresholdDb": 2.5, "robustMultiplier": 3.0, "minimumRegionPixels": 20, "minimumValidFraction": 0.7}
        (jobs / f"{job_id}_request.json").write_text(json.dumps({"action": action, "request": req, "selectedSceneIds": ids}))
        (jobs / f"{job_id}.json").write_text(json.dumps({"id": job_id, "action": action, "status": "QUEUED"}))
        return job_id

    def job(self, job_id: str) -> dict:
        return json.loads((self.output / "jobs" / f"{job_id}.json").read_text())


class FullRunTests(unittest.TestCase):
    def test_complete_run_with_mixed_grids_writes_manifest_analysis_and_current_pointer(self):
        fx = Fixture(self)
        job_id = fx.submit()
        self.assertEqual(fw.run_worker(job_id), 0)
        job = fx.job(job_id)
        self.assertEqual(job["status"], "COMPLETE", job.get("error"))
        run_dir = Path(job["result"]["runDirectory"])
        manifest = json.loads((run_dir / "forest_manifest.json").read_text())
        self.assertEqual(len(manifest["observations"]), 5)
        self.assertEqual(manifest["data_source"], "NISAR")
        # The provenance block must record the same boundary-source text as the site block (the original bug).
        self.assertEqual(manifest["provenance"]["boundarySource"], manifest["site"]["boundary_source"])
        analysis = json.loads((run_dir / "forest_analysis.json").read_text())
        self.assertIn(analysis["readiness"]["status"], {"READY", "READY_WITH_WARNINGS"})
        current = json.loads((fx.output / "current_run.json").read_text())
        self.assertEqual(current["runId"], job["result"]["runId"])

    def test_every_aligned_raster_shares_the_reference_grid(self):
        fx = Fixture(self)
        job_id = fx.submit()
        fw.run_worker(job_id)
        run_dir = Path(fx.job(job_id)["result"]["runDirectory"])
        grids = set()
        for path in sorted((run_dir / "rasters").glob("observation_*_h*_db.tif")) + sorted((run_dir / "rasters").glob("observation_*_quality_valid.tif")):
            with rasterio.open(path) as ds:
                grids.add((ds.width, ds.height, tuple(round(v, 9) for v in ds.transform[:6]), ds.crs.to_string()))
        self.assertEqual(len(grids), 1, grids)

    def test_blocked_analysis_is_saved_but_does_not_replace_a_previous_good_run(self):
        fx = Fixture(self)
        good = fx.submit(job_id="1" * 32)
        fw.run_worker(good)
        before = (fx.output / "current_run.json").read_bytes()
        analysis_before = (fx.output / "forest_analysis.json").read_bytes()
        blocked = fx.submit(job_id="2" * 32, request={"siteName": "Blocked AOI", "bbox": BBOX, "startDate": "2026-06-17", "endDate": "2026-10-12",
                            "thresholdDb": 2.5, "robustMultiplier": 3.0, "minimumRegionPixels": 20, "minimumValidFraction": 1.0})
        # Force the readiness gate to block by making the forest mask nearly empty on this site.
        with patch.object(fw, "analyze_manifest", return_value={"readiness": {"status": "BLOCKED", "summary": "forced block for test", "checks": []},
                          "site": {}, "method": {}, "observations": [], "candidates": []}):
            fw.run_worker(blocked)
        job = fx.job(blocked)
        self.assertEqual(job["status"], "COMPLETE")
        self.assertEqual(job["result"]["analysisStatus"], "BLOCKED")
        self.assertEqual(job["result"]["candidateCount"], 0)
        self.assertEqual((fx.output / "current_run.json").read_bytes(), before)
        self.assertEqual((fx.output / "forest_analysis.json").read_bytes(), analysis_before)


class FailureTests(unittest.TestCase):
    def assert_failed_safely(self, fx: Fixture, job_id: str, *, expect_stage_contains: str):
        job = fx.job(job_id)
        self.assertEqual(job["status"], "FAILED")
        self.assertTrue(job.get("error"))
        self.assertIn(expect_stage_contains.lower(), (job.get("failedStage") or "").lower(), job)
        self.assertTrue(job.get("diagnostics"), "a failed job must carry diagnostics, not just 'FAILED'")
        self.assertIn("traceback", job["diagnostics"])
        self.assertTrue(job["diagnostics"].get("guidance"))

    def good_run_then(self, fx: Fixture):
        fw.run_worker(fx.submit(job_id="1" * 32))
        return (fx.output / "current_run.json").read_bytes(), (fx.output / "forest_analysis.json").read_bytes()

    def test_failure_during_extraction_keeps_last_good_result_and_reports_stage(self):
        fx = Fixture(self)
        pointer, analysis = self.good_run_then(fx)
        fx.fail_extraction_on = "scene_03"
        self.assertEqual(fw.run_worker(fx.submit(job_id="2" * 32)), 1)
        self.assert_failed_safely(fx, "2" * 32, expect_stage_contains="Reading real GCOV")
        self.assertEqual((fx.output / "current_run.json").read_bytes(), pointer)
        self.assertEqual((fx.output / "forest_analysis.json").read_bytes(), analysis)
        # The earlier run is still readable.
        self.assertTrue(json.loads((fx.output / "forest_analysis.json").read_text())["observations"])

    def test_failed_run_leaves_no_half_finished_run_listed_as_a_result(self):
        fx = Fixture(self, fail_extraction_on="scene_02")
        fw.run_worker(fx.submit())
        runs = fx.output / "runs"
        for run in runs.iterdir() if runs.exists() else []:
            self.assertTrue((run / "failure.json").exists() or (run / "forest_analysis.json").exists(),
                            f"{run.name} is a partial run with no failure marker")
            self.assertFalse((run / "forest_analysis.json").exists() and (run / "failure.json").exists())

    def test_authentication_failure_is_reported_with_guidance_and_no_run_directory(self):
        fx = Fixture(self, auth_error=fw.WorkflowError("NASA Earthdata Login is required"))
        self.assertEqual(fw.run_worker(fx.submit()), 1)
        self.assert_failed_safely(fx, "a" * 32, expect_stage_contains="Authenticating")
        self.assertIn("earthdata", fx.job("a" * 32)["diagnostics"]["guidance"].lower())
        self.assertFalse((fx.output / "runs").exists() and any((fx.output / "runs").iterdir()))

    def test_forest_mask_failure_is_reported_at_the_mask_stage(self):
        fx = Fixture(self, forest_class=40)  # cropland only: the real mask builder must refuse
        self.assertEqual(fw.run_worker(fx.submit()), 1)
        self.assert_failed_safely(fx, "a" * 32, expect_stage_contains="forest mask")
        self.assertFalse((fx.output / "current_run.json").exists())

    def test_detector_exception_is_reported_not_swallowed(self):
        fx = Fixture(self)
        with patch.object(fw, "analyze_manifest", side_effect=RuntimeError("detector blew up")):
            self.assertEqual(fw.run_worker(fx.submit()), 1)
        self.assert_failed_safely(fx, "a" * 32, expect_stage_contains="anomaly")
        self.assertEqual(fx.job("a" * 32)["errorType"], "RuntimeError")

    def test_invalid_request_is_recorded_on_the_job_instead_of_crashing_the_worker(self):
        fx = Fixture(self)
        job_id = fx.submit(request={"siteName": "x", "bbox": [5, 5, 4, 4], "startDate": "2026-06-17", "endDate": "2026-10-12"})
        self.assertEqual(fw.run_worker(job_id), 1)
        job = fx.job(job_id)
        self.assertEqual(job["status"], "FAILED")
        self.assertTrue(job["error"])

    def test_missing_request_file_marks_the_job_failed_instead_of_leaving_it_running(self):
        fx = Fixture(self)
        jobs = fx.output / "jobs"
        jobs.mkdir(parents=True)
        (jobs / f"{'b' * 32}.json").write_text(json.dumps({"id": "b" * 32, "status": "QUEUED"}))
        self.assertEqual(fw.run_worker("b" * 32), 1)
        self.assertEqual(fx.job("b" * 32)["status"], "FAILED")

    def test_malformed_job_id_never_touches_the_filesystem(self):
        fx = Fixture(self)
        self.assertEqual(fw.run_worker("../../etc/passwd"), 1)
        self.assertFalse(fx.output.exists())

    def test_stale_progress_from_a_previous_job_is_not_inherited(self):
        fx = Fixture(self)
        job_id = fx.submit()
        stale = {"id": job_id, "status": "COMPLETE", "stage": "Real-data forest analysis complete", "result": {"runId": "old"}}
        (fx.output / "jobs" / f"{job_id}.json").write_text(json.dumps(stale))
        with patch.object(fw, "analyze_manifest", side_effect=RuntimeError("boom")):
            fw.run_worker(job_id)
        job = fx.job(job_id)
        self.assertEqual(job["status"], "FAILED")
        self.assertNotIn("result", job)


class CancellationTests(unittest.TestCase):
    def test_cancel_request_stops_the_run_and_preserves_prior_results(self):
        fx = Fixture(self)
        fw.run_worker(fx.submit(job_id="1" * 32))
        pointer = (fx.output / "current_run.json").read_bytes()
        job_id = fx.submit(job_id="2" * 32)
        path = fx.output / "jobs" / f"{job_id}.json"
        original = fx._extract_pol

        def cancel_after_first_extract(*args, **kwargs):
            result = original(*args, **kwargs)
            doc = json.loads(path.read_text())
            doc["cancelRequested"] = True
            path.write_text(json.dumps(doc))
            return result

        with patch.object(fw, "extract_polarization_to_tiff", cancel_after_first_extract):
            self.assertEqual(fw.run_worker(job_id), 1)
        job = fx.job(job_id)
        self.assertEqual(job["status"], "CANCELLED")
        self.assertEqual((fx.output / "current_run.json").read_bytes(), pointer)


class RasterioApiMisuseTests(unittest.TestCase):
    """Guards the class of mistake behind ``'DatasetReader' object is not subscriptable``."""

    def make(self, root: Path, name: str, transform: Affine, shape=(40, 40), dtype="float32", nodata=np.nan, value=1.0):
        return write_tif(root / name, np.full(shape, value), transform, dtype, nodata)

    def test_grid_comparison_accepts_profiles_and_open_datasets_in_either_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a = self.make(root, "a.tif", Affine(0.001, 0, 1, 0, -0.001, 2))
            b = self.make(root, "b.tif", Affine(0.001, 0, 1, 0, -0.001, 2))
            c = self.make(root, "c.tif", Affine(0.001, 0, 1.01, 0, -0.001, 2))
            with rasterio.open(a) as da, rasterio.open(b) as db, rasterio.open(c) as dc:
                self.assertTrue(fw._same_grid(da.profile, db))
                self.assertTrue(fw._same_grid(da, db))        # dataset first: used to raise the TypeError
                self.assertTrue(fw._same_grid(da, db.profile))
                self.assertTrue(fw._same_grid(da.profile, db.profile))
                self.assertFalse(fw._same_grid(da, dc))

    def test_align_raster_same_grid_and_reprojected_branches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ref = self.make(root, "ref.tif", Affine(0.001, 0, 1, 0, -0.001, 2), value=0.0)
            same = self.make(root, "same.tif", Affine(0.001, 0, 1, 0, -0.001, 2), value=5.0)
            shifted = self.make(root, "shifted.tif", Affine(0.001, 0, 1.0005, 0, -0.001, 2.0005), value=7.0)
            out_same = fw.align_raster_to_reference(same, ref, root / "o1.tif")
            out_shift = fw.align_raster_to_reference(shifted, ref, root / "o2.tif")
            with rasterio.open(ref) as r, rasterio.open(out_same) as s, rasterio.open(out_shift) as t:
                self.assertTrue(fw._same_grid(r, s))
                self.assertTrue(fw._same_grid(r, t))
                self.assertAlmostEqual(float(np.nanmedian(s.read(1))), 5.0, places=4)
                self.assertAlmostEqual(float(np.nanmedian(t.read(1))), 7.0, places=3)

    def test_categorical_alignment_keeps_class_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ref = self.make(root, "ref.tif", Affine(0.001, 0, 1, 0, -0.001, 2), value=0.0)
            cat = write_tif(root / "cat.tif", np.full((40, 40), 1), Affine(0.001, 0, 1.0005, 0, -0.001, 2.0005), "uint8", 0)
            out = fw.align_raster_to_reference(cat, ref, root / "o.tif", categorical=True)
            with rasterio.open(out) as ds:
                self.assertEqual(set(np.unique(ds.read(1))) - {0}, {1})

    def test_no_forest_module_subscripts_an_open_rasterio_dataset(self):
        """Static guard: `with rasterio.open(...) as ds:` then `ds["key"]` is always a bug (use ds.crs/.profile/.read)."""
        offenders = []
        for name in ("forest_workflow.py", "forest_analysis.py", "forest_previews.py", "forest_optical_reference.py"):
            tree = ast.parse((HERE / name).read_text(encoding="utf-8"))
            for fn in ast.walk(tree):
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                datasets = set()
                for node in ast.walk(fn):
                    if isinstance(node, (ast.With, ast.AsyncWith)):
                        for item in node.items:
                            call = item.context_expr
                            if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "open"
                                    and isinstance(call.func.value, ast.Name) and call.func.value.id == "rasterio"
                                    and isinstance(item.optional_vars, ast.Name)):
                                datasets.add(item.optional_vars.id)
                for node in ast.walk(fn):
                    if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in datasets
                            and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str)):
                        offenders.append(f"{name}:{node.lineno} {node.value.id}[{node.slice.value!r}]")
        self.assertEqual(offenders, [])

    def test_public_helpers_accept_open_datasets_where_they_compare_grids(self):
        """Every `*same_grid*` helper in the forest modules must tolerate a DatasetReader argument."""
        import forest_analysis, raster_utils
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(Path(tmp), "p.tif", Affine(0.001, 0, 1, 0, -0.001, 2))
            with rasterio.open(p) as ds:
                self.assertTrue(raster_utils.same_grid(ds.profile, ds))
                self.assertTrue(forest_analysis._same_grid(ds.profile, ds.profile))


if __name__ == "__main__":
    unittest.main()
