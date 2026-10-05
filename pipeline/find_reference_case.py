"""Find nearby NISAR dates with independent clear QA coverage, without scoring detections."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
import json
from pathlib import Path

import numpy as np
import rasterio
from shapely.geometry import shape
from shapely.ops import unary_union

from hls_reference import _common_tile_pairs, _read_hls_qa, _qa_clear, ReferenceUnavailable
from main import ROOT, load_config
from raster_utils import atomic_json, read_rasters, same_grid


def find_cases(folder, maximum_span_days=24):
    import earthaccess
    from web_job import authenticate
    authenticate()
    folder = Path(folder)
    manifest = json.loads((folder/"run_manifest.json").read_text())
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR":
        raise ValueError("Select a completed real NISAR run.")
    observations = json.loads((folder/"observations.json").read_text())
    with rasterio.open(folder/"wetland_mask.tif") as source:
        study, profile = source.read(1) == 1, source.profile.copy()
    boundary = unary_union([shape(item["geometry"]) for item in
                           json.loads((folder/"site_boundary.geojson").read_text())["features"]])
    first = observations[0]
    entries = [{"date": manifest["baseline_date"], "scene": manifest["baseline_scene"],
                "rasters": [first["rasters"][key] for key in ("before_hh", "before_hv")]}]
    entries += [{"date": item["date"], "scene": item["scene_name"],
                 "rasters": [item["rasters"][key] for key in ("after_hh", "after_hv")]} for item in observations]
    validity = {}
    for entry in entries:
        if any(Path(name).name != name for name in entry["rasters"]):
            raise ValueError("Invalid saved raster filename.")
        paths = [folder/name for name in entry["rasters"]]
        arrays, _ = read_rasters(paths)
        with rasterio.open(paths[0]) as source:
            if not same_grid(profile, source):
                raise ValueError("Saved radar dates do not share a grid.")
        validity[entry["date"]] = study & np.logical_and.reduce([np.isfinite(value) for value in arrays])
    config = load_config()
    tolerance = int(config["validation"]["date_tolerance_days"])
    start = min(date.fromisoformat(item["date"]) for item in entries)-timedelta(days=tolerance)
    end = max(date.fromisoformat(item["date"]) for item in entries)+timedelta(days=tolerance)
    records = []
    for product in config["validation"].get("reference_products", [config["validation"]["reference_product"]]):
        found = earthaccess.search_data(short_name=product, bounding_box=boundary.bounds,
                                        temporal=(start.isoformat(), end.isoformat()), count=300)
        print(f"{product}: {len(found)} optical records", flush=True)
        records.extend(found)
    paired = []
    needed = {}
    for before in entries:
        for after in entries:
            span = (date.fromisoformat(after["date"])-date.fromisoformat(before["date"])).days
            if not 0 < span <= maximum_span_days:
                continue
            try:
                pairs = _common_tile_pairs(records, date.fromisoformat(before["date"]),
                                          date.fromisoformat(after["date"]), tolerance, boundary)
            except ReferenceUnavailable:
                continue
            paired.append((before, after, pairs))
            for first_scene, second_scene in pairs:
                for scene in (first_scene, second_scene):
                    needed[scene["granule_id"]] = scene["granule"]
    qa, failures = {}, []
    cache = ROOT/"output"/"reference_qa_cache"
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(_read_hls_qa, granule, profile, boundary.bounds, cache): name
                   for name, granule in needed.items()}
        for index, future in enumerate(as_completed(futures), 1):
            name = futures[future]
            try:
                qa[name] = _qa_clear(future.result())
                print(f"QA scene {index}/{len(futures)}: {name}, {int((qa[name] & study).sum())} clear study pixels", flush=True)
            except Exception as error:
                failures.append({"scene": name, "error_type": type(error).__name__})
                print(f"QA scene {index}/{len(futures)} unavailable: {type(error).__name__}", flush=True)
    candidates = []
    for before, after, pairs in paired:
        valid = validity[before["date"]] & validity[after["date"]]
        best = None
        for first_scene, second_scene in pairs:
            if first_scene["granule_id"] not in qa or second_scene["granule_id"] not in qa:
                continue
            pixels = int((valid & qa[first_scene["granule_id"]] & qa[second_scene["granule_id"]]).sum())
            if best is None or pixels > best[0]:
                best = (pixels, first_scene, second_scene)
        if best is not None:
            pixels, first_scene, second_scene = best
            candidates.append({"baseline_date": before["date"], "event_date": after["date"],
                               "scene_names": [before["scene"], after["scene"]],
                               "common_qa_clear_fraction": pixels/int(study.sum()),
                               "baseline_reference": first_scene["granule_id"], "event_reference": second_scene["granule_id"]})
    candidates.sort(key=lambda item: (-item["common_qa_clear_fraction"],
                                     (date.fromisoformat(item["event_date"])-date.fromisoformat(item["baseline_date"])).days,
                                     item["baseline_date"], item["event_date"]))
    result = {"run_id": manifest["run_id"], "method": "Ranked only by common QA-clear coverage, then shortest NISAR interval. Detection agreement is not consulted.",
              "date_tolerance_days": tolerance, "maximum_case_span_days": maximum_span_days,
              "note": "Preflight only. Spectral validity and full reference comparison must still be computed.",
              "scenes_screened": len(qa), "unavailable_scenes": failures, "candidates": candidates}
    atomic_json(folder/"reference_case_candidates.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_folder", type=Path)
    find_cases(parser.parse_args().run_folder)
