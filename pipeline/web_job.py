"""Local browser jobs: public discovery, explicit NISAR processing, reference retries."""
import argparse
from datetime import date, datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import yaml

from main import ROOT, load_config, run_pipeline, _set_study_area, _read_boundary, _validated_site_name
from raster_utils import atomic_json

OUTPUT = ROOT/"output"
JOBS = OUTPUT/"jobs"


def user_error(error):
    """Keep transport internals in the local log, with actionable browser errors."""
    message = str(error)
    if "10013" in message or "access permissions" in message:
        return "The local worker cannot reach NASA because network access is blocked. Restart the development server from a normal PowerShell terminal, then retry."
    if any(value in message for value in ("HTTPSConnectionPool", "ConnectionError", "Max retries exceeded", "ConnectTimeout", "Read timed out")):
        return "Could not connect to NASA's data service. Check your internet connection and retry; existing results are still available."
    return message


def authenticate():
    import earthaccess
    strategy = "environment" if os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME") else "netrc"
    try:
        auth = earthaccess.login(strategy=strategy)
        if not auth.authenticated:
            raise RuntimeError("Login failed")
    except Exception as error:
        raise RuntimeError("Earthdata Login is not available. In the local terminal, run the pipeline Python with earthaccess.login(persist=True), then try again.") from error


def area_config(request, job_id):
    config = load_config()
    config["site"]["name"] = _validated_site_name(request.get("siteName"))
    start, end = date.fromisoformat(request.get("startDate", "")), date.fromisoformat(request.get("endDate", ""))
    if start > end or end > date.today():
        raise ValueError("Choose an ordered observation date range ending today or earlier.")
    config["nisar"]["temporal"] = [start.isoformat(), end.isoformat()]
    config["nisar"]["search_limit"] = 200
    boundary = request.get("boundary")
    if boundary is not None:
        path = JOBS/f"{job_id}_boundary.geojson"
        if not isinstance(boundary, dict) or boundary.get("type") != "FeatureCollection":
            raise ValueError("Upload a GeoJSON FeatureCollection containing valid polygons in WGS84.")
        atomic_json(path, boundary)
        _set_study_area(config, boundary_geojson=path)
    else:
        bounds = request.get("bbox")
        if not isinstance(bounds, list) or len(bounds) != 4:
            raise ValueError("Select an area on the map or upload a GeoJSON boundary.")
        _set_study_area(config, bbox=bounds)
    area = config["site"]["bbox"]
    if area["max_lon"]-area["min_lon"] > 2 or area["max_lat"]-area["min_lat"] > 2:
        raise ValueError("Choose a smaller study area, up to 2 degrees across, for this local processor.")
    return config


def discover(config):
    from search_nisar import search_scenes, select_compatible_series
    results = search_scenes(config)
    series = select_compatible_series(results, config)
    scenes = []
    for identity, granule in series:
        archives = granule.get("umm", {}).get("DataGranule", {}).get("ArchiveAndDistributionInformation", [])
        size_bytes = 0
        units = {"bytes": 1, "kilobytes": 1000, "megabytes": 1000000, "gigabytes": 1000000000,
                 "b": 1, "kb": 1000, "mb": 1000000, "gb": 1000000000}
        for archive in archives:
            try:
                if str(archive.get("Name", "")).lower().endswith(".h5") or len(archives) == 1:
                    if archive.get("SizeInBytes") is not None:
                        size_bytes += float(archive["SizeInBytes"])
                    else:
                        size_bytes += float(archive.get("Size", 0))*units.get(str(archive.get("SizeUnit", "megabytes")).lower(), 0)
            except (ValueError, TypeError):
                pass
        scenes.append({"date": identity["date"], "name": identity["name"],
                       "full_granule_gb": round(size_bytes/1e9, 2) if size_bytes else None})
    return {"site_name": config["site"]["name"], "product": config["nisar"]["product"],
            "bbox": config["site"]["bbox"], "scenes": scenes, "catalog_hits": len(results),
            "search_limit_reached": len(results) >= config["nisar"]["search_limit"],
            "note": "Matching track, direction, frame, mode, polarizations and release. Choose two different dates. Full-granule sizes are not a transfer estimate; this processor reads a spatial subset."}


def recheck_reference(run_id, progress):
    from hls_reference import validate_hls_open_water
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Select a saved real NISAR run.")
    folder = OUTPUT/"runs"/run_id
    manifest = json.loads((folder/"run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR":
        raise ValueError("Reference checking requires a completed real NISAR run.")
    config = load_config()
    recorded = json.loads((folder/"processing_config.json").read_text(encoding="utf-8"))
    config["processing"] = recorded["processing"]
    config["validation"] = {**config["validation"], **recorded.get("validation", {})}
    config["site"]["name"] = manifest["site_name"]
    _set_study_area(config, boundary_geojson=folder/"site_boundary.geojson")
    case = json.loads((folder/"case_study.json").read_text(encoding="utf-8"))
    observations = json.loads((folder/"observations.json").read_text(encoding="utf-8"))
    selected = next(item for item in observations if item["date"] == case["event_date"])
    rasters = selected["rasters"]
    authenticate()
    progress(f"Checking Sentinel-2 and Landsat reference pairs (up to {config['validation'].get('maximum_reference_pairs', 16)})")
    reference = validate_hls_open_water(config, manifest["baseline_date"], case["event_date"],
        folder/"site_boundary.geojson", folder/rasters["before_hh"],
        [folder/rasters[key] for key in ("after_hh", "before_hv", "after_hv")],
        folder/selected["classification_file"], folder/"wetland_mask.tif", progress=progress,
        baseline_observation_dates=selected.get("baseline_observation_dates", [manifest["baseline_date"]]))
    previous = json.loads((folder/"reference_validation.json").read_text(encoding="utf-8"))
    atomic_json(folder/"reference_checks"/f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_previous.json", previous)
    reference["checked_at"] = datetime.now(timezone.utc).isoformat()
    atomic_json(folder/"reference_validation.json", reference)
    case["reference_validation"] = reference
    case["uncertainty"]["reference_status"] = reference["status"]
    case["uncertainty"]["reference_coverage"] = reference["coverage"]
    atomic_json(folder/"case_study.json", case)
    manifest.update(reference_check_status=reference["status"], reference_validation_status=reference["status"],
                    cross_sensor_check_completed=reference["cross_sensor_check_completed"], reference_validated=False)
    atomic_json(folder/"run_manifest.json", manifest)
    evidence_prepared = False
    try:
        from reference_evidence import build_reference_evidence
        build_reference_evidence(run_id, progress=progress)
        evidence_prepared = True
    except Exception as error:
        logging.warning("Optical evidence could not be prepared (%s); reference statistics are saved.", type(error).__name__)
    return {"run_id": run_id, "reference_status": reference["status"], "coverage": reference["coverage"],
            "evaluated_pairs": reference.get("selection", {}).get("evaluated_pairs", 1), "evidence_prepared": evidence_prepared}


def execute(job_id):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise ValueError("Invalid job identifier")
    job_path = JOBS/f"{job_id}.json"
    request = json.loads((JOBS/f"{job_id}_request.json").read_text(encoding="utf-8"))
    job = {"id": job_id, "action": request["action"], "pid": os.getpid(), "status": "RUNNING",
           "started_at": datetime.now(timezone.utc).isoformat()}
    def progress(stage):
        job["stage"] = stage
        atomic_json(job_path, job)
    try:
        os.environ["BEYONDERS_WEB_JOB"] = "1"
        if request["action"] in ("search", "run"):
            progress("Searching NASA's public NISAR scene catalog")
            config = area_config(request, job_id)
            if request["action"] == "search":
                result = discover(config)
            else:
                from search_nisar import scene_identity
                names = request.get("sceneNames")
                if not isinstance(names, list) or len(names) != 2 or len(set(names)) != 2:
                    raise ValueError("Search first, then select two different NISAR dates.")
                identities = [scene_identity(name) for name in names]
                if identities[0]["compatibility"] != identities[1]["compatibility"] or identities[0]["date"] >= identities[1]["date"]:
                    raise ValueError("Select a chronological NISAR pair with matching observation geometry.")
                authenticate()
                config_path = JOBS/f"{job_id}_config.yaml"
                config_path.write_text(yaml.safe_dump(config), encoding="utf-8")
                manifest = run_pipeline(config_path=config_path, mode="real", scene_names=names, progress=progress)
                result = {"run_id": manifest["run_id"], "site_name": manifest["site_name"],
                          "reference_status": manifest["reference_check_status"]}
        elif request["action"] == "reference":
            result = recheck_reference(request.get("runId"), progress)
        elif request["action"] == "preview":
            from radar_previews import render_run
            run_id = request.get("runId", "")
            if not re.fullmatch(r"[a-f0-9]{32}", run_id):
                raise ValueError("Invalid run identifier")
            progress("Rendering saved radar inputs")
            result = {"run_id": run_id, "date_pairs": render_run(OUTPUT/"runs"/run_id)}
        elif request["action"] == "evidence":
            from reference_evidence import build_reference_evidence
            report = build_reference_evidence(request.get("runId", ""), progress=progress)
            result = {"run_id": report["run_id"], "reference_status": report["reference_status"],
                "evidence_prepared": True, "counts_reproduced": report["counts_reproduced"],
                "matching_pixels": report["metrics"]["matching_pixels"],
                "radar_only_pixels": report["metrics"]["radar_only_pixels"]}
        else:
            raise ValueError("Unsupported processing action")
        job.update(status="COMPLETE", stage="Complete", result=result,
                   completed_at=datetime.now(timezone.utc).isoformat())
    except Exception as error:
        logging.exception("Local processing job failed")
        job.update(status="FAILED", stage="Processing stopped", error=user_error(error),
                   completed_at=datetime.now(timezone.utc).isoformat())
    finally:
        atomic_json(job_path, job)
        active = JOBS/"active.json"
        if active.is_file():
            try:
                if json.loads(active.read_text(encoding="utf-8")).get("id") == job_id:
                    active.unlink(missing_ok=True)
            except (ValueError, OSError):
                pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_id")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    execute(parser.parse_args().job_id)
