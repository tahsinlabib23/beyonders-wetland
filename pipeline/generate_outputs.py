"""Publish sample JSON files only from a fully completed run."""
import json
from pathlib import Path
from raster_utils import atomic_json


def consolidate_outputs(pipeline_dir, target_dir):
    source, target = Path(pipeline_dir), Path(target_dir)
    files = {"wetland_pulse.json": "sample_pulse.json", "patches_final.geojson": "sample_patches.geojson",
             "sensitivity_results.json": "sample_sensitivity.json"}
    content = {}
    for name, destination in files.items():
        with open(source / name, encoding="utf-8") as handle:
            content[destination] = json.load(handle)
    for destination, values in content.items():
        atomic_json(target / destination, values)
    return len(content)
