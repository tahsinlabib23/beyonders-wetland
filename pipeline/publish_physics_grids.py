"""Publish compact, nearest-native-pixel grids for public case inspectors.

These are sampled previews for interactive education, not analysis rasters.
The full-resolution source rasters stay in operator-managed run folders.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parents[1]
FOREST_RUN = ROOT / "pipeline/output/forests/runs/03111a500c5846af95e207984e1ebd0b"
CHOKWE_RUN = ROOT / "pipeline/output/runs/ec8fa5ee15ae41d1aa89f930f2b47e36"
FOREST_STUDY = ROOT / "public/forests/rondonia/2026.10.08-v1/study.json"
FOREST_INDEX = ROOT / "public/forests/rondonia/index.json"
FOREST_INDEX_URL = "/forests/rondonia/index.json"
GRID_WIDTH = 128
GRID_HEIGHT = 128


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sampled_band(path: Path, bbox: list[float]) -> list[float | None]:
    west, south, east, north = bbox
    destination = np.full((GRID_HEIGHT, GRID_WIDTH), np.nan, dtype=np.float32)
    with rasterio.open(path) as source:
        if source.crs is None:
            raise ValueError(f"Missing CRS: {path}")
        if source.count != 1:
            raise ValueError(f"Expected one band: {path}")
        transform = Affine((east - west) / GRID_WIDTH, 0, west, 0,
                           -(north - south) / GRID_HEIGHT, north)
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=transform,
            dst_crs="EPSG:4326",
            dst_nodata=np.nan,
            resampling=Resampling.nearest,
        )
    return [None if not np.isfinite(value) else round(float(value), 2)
            for value in destination.ravel()]


def publish_grid(output: Path, payload: dict) -> str:
    if output.exists():
        raise FileExistsError(f"Refusing to replace published sample grid: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    digest = sha256(output)
    checksums = output.parent / "checksums.json"
    checksums.write_text(json.dumps({output.name: digest}, indent=2) + "\n", encoding="utf-8")
    manifest = output.parent / "manifest.json"
    manifest.write_text(json.dumps({
        "schema_version": 1,
        "artifact": output.name,
        "sha256": digest,
        "grid": [GRID_WIDTH, GRID_HEIGHT],
        "sampling": "Nearest native pixel at each regular WGS84 preview-grid cell center.",
        "use": "Interactive education only; do not use this sampled preview grid for area or accuracy calculations.",
    }, indent=2) + "\n", encoding="utf-8")
    return digest


def publish_chokwe(version: str) -> str:
    preview = read_json(CHOKWE_RUN / "radar_preview_00.json")
    bounds = preview["layers"]["hh"]["bounds"]
    bbox = [bounds[0][1], bounds[0][0], bounds[1][1], bounds[1][0]]
    payload = {
        "schema_version": 1,
        "kind": "wetland",
        "site": "Chókwè, Mozambique",
        "band": "NISAR L-band L2 GCOV BETA",
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
        "bbox": bbox,
        "sampling": "Nearest source raster pixel at each WGS84 preview-grid cell center; masked cells are null.",
        "baseline_date": preview["baseline_date"],
        "event_date": preview["date"],
        "units": "sigma0 dB",
        "hh_before_db": sampled_band(CHOKWE_RUN / "before_hh_masked.tif", bbox),
        "hv_before_db": sampled_band(CHOKWE_RUN / "before_hv_masked.tif", bbox),
        "hh_after_db": sampled_band(CHOKWE_RUN / "after_00_hh_masked.tif", bbox),
        "hv_after_db": sampled_band(CHOKWE_RUN / "after_00_hv_masked.tif", bbox),
        "limitations": [
            "The compact grid is for nearest-pixel inspection, not classification or area measurement.",
            "This case contains NISAR L-band only; no matched C-band value is available.",
            "HH/HV values alone do not uniquely distinguish open water from flooded vegetation.",
        ],
    }
    output = ROOT / f"public/physics/chokwe/{version}/pixel-grid.json"
    return publish_grid(output, payload)


def publish_forest(version: str) -> str:
    study = read_json(FOREST_STUDY)
    payload = {
        "schema_version": 1,
        "kind": "forest",
        "site": "Rondônia, Brazil",
        "band": "NISAR L-band L2 GCOV PROVISIONAL",
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
        "bbox": study["bbox"],
        "sampling": "Nearest source raster pixel at each WGS84 preview-grid cell center; masked cells are null.",
        "baseline_dates": study["baseline_dates"],
        "native_resolution_m": 20,
        "units": "sigma0 dB",
        "baseline_hh_db": sampled_band(FOREST_RUN / "baseline_hh.tif", study["bbox"]),
        "baseline_hv_db": sampled_band(FOREST_RUN / "baseline_hv.tif", study["bbox"]),
        "frames": {},
        "limitations": [
            "RFDI is computed from these sampled backscatter values in linear power.",
            "RFDI is a radar scattering ratio, not a biomass or forest-loss estimate.",
            "The compact grid is not used for published candidate areas or accuracy metrics.",
        ],
    }
    for frame in study["frames"]:
        date = frame["date"]
        payload["frames"][date] = {
            "hh_db": sampled_band(FOREST_RUN / f"{date}_hh.tif", study["bbox"]),
            "hv_db": sampled_band(FOREST_RUN / f"{date}_hv.tif", study["bbox"]),
        }
    output = ROOT / f"public/physics/rondonia/{version}/pixel-grid.json"
    digest = publish_grid(output, payload)
    index = read_json(FOREST_INDEX)
    index["physics_grid_url"] = f"/physics/rondonia/{version}/pixel-grid.json"
    index["physics_grid_checksums_url"] = f"/physics/rondonia/{version}/checksums.json"
    FOREST_INDEX.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="2026.10.29-v1", help="New immutable supplement directory name")
    args = parser.parse_args()
    if not args.version or any(part in args.version for part in ("..", "/", "\\")):
        raise SystemExit("Version must be a single path segment.")
    outputs = [
        ROOT / f"public/physics/chokwe/{args.version}/pixel-grid.json",
        ROOT / f"public/physics/rondonia/{args.version}/pixel-grid.json",
    ]
    existing = [str(path) for path in outputs if path.exists()]
    if existing:
        raise SystemExit("Refusing to overwrite immutable supplement(s): " + ", ".join(existing))
    chokwe = publish_chokwe(args.version)
    forest = publish_forest(args.version)
    print(f"Chokwe sample grid SHA-256: {chokwe}")
    print(f"Rondonia sample grid SHA-256: {forest}")
    print(f"Forest index updated: {FOREST_INDEX_URL}")


if __name__ == "__main__":
    main()
