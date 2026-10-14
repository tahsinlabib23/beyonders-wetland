"""Forest acceptance: scientific invariants and publication isolation."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from rasterio.transform import from_origin

from forest_pipeline import detector, pixel_area, read_config, support_metrics


class ForestDetectorTests(unittest.TestCase):
    def stack(self):
        hv=np.full((7,12,12),-12.,dtype="float32")
        hh=np.full_like(hv,-7.)
        quality=np.ones(hv.shape,dtype=bool)
        tree=np.full((12,12),10)
        study=np.ones((12,12),dtype=bool)
        return hh,hv,quality,tree,study

    def test_two_consecutive_dates_and_minimum_area(self):
        hh,hv,q,tree,study=self.stack(); hv[3:,1:11,1:11]=-15
        a,b,mad,frames=detector(hh,hv,q,tree,study,.0001)
        self.assertEqual(frames[0]["stats"]["candidate_pixels"],0)
        self.assertEqual(frames[1]["stats"]["candidate_pixels"],100)
        self.assertAlmostEqual(frames[1]["stats"]["candidate_area_km2"],.01)
        self.assertTrue(np.array_equal(a,np.full(tree.shape,-12.)))
        self.assertTrue(np.all(mad==0))

    def test_invalid_middle_date_breaks_persistence(self):
        hh,hv,q,tree,study=self.stack();hv[3:]=-16;q[4]=False
        frames=detector(hh,hv,q,tree,study,.0001)[3]
        self.assertEqual(frames[1]["stats"]["candidate_pixels"],0)
        self.assertEqual(frames[2]["stats"]["candidate_pixels"],0)
        self.assertEqual(frames[3]["stats"]["candidate_pixels"],144)
        self.assertTrue(np.all(frames[1]["classification"]==255))

    def test_all_baseline_dates_required(self):
        hh,hv,q,tree,study=self.stack();hv[3:]=-20;q[1]=False
        for frame in detector(hh,hv,q,tree,study,.0001)[3]:
            self.assertEqual(frame["stats"]["assessed_area_km2"],0)

    def test_historical_nonforest_is_unassessed(self):
        hh,hv,q,tree,study=self.stack();hv[3:]=-20;tree[:]=30
        for frame in detector(hh,hv,q,tree,study,.0001)[3]:
            self.assertTrue(np.all(frame["classification"]==255))

    def test_tiny_patches_removed(self):
        hh,hv,q,tree,study=self.stack();hv[3:,2:5,2:5]=-20
        self.assertEqual(detector(hh,hv,q,tree,study,.0001)[3][-1]["stats"]["candidate_pixels"],0)

    def test_boundary_and_nan_never_count_as_unchanged(self):
        hh,hv,q,tree,study=self.stack();study[0]=False;hv[:,1]=np.nan
        frames=detector(hh,hv,q,tree,study,.0001)[3]
        self.assertTrue(np.all(frames[-1]["classification"][:2]==255))

    def test_reproducibility(self):
        hh,hv,q,tree,study=self.stack();hv[3:]=-17
        one=detector(hh,hv,q,tree,study,.0001);two=detector(hh,hv,q,tree,study,.0001)
        for a,b in zip(one[3],two[3]):
            np.testing.assert_array_equal(a["classification"],b["classification"])
            self.assertEqual(a["stats"],b["stats"])

    def test_grid_area(self):
        p={"crs":"EPSG:32720","transform":from_origin(200000,8800000,20,30)}
        self.assertAlmostEqual(pixel_area(p),.0006)
        with self.assertRaises(ValueError):pixel_area({"crs":"EPSG:4326","transform":from_origin(0,0,.01,.01)})

    def test_empty_quality_cannot_form_candidates(self):
        hh,hv,q,tree,study=self.stack();q[:]=False
        self.assertEqual(detector(hh,hv,q,tree,study,.0001)[3][-1]["stats"]["candidate_pixels"],0)


class ForestReferenceTests(unittest.TestCase):
    def test_poor_coverage_suppresses_support_fraction(self):
        candidates=np.ones((10,10));study=np.ones_like(candidates);common=np.zeros_like(candidates,dtype=bool);common[0]=True
        metrics=support_metrics(candidates,study,common,common,.0009)
        self.assertEqual(metrics["status"],"INCONCLUSIVE")
        self.assertIsNone(metrics["support_overlap_fraction"])
        self.assertIsNone(metrics["f1"])

    def test_native_support_area_not_replicated_radar_pixels(self):
        candidates=np.array([[.5,1.],[0.,.25]]);study=np.ones((2,2));common=np.array([[True,False],[True,True]])
        support=np.array([[True,False],[False,False]])
        metrics=support_metrics(candidates,study,common,support,.0009)
        self.assertAlmostEqual(metrics["candidate_supported_area_km2"],.00045)
        self.assertAlmostEqual(metrics["candidate_unassessed_area_km2"],.0009)
        self.assertIsNone(metrics["precision"])
        self.assertIsNone(metrics["recall"])

    def test_no_candidates_no_accuracy_claim(self):
        metrics=support_metrics(np.zeros((3,3)),np.ones((3,3)),np.ones((3,3),bool),np.ones((3,3),bool),.0009)
        self.assertEqual(metrics["status"],"CROSS_SENSOR_CHECK")
        self.assertIsNone(metrics["support_overlap_fraction"])
        self.assertIsNone(metrics["f1"])

    def test_protocol_cannot_silently_change_threshold(self):
        source=Path(__file__).with_name("forest_rondonia.json")
        config=json.loads(source.read_text());config["drop_db"]=2
        temporary_root=Path(__file__).resolve().parent/"output/forests/test-temporaries"
        temporary_root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            path=Path(directory)/"config.json";path.write_text(json.dumps(config))
            with self.assertRaises(ValueError):read_config(path)


if __name__=="__main__": unittest.main()
