"""Forest-specific NISAR GCOV time-series screening.

This module is deliberately separate from the wetland detector. It expects real,
calibrated dB GeoTIFFs extracted from compatible NISAR L2 GCOV observations and a
sourced binary forest mask. It identifies potential structural backscatter anomalies;
it does not classify confirmed deforestation, determine cause, or measure recovery.

Manifest format is documented in FOREST_MODULE_GUIDE.md. No data are simulated by
this CLI. Synthetic rasters are used only inside the isolated unit tests.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import warnings
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import rasterio
from pyproj import CRS
from rasterio.features import shapes
from rasterio.warp import transform_bounds, transform_geom
from scipy.ndimage import find_objects, label
from shapely.geometry import shape, mapping

SCHEMA_VERSION = 1
METHOD_VERSION = "forest-gcov-anomaly-v1"
REQUIRED_COMPATIBILITY = (
    "product", "product_maturity", "frequency", "polarizations",
    "track", "direction", "frame", "bandwidth", "frequency_a_bandwidth", "frequency_b_bandwidth",
    "polarization_mode", "paired_polarization_mode", "polarization_mode_code", "acquisition", "release",
)


def _iso_date(value: Any, label: str = "date") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an ISO date string.")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD.") from exc


def _resolve(base: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty path.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"{label} does not exist: {path}")
    return path


def _validate_compatibility(manifest: dict[str, Any], observations: list[dict[str, Any]]) -> tuple[bool, str]:
    reference = manifest.get("compatibility")
    if not isinstance(reference, dict):
        return False, "The manifest must declare a compatibility signature for the selected NISAR series."
    missing = [key for key in REQUIRED_COMPATIBILITY if key not in reference]
    if missing:
        return False, "Compatibility signature is missing: " + ", ".join(missing) + "."
    if reference.get("product") != "NISAR_L2_GCOV_PROVISIONAL_V1":
        return False, "This first forest workflow requires NISAR_L2_GCOV_PROVISIONAL_V1."
    if reference.get("frequency") != "frequencyA":
        return False, "This first forest workflow requires frequencyA L-band GCOV observations."
    pols = reference.get("polarizations")
    if pols not in (["HHHH", "HVHV"], ["HVHV", "HHHH"]):
        return False, "Both HHHH and HVHV diagonal power layers are required."
    if reference.get("product_maturity") != "PROVISIONAL":
        return False, "This implementation accepts only one explicitly declared product maturity; use PROVISIONAL for current L-band GCOV."
    if any(reference.get(key) in (None, "") for key in ("track", "direction", "frame", "bandwidth", "polarization_mode", "acquisition", "release")):
        return False, "Track, direction, frame, both band modes, both polarization modes, acquisition mode and processing release must be recorded for the selected series."
    for index, item in enumerate(observations):
        if not isinstance(item, dict):
            return False, f"Observation {index + 1} is not an object."
        local = item.get("compatibility")
        if not isinstance(local, dict):
            return False, f"Observation {index + 1} is missing its compatibility signature."
        for key in REQUIRED_COMPATIBILITY:
            if local.get(key) != reference.get(key):
                return False, f"Observation {index + 1} is incompatible ({key} differs); mixed series are not analysed."
    return True, "All selected observations declare the same product, maturity, frequency, polarization, track, direction, frame, bandwidth and release."


def _read_raster(path: Path) -> tuple[np.ndarray, dict[str, Any], np.ndarray]:
    with rasterio.open(path) as src:
        if src.count != 1 or src.crs is None:
            raise ValueError(f"Expected a single-band raster with a CRS: {path.name}")
        values = src.read(1, masked=True).astype("float64").filled(np.nan)
        profile = src.profile.copy()
        valid = np.isfinite(values)
        if src.nodata is not None and isinstance(src.nodata, (int, float)) and math.isfinite(float(src.nodata)):
            valid &= values != float(src.nodata)
    return values, profile, valid


def _same_grid(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (
        CRS.from_user_input(a["crs"]) == CRS.from_user_input(b["crs"])
        and a["width"] == b["width"] and a["height"] == b["height"]
        and a["transform"].almost_equals(b["transform"], precision=1e-8)
    )


def _area_km2(geometry, crs_value: Any) -> float:
    crs = CRS.from_user_input(crs_value)
    if crs.is_geographic:
        area, _ = crs.get_geod().geometry_area_perimeter(geometry)
        return abs(float(area)) / 1_000_000
    if not crs.is_projected or len(crs.axis_info) < 2:
        raise ValueError("Candidate area cannot be measured for this CRS.")
    factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
    return abs(float(geometry.area)) * factors[0] * factors[1] / 1_000_000


def _blocked_result(manifest: dict[str, Any], checks: list[dict[str, str]], message: str) -> dict[str, Any]:
    site = manifest.get("site") if isinstance(manifest.get("site"), dict) else {}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "methodVersion": METHOD_VERSION,
        "dataSource": "NISAR",
        "resultType": "potential forest structural disturbance candidates",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "runId": uuid4().hex,
        "site": {"name": str(site.get("name") or "Unnamed forest study area"), "bounds": None},
        "product": (manifest.get("compatibility") or {}).get("product") if isinstance(manifest.get("compatibility"), dict) else None,
        "productMaturity": (manifest.get("compatibility") or {}).get("product_maturity") if isinstance(manifest.get("compatibility"), dict) else None,
        "readiness": {"status": "BLOCKED", "summary": message, "checks": checks},
        "method": {"thresholdDb": None, "robustMultiplier": None, "minimumRegionPixels": None},
        "observations": [], "candidates": [], "limitations": [
            "No forest-change conclusions are available because the input requirements failed.",
            "No data or detections were generated to fill missing inputs.",
        ],
    }


def analyze_manifest(manifest_path: str | Path, threshold_db: float = 2.5,
                     robust_multiplier: float = 3.0, minimum_region_pixels: int = 20,
                     minimum_valid_fraction: float = 0.70) -> dict[str, Any]:
    """Analyze a forest-mask-constrained GCOV series or return a BLOCKED report.

    Input HH/HV rasters must contain dB power, matching the existing GCOV extractor.
    A candidate is a local departure from a leave-one-out, multi-observation median.
    Thresholds are screening parameters requiring site-specific evaluation, not a
    validated universal forest-loss classifier.
    """
    if not 0.5 <= threshold_db <= 8:
        raise ValueError("threshold_db must be between 0.5 and 8 dB.")
    if not 1 <= robust_multiplier <= 8:
        raise ValueError("robust_multiplier must be between 1 and 8.")
    if minimum_region_pixels < 1:
        raise ValueError("minimum_region_pixels must be positive.")
    if not 0.1 <= minimum_valid_fraction <= 1:
        raise ValueError("minimum_valid_fraction must be between 0.1 and 1.")

    manifest_path = Path(manifest_path).resolve()
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise ValueError("Forest manifest must be a JSON object.")
    base = manifest_path.parent
    site = manifest.get("site") if isinstance(manifest.get("site"), dict) else {}
    observations = manifest.get("observations")
    if not isinstance(observations, list):
        observations = []
    checks: list[dict[str, str]] = []

    compatibility_ok, compatibility_message = _validate_compatibility(manifest, observations)
    checks.append({"id": "compatible_series", "label": "Compatible NISAR series",
                   "status": "PASS" if compatibility_ok else "FAIL", "message": compatibility_message})
    dates_ok = True
    normalized_dates: list[str] = []
    try:
        for idx, item in enumerate(observations):
            normalized_dates.append(_iso_date(item.get("date"), f"Observation {idx + 1} date"))
        dates_ok = normalized_dates == sorted(normalized_dates) and len(set(normalized_dates)) == len(normalized_dates)
    except (AttributeError, TypeError, ValueError):
        dates_ok = False
    dates_message = "Observation dates are unique and chronological." if dates_ok else "Observation dates must be valid, unique and already sorted chronologically."
    checks.append({"id": "chronology", "label": "Chronological dates", "status": "PASS" if dates_ok else "FAIL", "message": dates_message})
    count_ok = len(observations) >= 3
    checks.append({"id": "series_length", "label": "Multi-date baseline", "status": "PASS" if count_ok else "FAIL",
                   "message": f"{len(observations)} observations supplied; at least 3 are required for this screening method."})
    if not (compatibility_ok and dates_ok and count_ok):
        return _blocked_result(manifest, checks, "The series is not ready for forest analysis. Resolve the failed requirements and rerun.")

    forest_mask_path = None
    try:
        mask_source = site.get("forest_mask_source")
        if not isinstance(mask_source, str) or not mask_source.strip():
            raise ValueError("site.forest_mask_source must cite the forest-cover dataset, version and source URL or reference.")
        forest_mask_path = _resolve(base, site.get("forest_mask_path"), "site.forest_mask_path")
        mask_values, reference_profile, mask_valid = _read_raster(forest_mask_path)
        forest_mask = mask_valid & (mask_values > 0)
        if not forest_mask.any():
            raise ValueError("The forest mask has no positive forest pixels.")
    except (OSError, ValueError, FileNotFoundError) as exc:
        checks.append({"id": "forest_mask", "label": "Forest cover mask", "status": "FAIL", "message": str(exc)})
        return _blocked_result(manifest, checks, "A sourced, aligned forest-cover mask is required. A protected-area boundary alone is not a forest mask.")
    checks.append({"id": "forest_mask", "label": "Forest cover mask", "status": "PASS",
                   "message": f"Binary forest mask loaded; {int(forest_mask.sum())} forest pixels in the analysis grid."})

    loaded: list[dict[str, Any]] = []
    observation_summaries: list[dict[str, Any]] = []
    grid_error: str | None = None
    for index, item in enumerate(observations):
        scene_id = str(item.get("scene_id") or f"observation-{index + 1}")
        try:
            hh_path = _resolve(base, item.get("hh_path"), f"Observation {index + 1} HH path")
            hv_path = _resolve(base, item.get("hv_path"), f"Observation {index + 1} HV path")
            hh, hh_profile, hh_valid = _read_raster(hh_path)
            hv, hv_profile, hv_valid = _read_raster(hv_path)
            if not _same_grid(reference_profile, hh_profile) or not _same_grid(reference_profile, hv_profile):
                raise ValueError("HH, HV and forest mask must share an identical CRS, affine transform and dimensions. Reproject explicitly before analysis.")
            valid = forest_mask & hh_valid & hv_valid
            quality_path_value = item.get("quality_mask_path")
            if quality_path_value:
                quality_path = _resolve(base, quality_path_value, f"Observation {index + 1} quality mask")
                quality, quality_profile, quality_valid = _read_raster(quality_path)
                if not _same_grid(reference_profile, quality_profile):
                    raise ValueError("Quality mask grid differs from the analysis grid.")
                valid &= quality_valid & (quality > 0)
            coverage = float(valid.sum() / forest_mask.sum())
            median_hh = float(np.median(hh[valid])) if valid.any() else None
            median_hv = float(np.median(hv[valid])) if valid.any() else None
            summary = {"date": normalized_dates[index], "sceneId": scene_id, "validCoverageFraction": coverage,
                       "medianHhDb": median_hh, "medianHvDb": median_hv,
                       "used": coverage >= minimum_valid_fraction,
                       "reason": None if coverage >= minimum_valid_fraction else f"Valid forest coverage {coverage:.1%} is below {minimum_valid_fraction:.0%}."}
            observation_summaries.append(summary)
            if coverage >= minimum_valid_fraction:
                loaded.append({"date": normalized_dates[index], "scene_id": scene_id,
                               "hh": hh, "hv": hv, "valid": valid,
                               "profile": hh_profile, "source_names": [hh_path.name, hv_path.name]})
        except (OSError, ValueError, FileNotFoundError) as exc:
            grid_error = str(exc)
            break

    if grid_error:
        checks.append({"id": "raster_alignment", "label": "Raster alignment and quality", "status": "FAIL", "message": grid_error})
        return _blocked_result(manifest, checks, "Input raster validation failed; no detections were calculated.")
    excluded = len(observations) - len(loaded)
    usable_ok = len(loaded) >= 3
    checks.append({"id": "valid_coverage", "label": "Valid forest coverage", "status": "PASS" if usable_ok and excluded == 0 else "PARTIAL" if usable_ok else "FAIL",
                   "message": f"{len(loaded)} of {len(observations)} observations meet the {minimum_valid_fraction:.0%} minimum valid-pixel coverage."})
    if not usable_ok:
        result = _blocked_result(manifest, checks, "Fewer than three observations meet the valid forest-coverage requirement. No candidate map was generated.")
        result["observations"] = observation_summaries
        return result

    stack_hh = np.stack([entry["hh"] for entry in loaded], axis=0)
    stack_hv = np.stack([entry["hv"] for entry in loaded], axis=0)
    stack_valid = np.stack([entry["valid"] for entry in loaded], axis=0)
    count = len(loaded)
    anomaly_masks: list[np.ndarray] = []
    scene_hh_changes: list[np.ndarray] = []
    scene_hv_changes: list[np.ndarray] = []
    stricter_anomaly_masks: list[np.ndarray] = []
    per_scene_stats: list[dict[str, float | str | None]] = []
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for target_index, target in enumerate(loaded):
            other_idx = [idx for idx in range(count) if idx != target_index]
            hh_others = np.where(stack_valid[other_idx], stack_hh[other_idx], np.nan)
            hv_others = np.where(stack_valid[other_idx], stack_hv[other_idx], np.nan)
            hh_base = np.nanmedian(hh_others, axis=0)
            hv_base = np.nanmedian(hv_others, axis=0)
            hh_mad = np.nanmedian(np.abs(hh_others - hh_base[None, ...]), axis=0)
            hv_mad = np.nanmedian(np.abs(hv_others - hv_base[None, ...]), axis=0)
            dhh = target["hh"] - hh_base
            dhv = target["hv"] - hv_base
            scene_hh_changes.append(dhh)
            scene_hv_changes.append(dhv)
            hh_limit = np.maximum(threshold_db, robust_multiplier * 1.4826 * np.nan_to_num(hh_mad, nan=0.0))
            hv_limit = np.maximum(threshold_db, robust_multiplier * 1.4826 * np.nan_to_num(hv_mad, nan=0.0))
            valid = target["valid"] & np.isfinite(hh_base) & np.isfinite(hv_base)
            anomaly = valid & ((np.abs(dhh) >= hh_limit) | (np.abs(dhv) >= hv_limit))
            anomaly &= forest_mask
            anomaly_masks.append(anomaly)
            # Recompute the same screen with a +0.5 dB floor while retaining the
            # robust MAD term. This is a real sensitivity pass, not a raw delta-only
            # approximation that could overstate the retained fraction.
            strict_hh_limit = np.maximum(threshold_db + 0.5,
                robust_multiplier * 1.4826 * np.nan_to_num(hh_mad, nan=0.0))
            strict_hv_limit = np.maximum(threshold_db + 0.5,
                robust_multiplier * 1.4826 * np.nan_to_num(hv_mad, nan=0.0))
            strict_anomaly = valid & ((np.abs(dhh) >= strict_hh_limit) | (np.abs(dhv) >= strict_hv_limit))
            stricter_anomaly_masks.append(strict_anomaly & forest_mask)
            per_scene_stats.append({"date": target["date"], "medianHhChangeDb": float(np.median(dhh[anomaly])) if anomaly.any() else None,
                                   "medianHvChangeDb": float(np.median(dhv[anomaly])) if anomaly.any() else None,
                                   "candidatePixelCount": int(anomaly.sum()),
                                   "validCoverageFraction": float(valid.sum() / forest_mask.sum())})

    candidates: list[dict[str, Any]] = []
    candidate_seq = 0
    for scene_index, (entry, flagged) in enumerate(zip(loaded, anomaly_masks)):
        labels, label_count = label(flagged, structure=np.ones((3, 3), dtype=np.uint8))
        component_counts = np.bincount(labels.ravel(), minlength=label_count + 1)
        component_slices = find_objects(labels, max_label=label_count)
        # Polygonize once per acquisition; compute statistics inside each component's
        # bounding window to avoid rescanning the full raster for every small region.
        for geom_dict, geom_value in shapes(labels.astype("int32"), mask=labels > 0,
                                             transform=entry["profile"]["transform"], connectivity=8):
            component_id = int(geom_value)
            if component_id <= 0 or component_id > label_count:
                continue
            pixel_count = int(component_counts[component_id])
            if pixel_count < minimum_region_pixels:
                continue
            component_window = component_slices[component_id - 1]
            if component_window is None:
                continue
            local_component = labels[component_window] == component_id
            candidate_seq += 1
            geom_source = shape(geom_dict)
            if geom_source.is_empty:
                continue
            geometry = transform_geom(entry["profile"]["crs"], "EPSG:4326", mapping(geom_source), precision=7)
            dhh = scene_hh_changes[scene_index]
            dhv = scene_hv_changes[scene_index]
            dhh_values = dhh[component_window][local_component]
            dhv_values = dhv[component_window][local_component]
            stricter = stricter_anomaly_masks[scene_index][component_window][local_component]
            stricter_fraction = float(stricter.sum() / pixel_count)
            detected_dates = []
            for other_entry, other_mask in zip(loaded, anomaly_masks):
                overlap = int(np.logical_and(local_component, other_mask[component_window]).sum())
                if overlap / pixel_count >= 0.25:
                    detected_dates.append(other_entry["date"])
            if len(detected_dates) >= 3:
                persistence = "PERSISTENT"
            elif len(detected_dates) >= 2:
                persistence = "RECURRING"
            else:
                persistence = "SINGLE_OBSERVATION"
            candidates.append({
                "id": f"F-{entry['date'].replace('-', '')}-{candidate_seq:04d}",
                "date": entry["date"], "sceneId": entry["scene_id"],
                "areaKm2": round(_area_km2(geom_source, entry["profile"]["crs"]), 6),
                "pixelCount": pixel_count,
                "geometry": geometry,
                "detectedDates": detected_dates,
                "persistence": persistence,
                "evidence": {
                    "medianHhChangeDb": round(float(np.nanmedian(dhh_values)), 4),
                    "medianHvChangeDb": round(float(np.nanmedian(dhv_values)), 4),
                    "medianAbsoluteHhChangeDb": round(float(np.nanmedian(np.abs(dhh_values))), 4),
                    "medianAbsoluteHvChangeDb": round(float(np.nanmedian(np.abs(dhv_values))), 4),
                    "validCoverageFraction": round(float(entry["valid"].sum() / forest_mask.sum()), 4),
                    "thresholdDb": threshold_db,
                    "stricterThresholdRetainedFraction": round(stricter_fraction, 4),
                },
                "assessment": {
                    "state": "POTENTIAL_STRUCTURAL_DISTURBANCE",
                    "reasons": [
                        "HH and/or HV backscatter differs from a leave-one-observation-out temporal median.",
                        "Candidate pixels are inside the supplied forest-cover mask and pass the configured valid-coverage screen.",
                    ],
                    "alternatives": [
                        {"name": "Moisture and seasonal conditions", "status": "UNASSESSED", "note": "No independent soil-moisture or phenology evidence was supplied."},
                        {"name": "Acquisition geometry", "status": "SCREENED", "note": "The NISAR compatibility signature matches across this series; remaining processing effects are not ruled out."},
                        {"name": "Forest-mask error or mixed land cover", "status": "UNASSESSED", "note": "The supplied mask was applied, but its classification accuracy was not independently evaluated by this tool."},
                    ],
                    "opticalEvidence": {"status": "NOT_PROVIDED", "summary": "No aligned, independent optical disturbance comparison was supplied. This candidate is not independently validated."},
                    "cause": "UNKNOWN",
                },
            })

    with rasterio.open(forest_mask_path) as mask_src:
        bounds_src = mask_src.bounds
        bounds = transform_bounds(mask_src.crs, "EPSG:4326", bounds_src.left, bounds_src.bottom, bounds_src.right, bounds_src.top, densify_pts=21)
    partial = excluded > 0
    checks.append({"id": "independent_evidence", "label": "Independent reference evidence", "status": "INFO",
                   "message": "No independent optical or disturbance-reference assessment was run by this GCOV-only stage."})
    checks.append({"id": "interpretation", "label": "Interpretation guardrails", "status": "PASS",
                   "message": "Outputs are potential radar structural anomalies; cause, confirmed forest loss and recovery are not inferred."})
    if partial:
        summary = f"Analysis completed with limited coverage: {len(loaded)} compatible observations were usable; {excluded} were excluded for coverage. Independent validation is not provided."
    else:
        summary = f"Analysis completed on {len(loaded)} compatible observations. Candidate regions require interpretation and independent validation."
    return {
        "schemaVersion": SCHEMA_VERSION,
        "methodVersion": METHOD_VERSION,
        "dataSource": "NISAR",
        "resultType": "potential forest structural disturbance candidates",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "runId": uuid4().hex,
        "site": {"name": str(site.get("name") or "Unnamed forest study area"), "bounds": [round(float(v), 7) for v in bounds]},
        "product": manifest["compatibility"]["product"],
        "productMaturity": manifest["compatibility"]["product_maturity"],
        "compatibility": manifest["compatibility"],
        "readiness": {"status": "LIMITED" if partial else "READY", "summary": summary, "checks": checks},
        "method": {"name": "Leave-one-observation-out median anomaly screen", "version": METHOD_VERSION,
                   "thresholdDb": threshold_db, "robustMultiplier": robust_multiplier,
                   "minimumRegionPixels": minimum_region_pixels, "minimumValidFraction": minimum_valid_fraction,
                   "inputsAreDb": True, "maskSource": str(site.get("forest_mask_source") or "Not recorded"),
                   "description": "Each date is compared with the per-pixel median of the other compatible observations. HH or HV departures beyond a configurable absolute/robust threshold are grouped inside a forest mask."},
        "observations": observation_summaries,
        "sceneStats": per_scene_stats,
        "candidates": candidates,
        "limitations": [
            "This is an exploratory anomaly screen, not a validated universal forest-loss or degradation classifier.",
            "HH/HV backscatter changes alone do not establish deforestation, fire, logging, cause, biomass loss, carbon emissions or ecological recovery.",
            "The thresholds require site-specific calibration and evaluation against suitable independent reference data.",
            "No independent optical disturbance comparison was supplied; optical evidence is marked NOT_PROVIDED.",
            "The supplied forest mask is assumed to be appropriate; its accuracy is not measured here.",
            "Results inherit the source product's PROVISIONAL maturity and acquisition/data-quality limitations.",
        ],
    }


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        temporary = Path(handle.name)
        json.dump(payload, handle, indent=2, allow_nan=False)
        handle.write("\n")
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to a forest workflow manifest generated by pipeline/forest_workflow.py run.")
    parser.add_argument("--test-fixture-mode", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--output", default="output/forest/forest_analysis.json", help="Output JSON path (default: pipeline/output/forest/forest_analysis.json when run from pipeline/).")
    parser.add_argument("--threshold-db", type=float, default=2.5)
    parser.add_argument("--robust-multiplier", type=float, default=3.0)
    parser.add_argument("--minimum-region-pixels", type=int, default=20)
    parser.add_argument("--minimum-valid-fraction", type=float, default=0.70)
    args = parser.parse_args()
    try:
        manifest_payload = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        if not args.test_fixture_mode:
            provenance = manifest_payload.get("provenance") if isinstance(manifest_payload, dict) else None
            site = manifest_payload.get("site") if isinstance(manifest_payload, dict) else None
            mask_metadata = site.get("forest_mask_metadata") if isinstance(site, dict) else None
            authentic_workflow = (isinstance(manifest_payload, dict) and manifest_payload.get("data_source") == "NISAR"
                and manifest_payload.get("workflow_version") == "forest-workflow-v1"
                and isinstance(provenance, dict) and provenance.get("catalogProduct") == "NISAR_L2_GCOV_PROVISIONAL_V1"
                and isinstance(mask_metadata, dict) and mask_metadata.get("dataset") == "ESA WorldCover 2021 v200 10 m land-cover map"
                and isinstance(manifest_payload.get("observations"), list)
                and all(isinstance(item, dict) and isinstance(item.get("source"), dict)
                        and item["source"].get("product") == "NISAR_L2_GCOV_PROVISIONAL_V1"
                        and isinstance(item.get("scene_id"), str) and item["scene_id"].startswith("NISAR_")
                        for item in manifest_payload["observations"]))
            if not authentic_workflow:
                raise ValueError("Standalone analysis only accepts manifests emitted by the real-data forest workflow. It cannot be used to label arbitrary raster fixtures as real NISAR results.")
        result = analyze_manifest(args.manifest, args.threshold_db, args.robust_multiplier,
                                  args.minimum_region_pixels, args.minimum_valid_fraction)
        output = Path(args.output).resolve()
        _atomic_write(output, result)
        print(json.dumps({"output": str(output), "runId": result["runId"],
                          "readiness": result["readiness"]["status"],
                          "observationCount": len(result["observations"]),
                          "candidateCount": len(result["candidates"])}))
        return 0 if result["readiness"]["status"] in ("READY", "LIMITED") else 2
    except Exception as exc:
        print(f"Forest analysis failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
