"""Compute rule verdicts from existing measured checks; never invent inputs."""
import json
from pathlib import Path
from raster_utils import atomic_json


def validate_patches(geojson_path, out_geojson=None):
    with open(geojson_path, encoding="utf-8") as handle:
        data = json.load(handle)
    for feature in data["features"]:
        props = feature["properties"]
        statuses = [props[key] for key in ("quality_status", "spatial_status", "temporal_status", "threshold_stability")]
        passes = sum(status in ("PASS", "STABLE") for status in statuses)
        props["evidence_state"] = ("SUPPORTED" if passes == 4 else "MODERATE" if passes >= 2 else "UNCERTAIN")
        props["reference_validated"] = False
        props["evidence_method"] = "Rule consistency only; no accuracy estimate or independent reference validation."
    destination = out_geojson or Path(geojson_path).with_name(Path(geojson_path).stem + "_validated.geojson")
    atomic_json(destination, data)
    return str(destination)
