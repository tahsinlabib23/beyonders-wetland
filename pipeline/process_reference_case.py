"""Process the highest-coverage preflight pair from saved real NISAR subsets."""
import argparse
import json
import logging
import re

from main import ROOT, load_config, run_pipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_run_id")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{32}", args.source_run_id):
        parser.error("Invalid saved run ID.")
    source = ROOT/"output"/"runs"/args.source_run_id
    with open(source/"run_manifest.json", encoding="utf-8") as handle:
        source_manifest = json.load(handle)
    with open(source/"reference_case_candidates.json", encoding="utf-8") as handle:
        screening = json.load(handle)
    config = load_config()
    candidates = screening.get("candidates", [])
    if not candidates or candidates[0]["common_qa_clear_fraction"] < config["validation"]["minimum_clear_coverage"]:
        raise ValueError("No screened pair meets the configured minimum common clear coverage. Keep the result inconclusive.")
    selected = candidates[0]
    selection = {"source_run_id": args.source_run_id, "method": screening["method"],
                 "screened_scenes": screening["scenes_screened"], "candidate_pairs": len(candidates),
                 "selected_pair": selected, "note": screening["note"]}
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    manifest = run_pipeline(mode="real", site_name=source_manifest["site_name"],
                            boundary_geojson=source/"site_boundary.geojson",
                            start_date=selected["baseline_date"], end_date=selected["event_date"],
                            scene_names=selected["scene_names"], cached_run_id=args.source_run_id,
                            reference_case_selection=selection, progress=logging.info)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
