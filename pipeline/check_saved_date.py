"""Check one saved NISAR observation against HLS without changing the published run."""
import argparse
from datetime import date
import json
from pathlib import Path
import re

import numpy as np
from shapely.geometry import shape
from shapely.ops import unary_union

from hls_reference import ReferenceUnavailable, validate_hls_open_water
from main import ROOT, _login_earthdata, load_config
from raster_utils import atomic_json
from reference_evidence import _profile, _read_hls_scene, _render, _resolve_scenes, compare


def check_saved_date(run_id, event_date):
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Run ID must contain 32 lowercase hexadecimal characters.")
    date.fromisoformat(event_date)
    folder = ROOT/"output"/"runs"/run_id
    manifest = json.loads((folder/"run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR":
        raise ValueError("Choose a completed real NISAR run.")
    observations = json.loads((folder/"observations.json").read_text(encoding="utf-8"))
    selected = next((item for item in observations if item["date"] == event_date), None)
    if selected is None:
        raise ValueError("Date is not an observation in this run. See observations.json for available dates.")
    paths = selected["rasters"]
    names = [paths[key] for key in ("before_hh", "after_hh", "before_hv", "after_hv")]
    names += [selected["classification_file"]]
    if any(Path(name).name != name for name in names):
        raise ValueError("Saved observation contains an unsafe artifact path.")

    config = load_config(folder/"processing_config.json")
    output = folder/"date_checks"/event_date
    output.mkdir(parents=True, exist_ok=True)
    _login_earthdata()
    try:
        reference = validate_hls_open_water(
            config, manifest["baseline_date"], event_date, folder/"site_boundary.geojson",
            folder/paths["before_hh"], [folder/paths[key] for key in ("after_hh", "before_hv", "after_hv")],
            folder/selected["classification_file"], folder/"wetland_mask.tif",
            progress=lambda message: print(message, flush=True),
            baseline_observation_dates=selected["baseline_observation_dates"],
        )
    except ReferenceUnavailable as error:
        reference = {"status": "UNAVAILABLE", "reference_validated": False,
                     "reason": str(error), "event_date": event_date,
                     "baseline_observation_dates": selected["baseline_observation_dates"]}
    atomic_json(output/"reference_validation.json", reference)
    print(f"Reference status: {reference['status']}", flush=True)
    print(f"Reference saved: {(output/'reference_validation.json').resolve()}", flush=True)
    if not reference.get("comparison"):
        return output

    arrays, profile, grid, study = _profile(folder, selected)
    valid = study & np.logical_and.reduce([np.isfinite(values) for values in arrays])
    boundary = unary_union([shape(item["geometry"]) for item in
                            json.loads((folder/"site_boundary.geojson").read_text(encoding="utf-8"))["features"]])
    pair = reference["comparison"]
    scene_names = [pair[stage]["scene"] for stage in ("baseline", "event")]
    granules = _resolve_scenes(scene_names, boundary.bounds)
    scenes = []
    for name in scene_names:
        print(f"Rendering optical scene: {name}", flush=True)
        scenes.append(_read_hls_scene(granules[name], profile, boundary.bounds, details=True,
                                      cache_dir=output/"reference_source_cache"))
    before, after = scenes
    threshold = float(pair["mndwi_threshold"])
    common, radar, optical, metrics = compare(grid, valid, before, after, threshold)
    recorded = reference["metrics"]
    expected = (recorded["true_positive_pixels"], recorded["false_positive_pixels"],
                recorded["false_negative_pixels"])
    actual = (metrics["matching_pixels"], metrics["radar_only_pixels"], metrics["optical_only_pixels"])
    if actual != expected or int(common.sum()) != reference["coverage"]["common_clear_pixels"]:
        raise ValueError("Rendered evidence does not reproduce the reference counts; evidence was not published.")
    candidates = valid & (grid == 1)
    radar_only = radar & ~optical
    categories = {
        "water_on_both_optical_dates": radar_only & (before["index"] > threshold) & (after["index"] > threshold),
        "not_water_on_either_optical_date": radar_only & (before["index"] <= threshold) & (after["index"] <= threshold),
        "optical_water_recession": radar_only & (before["index"] > threshold) & (after["index"] <= threshold),
    }
    visuals = _render(output, profile, study, before, after, common, radar, optical, threshold, candidates)
    report = {
        "run_id": run_id, "event_date": event_date,
        "baseline_observation_dates": selected["baseline_observation_dates"],
        "baseline_method": selected.get("baseline_method"),
        "reference_status": reference["status"], "reference_validated": False,
        "comparison": pair, "coverage": reference["coverage"],
        "optical_support": reference.get("optical_support"), "counts_reproduced": True,
        "radar_grid_metrics": metrics,
        "radar_only_categories": {name: int(mask.sum()) for name, mask in categories.items()},
        "candidate_pixels": int(candidates.sum()), "candidate_compared_pixels": int(radar.sum()),
        "visuals": visuals,
        "note": "Satellite agreement is not field validation. This check preserves the saved median radar baseline and does not change the run's selected date.",
    }
    atomic_json(output/"evidence.json", report)
    print(f"Evidence saved: {output.resolve()}", flush=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("event_date", help="An observation date in this run, YYYY-MM-DD")
    args = parser.parse_args()
    check_saved_date(args.run_id, args.event_date)
