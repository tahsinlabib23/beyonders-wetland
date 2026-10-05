"""Shared detector sweep with connected-region counts and CRS-aware area."""
import numpy as np
from rasterio.features import shapes
from shapely.geometry import shape
from raster_utils import atomic_json, read_rasters, classify, remove_small_regions, area_km2

DEFAULT_THRESHOLDS = tuple(i / 2 for i in range(1, 11))


def run_sensitivity_sweep(before_hh_path, after_hh_path, before_hv_path, after_hv_path,
                          config, base_thresholds=DEFAULT_THRESHOLDS,
                          out_json="sensitivity_results.json", data_source="UNVERIFIED"):
    arrays, profile = read_rasters([before_hh_path, after_hh_path, before_hv_path, after_hv_path])
    thresholds = sorted(set(float(t) for t in base_thresholds))
    if not thresholds or not all(np.isfinite(t) and t > 0 for t in thresholds):
        raise ValueError("Provide finite positive thresholds.")
    results = []
    for cutoff in thresholds:
        grid = remove_small_regions(classify(arrays, config, cutoff)[0], config["processing"]["minimum_region_pixels"])
        regions = [shape(g) for g, _ in shapes(grid, mask=grid > 0, transform=profile["transform"])]
        results.append({"delta_db": cutoff, "area_km2": sum(area_km2(g, profile["crs"]) for g in regions),
                        "patches": len(regions)})
    base = config["processing"]["base_threshold_db"]
    low, high = max(thresholds[0], base-.5), min(thresholds[-1], base+.5)
    matching = [r for r in results if low <= r["delta_db"] <= high]
    if len(matching) < 2:
        raise ValueError("The sweep must include at least two thresholds surrounding the base cutoff.")
    first, last = matching[0], matching[-1]
    variation = abs(first["area_km2"]-last["area_km2"])/first["area_km2"] if first["area_km2"] > 0 else None
    output = {"patch_id": "global_sweep", "data_source": data_source, "thresholds": results,
              "base_threshold_db": base, "stable_range": [first["delta_db"], last["delta_db"]],
              "stability_verdict": "STABLE" if variation is not None and variation <= .2 else "SENSITIVE",
              "sensitivity_note": "Shared water/vegetation cutoff; areas use the raster CRS and counts use connected regions. Rule stability is not accuracy." +
                (" No detections in the local range: stability is unavailable, conservatively labeled SENSITIVE." if variation is None else "")}
    atomic_json(out_json, output)
    return output
