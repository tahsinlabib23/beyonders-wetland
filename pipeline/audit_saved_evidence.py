"""Reproduce a compact evidence inventory without fetching or changing science outputs."""
import argparse
import json
from pathlib import Path
from raster_utils import atomic_json


def audit(root):
    result = []
    for folder in sorted(Path(root).glob("*")):
        if not (folder / "run_manifest.json").is_file():
            continue
        manifest = json.loads((folder / "run_manifest.json").read_text(encoding="utf-8"))
        if manifest.get("data_source") != "NISAR" or manifest.get("status") != "COMPLETE":
            continue
        for reference_path in [folder / "reference_validation.json", *sorted((folder / "date_checks").glob("*/reference_validation.json"))]:
            if not reference_path.is_file():
                continue
            reference = json.loads(reference_path.read_text(encoding="utf-8"))
            evidence_path = reference_path.parent / ("reference_evidence.json" if reference_path.parent == folder else "evidence.json")
            evidence = json.loads(evidence_path.read_text(encoding="utf-8")) if evidence_path.exists() else {}
            support = reference.get("optical_support", {})
            coverage = support.get("common_clear_fraction", reference.get("coverage", {}).get("common_clear_fraction"))
            usable = reference.get("status") == "CROSS_SENSOR_CHECK" and coverage is not None and coverage >= .2
            result.append({"run_id": folder.name, "site_name": manifest.get("site_name"), "check": reference_path.parent.name,
                "status": reference.get("status"), "coverage_fraction": coverage, "comparison": reference.get("comparison"),
                "metrics_reportable": usable, "precision": support.get("precision") if usable else None,
                "recall": support.get("recall") if usable else None, "f1": support.get("f1") if usable else None,
                "radar_only_categories": evidence.get("radar_only_categories") if usable else None,
                "reference_validated": False, "interpretation": "UNVERIFIED_RADAR_CHANGE"})
    return {"schema_version": 1, "selection": "all complete local NISAR runs; no ranking by agreement", "checks": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, default=Path(__file__).parent / "output/runs")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    atomic_json(args.output, audit(args.runs))
    print(f"Evidence inventory saved: {args.output}")
