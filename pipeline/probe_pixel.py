"""Probe the published run's masked rasters. Default runs contain fake data."""
import argparse
import json
import math
import sys
from pathlib import Path
import numpy as np
import rasterio
from pyproj import Transformer
from output_reader import current_run
from raster_utils import same_grid


def probe_pixel(lat, lng, acquired_date=None, output_root=None, run_id=None):
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("Invalid geographic coordinates.")
    folder, manifest = current_run(output_root)
    if run_id is not None and manifest["run_id"] != run_id:
        raise RuntimeError("Pipeline run changed during this probe request; retry.")
    with open(folder/"observations.json", encoding="utf-8") as handle:
        observations = json.load(handle)
    selected_date = acquired_date or manifest["selected_date"]
    observation = next((o for o in observations if o["date"] == selected_date), None)
    if observation is None:
        raise ValueError("Date is not present in this completed run.")
    names = [observation["rasters"][k] for k in ("before_hh", "after_hh", "before_hv", "after_hv")]
    names.append(observation["classification_file"])
    if any(not isinstance(name, str) or Path(name).name != name for name in names):
        raise ValueError("Invalid raster path in observation.")
    paths = [folder/name for name in names]
    with rasterio.open(paths[0]) as src:
        profile = src.profile.copy()
        x, y = Transformer.from_crs(4326, profile["crs"], always_xy=True).transform(lng, lat)
        bounds = src.bounds
        if (math.isfinite(x) and math.isfinite(y) and
                min(bounds.left, bounds.right) <= x <= max(bounds.left, bounds.right) and
                min(bounds.bottom, bounds.top) <= y <= max(bounds.bottom, bounds.top)):
            row, col = src.index(x, y)
        else:
            row, col = -1, -1
    values = []
    inside = 0 <= row < profile["height"] and 0 <= col < profile["width"]
    grid_value = 0
    for index, path in enumerate(paths):
        with rasterio.open(path) as src:
            if not same_grid(profile, src):
                raise ValueError("Probe rasters have incompatible grids.")
            value = src.read(1, window=((row, row+1), (col, col+1)), masked=True)[0, 0] if inside else np.ma.masked
        if index < 4:
            values.append(float(value) if not np.ma.is_masked(value) and np.isfinite(value) else None)
        elif not np.ma.is_masked(value):
            grid_value = int(value)
    valid = all(value is not None for value in values)
    classification = {1: "OPEN_WATER", 2: "VEGETATED_INUNDATION"}.get(grid_value, "UNCERTAIN")
    hh_b, hh_a, hv_b, hv_a = [round(value, 4) if value is not None else None for value in values]
    return {"lat": lat, "lng": lng, "hh_before": hh_b, "hh_after": hh_a,
            "hv_before": hv_b, "hv_after": hv_a,
            "delta_hh": round(hh_a-hh_b, 4) if valid else None,
            "delta_hv": round(hv_a-hv_b, 4) if valid else None,
            "valid": valid, "acquisition_date": selected_date,
            "land_cover": "Not supplied; detector class is not an observed land-cover label." if valid else "Outside raster or masked/no-data pixel",
            "classification": classification,
            "data_source": "SIMULATED" if manifest["data_source"] == "SIMULATED_DEMO" else manifest.get("data_source", "UNVERIFIED"),
            "run_id": manifest["run_id"], "reference_validated": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lng", type=float, required=True)
    parser.add_argument("--date")
    parser.add_argument("--output-root")
    parser.add_argument("--run-id")
    args = parser.parse_args()
    try:
        print(json.dumps(probe_pixel(args.lat, args.lng, args.date, args.output_root, args.run_id), allow_nan=False))
    except Exception as error:
        print(f"Probe failed: {error}", file=sys.stderr)
        sys.exit(1)
