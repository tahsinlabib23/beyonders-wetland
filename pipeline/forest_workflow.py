"""End-to-end REAL NISAR forest workflow for the GeoNexSAR local application.

Live data flow:
  NASA CMR discovery -> compatible NISAR L2 GCOV series -> Earthdata-authenticated
  GCOV streaming -> HH/HV GeoTIFF extraction -> explicit grid alignment -> ESA
  WorldCover forest mask -> forest-specific anomaly screening -> NASA HLS optical
  comparison where available -> persisted provenance and exports.

No demo detections, fallback imagery, simulated measurements, or made-up scenes are
created by this module. The unit tests use synthetic fixtures only in temporary dirs.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import numpy as np
import rasterio
from affine import Affine
from pyproj import CRS
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.warp import reproject, transform_bounds, transform_geom
from shapely.geometry import Polygon, box, shape

from extract_gcov import extract_polarization_to_tiff, extract_quality_layers_to_tiff
from forest_analysis import analyze_manifest, _atomic_write
from forest_jobs import JobRecorder, WorkflowCancelled, build_diagnostics, sanitize_text, utc_now
from search_nisar import scene_identity

ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ["FOREST_OUTPUT_DIR"]) if os.environ.get("FOREST_OUTPUT_DIR") and Path(os.environ["FOREST_OUTPUT_DIR"]).is_absolute() else ROOT / "output" / "forest"
PRODUCT = "NISAR_L2_GCOV_PROVISIONAL_V1"
FREQUENCY = "frequencyA"
WORLD_COVER_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
WORLD_COVER_ATTRIBUTION = "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data processed by the ESA WorldCover consortium; classes 10 (tree cover) and 95 (mangroves)."
CMR_SOURCE = "NASA Common Metadata Repository (CMR), queried live through earthaccess"


class WorkflowError(RuntimeError):
    """Expected error that should be surfaced to the local UI without a fake result."""


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         delete=False, suffix=".partial.json") as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def validate_request(request: dict) -> dict:
    if not isinstance(request, dict):
        raise WorkflowError("Request body must be a JSON object.")
    name = request.get("siteName")
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
        raise WorkflowError("Study-area name must be 2–80 characters and contain no control characters.")
    raw_bbox = request.get("bbox")
    if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
        raise WorkflowError("AOI must be a WGS84 bounding box: west, south, east, north.")
    try:
        west, south, east, north = [float(value) for value in raw_bbox]
    except (TypeError, ValueError) as exc:
        raise WorkflowError("AOI coordinates must be finite numeric values.") from exc
    if not all(math.isfinite(v) for v in (west, south, east, north)):
        raise WorkflowError("AOI coordinates must be finite numeric values.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise WorkflowError("AOI bounds are invalid. Order must be west, south, east, north in WGS84.")

    boundary_geojson = request.get("boundaryGeoJson")
    if boundary_geojson is not None:
        if not isinstance(boundary_geojson, dict) or boundary_geojson.get("type") != "FeatureCollection":
            raise WorkflowError("Uploaded forest boundary must be a GeoJSON FeatureCollection.")
        boundary_features = boundary_geojson.get("features")
        if not isinstance(boundary_features, list) or not boundary_features:
            raise WorkflowError("Uploaded forest boundary must contain at least one Polygon or MultiPolygon feature.")
        cleaned_features = []
        bounds_list = []
        for index, feature in enumerate(boundary_features, start=1):
            if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("geometry"), dict):
                raise WorkflowError(f"GeoJSON feature {index} is missing a geometry.")
            geometry_data = feature["geometry"]
            if geometry_data.get("type") not in ("Polygon", "MultiPolygon"):
                raise WorkflowError("Only Polygon and MultiPolygon forest boundaries are supported.")
            try:
                polygon = shape(geometry_data)
                if polygon.is_empty or not polygon.is_valid or polygon.geom_type not in ("Polygon", "MultiPolygon"):
                    raise ValueError("Geometry is empty or invalid.")
                geom_bounds = tuple(float(value) for value in polygon.bounds)
            except Exception as exc:
                raise WorkflowError(f"GeoJSON feature {index} contains an invalid polygon geometry: {exc}") from exc
            if len(geom_bounds) != 4 or not all(math.isfinite(value) for value in geom_bounds):
                raise WorkflowError(f"GeoJSON feature {index} has non-finite coordinates.")
            fw, fs, fe, fn = geom_bounds
            if not (-180 <= fw < fe <= 180 and -90 <= fs < fn <= 90):
                raise WorkflowError(f"GeoJSON feature {index} must use WGS84 longitude/latitude coordinates and cannot cross the antimeridian.")
            bounds_list.append(geom_bounds)
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            cleaned_features.append({"type": "Feature", "geometry": geometry_data, "properties": properties})
        west = min(bounds[0] for bounds in bounds_list)
        south = min(bounds[1] for bounds in bounds_list)
        east = max(bounds[2] for bounds in bounds_list)
        north = max(bounds[3] for bounds in bounds_list)
        boundary_geojson = {"type": "FeatureCollection", "features": cleaned_features}

    # Keep the local interactive flow small enough for reliable raster workstations.
    if east - west > 0.20 or north - south > 0.20 or (east-west)*(north-south) > 0.025:
        raise WorkflowError("Choose a smaller forest study area: maximum 0.20° in either direction and 0.025 square degrees. This keeps raster memory and data-transfer demands bounded.")
    start_text, end_text = request.get("startDate"), request.get("endDate")
    try:
        start_day, end_day = date.fromisoformat(start_text), date.fromisoformat(end_text)
    except (TypeError, ValueError) as exc:
        raise WorkflowError("Start and end dates must use YYYY-MM-DD.") from exc
    if start_day > end_day:
        raise WorkflowError("Start date must be on or before end date.")
    if end_day > date.today():
        raise WorkflowError("End date cannot be in the future.")
    try:
        threshold_db = float(request.get("thresholdDb", 2.5))
        robust_multiplier = float(request.get("robustMultiplier", 3.0))
        raw_minimum_region_pixels = float(request.get("minimumRegionPixels", 20))
        minimum_valid_fraction = float(request.get("minimumValidFraction", 0.70))
    except (TypeError, ValueError) as exc:
        raise WorkflowError("Forest detector settings must be numeric values.") from exc
    if not math.isfinite(raw_minimum_region_pixels) or not raw_minimum_region_pixels.is_integer():
        raise WorkflowError("Minimum candidate size must be a whole number of raster pixels.")
    minimum_region_pixels = int(raw_minimum_region_pixels)
    if not math.isfinite(threshold_db) or not 0.5 <= threshold_db <= 8:
        raise WorkflowError("The HH/HV anomaly threshold must be between 0.5 and 8 dB.")
    if not math.isfinite(robust_multiplier) or not 1 <= robust_multiplier <= 8:
        raise WorkflowError("The robust MAD multiplier must be between 1 and 8.")
    if not 1 <= minimum_region_pixels <= 1_000_000:
        raise WorkflowError("Minimum candidate size must be between 1 and 1,000,000 raster pixels.")
    if not math.isfinite(minimum_valid_fraction) or not 0.1 <= minimum_valid_fraction <= 1:
        raise WorkflowError("Minimum valid forest coverage must be between 0.1 and 1.0.")
    return {"siteName": name.strip(), "bbox": [west, south, east, north],
            "startDate": start_day.isoformat(), "endDate": end_day.isoformat(),
            "thresholdDb": threshold_db, "robustMultiplier": robust_multiplier,
            "minimumRegionPixels": minimum_region_pixels, "minimumValidFraction": minimum_valid_fraction,
            "boundaryGeoJson": boundary_geojson}


def _granule_name(record) -> str:
    try:
        name = record["umm"]["GranuleUR"]
    except (KeyError, TypeError) as exc:
        raise WorkflowError("NASA catalog returned a record without a granule identifier.") from exc
    if not isinstance(name, str):
        raise WorkflowError("NASA catalog returned an invalid granule identifier.")
    return name


def _footprint(record):
    """Return a CMR footprint if present, used only to rank intersecting granules."""
    umm = record.get("umm", {}) if isinstance(record, dict) else {}
    domain = (umm.get("SpatialExtent", {}).get("HorizontalSpatialDomain", {}))
    geometry = domain.get("Geometry", {})
    polygons = []
    for item in geometry.get("GPolygons", []) or []:
        points = item.get("Boundary", {}).get("Points", []) or []
        coords = [(p.get("Longitude"), p.get("Latitude")) for p in points]
        if len(coords) >= 4 and all(x is not None and y is not None for x, y in coords):
            try:
                candidate = Polygon([(float(x), float(y)) for x, y in coords])
                if candidate.is_valid and not candidate.is_empty:
                    polygons.append(candidate)
            except (TypeError, ValueError):
                continue
    if not polygons:
        return None
    from shapely.ops import unary_union
    return unary_union(polygons)


COVERAGE_MAX_SPAN_DEG = 6.0
COVERAGE_MAX_STACKS = 60


def validate_scan_request(request: dict) -> dict:
    """A coverage scan only reads public catalog metadata, so it may cover a larger window than an analysis AOI."""
    if not isinstance(request, dict):
        raise WorkflowError("Request body must be a JSON object.")
    raw = request.get("bbox")
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        raise WorkflowError("The search window must be a WGS84 bounding box: west, south, east, north.")
    try:
        west, south, east, north = [float(v) for v in raw]
    except (TypeError, ValueError) as exc:
        raise WorkflowError("Search-window coordinates must be finite numeric values.") from exc
    if not all(math.isfinite(v) for v in (west, south, east, north)):
        raise WorkflowError("Search-window coordinates must be finite numeric values.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise WorkflowError("Search-window bounds are invalid. Order must be west, south, east, north in WGS84.")
    if east - west > COVERAGE_MAX_SPAN_DEG or north - south > COVERAGE_MAX_SPAN_DEG:
        raise WorkflowError(f"The search window is larger than {COVERAGE_MAX_SPAN_DEG:g} degrees on a side. Zoom in or pick a smaller region; a wider search is not run to avoid truncated, misleading results.")
    start, end = request.get("startDate"), request.get("endDate")
    try:
        start_d, end_d = date.fromisoformat(str(start)), date.fromisoformat(str(end))
    except ValueError as exc:
        raise WorkflowError("Dates must be valid YYYY-MM-DD values.") from exc
    if end_d < start_d:
        raise WorkflowError("The end date must not be before the start date.")
    return {"bbox": [west, south, east, north], "startDate": start_d.isoformat(), "endDate": end_d.isoformat()}


def _series_groups(catalog: list, start_date: str, end_date: str, window=None) -> tuple[dict, int]:
    """Group catalog records into internally compatible stacks (same product, track, direction, frame, modes, release).

    Returns (groups, rejected). Each group maps acquisition date -> the record with the largest overlap with `window`.
    """
    groups: dict[tuple, dict] = {}
    rejected = 0
    for record in catalog:
        try:
            name = _granule_name(record)
            identity = scene_identity(name, FREQUENCY)
            tokens = Path(name).name.removesuffix(".h5").split("_")
            if len(tokens) < 14:
                raise WorkflowError("short name")
        except (WorkflowError, KeyError, TypeError, ValueError):
            rejected += 1
            continue
        if identity["date"] < start_date or identity["date"] > end_date:
            continue
        key = identity["compatibility"] + (tokens[8], tokens[9])
        footprint = _footprint(record)
        overlap = float(footprint.intersection(window).area) if (footprint is not None and window is not None) else 0.0
        by_date = groups.setdefault(key, {})
        previous = by_date.get(identity["date"])
        if previous is None or overlap > previous["overlap"]:
            by_date[identity["date"]] = {"name": name, "overlap": overlap, "footprint": footprint}
    return groups, rejected


def _stack_summary(key: tuple, by_date: dict, window=None) -> dict:
    ordered = sorted(by_date)
    first = by_date[ordered[0]]["name"]
    compat = _compatibility_record(first)
    boxes = []
    for item in by_date.values():
        fp = item["footprint"]
        if fp is None:
            continue
        clipped = fp.intersection(window) if window is not None else fp
        if not clipped.is_empty:
            boxes.append(clipped.bounds)
    bounds = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else None
    gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(ordered, ordered[1:])]
    return {"id": "|".join(str(v) for v in key), "track": compat["track"], "direction": compat["direction"], "frame": compat["frame"],
            "bandwidth": compat["bandwidth"], "polarizationMode": compat["polarization_mode"],
            "pairedPolarizationMode": compat["paired_polarization_mode"], "release": compat["release"],
            "dates": ordered, "count": len(ordered), "longestGapDays": max(gaps) if gaps else 0,
            "bbox": bounds, "sufficient": len(ordered) >= 3}


def scan_coverage(request: dict) -> dict:
    """Public-catalog coverage scan: which compatible acquisition stacks exist in a window, and how many dates each has.

    Reads CMR metadata only (no login, no downloads) and reports the scope it searched. It does not process anything and
    never implies that listed acquisitions have been downloaded, validated or analysed.
    """
    scan = validate_scan_request(request)
    try:
        import earthaccess
    except ImportError as exc:
        raise WorkflowError("The pipeline environment is missing earthaccess. Install pipeline/requirements.txt.") from exc
    west, south, east, north = scan["bbox"]
    count_limit = 2000
    catalog = earthaccess.search_data(short_name=PRODUCT, bounding_box=(west, south, east, north),
                                      temporal=(scan["startDate"], scan["endDate"]), count=count_limit)
    window = box(west, south, east, north)
    groups, rejected = _series_groups(list(catalog or []), scan["startDate"], scan["endDate"], window)
    stacks = [_stack_summary(key, by_date, window) for key, by_date in groups.items()]
    stacks.sort(key=lambda item: (item["sufficient"], item["count"], -item["longestGapDays"]), reverse=True)
    truncated = len(catalog or []) >= count_limit
    scope = {"bbox": scan["bbox"], "startDate": scan["startDate"], "endDate": scan["endDate"], "product": PRODUCT,
             "frequency": FREQUENCY, "catalogHits": len(catalog or []), "truncated": truncated,
             "searchedAt": utc_now(), "source": CMR_SOURCE}
    usable = [item for item in stacks if item["sufficient"]]
    if not catalog:
        message = "NASA's catalog lists no NISAR L2 GCOV provisional scenes in this window and date range. That says nothing about other places or dates."
    elif not usable:
        message = "Scenes exist here, but no single compatible stack has the three acquisitions the forest analysis needs. Try a longer date range or a neighbouring area."
    else:
        message = f"{len(usable)} compatible stack(s) with at least three acquisitions are listed in this window. These are catalog records only: nothing has been downloaded or analysed."
    if truncated:
        message += f" The catalog reply reached the {count_limit}-scene limit, so the list may be incomplete; use a smaller window."
    return {"status": "OK" if usable else "INSUFFICIENT_OBSERVATIONS" if catalog else "EMPTY", "scope": scope, "rejectedGranules": rejected,
            "stacks": stacks[:COVERAGE_MAX_STACKS], "stackCount": len(stacks), "usableStackCount": len(usable), "message": message}


def search_compatible_series(request: dict, selected_scene_ids: list[str] | None = None) -> dict:
    """Query live NASA CMR and return the longest internally-compatible dated series."""
    request = validate_request(request)
    try:
        import earthaccess
    except ImportError as exc:
        raise WorkflowError("The pipeline environment is missing earthaccess. Run pipeline/setup_env.py or install pipeline/requirements.txt.") from exc
    west, south, east, north = request["bbox"]
    catalog = earthaccess.search_data(short_name=PRODUCT, bounding_box=(west, south, east, north),
                                      temporal=(request["startDate"], request["endDate"]), count=1000)
    if not catalog:
        return {"status": "INSUFFICIENT_OBSERVATIONS", "siteName": request["siteName"],
                "product": PRODUCT, "catalogHits": 0, "minimumRequiredObservations": 3,
                "selectedSceneIds": [], "scenes": [], "message": "NASA CMR returned no NISAR L2 GCOV provisional scenes for this AOI and date range. Try a different forest area or observation window."}

    requested = set(selected_scene_ids or [])
    if selected_scene_ids is not None:
        if len(requested) != len(selected_scene_ids) or len(requested) < 3:
            raise WorkflowError("Choose at least three unique scenes from one discovered compatible series.")
        catalog_by_name = {_granule_name(item): item for item in catalog}
        missing = sorted(requested - set(catalog_by_name))
        if missing:
            raise WorkflowError("One or more previously selected scenes are no longer in NASA's current catalog. Run discovery again before processing.")
        catalog = [catalog_by_name[name] for name in selected_scene_ids]

    groups: dict[tuple, list] = {}
    site_geom = box(west, south, east, north)
    rejected = 0
    for record in catalog:
        try:
            name = _granule_name(record)
            identity = scene_identity(name, FREQUENCY)
        except (WorkflowError, KeyError, TypeError, ValueError):
            rejected += 1
            continue
        if requested and name not in requested:
            continue
        if identity["date"] < request["startDate"] or identity["date"] > request["endDate"]:
            continue
        # The shared parser narrows the selected frequency's mode fields. The
        # forest workflow additionally requires the full four-character paired
        # bandwidth and polarization mode codes to match across all acquisitions.
        name_tokens = Path(name).name.removesuffix(".h5").split("_")
        if len(name_tokens) < 14:
            rejected += 1
            continue
        key = identity["compatibility"] + (name_tokens[8], name_tokens[9])
        fp = _footprint(record)
        overlap = float(fp.intersection(site_geom).area) if fp is not None else 0.0
        entry = {"identity": identity, "record": record, "name": name, "date": identity["date"],
                 "overlap": overlap}
        groups.setdefault(key, []).append(entry)

    series_options = []
    for key, group in groups.items():
        # If several adjacent granules from one overpass share an acquisition date,
        # retain the granule with the largest study-area intersection for that date.
        by_date = {}
        for item in group:
            previous = by_date.get(item["date"])
            if previous is None or item["overlap"] > previous["overlap"]:
                by_date[item["date"]] = item
        ordered = sorted(by_date.values(), key=lambda item: item["date"])
        if len(ordered) < 2:
            continue
        span_days = (date.fromisoformat(ordered[-1]["date"]) - date.fromisoformat(ordered[0]["date"])).days
        series_options.append((len(ordered), span_days, ordered[-1]["date"], tuple(str(v) for v in key), ordered))

    if not series_options:
        result = {"status": "INSUFFICIENT_OBSERVATIONS", "siteName": request["siteName"],
                  "product": PRODUCT, "catalogHits": len(catalog), "rejectedGranules": rejected,
                  "minimumRequiredObservations": 3, "selectedSceneIds": [], "scenes": [],
                  "message": "CMR found scenes, but not a chronological compatible series with matching product, track, direction, frame, bandwidth, polarization mode, acquisition mode and processing release."}
        if selected_scene_ids is not None:
            raise WorkflowError(result["message"])
        return result

    series_options.sort(key=lambda item: (item[0], item[1], item[2], item[3]), reverse=True)
    _, _, _, key, selected = series_options[0]
    first_identity = selected[0]["identity"]
    compatibility = _compatibility_record(first_identity["name"])
    scenes = [{"date": item["date"], "sceneId": item["name"],
               "track": compatibility["track"], "direction": compatibility["direction"],
               "frame": compatibility["frame"], "bandwidth": compatibility["bandwidth"],
               "polarizationMode": compatibility["polarization_mode"],
               "pairedPolarizationMode": compatibility["paired_polarization_mode"],
               "processingRelease": compatibility["release"]} for item in selected]
    enough = len(scenes) >= 3
    option_groups, _ = _series_groups(catalog, request["startDate"], request["endDate"], site_geom)
    series_options_summary = sorted((_stack_summary(k, v, site_geom) for k, v in option_groups.items()), key=lambda item: (item["count"], item["dates"][-1]), reverse=True)[:12]
    return {"status": "READY" if enough else "INSUFFICIENT_OBSERVATIONS", "siteName": request["siteName"],
            "seriesOptions": series_options_summary, "usedSeriesId": "|".join(str(v) for v in key),
            "product": PRODUCT, "productMaturity": "PROVISIONAL", "frequency": FREQUENCY,
            "catalogSource": CMR_SOURCE, "catalogHits": len(catalog), "rejectedGranules": rejected,
            "compatibleSeriesCount": len(scenes), "minimumRequiredObservations": 3,
            "compatibility": compatibility, "selectedSceneIds": [item["sceneId"] for item in scenes],
            "scenes": scenes, "startDate": request["startDate"], "endDate": request["endDate"],
            "message": (f"Found {len(scenes)} chronological, compatible real NISAR acquisitions. Processing requires NASA Earthdata Login." if enough else f"The best compatible series has only {len(scenes)} unique acquisition dates; at least three are required. No science analysis was run.")}


def _compatibility_record(name: str) -> dict:
    tokens = Path(name).name.removesuffix(".h5").split("_")
    # Current provisional name: NISAR_L2_PR_GCOV_cycle_track_dir_frame_bandwidth_pol_mode_start_stop_release_...
    if len(tokens) < 18 or tokens[:4] != ["NISAR", "L2", "PR", "GCOV"]:
        raise WorkflowError(f"Unsupported NISAR granule-name layout: {name}")
    return {"product": PRODUCT, "product_maturity": "PROVISIONAL", "frequency": FREQUENCY,
            "polarizations": ["HHHH", "HVHV"], "track": tokens[5], "direction": tokens[6],
            "frame": tokens[7], "bandwidth": tokens[8],
            "frequency_a_bandwidth": tokens[8][:2], "frequency_b_bandwidth": tokens[8][2:],
            "polarization_mode": tokens[9][:2], "paired_polarization_mode": tokens[9][2:],
            "polarization_mode_code": tokens[9], "acquisition": tokens[10], "release": tokens[13]}


def worldcover_tiles_for_bbox(bbox_values: list[float]) -> list[str]:
    west, south, east, north = [float(value) for value in bbox_values]
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Invalid WGS84 bounding box.")
    tile_west_start = math.floor(west / 3) * 3
    tile_west_end = math.floor(math.nextafter(east, -math.inf) / 3) * 3
    tile_south_start = math.floor(south / 3) * 3
    tile_south_end = math.floor(math.nextafter(north, -math.inf) / 3) * 3
    names = []
    for lat in range(tile_south_start, tile_south_end + 1, 3):
        for lon in range(tile_west_start, tile_west_end + 1, 3):
            lat_token = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
            lon_token = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
            names.append(f"{lat_token}{lon_token}")
    return names


def worldcover_tile_url(tile_name: str) -> str:
    if not re.fullmatch(r"[NS]\d{2}[EW]\d{3}", tile_name):
        raise ValueError("Invalid ESA WorldCover tile name.")
    return f"{WORLD_COVER_BASE}/ESA_WorldCover_10m_2021_v200_{tile_name}_Map.tif"


def download_worldcover_tile(tile_name: str, cache_dir: Path) -> str | Path:
    """Resolve a real ESA WorldCover COG, preferring a verified local copy.

    WorldCover 3-degree tiles are large. If no cached copy exists, use GDAL's
    /vsicurl/ support so only the relevant COG blocks are read for the AOI instead
    of downloading the whole tile. The source is public and no fake fallback exists.
    """
    url = worldcover_tile_url(tile_name)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"ESA_WorldCover_10m_2021_v200_{tile_name}_Map.tif"
    if path.is_file() and path.stat().st_size > 100_000:
        try:
            with rasterio.open(path) as src:
                if src.crs is not None and src.count == 1:
                    return path
        except rasterio.errors.RasterioError:
            path.unlink(missing_ok=True)
    vsi_path = f"/vsicurl/{url}"
    try:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES"):
            with rasterio.open(vsi_path) as src:
                if src.crs is None or src.count != 1 or src.width < 1000 or src.height < 1000:
                    raise WorkflowError(f"ESA WorldCover tile {tile_name} lacks a valid georeferenced 10 m map layer.")
                if CRS.from_user_input(src.crs).to_epsg() != 4326:
                    raise WorkflowError(f"ESA WorldCover tile {tile_name} is not in the expected WGS84 grid.")
    except Exception as exc:
        if isinstance(exc, WorkflowError):
            raise
        raise WorkflowError(
            f"Could not open the official ESA WorldCover cloud-optimized GeoTIFF for tile {tile_name} via range requests ({type(exc).__name__}). Check internet/GDAL CURL support or place the official tile at {path}."
        ) from exc
    return vsi_path


def _grid_of(raster) -> dict:
    """Grid description (crs, size, transform) from an open Rasterio dataset OR a profile dict.

    A Rasterio ``DatasetReader`` is not subscriptable, and a profile dict has no ``.crs``. Reading the grid through
    one helper means callers can never mix the two up (the cause of "'DatasetReader' object is not subscriptable").
    """
    if isinstance(raster, Mapping):  # rasterio's Profile is a UserDict, not a dict
        return {"crs": raster["crs"], "width": raster["width"], "height": raster["height"], "transform": raster["transform"]}
    return {"crs": raster.crs, "width": raster.width, "height": raster.height, "transform": raster.transform}


def _same_grid(a, b) -> bool:
    ga, gb = _grid_of(a), _grid_of(b)
    if ga["crs"] is None or gb["crs"] is None:
        return False
    return (CRS.from_user_input(ga["crs"]) == CRS.from_user_input(gb["crs"])
            and ga["width"] == gb["width"] and ga["height"] == gb["height"]
            and ga["transform"].almost_equals(gb["transform"], precision=1e-8))


def _write_array(path: Path, values: np.ndarray, profile: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.stem + ".partial" + path.suffix)
    out_profile = profile.copy()
    out_profile.update(driver="GTiff", count=1, height=values.shape[0], width=values.shape[1],
                       compress="deflate")
    if values.dtype.kind == "f":
        out_profile.update(dtype="float32", nodata=np.nan)
        values = values.astype("float32", copy=False)
    else:
        out_profile.update(dtype=values.dtype, nodata=0)
    if not out_profile.get("tiled"):
        out_profile.pop("blockxsize", None)
        out_profile.pop("blockysize", None)
    try:
        with rasterio.open(temporary, "w", **out_profile) as dst:
            dst.write(values, 1)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def align_raster_to_reference(source_path: Path, reference_path: Path, output_path: Path,
                              categorical: bool = False) -> Path:
    with rasterio.open(reference_path) as reference, rasterio.open(source_path) as source:
        if source.crs is None or reference.crs is None or source.count != 1 or reference.count != 1:
            raise WorkflowError(f"Cannot align a raster without single-band georeferencing: {source_path.name}")
        target_profile = reference.profile.copy()
        target_profile.update(driver="GTiff", count=1, dtype="uint8" if categorical else "float32",
                              nodata=0 if categorical else np.nan, compress="deflate")
        src = source.read(1, masked=True)
        if categorical:
            src_array = src.filled(0).astype("uint8")
            dst_array = np.zeros((reference.height, reference.width), dtype="uint8")
            src_nodata = source.nodata if source.nodata is not None else 0
            dst_nodata = 0
            method = Resampling.nearest
        else:
            src_array = src.astype("float32").filled(np.nan)
            dst_array = np.full((reference.height, reference.width), np.nan, dtype="float32")
            src_nodata = source.nodata if source.nodata is not None else np.nan
            dst_nodata = np.nan
            method = Resampling.bilinear
        if _same_grid(target_profile, source):
            dst_array[:] = src_array
        else:
            reproject(source=src_array, destination=dst_array, src_transform=source.transform,
                      src_crs=source.crs, src_nodata=src_nodata,
                      dst_transform=reference.transform, dst_crs=reference.crs,
                      dst_nodata=dst_nodata, resampling=method, init_dest_nodata=True)
    return _write_array(output_path, dst_array, target_profile)


def build_worldcover_forest_mask(bbox_values: list[float], reference_raster: Path,
                                 output_mask: Path, cache_dir: Path,
                                 classes: tuple[int, ...] = (10, 95),
                                 boundary_geojson: dict | None = None) -> dict:
    """Download authentic ESA WorldCover tiles and create a forest mask on GCOV grid."""
    tiles = worldcover_tiles_for_bbox(bbox_values)
    with rasterio.open(reference_raster) as reference:
        if reference.crs is None:
            raise WorkflowError("The reference NISAR raster has no CRS.")
        profile = reference.profile.copy()
        out_shape = (reference.height, reference.width)
        landcover = np.zeros(out_shape, dtype=np.uint8)
        tile_sources = []
        for tile_name in tiles:
            tile_path = download_worldcover_tile(tile_name, cache_dir)
            tile_url = worldcover_tile_url(tile_name)
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES"):
                with rasterio.open(tile_path) as src:
                    part = np.zeros(out_shape, dtype=np.uint8)
                    reproject(source=rasterio.band(src, 1), destination=part,
                              src_transform=src.transform, src_crs=src.crs, src_nodata=0,
                              dst_transform=reference.transform, dst_crs=reference.crs,
                              dst_nodata=0, resampling=Resampling.nearest)
                    # A tile's observed nonzero ESA class replaces only no-data in the mosaic.
                    actual = part != 0
                    landcover[actual] = part[actual]
            tile_sources.append({"tile": tile_name, "filename": Path(tile_url).name,
                                 "sourceUrl": tile_url,
                                 "accessMode": "LOCAL_CACHE" if isinstance(tile_path, Path) else "REMOTE_COG_RANGE_READ"})
        west, south, east, north = bbox_values
        if boundary_geojson is not None:
            geometries = [feature["geometry"] for feature in boundary_geojson["features"]]
            projected_aoi = [(transform_geom("EPSG:4326", reference.crs, geometry), 1) for geometry in geometries]
        else:
            aoi = {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}
            projected_aoi = [(transform_geom("EPSG:4326", reference.crs, aoi), 1)]
        aoi_mask = rasterize(projected_aoi, out_shape=out_shape,
                             transform=reference.transform, fill=0, dtype="uint8")
        mask = ((np.isin(landcover, classes)) & (aoi_mask == 1)).astype("uint8")
        forest_pixels = int(mask.sum())
        if forest_pixels == 0:
            raise WorkflowError("The real ESA WorldCover tile has no class-10 tree-cover or class-95 mangrove pixels inside the selected AOI/grid. Choose a forested AOI with catalog coverage; no analysis was created.")
        profile.update(driver="GTiff", count=1, dtype="uint8", nodata=0, compress="deflate")
    _write_array(output_mask, mask, profile)
    return {"path": str(output_mask), "classes": list(classes), "forestPixelCount": forest_pixels,
            "forestPixelFractionOfGrid": forest_pixels / mask.size if mask.size else 0,
            "dataset": "ESA WorldCover 2021 v200 10 m land-cover map",
            "attribution": WORLD_COVER_ATTRIBUTION,
            "sourceUrl": "https://esa-worldcover.org/en/data-access",
            "tileSources": tile_sources,
            "limitations": "WorldCover is a 2021 land-cover mask, not a current-year forest inventory; class 10 includes tree cover that can include plantations, and mask accuracy is not assessed by this workflow."}


def _login_strategy() -> str:
    return "environment" if os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME") else "netrc"


def _authenticate_noninteractive() -> None:
    import earthaccess
    try:
        result = earthaccess.login(strategy=_login_strategy())
        if not result.authenticated:
            raise RuntimeError("Earthdata authentication was not accepted")
    except Exception as exc:
        raise WorkflowError("NASA Earthdata Login is required to stream NISAR and HLS data, and no valid saved login was found. Open the Earthdata panel in the app, run the shown login command once in your terminal, press 'Test connection', then start the run again. Never put credentials in the app form or the repository.") from exc


def _plain_message(exc: BaseException) -> str:
    """Exception text without tuple/repr noise: ``Exception('x',)`` should read as ``x``."""
    if len(exc.args) == 1 and isinstance(exc.args[0], str):
        return exc.args[0]
    return str(exc)


def check_authentication() -> dict:
    """Non-interactive Earthdata check used by the app. Never prompts, never prints or returns a secret.

    ``earthaccess.login`` only reports ``authenticated`` after Earthdata Login itself accepted the saved
    credentials or token, so this is an actual server-side check, not a test for a file's existence.
    States: connected | not_connected | check_failed (network/other) | dependency_missing.
    """
    checked_at = utc_now()
    try:
        import earthaccess
    except ImportError:
        return {"state": "dependency_missing", "checkedAt": checked_at,
                "message": "The earthaccess package is not installed in the pipeline Python environment.",
                "guidance": "Install it with: pipeline\\venv\\Scripts\\python -m pip install -r pipeline\\requirements.txt"}
    strategy = _login_strategy()
    try:
        result = earthaccess.login(strategy=strategy)
    except Exception as exc:
        text = f"{type(exc).__name__} {exc}".lower()
        network = any(k in text for k in ("connectionerror", "max retries", "timed out", "timeout", "name resolution", "ssl", "10013"))
        return {"state": "check_failed" if network else "not_connected", "checkedAt": checked_at, "strategy": strategy,
                "message": sanitize_text(_plain_message(exc), (ROOT,)),
                "guidance": ("Could not reach NASA Earthdata. Check your internet connection and press 'Test connection' again." if network
                             else "No valid saved Earthdata login was found. Run the login command shown in the panel once, then test again.")}
    if getattr(result, "authenticated", False):
        out = {"state": "connected", "checkedAt": checked_at, "strategy": strategy,
               "message": "Earthdata accepted the saved login.", "guidance": "You can start downloads and analysis."}
        token = getattr(result, "token", None)
        if isinstance(token, dict) and token.get("expiration_date"):
            out["tokenExpires"] = str(token["expiration_date"])
        return out
    return {"state": "not_connected", "checkedAt": checked_at, "strategy": strategy,
            "message": "Earthdata did not accept the saved login (it may have expired).",
            "guidance": "Run the login command shown in the panel once, then test again."}


def _scene_handle(record):
    import earthaccess
    try:
        handles = earthaccess.open([record])
    except Exception as exc:
        raise WorkflowError(f"Could not open the selected real NISAR scene {_granule_name(record)}: {exc}") from exc
    if len(handles) != 1:
        for handle in handles:
            try: handle.close()
            except Exception: pass
        raise WorkflowError(f"NASA returned {len(handles)} handles for one scene; expected exactly one for {_granule_name(record)}.")
    return handles[0]


def _run_analysis(request: dict, discovery: dict, context: dict, progress) -> dict:
    from forest_optical_reference import attach_forest_optical_reference

    compatibility = discovery["compatibility"]
    series_ids = discovery["selectedSceneIds"]
    catalog = None
    # Re-query and validate the user's specific discovered scene list; don't blindly trust
    # stale browser state or use the catalog's current best series without consent.
    current = search_compatible_series(request, series_ids)
    if current["status"] != "READY" or set(current["selectedSceneIds"]) != set(series_ids):
        raise WorkflowError("The selected scene list no longer forms a compatible series in the live NASA catalog. Discover again; no forest result was written.")

    # Repeat search records for opening. Since earthaccess object instances aren't kept in
    # a JSON job, query once more and map only the exactly selected GranuleUR identifiers.
    import earthaccess
    west, south, east, north = request["bbox"]
    catalog = earthaccess.search_data(short_name=PRODUCT, bounding_box=(west, south, east, north),
                                      temporal=(request["startDate"], request["endDate"]), count=1000)
    by_name = {_granule_name(item): item for item in catalog}
    if any(name not in by_name for name in series_ids):
        raise WorkflowError("One or more selected scenes disappeared from the fresh NASA catalog check. Run discovery again.")

    progress("Authenticating with NASA Earthdata Login")
    _authenticate_noninteractive()
    selected = [by_name[name] for name in series_ids]
    selected = sorted(selected, key=lambda item: scene_identity(_granule_name(item), FREQUENCY)["timestamp"])
    # The already-discovered dates are required to be unique: one GCOV acquisition per day.
    identities = [scene_identity(_granule_name(item), FREQUENCY) for item in selected]
    dates = [identity["date"] for identity in identities]
    if len(set(dates)) != len(dates) or len(identities) < 3:
        raise WorkflowError("The selected NISAR series needs at least three unique acquisition dates.")
    signatures = [_compatibility_record(_granule_name(item)) for item in selected]
    if any(signature != signatures[0] for signature in signatures[1:]):
        raise WorkflowError("The selected NISAR acquisitions have mixed geometry, paired acquisition modes or processing releases.")
    compatibility = signatures[0]

    # Don't create a run directory until catalog validation and authentication succeed.
    run_id = uuid4().hex
    run_dir = OUTPUT_ROOT / "runs" / run_id
    rasters_dir = run_dir / "rasters"
    rasters_dir.mkdir(parents=True, exist_ok=False)
    context["runDir"] = run_dir  # lets the worker mark this folder as a failed attempt if anything below raises
    bounds = tuple(request["bbox"])
    scene_manifest = []
    reference_hh = None
    reference_grid = None
    for index, (record, identity) in enumerate(zip(selected, identities), start=1):
        progress(f"Reading real GCOV HHHH/HVHV layers for acquisition {identity['date']} ({index}/{len(selected)})")
        scene_prefix = rasters_dir / f"scene_{index:02d}"
        handle = _scene_handle(record)
        try:
            hh_raw = rasters_dir / f"scene_{index:02d}_hh_raw.tif"
            hv_raw = rasters_dir / f"scene_{index:02d}_hv_raw.tif"
            extract_polarization_to_tiff(handle, FREQUENCY, "HHHH", hh_raw, bbox=bounds)
            extract_polarization_to_tiff(handle, FREQUENCY, "HVHV", hv_raw, bbox=bounds)
            quality = extract_quality_layers_to_tiff(handle, FREQUENCY, scene_prefix, bbox=bounds)
            quality_raw = Path(quality["quality_valid_path"])
        finally:
            handle.close()

        if index == 1:
            reference_hh = rasters_dir / f"observation_{index:02d}_hh_db.tif"
            shutil.move(hh_raw, reference_hh)
            reference_grid = reference_hh
            hh_aligned = reference_hh
        else:
            hh_aligned = rasters_dir / f"observation_{index:02d}_hh_db.tif"
            align_raster_to_reference(hh_raw, reference_grid, hh_aligned, categorical=False)
            hh_raw.unlink(missing_ok=True)
        hv_aligned = rasters_dir / f"observation_{index:02d}_hv_db.tif"
        quality_aligned = rasters_dir / f"observation_{index:02d}_quality_valid.tif"
        align_raster_to_reference(hv_raw, reference_grid, hv_aligned, categorical=False)
        align_raster_to_reference(quality_raw, reference_grid, quality_aligned, categorical=True)
        hv_raw.unlink(missing_ok=True)
        quality_raw.unlink(missing_ok=True)
        # The extractor's ancillary number-of-looks and ensemble-mask sidecars are
        # preserved for audit, but only the explicit conservative validity mask is used.
        quality_record = {
            "qualityValidFraction": quality.get("number_of_looks_valid_fraction"),
            "numberOfLooksMedian": quality.get("number_of_looks_median"),
            "numberOfLooksMinimum": quality.get("number_of_looks_min"),
            "numberOfLooksMaximum": quality.get("number_of_looks_max"),
            "maskEnsembleCounts": quality.get("mask_ensemble_counts"),
            "maskAttributes": quality.get("mask_attributes"),
            "maskInterpretation": quality.get("mask_interpretation"),
            "numberOfLooksRaster": (str(Path(quality["number_of_looks_path"]).relative_to(run_dir))
                                     if quality.get("number_of_looks_path") else None),
            "maskEnsembleRaster": (str(Path(quality["mask_ensemble_path"]).relative_to(run_dir))
                                   if quality.get("mask_ensemble_path") else None),
        }
        scene_manifest.append({"date": identity["date"], "scene_id": _granule_name(record),
            "hh_path": str(hh_aligned.relative_to(run_dir)), "hv_path": str(hv_aligned.relative_to(run_dir)),
            "quality_mask_path": str(quality_aligned.relative_to(run_dir)),
            "quality": quality_record, "compatibility": _compatibility_record(_granule_name(record)),
            "source": {"product": PRODUCT, "productMaturity": "PROVISIONAL", "granuleId": _granule_name(record)}})

    progress("Downloading authentic ESA WorldCover tiles and building the forest mask")
    mask_info = build_worldcover_forest_mask(request["bbox"], reference_grid,
        run_dir / "forest_mask.tif", OUTPUT_ROOT / "cache" / "worldcover",
        boundary_geojson=request.get("boundaryGeoJson"))

    # Computed once: the run manifest used to read ``manifest["site"]`` while the dict literal defining
    # ``manifest`` was still being built, raising UnboundLocalError on every run that reached this point.
    boundary_source = ("User-uploaded WGS84 GeoJSON polygon/multipolygon; raster mask clipped to supplied geometry"
                       if request.get("boundaryGeoJson") else "User-selected WGS84 rectangular study AOI; not a forest-boundary claim")
    manifest = {"schema_version": 1, "workflow_version": "forest-workflow-v1",
        "data_source": "NISAR", "created_at": datetime.now(timezone.utc).isoformat(),
        "site": {"name": request["siteName"], "bbox": request["bbox"],
                 "forest_mask_path": "forest_mask.tif", "forest_mask_source": f"{mask_info['dataset']}; {mask_info['sourceUrl']}; accessed {datetime.now(timezone.utc).date().isoformat()}",
                 "forest_mask_metadata": {key: value for key, value in mask_info.items() if key != "path"},
                 "boundary_source": boundary_source,
                 "boundaryGeoJson": request.get("boundaryGeoJson")},
        "compatibility": compatibility,
        "observations": scene_manifest,
        "provenance": {"catalogSource": CMR_SOURCE, "catalogProduct": PRODUCT,
            "selectedSceneIds": series_ids, "observationDates": [o["date"] for o in scene_manifest],
            "selectedSceneMetadata": [{"date": o["date"], "sceneId": o["scene_id"],
                                        "compatibility": o["compatibility"]} for o in scene_manifest],
            "resampling": "HH/HV bilinear to the first scene's GCOV grid; validity mask nearest-neighbour",
            "worldCoverAttribution": WORLD_COVER_ATTRIBUTION,
            "boundarySource": boundary_source}}
    manifest_path = run_dir / "forest_manifest.json"
    atomic_json(manifest_path, manifest)

    progress("Running the forest-specific temporal HH/HV anomaly screen")
    analysis = analyze_manifest(manifest_path, threshold_db=request["thresholdDb"],
        robust_multiplier=request["robustMultiplier"],
        minimum_region_pixels=request["minimumRegionPixels"],
        minimum_valid_fraction=request["minimumValidFraction"])
    if analysis["readiness"]["status"] == "BLOCKED":
        # A blocked analysis is still a useful, honest report: it records the actual
        # scenes and failed readiness checks, but contains no candidate detections.
        # Try to preserve measured HH/HV quicklooks for inspection even if coverage
        # is too weak for anomaly screening. Quicklook failure never creates imagery.
        try:
            from forest_previews import render_run_previews
            blocked_quicklooks = render_run_previews(manifest_path, run_dir / "previews")
        except Exception as preview_error:
            logging.exception("Blocked-run radar quicklook rendering failed")
            blocked_quicklooks = {"status": "UNAVAILABLE", "source": PRODUCT, "count": 0,
                "requestedCount": 0, "dates": [], "channels": ["hh", "hv"],
                "message": f"Real raster quicklooks could not be rendered: {type(preview_error).__name__}: {preview_error}"}
        # Keep it inside this run so the UI can inspect it by run ID. Do not publish
        # it as the current successful analysis or overwrite the previous good run.
        analysis["runId"] = run_id
        analysis["site"]["bounds"] = [float(value) for value in request["bbox"]]
        analysis["product"] = PRODUCT
        analysis["productMaturity"] = "PROVISIONAL"
        analysis["compatibility"] = compatibility
        analysis["method"].update({
            "name": "Leave-one-observation-out median anomaly screen",
            "version": analysis.get("methodVersion"),
            "thresholdDb": request["thresholdDb"],
            "robustMultiplier": request["robustMultiplier"],
            "minimumRegionPixels": request["minimumRegionPixels"],
            "minimumValidFraction": request["minimumValidFraction"],
            "inputsAreDb": True,
            "maskSource": mask_info.get("sourceUrl"),
            "description": "Processing stopped at the data-readiness gate. No candidate regions were generated.",
        })
        analysis["provenance"] = {
            "workflowVersion": "forest-workflow-v1",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "siteName": request["siteName"],
            "bboxWgs84WestSouthEastNorth": request["bbox"],
            "dateRange": {"start": request["startDate"], "end": request["endDate"]},
            "catalog": {"source": CMR_SOURCE, "product": PRODUCT, "maturity": "PROVISIONAL",
                        "catalogHits": discovery.get("catalogHits"),
                        "selectedScenes": [{"date": scene["date"], "granuleId": scene["sceneId"]} for scene in discovery["scenes"]]},
            "forestMask": {key: value for key, value in mask_info.items() if key != "path"},
            "detectorSettings": {"thresholdDb": request["thresholdDb"],
                                 "robustMultiplier": request["robustMultiplier"],
                                 "minimumRegionPixels": request["minimumRegionPixels"],
                                 "minimumValidFraction": request["minimumValidFraction"]},
            "independentOpticalContext": {"source": "NASA HLS L30/S30 v2.0", "status": "NOT_RUN",
                                          "referenceValidated": False, "dates": []},
            "radarQuicklooks": {key: blocked_quicklooks.get(key) for key in
                                ("status", "source", "count", "requestedCount", "dates", "channels", "sharedPercentileScale", "message")},
            "cautions": ["Readiness was blocked; no candidate detections were produced.",
                         "NISAR backscatter anomalies are not confirmed forest loss.",
                         "ESA WorldCover 2021 is a static dated forest-cover mask."],
        }
        analysis["opticalEvidenceSummary"] = {"status": "NOT_RUN", "summary": "Optical cross-check skipped because the forest readiness gate was blocked.", "referenceValidated": False, "dates": []}
        atomic_json(run_dir / "forest_analysis.json", analysis)
        atomic_json(run_dir / "workflow_provenance.json", {
            "workflowRunId": run_id, "createdAt": datetime.now(timezone.utc).isoformat(),
            "request": request, "catalogDiscovery": discovery,
            "forestMask": {key: value for key, value in mask_info.items() if key != "path"},
            "analysisReadiness": analysis["readiness"],
            "radarQuicklooks": {key: blocked_quicklooks.get(key) for key in
                                ("status", "source", "count", "requestedCount", "dates", "channels", "message")},
            "dataSources": {"nisar": "NASA/ASF NISAR L2 GCOV PROVISIONAL V1",
                            "forestMask": "ESA WorldCover 2021 v200",
                            "opticalReference": "Not run because readiness was blocked"},
        })
        return {"runId": run_id, "runDirectory": str(run_dir), "analysisStatus": "BLOCKED",
                "observationCount": len(analysis.get("observations", [])), "candidateCount": 0,
                "opticalSummary": "NOT RUN — data-readiness checks blocked the analysis",
                "message": analysis["readiness"]["summary"],
                "workflowStatus": "COMPLETE_WITH_BLOCKED_ANALYSIS"}

    progress("Rendering map-aligned quicklooks from the actual HH/HV measurements")
    try:
        from forest_previews import render_run_previews
        radar_previews = render_run_previews(manifest_path, run_dir / "previews")
    except Exception as preview_error:
        # Visualization is optional to the measurements: expose the failure rather
        # than substituting a colorized placeholder or discarding valid analysis.
        logging.exception("Real NISAR quicklook rendering failed")
        radar_previews = {"status": "UNAVAILABLE", "source": PRODUCT, "count": 0,
            "requestedCount": 0, "dates": [], "channels": ["hh", "hv"],
            "message": f"Measured NISAR analysis completed, but the radar quicklook renderer failed: {type(preview_error).__name__}: {preview_error}"}

    progress("Checking actual NASA HLS optical observations for independent vegetation-change context")
    optical = attach_forest_optical_reference(analysis, manifest_path, progress=progress)
    analysis["runId"] = run_id
    analysis["opticalEvidenceSummary"] = optical
    mask_info_export = {key: value for key, value in mask_info.items() if key != "path"}
    analysis["provenance"] = {
        "workflowVersion": "forest-workflow-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "siteName": request["siteName"], "bboxWgs84WestSouthEastNorth": request["bbox"],
        "dateRange": {"start": request["startDate"], "end": request["endDate"]},
        "catalog": {"source": CMR_SOURCE, "product": PRODUCT, "maturity": "PROVISIONAL",
                    "catalogHits": discovery.get("catalogHits"),
                    "selectedScenes": [{"date": scene["date"], "granuleId": scene["sceneId"]} for scene in discovery["scenes"]]},
        "forestMask": mask_info_export,
        "detectorSettings": {"thresholdDb": request["thresholdDb"], "robustMultiplier": request["robustMultiplier"],
                              "minimumRegionPixels": request["minimumRegionPixels"],
                              "minimumValidFraction": request["minimumValidFraction"]},
        "independentOpticalContext": {"source": optical.get("source"), "sourceUrl": optical.get("sourceUrl"),
                                      "status": optical.get("status"), "referenceValidated": False,
                                      "dates": optical.get("dates", [])},
        "radarQuicklooks": {key: radar_previews.get(key) for key in
                            ("status", "source", "count", "requestedCount", "dates", "channels", "sharedPercentileScale", "message")},
        "cautions": ["NISAR backscatter anomalies are not confirmed forest loss.",
                     "HLS index change is independent optical context, not ground truth.",
                     "ESA WorldCover 2021 is a static dated forest-cover mask."]
    }
    # Save the full run before publishing the stable current-analysis pointer.
    atomic_json(run_dir / "forest_analysis.json", analysis)
    atomic_json(run_dir / "forest_optical_evidence.json", optical)
    atomic_json(run_dir / "workflow_provenance.json", {
        "workflowRunId": run_id, "createdAt": datetime.now(timezone.utc).isoformat(),
        "request": request, "catalogDiscovery": discovery, "forestMask": mask_info_export,
        "dataSources": {"nisar": "NASA/ASF NISAR L2 GCOV PROVISIONAL V1", "forestMask": "ESA WorldCover 2021 v200", "opticalReference": "NASA HLS L30/S30 v2.0 when available"},
        "software": {"workflow": "forest-workflow-v1", "detector": analysis.get("methodVersion")},
        "cautions": ["NISAR backscatter anomaly is not confirmed forest loss.", "HLS index change is independent context, not ground truth.", "ESA WorldCover 2021 is a static, dated forest-cover mask."]})
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    atomic_json(OUTPUT_ROOT / "forest_analysis.json", analysis)
    atomic_json(OUTPUT_ROOT / "current_run.json", {"runId": run_id, "path": str(run_dir), "status": "COMPLETE",
                 "dataSource": "NISAR", "updatedAt": datetime.now(timezone.utc).isoformat()})
    return {"runId": run_id, "analysisPath": str(OUTPUT_ROOT / "forest_analysis.json"),
            "runDirectory": str(run_dir), "analysisStatus": analysis["readiness"]["status"],
            "observationCount": len(analysis["observations"]), "candidateCount": len(analysis["candidates"]),
            "opticalSummary": optical.get("summary"), "message": "Real NISAR processing completed. Read the optical-evidence status and limitations in the report; HLS agreement is not field validation."}


def _mark_failed_run(run_dir: Path, error: BaseException, cancelled: bool) -> None:
    """A run folder that never produced an analysis is a failed attempt, not a result.

    Write a marker (so it can never be mistaken for a saved run) and delete the intermediate rasters, which are
    re-creatable and can be large. Best effort: reporting a failure must never raise a second failure.
    """
    try:
        if (run_dir / "forest_analysis.json").exists():
            return  # analysis (including a BLOCKED diagnostic report) was saved; this is a real run folder
        marker = {"status": "CANCELLED" if cancelled else "FAILED", "failedAt": utc_now(),
                  "errorType": type(error).__name__, "message": sanitize_text(error, (ROOT,)),
                  "note": "No analysis was published from this attempt. Intermediate rasters were removed."}
        atomic_json_path = run_dir / "failure.json"
        _atomic_write(atomic_json_path, json.dumps(marker, indent=2))
        shutil.rmtree(run_dir / "rasters", ignore_errors=True)
        for leftover in run_dir.glob("*.partial*"):
            leftover.unlink(missing_ok=True)
    except Exception:
        logging.exception("Could not write the failed-run marker")


def run_worker(job_id: str) -> int:
    """Run one queued job. Every outcome is recorded on the job; this function never leaves a job RUNNING."""
    if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
        print("Invalid job identifier.", file=sys.stderr)
        return 1  # nothing to record against, and nothing on disk is touched
    jobs_root = OUTPUT_ROOT / "jobs"
    request_path = jobs_root / f"{job_id}_request.json"
    job_path = jobs_root / f"{job_id}.json"
    jobs_root.mkdir(parents=True, exist_ok=True)

    recorder = JobRecorder(job_path, job_id, None, roots=(ROOT,))
    context: dict = {}
    recorder.write()
    recorder.start_heartbeat()
    try:
        # Everything, including reading and validating the request, is inside the try so a bad job is reported.
        if not request_path.is_file():
            raise WorkflowError("The forest job request file is missing, so there is nothing to run.")
        request_doc = json.loads(request_path.read_text(encoding="utf-8"))
        action = request_doc.get("action")
        recorder.job["action"] = action
        os.environ.setdefault("GDAL_NUM_THREADS", "2")
        if action == "coverage":
            recorder.progress("Scanning NASA's public CMR catalog for compatible NISAR acquisition stacks")
            recorder.complete("Coverage scan complete (catalog records only)", scan_coverage(request_doc.get("request")))
            return 0
        request = validate_request(request_doc.get("request"))
        if action == "discover":
            recorder.progress("Searching NASA's live CMR catalog for compatible NISAR GCOV acquisitions")
            result = search_compatible_series(request)
            result["workflowVersion"] = "forest-workflow-v1"
            recorder.complete("Catalog discovery complete", result)
            return 0
        if action == "run":
            recorder.progress("Rechecking selected scenes against NASA CMR")
            selected_ids = request_doc.get("selectedSceneIds")
            if not isinstance(selected_ids, list) or len(selected_ids) < 3:
                raise WorkflowError("Run requires at least three scene IDs selected from a successful live discovery.")
            discovery = search_compatible_series(request, selected_ids)
            if discovery.get("status") != "READY":
                raise WorkflowError(discovery.get("message", "Selected series is no longer ready."))
            result = _run_analysis(request, discovery, context, recorder.progress)
            if result.get("analysisStatus") == "BLOCKED":
                recorder.complete("Data readiness blocked analysis; saved the actual diagnostic report with zero candidates", result)
            else:
                recorder.complete("Real-data forest analysis complete", result)
            return 0
        raise WorkflowError("Unsupported forest workflow action.")
    except WorkflowCancelled as exc:
        stage = str(recorder.job.get("stage"))
        if context.get("runDir"):
            _mark_failed_run(context["runDir"], exc, cancelled=True)
        recorder.cancelled(stage)
        return 1
    except BaseException as exc:  # noqa: BLE001 - the job must reach a terminal state for any failure, even KeyboardInterrupt
        logging.exception("Forest workflow stopped")
        if context.get("runDir"):
            _mark_failed_run(context["runDir"], exc, cancelled=False)
        try:
            recorder.failed(exc)
        except Exception:
            logging.exception("Could not record the failure on the job")
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        return 1
    finally:
        recorder.stop_heartbeat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    login = sub.add_parser("login", help="Run an interactive NASA Earthdata Login and persist it locally.")
    login.set_defaults(command="login")
    sub.add_parser("auth-check", help="Check Earthdata authentication without prompting; prints one JSON object.")
    sub.add_parser("environment", help="Report which pipeline packages are available; prints one JSON object.")
    worker = sub.add_parser("worker", help="Internal local-app background worker.")
    worker.add_argument("--job-id", required=True)
    discover = sub.add_parser("discover", help="Query the live NASA CMR catalog without downloading science data.")
    discover.add_argument("--site-name", required=True)
    discover.add_argument("--bbox", nargs=4, required=True, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    discover.add_argument("--start-date", required=True)
    discover.add_argument("--end-date", required=True)
    run = sub.add_parser("run", help="Run the full real NISAR + ESA WorldCover + HLS workflow.")
    run.add_argument("--site-name", required=True)
    run.add_argument("--bbox", nargs=4, required=True, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    run.add_argument("--start-date", required=True)
    run.add_argument("--end-date", required=True)
    run.add_argument("--threshold-db", type=float, default=2.5)
    run.add_argument("--robust-multiplier", type=float, default=3.0)
    run.add_argument("--minimum-region-pixels", type=int, default=20)
    run.add_argument("--minimum-valid-fraction", type=float, default=0.70)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        if args.command == "login":
            import earthaccess
            auth = earthaccess.login(persist=True)
            if not auth.authenticated:
                raise WorkflowError("NASA Earthdata login was not accepted.")
            print("NASA Earthdata Login succeeded and credentials were persisted in the local user configuration.")
            return 0
        if args.command == "worker":
            return run_worker(args.job_id)
        if args.command == "auth-check":
            print(json.dumps(check_authentication()))
            return 0
        if args.command == "environment":
            from forest_jobs import environment_summary
            print(json.dumps(environment_summary()))
            return 0
        raw_request = {"siteName": args.site_name, "bbox": args.bbox,
                       "startDate": args.start_date, "endDate": args.end_date}
        if args.command == "run":
            raw_request.update({"thresholdDb": args.threshold_db, "robustMultiplier": args.robust_multiplier,
                                "minimumRegionPixels": args.minimum_region_pixels,
                                "minimumValidFraction": args.minimum_valid_fraction})
        request = validate_request(raw_request)
        if args.command == "discover":
            result = search_compatible_series(request)
            print(json.dumps(result, indent=2))
            return 0 if result.get("status") == "READY" else 2
        if args.command == "run":
            result = search_compatible_series(request)
            if result.get("status") != "READY":
                print(json.dumps(result, indent=2))
                return 2
            # CLI run processes the exact current best compatible series.
            cli_id = uuid4().hex
            job_root = OUTPUT_ROOT / "jobs"
            job_root.mkdir(parents=True, exist_ok=True)
            request_path = job_root / f"{cli_id}_request.json"
            atomic_json(request_path, {"action": "run", "request": request,
                                       "selectedSceneIds": result["selectedSceneIds"]})
            atomic_json(job_root / f"{cli_id}.json", {"id": cli_id, "status": "RUNNING", "stage": "CLI run"})
            status = run_worker(cli_id)
            job_payload = json.loads((job_root / f"{cli_id}.json").read_text(encoding="utf-8"))
            print(json.dumps(job_payload.get("result", {"status": job_payload.get("status"), "error": job_payload.get("error")}), indent=2))
            return status
    except Exception as exc:
        print(f"Forest workflow failed: {exc}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
