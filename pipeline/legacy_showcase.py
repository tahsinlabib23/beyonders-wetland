"""Adapter: export a completed REAL NISAR run saved in the older loose-output format.

Older runs have `last_attempt.json` (the run manifest) plus loose artifacts such as
`wetland_pulse.json`, `patches_final.geojson` and `sensitivity_results.json`, and
no `run_manifest.json`, `observations.json`, per-date patch files or radar previews.

Rules enforced here (nothing is invented):
  * the manifest must be the expected run, COMPLETE, real NISAR, product NISAR_L2_GCOV_PROVISIONAL_V1;
  * acquisition dates come only from the manifest's scene names;
  * each loose derived artifact is exported ONLY if it is consistent with that manifest
    (same dates, same site, geometry inside the study bounds). Otherwise it is skipped and
    the reason is recorded in the showcase manifest;
  * the boundary is exported only if a committed boundary file matches the manifest's
    recorded boundary source and site bounds;
  * raw TIFF rasters, radar previews, HLS evidence and validation are never created or copied.

Standard library only, so it runs without the pipeline virtualenv.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_PRODUCT = "NISAR_L2_GCOV_PROVISIONAL_V1"
SCENE_DATE = re.compile(r"_(\d{8})T\d{6}_")
PATCH_REQUIRED = ("id", "date", "area_km2", "classification", "quality_status", "spatial_status",
                  "temporal_status", "threshold_stability", "evidence_state", "mean_delta_db", "valid_fraction", "centroid")
BOUNDS_TOLERANCE_DEG = 0.02
AREA_TOLERANCE = 0.02

LIMITATIONS = [
    "NISAR L2 GCOV input is a provisional product; results are exploratory.",
    "A radar change candidate is not confirmed flooding; backscatter change can have several causes.",
    "No field truth is included. No cross-sensor (optical) comparison is included in this export.",
    "The study boundary is a mapped haor polygon (CRIIPS), not the Ramsar site boundary or a legal wetland extent.",
    "Areas with no candidate polygon were not classified as unchanged; they have no detector result.",
    "Acquisition gaps are real: no values are interpolated between NISAR observations.",
]


class LegacyRunError(ValueError):
    """The legacy run cannot be exported safely."""


def load(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def scene_date(name: str) -> str:
    match = SCENE_DATE.search(name)
    if not match:
        raise LegacyRunError(f"Cannot read an acquisition date from scene name: {name}")
    raw = match.group(1)
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"


def is_legacy_run(folder: Path) -> bool:
    return (folder / "last_attempt.json").is_file() and not (folder / "run_manifest.json").is_file()


def validate_manifest(manifest: dict, run_id: str) -> dict:
    """Return real acquisition facts, or raise LegacyRunError."""
    checks = [
        (manifest.get("run_id") == run_id, f"run_id is {manifest.get('run_id')!r}, expected {run_id!r}"),
        (manifest.get("status") == "COMPLETE", f"status is {manifest.get('status')!r}, expected 'COMPLETE'"),
        (manifest.get("data_source") == "NISAR", f"data_source is {manifest.get('data_source')!r}, expected 'NISAR'"),
        (manifest.get("mode") in (None, "real"), f"mode is {manifest.get('mode')!r}, expected 'real'"),
        (manifest.get("product") == EXPECTED_PRODUCT, f"product is {manifest.get('product')!r}, expected {EXPECTED_PRODUCT!r}"),
        (manifest.get("seed") in (None,), "a seed implies simulated input"),
    ]
    for ok, message in checks:
        if not ok:
            raise LegacyRunError(f"Refusing legacy export: {message}.")
    scenes = manifest.get("observation_scenes") or []
    dates = [scene_date(name) for name in scenes]
    if not dates or len(dates) != manifest.get("observation_count") or len(set(dates)) != len(dates) or dates != sorted(dates):
        raise LegacyRunError("Refusing legacy export: observation scenes do not match observation_count / are not unique and ordered.")
    selected = manifest.get("selected_date")
    if selected not in dates:
        raise LegacyRunError("Refusing legacy export: selected_date is not one of the observation scene dates.")
    baseline_scene = manifest.get("baseline_scene")
    if baseline_scene and scene_date(baseline_scene) != manifest.get("baseline_date"):
        raise LegacyRunError("Refusing legacy export: baseline_date does not match the baseline scene name.")
    return {"observation_dates": dates, "selected_date": selected, "baseline_date": manifest.get("baseline_date"),
            "baseline_observation_dates": manifest.get("baseline_observation_dates") or []}


def _walk_bbox(coords, box):
    if coords and isinstance(coords[0], (int, float)):
        box[0] = min(box[0], coords[0]); box[1] = min(box[1], coords[1]); box[2] = max(box[2], coords[0]); box[3] = max(box[3], coords[1])
    else:
        for item in coords:
            _walk_bbox(item, box)


def bbox_of(collection: dict):
    box = [float("inf"), float("inf"), float("-inf"), float("-inf")]
    for feature in collection.get("features", []):
        if feature.get("geometry"):
            _walk_bbox(feature["geometry"]["coordinates"], box)
    return box if box[0] != float("inf") else None


def inside(box, bounds, tol=BOUNDS_TOLERANCE_DEG) -> bool:
    return bool(box and bounds and box[0] >= bounds[0] - tol and box[1] >= bounds[1] - tol and box[2] <= bounds[2] + tol and box[3] <= bounds[3] + tol)


def check_pulse(pulse, facts, manifest):
    problems = []
    if not isinstance(pulse, dict) or not isinstance(pulse.get("dates"), list) or not pulse["dates"]:
        return ["wetland_pulse.json has no 'dates' list"]
    dates = [item.get("date") for item in pulse["dates"]]
    obs = facts["observation_dates"]
    extra = sorted(set(dates) - set(obs)); missing = sorted(set(obs) - set(dates))
    if extra:
        problems.append(f"pulse has dates that are not NISAR acquisitions of this run: {', '.join(extra)}")
    if missing:
        problems.append(f"pulse is missing acquisition dates of this run: {', '.join(missing)}")
    if (pulse.get("peak") or {}).get("date") != facts["selected_date"]:
        problems.append(f"pulse peak date {(pulse.get('peak') or {}).get('date')!r} differs from the run's selected_date {facts['selected_date']!r}")
    site = str(pulse.get("site", "")).strip().lower(); run_site = str(manifest.get("site_name", "")).strip().lower()
    if site and run_site and not (site == run_site or run_site.startswith(site) or site.startswith(run_site)):
        problems.append(f"pulse site {pulse.get('site')!r} differs from the run's site {manifest.get('site_name')!r}")
    return problems


def check_patches(collection, facts, manifest):
    problems = []
    features = collection.get("features") if isinstance(collection, dict) else None
    if not features:
        return ["patches file has no features"]
    for index, feature in enumerate(features):
        props = feature.get("properties") or {}
        absent = [key for key in PATCH_REQUIRED if key not in props]
        if absent:
            problems.append(f"feature {index} lacks required properties: {', '.join(absent)}"); break
        if props["date"] != facts["selected_date"]:
            problems.append(f"feature {props.get('id')} is dated {props['date']}, not the run's selected_date {facts['selected_date']}"); break
        if props.get("run_id") not in (None, manifest["run_id"]):
            problems.append(f"feature {props.get('id')} belongs to a different run"); break
        if props.get("data_source") not in (None, "NISAR"):
            problems.append(f"feature {props.get('id')} has data_source {props.get('data_source')!r}"); break
    bounds = manifest.get("site_bounds")
    box = bbox_of(collection)
    if not inside(box, bounds):
        problems.append(f"patch geometry bbox {[round(v, 4) for v in box] if box else None} is outside the run's study bounds {bounds}")
    return problems


def check_sensitivity(sweep, pulse):
    rows = sweep.get("thresholds") if isinstance(sweep, dict) else None
    if not rows or not all({"delta_db", "area_km2", "patches"} <= set(row) for row in rows):
        return ["sensitivity file has no well-formed thresholds table"]
    target = float((pulse.get("peak") or {}).get("area_km2", -1))
    if not any(abs(float(row["area_km2"]) - target) <= max(0.01, AREA_TOLERANCE * target) for row in rows):
        return [f"no sensitivity row matches the pulse peak area ({target} km²), so the sweep cannot be tied to this detection"]
    return []


def find_boundary(repo_root: Path, manifest: dict):
    """A committed boundary file is trusted only if its source string and bounds match the manifest."""
    source = str(manifest.get("wetland_boundary_source") or ""); bounds = manifest.get("site_bounds")
    if not source or not bounds:
        return None, "manifest records no boundary source / site bounds"
    for path in sorted((repo_root / "pipeline" / "data").glob("*boundary*.geojson")):
        try:
            collection = load(path)
        except (OSError, ValueError):
            continue
        props = (collection.get("features") or [{}])[0].get("properties") or {}
        if str(props.get("boundary_source", "")).strip() != source.strip():
            continue
        box = bbox_of(collection)
        if box and all(abs(a - b) <= 1e-3 for a, b in zip(box, bounds)):
            return (path, collection), None
    return None, "no committed boundary file matches the manifest's boundary source and site bounds"


def round_coords(value, places=5):
    return round(value, places) if isinstance(value, (int, float)) else [round_coords(v, places) for v in value]


def slim(collection):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": f["geometry"]["type"], "coordinates": round_coords(f["geometry"]["coordinates"])} if f.get("geometry") else None,
         "properties": f.get("properties", {})} for f in collection.get("features", [])]}


def export_legacy(run: Path, out: Path, run_id: str, repo_root: Path, write_json) -> dict:
    """Write the showcase into `out` (already created). Returns a summary dict."""
    manifest = load(run / "last_attempt.json")
    facts = validate_manifest(manifest, run_id)
    skipped, used = [], 0

    def skip(name, reason):
        skipped.append({"artifact": name, "reason": reason})

    # Boundary
    boundary_name = None
    found, why = find_boundary(repo_root, manifest)
    if found:
        path, collection = found
        used += write_json(out / "boundary.geojson", slim(collection)); boundary_name = (collection["features"][0].get("properties") or {}).get("name")
    else:
        skip("boundary.geojson", why)

    # Derived artifacts: pulse -> patches -> sensitivity, each only if consistent with the manifest.
    pulse = None; patch_dates = []; sensitivity_ok = False
    pulse_path = run / "wetland_pulse.json"
    if pulse_path.is_file():
        candidate = load(pulse_path); problems = check_pulse(candidate, facts, manifest)
        if problems:
            skip("wetland_pulse.json", "; ".join(problems))
        else:
            pulse = candidate; used += write_json(out / "pulse.json", pulse)
    else:
        skip("wetland_pulse.json", "file not present")

    patch_path = run / "patches_final.geojson"
    if pulse is None:
        why = "not exported because the pulse could not be verified against this run"
        if patch_path.is_file():
            own = check_patches(load(patch_path), facts, manifest)
            why += "; independent check of the patches: " + ("; ".join(own) if own else "consistent, but the app needs a verified pulse to place them in time")
        skip("patches_final.geojson", why)
    elif patch_path.is_file():
        collection = load(patch_path); problems = check_patches(collection, facts, manifest)
        if problems:
            skip("patches_final.geojson", "; ".join(problems))
        else:
            target = f"patches/{facts['selected_date']}.geojson"
            used += write_json(out / target, slim(collection)); patch_dates.append(facts["selected_date"])
    else:
        skip("patches_final.geojson", "file not present")

    sens_path = run / "sensitivity_results.json"
    if pulse is None:
        skip("sensitivity_results.json", "not exported because the pulse could not be verified against this run")
    elif sens_path.is_file():
        sweep = load(sens_path); problems = check_sensitivity(sweep, pulse)
        if problems:
            skip("sensitivity_results.json", "; ".join(problems))
        else:
            used += write_json(out / "sensitivity.json", sweep); sensitivity_ok = True
    else:
        skip("sensitivity_results.json", "file not present")

    for name in ("radar previews", "reference_validation.json / reference_evidence.json (HLS)", "per-date patch files for other dates", "raw TIFF rasters (never copied)"):
        skip(name, "not present in the legacy run" if "never" not in name else "raw rasters are not published")

    observations = []
    for index, date in enumerate(facts["observation_dates"]):
        observations.append({"date": date, "index": index, "patches_file": f"patches/{date}.geojson" if date in patch_dates else None,
                             "scene_name": manifest["observation_scenes"][index]})
    used += write_json(out / "observations.json", observations)
    write_json(out / "reference.json", {"available": False})

    completeness = "METADATA_ONLY" if pulse is None else ("PARTIAL" if len(patch_dates) < len(observations) or not sensitivity_ok else "FULL")
    keys = ("run_id", "product", "product_maturity", "frequency", "baseline_date", "baseline_scene", "baseline_method", "baseline_observation_dates",
            "selected_date", "observation_count", "site_name", "site_bounds", "wetland_boundary_source", "quality_mask_method",
            "reference_validated", "cross_sensor_check_completed", "reference_check_status", "reference_validation_status", "completed_at", "data_source")
    clean = {k: manifest.get(k) for k in keys if k in manifest}
    clean.update({
        "showcase_version": 1, "case_id": out.name, "label": "REAL NISAR-DERIVED SHOWCASE (LEGACY RUN)",
        "exported_at": datetime.now(timezone.utc).isoformat(), "legacy_format": True, "completeness": completeness,
        "site_display_name": boundary_name or manifest.get("site_name"),
        "observation_dates": facts["observation_dates"], "observation_scenes": manifest.get("observation_scenes"),
        "radar_dates": [], "has_reference": False, "reference_validated": bool(manifest.get("reference_validated")),
        "availability": {"acquisition_dates": True, "boundary": bool(found), "pulse": pulse is not None, "sensitivity": sensitivity_ok,
                         "patch_dates": patch_dates, "radar_dates": [], "reference": False},
        "legacy": {"source_manifest": "last_attempt.json", "skipped": skipped,
                   "note": "Legacy runs lack per-date patch files, radar previews and optical evidence. Only artifacts verified against the run manifest are included; nothing was reconstructed."},
        "limitations": LIMITATIONS, "source": "NASA/JPL NISAR L2 GCOV via NASA CMR / ASF DAAC (processed locally; raw HDF5/TIFF not distributed)",
        "total_bytes": used,
    })
    write_json(out / "manifest.json", clean)
    return {"completeness": completeness, "observations": len(observations), "patch_dates": patch_dates, "skipped": skipped, "bytes": used,
            "site": clean.get("site_display_name")}
