"""Render actual cropped NISAR dB inputs for the browser; metrics keep native grids."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
from matplotlib import colormaps
import numpy as np
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds

from raster_utils import atomic_json, read_rasters


def render_run(folder):
    folder = Path(folder).resolve()
    observations = json.loads((folder/"observations.json").read_text(encoding="utf-8"))
    manifest = json.loads((folder/"run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("data_source") != "NISAR":
        raise ValueError("Radar evidence images require a real NISAR run.")
    for index, observation in enumerate(observations):
        layers = {}
        for channel in ("hh", "hv"):
            names = [observation["rasters"][f"{stage}_{channel}"] for stage in ("before", "after")]
            if any(Path(name).name != name for name in names):
                raise ValueError("Invalid source raster filename.")
            arrays, profile = read_rasters([folder/name for name in names])
            before, after = arrays
            height, width = profile["height"], profile["width"]
            native = profile["transform"]
            left, bottom, right, top = transform_bounds(profile["crs"], "EPSG:3857",
                *(__import__("rasterio").transform.array_bounds(height, width, native)), densify_pts=21)
            span_x, span_y = right-left, top-bottom
            out_width = max(1, round(768*span_x/max(span_x, span_y)))
            out_height = max(1, round(768*span_y/max(span_x, span_y)))
            display_transform = from_bounds(left, bottom, right, top, out_width, out_height)
            valid_samples = np.concatenate([values[np.isfinite(values)] for values in arrays])
            if not valid_samples.size:
                raise ValueError("No finite radar data to display.")
            low, high = (float(value) for value in np.percentile(valid_samples, [2, 98]))
            if high-low < 1:
                high = low+1
            images = {}
            for stage, values in (("before", before), ("after", after), ("change", after-before)):
                display = np.full((out_height, out_width), np.nan, dtype="float32")
                reproject(values.astype("float32"), display, src_transform=native, src_crs=profile["crs"],
                    dst_transform=display_transform, dst_crs="EPSG:3857", src_nodata=np.nan,
                    dst_nodata=np.nan, resampling=Resampling.bilinear)
                limits = [-10.0, 10.0] if stage == "change" else [low, high]
                normalized = np.clip((display-limits[0])/(limits[1]-limits[0]), 0, 1)
                pixels = colormaps["RdBu_r" if stage == "change" else "gray"](np.nan_to_num(normalized), bytes=True)
                pixels[:, :, 3] = np.where(np.isfinite(display), 255, 0)
                filename = f"radar_{index:02d}_{channel}_{stage}.png"
                Image.fromarray(pixels).save(folder/filename)
                images[stage] = filename
            west, south, east, north = transform_bounds("EPSG:3857", "EPSG:4326", left, bottom, right, top)
            layers[channel] = {"images": images, "scale_db": [round(low, 2), round(high, 2)],
                "change_scale_db": [-10, 10], "source_rasters": dict(zip(("before", "after"), names)),
                "bounds": [[south, west], [north, east]], "width": out_width, "height": out_height}
        atomic_json(folder/f"radar_preview_{index:02d}.json", {
            "run_id": manifest["run_id"], "date": observation["date"],
            "baseline_date": manifest.get("baseline_date"), "baseline_scene": manifest.get("baseline_scene"),
            "baseline_observation_dates": observation.get("baseline_observation_dates", [manifest.get("baseline_date")]),
            "baseline_method": observation.get("baseline_method"),
            "event_scene": observation.get("scene_name"), "layers": layers,
            "patches_file": observation.get("patches_file"), "classification_file": observation.get("classification_file"),
            "note": "Actual masked GCOV power in dB. Before/after share a 2nd–98th percentile scale. Display uses bilinear resampling in Web Mercator; detection and statistics use the original grid. Transparent pixels are excluded or unavailable."})
    return len(observations)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    arguments = parser.parse_args()
    print(f"Rendered {render_run(arguments.folder)} date pairs.")
