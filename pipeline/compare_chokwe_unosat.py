"""Measure positive-only overlap with UNOSAT's later Sentinel-1 flood layers.

This is a cross-sensor follow-up comparison on the NISAR native grid, not a
formal accuracy assessment. UNOSAT's product is preliminary and not field
validated; its water polygons do not provide assessed negative labels.
"""
import argparse
import json
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize

from raster_utils import atomic_json


ROOT = Path(__file__).resolve().parent.parent
RUN_ID = "ec8fa5ee15ae41d1aa89f930f2b47e36"
PRODUCT_URL = "https://unosat.org/products/4232"
SHP_URL = "https://unosat.org/static/unosat_filesystem/4232/FL20251231MOZ_SHP.zip"
STUDY_BOUNDS = (32.93, -24.58, 33.03, -24.48)
SCENES = {
    "2026-01-23": "Maputo",
    "2026-01-24": "Maputo_Gaza",
}


def _read_shapes(path, bounds, target_crs):
    frame = gpd.read_file(path, bbox=bounds)
    if frame.crs is None or frame.empty:
        raise ValueError(f"Reference layer is empty or has no CRS: {path.name}")
    if "Sensor_Dat" in frame.columns:
        dates = sorted({value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)[:10]
                        for value in frame["Sensor_Dat"].dropna()})
        expected = path.name.split("_")[1]
        if dates and dates != [f"{expected[:4]}-{expected[4:6]}-{expected[6:8]}"]:
            raise ValueError(f"Reference scene date does not match its layer name: {dates}")
    projected = frame.to_crs(target_crs)
    shapes = [geometry for geometry in projected.geometry
              if geometry is not None and not geometry.is_empty]
    if not shapes:
        raise ValueError(f"Reference layer has no usable geometries: {path.name}")
    return shapes


def compare(run_id=RUN_ID, reference_dir=None, output=None):
    if run_id != RUN_ID:
        raise ValueError("This comparison is defined for the completed Chókwè run only.")
    run = ROOT / "pipeline/output/runs" / run_id
    manifest = json.loads((run / "run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "COMPLETE" or manifest.get("product_maturity") != "BETA":
        raise ValueError("Expected a completed NISAR BETA run.")
    if manifest.get("baseline_date") != "2026-01-05" or manifest.get("selected_date") != "2026-01-17":
        raise ValueError("The saved run does not contain the documented 5–17 January pair.")

    root = Path(reference_dir) if reference_dir else ROOT / "pipeline/output/reference-cache/unosat_4232_shp/FL20251231MOZ_SHP"
    with rasterio.open(run / "classification_00.tif") as source:
        classification = source.read(1)
        profile = source.profile.copy()
    candidate = classification == 1
    candidate_count = int(candidate.sum())
    if not candidate_count:
        raise ValueError("The saved run contains no candidate pixels to compare.")
    pixel_area_km2 = abs(profile["transform"].a * profile["transform"].e -
                         profile["transform"].b * profile["transform"].d) / 1_000_000
    candidate_area_km2 = candidate_count * pixel_area_km2
    water_pixel_area = {}
    results = []

    for acquisition_date, region in SCENES.items():
        date_tag = acquisition_date.replace("-", "")
        water_path = root / f"S1_{date_tag}_WaterExtent_{region}.shp"
        extent_path = root / f"S1_{date_tag}_AnalysisExtent_{region}.shp"
        if not water_path.is_file() or not extent_path.is_file():
            raise FileNotFoundError(f"Extract the UNOSAT product ZIP; missing {water_path.name} or {extent_path.name}.")
        print(f"Reading UNOSAT {acquisition_date} layers", flush=True)
        water_shapes = _read_shapes(water_path, STUDY_BOUNDS, profile["crs"])
        extent_shapes = _read_shapes(extent_path, STUDY_BOUNDS, profile["crs"])
        water = rasterize(((geometry, 1) for geometry in water_shapes), out_shape=classification.shape,
                          transform=profile["transform"], fill=0, dtype="uint8") == 1
        coverage = rasterize(((geometry, 1) for geometry in extent_shapes), out_shape=classification.shape,
                             transform=profile["transform"], fill=0, dtype="uint8") == 1
        overlap_count = int(np.count_nonzero(candidate & water))
        assessed_count = int(np.count_nonzero(candidate & coverage))
        day_offset = (date.fromisoformat(acquisition_date) - date.fromisoformat(manifest["selected_date"])).days
        result = {
            "acquisition_date": acquisition_date,
            "days_after_nisar_event": day_offset,
            "reference_water_pixels_in_study_box": int(water.sum()),
            "candidate_pixels_overlapping_reference_water": overlap_count,
            "candidate_overlap_area_km2": round(overlap_count * pixel_area_km2, 4),
            "candidate_fraction_overlapping_reference_water": overlap_count / candidate_count,
            "candidate_pixels_inside_reference_analysis_extent": assessed_count,
            "candidate_coverage_fraction": assessed_count / candidate_count,
        }
        results.append(result)
        print(json.dumps(result), flush=True)

    report = {
        "schema_version": 1,
        "run_id": run_id,
        "site_name": manifest.get("site_name"),
        "study_bounds_wgs84": list(STUDY_BOUNDS),
        "nisar": {
            "product": manifest.get("product"),
            "maturity": manifest.get("product_maturity"),
            "baseline_date": manifest["baseline_date"],
            "event_date": manifest["selected_date"],
            "method": "HH change <= -2.5 dB, one preceding observation",
            "candidate_pixels": candidate_count,
            "candidate_area_km2": round(candidate_area_km2, 4),
            "grid_crs": str(profile["crs"]),
            "pixel_area_km2": pixel_area_km2,
        },
        "reference": {
            "provider": "UNITAR/UNOSAT",
            "product_id": 4232,
            "product_url": PRODUCT_URL,
            "source_zip_url": SHP_URL,
            "sensor": "Sentinel-1",
            "product_dates": ["2026-01-23", "2026-01-24"],
            "preliminary": True,
            "field_validated": False,
            "overlay_method": "Rasterize the published water extent and analysis extent onto the native NISAR classification grid; count NISAR candidate pixels within mapped water.",
            "cell_rule": "Cell-center rasterization; candidate overlap is positive spatial support only.",
            "results": results,
        },
        "interpretation": "The later Sentinel-1 water extent spatially overlaps most NISAR HH-darkening candidates. The 6–7 day offset, preliminary unvalidated reference, differing sensors/products, and positive-only water layer prevent this from being a same-date truth map or a formal precision/recall/F1 assessment.",
    }
    target = Path(output) if output else ROOT / "docs/chokwe-unosat-overlap.json"
    atomic_json(target, report)
    print(f"Saved overlap report: {target}")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default=RUN_ID)
    parser.add_argument("--reference-dir", type=Path,
                        help="Extracted UNOSAT 4232 SHP folder containing the Sentinel-1 layers.")
    parser.add_argument("--output", type=Path,
                        help="Output JSON path; defaults to docs/chokwe-unosat-overlap.json.")
    args = parser.parse_args()
    compare(args.run_id, args.reference_dir, args.output)
