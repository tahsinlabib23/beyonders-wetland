"""Rebuild the catalog/pointer from already immutable viewer packages."""
import argparse
import json
import re
from pathlib import Path
from raster_utils import atomic_json


def refresh(root: Path, current: str | None = None):
    versions = []
    for manifest_path in root.glob("releases/*/runs/*/run_manifest.json"):
        version, run_id = manifest_path.parents[2].name, manifest_path.parent.name
        if not re.fullmatch(r"[a-f0-9]{32}", run_id) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}", version):
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        publication = json.loads((manifest_path.parent / "publication.json").read_text(encoding="utf-8"))
        evidence = json.loads((manifest_path.parent / "reference_validation.json").read_text(encoding="utf-8"))
        observations = json.loads((manifest_path.parent / "observations.json").read_text(encoding="utf-8"))
        if manifest.get("status") != "COMPLETE" or publication.get("run_id") != run_id:
            raise ValueError(f"Incomplete publication: {version}/{run_id}")
        versions.append({"run_id": run_id, "site_name": manifest.get("site_name"), "hazard_type": publication.get("hazard_type", "wetland_flood_change"), "publication_version": version,
            "dates": [item["date"] for item in observations], "method_version": publication["method_version"],
            "evidence_status": evidence.get("status"), "interpretation_status": publication["interpretation_status"],
            "path": f"releases/{version}/runs/{run_id}", "published_at": publication["published_at"]})
    if not versions:
        raise ValueError("No complete immutable study releases found.")
    grouped = {}
    for entry in sorted(versions, key=lambda item: item["published_at"]):
        grouped[entry["run_id"]] = entry
    studies = sorted(grouped.values(), key=lambda item: item["published_at"], reverse=True)
    chosen = current or studies[0]["run_id"]
    entry = next((item for item in versions if item["run_id"] == chosen), None)
    if not entry:
        raise ValueError("Chosen current study is not published.")
    catalog = {"schema_version": 1, "studies": studies, "releases": sorted(versions, key=lambda item: item["published_at"], reverse=True)}
    atomic_json(root / "catalog.json", catalog)
    atomic_json(root / "current_run.json", {**json.loads((root / entry["path"] / "run_manifest.json").read_text(encoding="utf-8")), "publication_version": entry["publication_version"]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--studies", type=Path, default=Path(__file__).parent.parent / "public/studies")
    parser.add_argument("--current")
    args = parser.parse_args()
    refresh(args.studies, args.current)
    print(f"Updated published catalog: {args.studies / 'catalog.json'}")
