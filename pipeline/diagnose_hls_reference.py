"""Audit optical QA coverage on the saved NISAR grid without changing results."""
import argparse
from datetime import date, timedelta
import json
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds, Window

from hls_reference import _band_url, _identity
from raster_utils import atomic_json, read_rasters


def diagnose(folder):
    import earthaccess
    strategy = "environment" if os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME") else "netrc"
    if not earthaccess.login(strategy=strategy).authenticated:
        raise RuntimeError("Save Earthdata Login before auditing optical coverage.")
    folder = Path(folder)
    reference = json.loads((folder / "reference_validation.json").read_text())
    case = json.loads((folder / "case_study.json").read_text())
    observations = json.loads((folder / "observations.json").read_text())
    observation = next(item for item in observations if item["date"] == case["event_date"])
    with rasterio.open(folder / observation["classification_file"]) as source:
        profile = source.profile.copy()
    with rasterio.open(folder / "wetland_mask.tif") as source:
        study = source.read(1) == 1
    inputs, _ = read_rasters([folder / observation["rasters"][key]
                             for key in ("before_hh", "after_hh", "before_hv", "after_hv")])
    study &= np.logical_and.reduce([np.isfinite(values) for values in inputs])
    with open(folder / "site_boundary.geojson", encoding="utf-8") as handle:
        boundary = json.load(handle)
    from shapely.geometry import shape
    from shapely.ops import unary_union
    bounds = unary_union([shape(item["geometry"]) for item in boundary["features"]]).bounds
    tolerance = reference.get("selection", {}).get("date_tolerance_days", 5)
    start = date.fromisoformat(case["baseline_date"]) - timedelta(days=tolerance)
    end = date.fromisoformat(case["event_date"]) + timedelta(days=tolerance)
    products = [item["collection"] for item in reference.get("selection", {}).get("catalog_searches", [])] or ["HLSS30"]
    records = []
    for product in products:
        records.extend(earthaccess.search_data(short_name=product, bounding_box=bounds,
                       temporal=(start.isoformat(), end.isoformat()), count=200))
    scene_names = {attempt[key] for attempt in reference["selection"]["attempts"]
                   for key in ("baseline_scene", "event_scene")}
    audits = []
    clear_masks = {}
    for record in records:
        identity = _identity(record)
        if identity is None or identity["granule_id"] not in scene_names:
            continue
        handle = earthaccess.open([_band_url(record, "Fmask")], show_progress=False)[0]
        try:
            with rasterio.open(handle) as source:
                projected = transform_bounds("EPSG:4326", source.crs, *bounds, densify_pts=21)
                window = from_bounds(*projected, source.transform).round_offsets().round_lengths()
                window = window.intersection(Window(0, 0, source.width, source.height))
                masked = source.read(1, window=window, masked=True)
                qa = np.asarray(masked.filled(255), dtype="uint8")
                aligned = np.full((profile["height"], profile["width"]), 255, dtype="uint8")
                reproject(qa, aligned, src_transform=source.window_transform(window), src_crs=source.crs,
                          dst_transform=profile["transform"], dst_crs=profile["crs"],
                          src_nodata=255, dst_nodata=255, resampling=Resampling.nearest)
        finally:
            handle.close()
        observed = study & (aligned != 255)
        flags = {"cloud": (aligned & 2) != 0, "cloud_adjacency": (aligned & 4) != 0,
                 "shadow": (aligned & 8) != 0, "snow_or_ice": (aligned & 16) != 0,
                 "high_aerosol": ((aligned >> 6) & 3) == 3}
        clear = observed & ~np.logical_or.reduce(list(flags.values()))
        clear_masks[identity["granule_id"]] = clear
        values, counts = np.unique(aligned[observed], return_counts=True)
        audits.append({"scene": identity["granule_id"], "date": identity["date"].isoformat(),
                       "valid_nisar_study_pixels": int(study.sum()),
                       "optical_qa_observed_pixels": int(observed.sum()),
                       "qa_clear_pixels": int(clear.sum()),
                       "excluded_pixel_counts": {key: int((observed & value).sum()) for key, value in flags.items()},
                       "qa_histogram": dict(zip(values.astype(str).tolist(), counts.tolist()))})
    pairs = [{"baseline_scene": attempt["baseline_scene"], "event_scene": attempt["event_scene"],
              "common_qa_clear_pixels": int((clear_masks[attempt["baseline_scene"]] &
                                             clear_masks[attempt["event_scene"]]).sum())}
             for attempt in reference["selection"]["attempts"]
             if attempt["baseline_scene"] in clear_masks and attempt["event_scene"] in clear_masks]
    result = {"note": "QA-only audit; overlapping flags are counted separately. Full spectral validity is checked by the reference pipeline.",
              "scenes": audits, "pairs": pairs}
    atomic_json(folder / "hls_coverage_diagnostic.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_folder", type=Path)
    args = parser.parse_args()
    print(json.dumps(diagnose(args.run_folder), indent=2))
