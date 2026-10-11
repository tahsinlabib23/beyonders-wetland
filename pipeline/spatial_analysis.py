"""Preserve geometry-derived checks without fabricating contextual datasets."""
import json
from pathlib import Path
from raster_utils import atomic_json


def run_spatial_analysis(geojson_path, context_raster=None, out_geojson=None):
    if context_raster is not None:
        raise NotImplementedError("Land-cover context sampling is not implemented; do not fabricate contextual values.")
    with open(geojson_path, encoding="utf-8") as handle:
        data = json.load(handle)
    for feature in data["features"]:
        props = feature["properties"]
        props["contextual_land_cover"] = None
        props["distance_to_water_m"] = None
        props["context_status"] = "NOT_AVAILABLE"
    destination = out_geojson or Path(geojson_path).with_name(Path(geojson_path).stem + "_spatial.geojson")
    atomic_json(destination, data)
    return str(destination)
