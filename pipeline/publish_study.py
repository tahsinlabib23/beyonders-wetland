"""Publish a credential-free, immutable viewer package from a completed real run.

Science rasters and original candidate geometries stay in the local download ZIP.
Display geometry is simplified in metres; measured statistics are unchanged.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform
from raster_utils import atomic_json

ROOT = Path(__file__).resolve().parent.parent
METHOD = "hh-hv-change-v1"
ID = re.compile(r"^[a-f0-9]{32}$")
VERSION = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$")


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, str):
        if re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith(("/home/", "/Users/")):
            return value.replace("\\", "/").rsplit("/", 1)[-1]
        if re.search(r"(?i)(password|access_token|authorization|bearer)\s*[=:]", value):
            raise ValueError("Potential secret in publication metadata; inspect locally.")
    return value


def display_geometry(data, tolerance):
    forward = Transformer.from_crs(4326, 6933, always_xy=True).transform
    reverse = Transformer.from_crs(6933, 4326, always_xy=True).transform
    for feature in data.get("features", []):
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            raise ValueError("Invalid candidate geometry; repair the source run explicitly.")
        simplified = mapping(transform(reverse, transform(forward, geometry).simplify(tolerance, preserve_topology=True)))
        def round_coordinates(values):
            return [round_coordinates(item) for item in values] if isinstance(values, (list, tuple)) else round(values, 6)
        simplified["coordinates"] = round_coordinates(simplified["coordinates"])
        feature["geometry"] = simplified
    data["display_geometry"] = {"simplification_metres": tolerance, "statistics_source": "original native-grid output", "not_for_measurement": True}
    return data


def publish(run_id, version, destination=None, downloads_url=None):
    if not ID.fullmatch(run_id) or not VERSION.fullmatch(version):
        raise ValueError("Use a 32-character run ID and a safe publication version.")
    source = ROOT / "pipeline/output/runs" / run_id
    manifest = json.loads((source / "run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR" or manifest.get("run_id") != run_id:
        raise ValueError("Only a completed, matching real NISAR run can be published.")
    observations = json.loads((source / "observations.json").read_text(encoding="utf-8"))
    if not observations or manifest.get("selected_date") not in [item["date"] for item in observations]:
        raise ValueError("Selected date is missing from observation index.")
    reference = json.loads((source / "reference_validation.json").read_text(encoding="utf-8"))
    root = Path(destination) if destination else ROOT / "public/studies"
    target = root / "releases" / version / "runs" / run_id
    if target.exists():
        raise ValueError("Immutable publication already exists. Choose a new version.")
    if downloads_url:
        parsed = urlparse(downloads_url)
        if parsed.scheme != "https" or parsed.hostname != "github.com" or "/releases/download/" not in parsed.path or parsed.query or parsed.fragment:
            raise ValueError("Downloads URL must be an HTTPS GitHub release download directory.")
    required = {"run_manifest.json", "observations.json", "case_study.json", "site_boundary.geojson", "wetland_pulse.json", "sensitivity_results.json", "reference_validation.json"}
    files = set(required)
    for index, observation in enumerate(observations):
        name = observation["patches_file"]
        if not re.fullmatch(r"patches_[a-zA-Z0-9_]+\.geojson", name):
            raise ValueError("Invalid observation artifact name.")
        files.add(name)
        files.add(f"radar_preview_{index:02d}.json")
        files.update(path.name for path in source.glob(f"radar_{index:02d}_*.png"))
    files.add("patches_final.geojson")
    if (source / "reference_evidence.json").exists():
        evidence = json.loads((source / "reference_evidence.json").read_text(encoding="utf-8"))
        metrics = reference.get("metrics", {})
        expected = {"matching_pixels": metrics.get("true_positive_pixels"), "radar_only_pixels": metrics.get("false_positive_pixels"), "optical_only_pixels": metrics.get("false_negative_pixels")}
        if evidence.get("run_id") != run_id or evidence.get("comparison") != reference.get("comparison") or any(evidence.get("metrics", {}).get(k) != v for k, v in expected.items()):
            raise ValueError("Stale optical evidence; rebuild before publishing.")
        files.add("reference_evidence.json")
        files.update(name for name in evidence.get("artifacts", []) if re.fullmatch(r"reference_[a-z_]+\.png", name))
    for date_folder in (source / "date_checks").glob("*"):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_folder.name):
            continue
        for name in ["reference_validation.json", "evidence.json"]:
            if (date_folder / name).exists():
                files.add(f"date_checks/{date_folder.name}/{name}")
        files.update(f"date_checks/{date_folder.name}/{p.name}" for p in date_folder.glob("reference_*.png"))
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="publication-", dir=root))
    try:
        checksums = {}
        for name in sorted(files):
            path = source / name
            if not path.is_file() or path.is_symlink():
                raise ValueError(f"Required publication artifact missing or linked: {name}")
            output = stage / name
            output.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix in (".json", ".geojson"):
                data = clean(json.loads(path.read_text(encoding="utf-8")))
                if name.startswith("patches_"):
                    data = display_geometry(data, 10)
                if name == "run_manifest.json":
                    data.update(publication_version=version, method_version=METHOD, reference_validated=False, interpretation_status="UNVERIFIED_RADAR_CHANGE", reference_availability=reference.get("status", "NOT_RUN"))
                output.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
                if output.stat().st_size > 3_900_000:
                    raise ValueError(f"Viewer JSON exceeds response budget: {name}; publish fewer dates or improve the display derivative explicitly.")
            else:
                shutil.copyfile(path, output)
            checksums[name] = {"sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "bytes": output.stat().st_size}
        downloads = {}
        zip_name = f"{run_id}-{version}-sources.zip"
        zip_folder = ROOT / "pipeline/output/publication-downloads"
        zip_folder.mkdir(parents=True, exist_ok=True)
        zip_path = zip_folder / zip_name
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(source.glob("*")):
                if path.is_file() and not path.is_symlink() and (path.suffix == ".tif" or re.fullmatch(r"patches_[a-zA-Z0-9_]+\.geojson", path.name)):
                    archive.write(path, path.name)
                    if downloads_url:
                        downloads[path.name] = downloads_url.rstrip("/") + "/" + zip_name
        publication = {"schema_version": 1, "run_id": run_id, "publication_version": version, "hazard_type": "wetland_flood_change", "method_version": METHOD,
            "published_at": datetime.now(timezone.utc).isoformat(), "run_status": "COMPLETE", "reference_availability": reference.get("status", "NOT_RUN"),
            "interpretation_status": "UNVERIFIED_RADAR_CHANGE", "reference_validated": False,
            "display_geometry_tolerance_metres": 10, "artifacts": checksums, "downloads": downloads,
            "source_archive": {"filename": zip_name, "sha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(), "bytes": zip_path.stat().st_size, "url": downloads_url.rstrip("/") + "/" + zip_name if downloads_url else None}}
        atomic_json(stage / "publication.json", publication)
        atomic_json(stage / "evidence_card.json", {"run_id": run_id, "site_name": manifest.get("site_name"), "hazard_type": "wetland_flood_change", "product": manifest.get("product"),
            "dates": [item["date"] for item in observations], "baseline_dates": manifest.get("baseline_observation_dates"),
            "boundary_source": manifest.get("wetland_boundary_source"), "method_version": METHOD, "reference": reference,
            "claim": "Measured radar-change candidates; confirmed flooding is not established.", "publication_version": version})
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(stage, target)
        catalog_path = root / "catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {"schema_version": 1, "studies": []}
        release = {"run_id": run_id, "site_name": manifest.get("site_name"), "hazard_type": "wetland_flood_change", "publication_version": version,
            "dates": [item["date"] for item in observations], "method_version": METHOD,
            "evidence_status": reference.get("status"), "interpretation_status": "UNVERIFIED_RADAR_CHANGE",
            "path": f"releases/{version}/runs/{run_id}"}
        catalog["releases"] = [item for item in catalog.get("releases", [])
            if (item["run_id"], item["publication_version"]) != (run_id, version)] + [release]
        catalog["studies"] = [item for item in catalog["studies"] if item["run_id"] != run_id] + [release]
        atomic_json(catalog_path, catalog)
        atomic_json(root / "current_run.json", {**clean(manifest), "publication_version": version})
        return target
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--version", required=True)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--downloads-url")
    args = parser.parse_args()
    print(publish(args.run_id, args.version, args.destination, args.downloads_url))
