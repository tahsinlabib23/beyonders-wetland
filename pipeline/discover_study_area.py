"""Check public NISAR catalog coverage for a study box before opening large science files."""
import argparse
from datetime import date
import json

from main import _set_study_area, _validated_site_name, load_config
from web_job import discover


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-name", required=True)
    parser.add_argument("--bbox", nargs=4, type=float, required=True,
                        metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    if start > end:
        parser.error("Start date must be on or before end date.")
    config = load_config()
    config["site"]["name"] = _validated_site_name(args.site_name)
    _set_study_area(config, bbox=args.bbox)
    config["nisar"]["temporal"] = [start.isoformat(), end.isoformat()]
    result = discover(config)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
