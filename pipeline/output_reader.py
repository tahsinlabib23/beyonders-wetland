"""Resolve only the current completed run; legacy loose outputs are never used."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "output"


def current_run(output_root=None):
    root = Path(output_root or ROOT).resolve()
    try:
        with open(root/"current_run.json", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except FileNotFoundError as error:
        raise RuntimeError("Pipeline output is unavailable: no completed run.") from error
    if manifest.get("status") != "COMPLETE":
        raise RuntimeError(f"Pipeline output is unavailable: {manifest.get('status', 'UNKNOWN')}")
    identifier = manifest.get("run_id", "")
    if not isinstance(identifier, str) or re.fullmatch(r"[a-f0-9]{32}", identifier) is None:
        raise ValueError("Invalid run identifier.")
    folder = (root/"runs"/identifier).resolve()
    if folder.parent != (root/"runs").resolve():
        raise ValueError("Run folder is outside the output directory.")
    return folder, manifest


def read_output(name, output_root=None):
    if re.fullmatch(r"[A-Za-z0-9_]+\.(json|geojson)", name) is None:
        raise ValueError("Invalid output filename.")
    folder, manifest = current_run(output_root)
    with open(folder/name, encoding="utf-8") as handle:
        return json.load(handle), manifest
