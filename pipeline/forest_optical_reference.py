"""Independent NASA HLS vegetation-index context for real forest candidates.

Uses real HLS L30/S30 surface-reflectance COG bands and Fmask quality flags. The
comparison is date-matched and forest-mask constrained. Index changes are context,
not ground truth or a claim of confirmed deforestation.
"""
from __future__ import annotations

import json

from datetime import date, timedelta
import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import reproject, transform_bounds, transform_geom
from rasterio.windows import Window, from_bounds
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.ops import transform as transform_geometry
from pyproj import Transformer

from hls_reference import _identity, _common_tile_pairs, _band_url, ReferenceUnavailable

MIN_CLEAR_COVERAGE = 0.20
MIN_CLEAR_PIXELS = 100
MIN_CANDIDATE_PIXELS = 10
DATE_TOLERANCE_DAYS = 10
NDVI_CHANGE_SCREEN = -0.10
NBR_CHANGE_SCREEN = -0.10


def _read_band(granule, band: str, bbox: tuple[float, float, float, float]):
    import earthaccess
    url = _band_url(granule, band)
    opened = earthaccess.open([url], show_progress=False)
    if len(opened) != 1:
        for item in opened:
            try: item.close()
            except Exception: pass
        raise ReferenceUnavailable(f"HLS {band} layer did not resolve to exactly one data stream.")
    handle = opened[0]
    try:
        with rasterio.open(handle) as src:
            if src.crs is None or src.count != 1:
                raise ReferenceUnavailable(f"HLS {band} layer has no valid single-band georeferencing.")
            left, bottom, right, top = transform_bounds("EPSG:4326", src.crs, *bbox, densify_pts=21)
            window = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
            window = window.intersection(Window(0, 0, src.width, src.height))
            if window.width <= 0 or window.height <= 0:
                raise ReferenceUnavailable(f"HLS {band} layer has no coverage over the study area.")
            masked = src.read(1, window=window, masked=True)
            values = np.asarray(masked.filled(-9999), dtype=np.float32)
            valid = ~np.ma.getmaskarray(masked)
            return {"values": values, "valid": valid, "crs": src.crs,
                    "transform": src.window_transform(window), "profile": src.profile.copy(),
                    "shape": values.shape, "source": url}
    finally:
        handle.close()



def compute_hls_indices(nir: np.ndarray, red: np.ndarray, swir2: np.ndarray,
                        fmask: np.ndarray, source_valid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute NDVI/NBR from native HLS reflectance with documented Fmask screening."""
    nir = np.asarray(nir, dtype="float32")
    red = np.asarray(red, dtype="float32")
    swir2 = np.asarray(swir2, dtype="float32")
    qa = np.asarray(fmask, dtype="int32") & 0xFF
    valid = np.asarray(source_valid, dtype=bool).copy()
    if nir.shape != red.shape or nir.shape != swir2.shape or nir.shape != qa.shape or nir.shape != valid.shape:
        raise ValueError("HLS NIR, red, SWIR2, Fmask and validity layers must have the same shape.")
    # HLS v2 Fmask bits: cloud, cloud/shadow adjacency, shadow, snow/ice;
    # bits 6-7 value 3 represent high aerosol.
    bad_qa = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)
    valid &= ((qa & bad_qa) == 0) & (((qa >> 6) & 0b11) < 0b11)
    for values in (nir, red, swir2):
        valid &= np.isfinite(values) & (values > -9999) & (values < 12000)
    ndvi_denominator = nir + red
    nbr_denominator = nir + swir2
    valid &= (np.isfinite(ndvi_denominator) & np.isfinite(nbr_denominator) &
              (ndvi_denominator > 0) & (nbr_denominator > 0))
    ndvi = np.full(nir.shape, np.nan, dtype="float32")
    nbr = np.full(nir.shape, np.nan, dtype="float32")
    ndvi[valid] = (nir[valid] - red[valid]) / ndvi_denominator[valid]
    nbr[valid] = (nir[valid] - swir2[valid]) / nbr_denominator[valid]
    return ndvi, nbr, valid

def read_hls_forest_indices(granule, bbox: tuple[float, float, float, float]) -> dict:
    """Read real HLS NIR/red/SWIR2/Fmask and calculate native-grid NDVI and NBR."""
    identity = _identity(granule)
    if identity is None:
        raise ReferenceUnavailable("HLS granule identity is not a recognized v2.0 L30/S30 product.")
    if identity["product"] == "L30":
        nir_band, red_band, swir_band = "B05", "B04", "B07"
    else:
        nir_band, red_band, swir_band = "B8A", "B04", "B12"
    arrays = {band: _read_band(granule, band, bbox) for band in (nir_band, red_band, swir_band, "Fmask")}
    reference = arrays[nir_band]
    for band, current in arrays.items():
        if (current["crs"] != reference["crs"] or current["shape"] != reference["shape"]
                or not current["transform"].almost_equals(reference["transform"], precision=1e-8)):
            raise ReferenceUnavailable(f"HLS {band} is not aligned with the other spectral/QA bands.")

    nir = arrays[nir_band]["values"].astype("float32")
    red = arrays[red_band]["values"].astype("float32")
    swir = arrays[swir_band]["values"].astype("float32")
    qa = arrays["Fmask"]["values"].astype("int32") & 0xFF
    ndvi, nbr, valid = compute_hls_indices(
        nir, red, swir, qa,
        arrays[nir_band]["valid"] & arrays[red_band]["valid"] & arrays[swir_band]["valid"] & arrays["Fmask"]["valid"])
    return {"identity": identity, "ndvi": ndvi, "nbr": nbr, "valid": valid,
            "crs": reference["crs"], "transform": reference["transform"],
            "shape": list(ndvi.shape), "pixelSize": [reference["transform"].a, reference["transform"].e],
            "bands": {"nir": nir_band, "red": red_band, "swir2": swir_band, "qa": "Fmask"},
            "sourceUrls": {band: arrays[band]["source"] for band in arrays}}


def _candidate_mask_on_radar_grid(analysis: dict, event_date: str, profile: dict) -> np.ndarray:
    geometries = []
    for candidate in analysis.get("candidates", []):
        if candidate.get("date") != event_date:
            continue
        geometry = candidate.get("geometry")
        if isinstance(geometry, dict) and geometry.get("type") in ("Polygon", "MultiPolygon"):
            geometries.append((transform_geom("EPSG:4326", profile["crs"], geometry), 1))
    return rasterize(geometries, out_shape=(profile["height"], profile["width"]),
                     transform=profile["transform"], fill=0, dtype="uint8")


def _area_average_to_hls(values: np.ndarray, source_profile: dict, target: dict) -> np.ndarray:
    result = np.zeros(target["shape"], dtype="float32")
    reproject(source=values.astype("float32"), destination=result,
              src_transform=source_profile["transform"], src_crs=source_profile["crs"],
              src_nodata=None, dst_transform=target["transform"], dst_crs=target["crs"],
              dst_nodata=None, init_dest_nodata=False, resampling=Resampling.average)
    return np.clip(result, 0, 1)


def _mask_to_hls(mask_values: np.ndarray, source_profile: dict, target: dict) -> np.ndarray:
    out = np.zeros(target["shape"], dtype="uint8")
    reproject(source=mask_values.astype("uint8"), destination=out,
              src_transform=source_profile["transform"], src_crs=source_profile["crs"],
              src_nodata=0, dst_transform=target["transform"], dst_crs=target["crs"],
              dst_nodata=0, resampling=Resampling.nearest)
    return out > 0


def _evaluate_pair(before: dict, after: dict, forest_native: np.ndarray,
                   candidate_fraction: np.ndarray) -> dict:
    common = (forest_native & before["valid"] & after["valid"] &
              np.isfinite(before["ndvi"]) & np.isfinite(after["ndvi"]) &
              np.isfinite(before["nbr"]) & np.isfinite(after["nbr"]))
    forest_total = int(forest_native.sum())
    common_count = int(common.sum())
    coverage = common_count / forest_total if forest_total else 0.0
    candidate_pixels = common & (candidate_fraction >= 0.05)
    candidate_count = int(candidate_pixels.sum())
    ndvi_delta = after["ndvi"] - before["ndvi"]
    nbr_delta = after["nbr"] - before["nbr"]
    control_pixels = common & (candidate_fraction < 0.01)
    result = {"status": "INCONCLUSIVE", "referenceValidated": False,
        "referenceProduct": "NASA HLS v2.0 L30/S30 surface reflectance",
        "resolutionMeters": 30, "baselineScene": before["identity"]["granule_id"],
        "eventScene": after["identity"]["granule_id"],
        "baselineDate": before["identity"]["date"].isoformat(),
        "eventDate": after["identity"]["date"].isoformat(),
        "baselineProduct": before["identity"]["product"], "eventProduct": after["identity"]["product"],
        "hlsTile": before["identity"]["tile"], "commonClearForestPixels": common_count,
        "forestPixelsOnHlsGrid": forest_total, "commonClearForestCoverageFraction": coverage,
        "candidateHlsPixels": candidate_count,
        "candidateMedianNdviChange": float(np.nanmedian(ndvi_delta[candidate_pixels])) if candidate_count else None,
        "candidateMedianNbrChange": float(np.nanmedian(nbr_delta[candidate_pixels])) if candidate_count else None,
        "comparisonForestMedianNdviChange": float(np.nanmedian(ndvi_delta[control_pixels])) if control_pixels.any() else None,
        "comparisonForestMedianNbrChange": float(np.nanmedian(nbr_delta[control_pixels])) if control_pixels.any() else None,
        "screenThresholds": {"ndviDrop": NDVI_CHANGE_SCREEN, "nbrDrop": NBR_CHANGE_SCREEN},
        "sourceUrls": {"baseline": before["sourceUrls"], "event": after["sourceUrls"]},
        "note": "HLS NDVI/NBR changes are independent optical context, not ground truth. Seasonal effects, clouds, timing mismatch and mixed pixels can affect the comparison."}
    if coverage < MIN_CLEAR_COVERAGE or common_count < MIN_CLEAR_PIXELS:
        result["status"] = "INCONCLUSIVE"
        result["summary"] = (f"Only {coverage:.1%} ({common_count:,} pixels) of the forest mask has common clear HLS coverage; this is below the configured screening minimum. Optical agreement is not assessed.")
        return result
    if candidate_count < MIN_CANDIDATE_PIXELS:
        result["status"] = "INCONCLUSIVE"
        result["summary"] = f"Only {candidate_count} HLS cells overlap this radar candidate, too few for the configured optical comparison."
        return result
    dndvi, dnbr = result["candidateMedianNdviChange"], result["candidateMedianNbrChange"]
    if (dndvi is not None and dndvi <= NDVI_CHANGE_SCREEN) or (dnbr is not None and dnbr <= NBR_CHANGE_SCREEN):
        result["status"] = "SUPPORTS_OPTICAL_VEGETATION_CHANGE"
        result["summary"] = f"Clear-sky HLS shows a median candidate-area change of {dndvi:.3f} NDVI and {dnbr:.3f} NBR (after minus baseline). This supports optical vegetation-change context; it does not establish deforestation or its cause." if dndvi is not None and dnbr is not None else "HLS vegetation-index change supports the radar candidate's context, but does not establish deforestation or its cause."
    else:
        result["status"] = "NO_STRONG_OPTICAL_SIGNAL"
        result["summary"] = f"The available clear-sky HLS comparison did not pass the exploratory NDVI/NBR drop screens (median ΔNDVI {dndvi:.3f}; median ΔNBR {dnbr:.3f}). That does not prove the radar candidate is false." if dndvi is not None and dnbr is not None else "The available HLS comparison did not show a strong negative vegetation-index signal; this does not prove the radar candidate is false."
    return result


def _set_independent_check(analysis: dict, status: str, message: str) -> None:
    checks = analysis.setdefault("readiness", {}).setdefault("checks", [])
    for check in checks:
        if check.get("id") == "independent_evidence":
            check.update(status=status, message=message)
            return
    checks.append({"id": "independent_evidence", "label": "Independent HLS optical context", "status": status, "message": message})


def attach_forest_optical_reference(analysis: dict, manifest_path: Path | str, progress=None) -> dict:
    """Attempt independent HLS comparison for candidate dates, retaining honest gaps."""
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidates = analysis.get("candidates", [])
    target_dates = sorted({item.get("date") for item in candidates if isinstance(item.get("date"), str)})
    if not target_dates:
        summary = {"status": "NOT_NEEDED", "summary": "The radar screen emitted no candidate regions for optical cross-check. No optical agreement is implied.", "dates": [], "source": "NASA HLS L30/S30 v2.0", "referenceValidated": False}
        _set_independent_check(analysis, "INFO", summary["summary"])
        return summary

    try:
        import earthaccess
        from hls_reference import _common_tile_pairs
        observations = manifest["observations"]
        baseline_day = date.fromisoformat(observations[0]["date"])
        bbox = tuple(float(v) for v in manifest["site"]["bbox"])
        boundary_doc = manifest["site"].get("boundaryGeoJson")
        if isinstance(boundary_doc, dict) and boundary_doc.get("type") == "FeatureCollection":
            boundary_parts = [shape(feature["geometry"]) for feature in boundary_doc.get("features", [])
                              if isinstance(feature, dict) and isinstance(feature.get("geometry"), dict)]
            boundary = unary_union(boundary_parts) if boundary_parts else box(*bbox)
        else:
            boundary = box(*bbox)
        start = date.fromisoformat(min([baseline_day.isoformat(), *target_dates])) - timedelta(days=DATE_TOLERANCE_DAYS)
        end = date.fromisoformat(max(target_dates)) + timedelta(days=DATE_TOLERANCE_DAYS)
        catalog = []
        searches = []
        for product in ("HLSL30", "HLSS30"):
            try:
                found = earthaccess.search_data(short_name=product, bounding_box=bbox,
                    temporal=(start.isoformat(), end.isoformat()), count=500)
                catalog.extend(found or [])
                searches.append({"product": product, "resultCount": len(found or []), "status": "OK"})
            except Exception as exc:
                searches.append({"product": product, "resultCount": 0, "status": "UNAVAILABLE", "errorType": type(exc).__name__})
        if not catalog:
            raise ReferenceUnavailable("NASA CMR returned no date-matched HLS L30/S30 scenes for the forest AOI.")

        forest_mask_path = (manifest_path.parent / manifest["site"]["forest_mask_path"]).resolve()
        hh_reference_path = (manifest_path.parent / observations[0]["hh_path"]).resolve()
        with rasterio.open(forest_mask_path) as mask_src, rasterio.open(hh_reference_path) as radar_src:
            forest_mask_radar = mask_src.read(1, masked=True).filled(0).astype("uint8") > 0
            radar_profile = radar_src.profile.copy()
        cache = {}
        date_results = []
        for date_index, target_date in enumerate(target_dates, start=1):
            if progress:
                progress(f"HLS independent check {date_index}/{len(target_dates)} for NISAR candidate date {target_date}")
            event_day = date.fromisoformat(target_date)
            candidates_date = [c for c in candidates if c.get("date") == target_date]
            radar_candidate = _candidate_mask_on_radar_grid(analysis, target_date, radar_profile)
            candidate_area_pixels = int(radar_candidate.sum())
            pair_candidates = _common_tile_pairs(catalog, baseline_day, event_day, DATE_TOLERANCE_DAYS, boundary)
            if not pair_candidates:
                message = "No HLS baseline/event pair in the same tile falls within the configured date tolerance."
                date_results.append({"date": target_date, "status": "UNAVAILABLE", "referenceValidated": False,
                    "summary": message, "pairCount": 0})
                for candidate in candidates_date:
                    candidate["assessment"]["opticalEvidence"] = {"status": "UNAVAILABLE", "summary": message,
                                                                    "referenceValidated": False}
                continue
            best = None
            attempts = []
            # Select by common clear forest coverage, not by similarity to the radar labels.
            for first, second in pair_candidates[:6]:
                first_id, second_id = first["granule_id"], second["granule_id"]
                try:
                    if first_id not in cache:
                        cache[first_id] = read_hls_forest_indices(first["granule"], bbox)
                    if second_id not in cache:
                        cache[second_id] = read_hls_forest_indices(second["granule"], bbox)
                    hls_before, hls_after = cache[first_id], cache[second_id]
                    if (hls_before["crs"] != hls_after["crs"] or hls_before["shape"] != hls_after["shape"]
                            or not hls_before["transform"].almost_equals(hls_after["transform"], precision=1e-8)):
                        raise ReferenceUnavailable("HLS before/after scenes are not on the same tile grid.")
                    target = {"shape": tuple(hls_before["shape"]), "crs": hls_before["crs"], "transform": hls_before["transform"]}
                    forest_hls = _mask_to_hls(forest_mask_radar.astype("uint8"), radar_profile, target)
                    candidate_fraction = _area_average_to_hls(radar_candidate.astype("float32"), radar_profile, target)
                    result = _evaluate_pair(hls_before, hls_after, forest_hls, candidate_fraction)
                    attempts.append({"baselineScene": first_id, "eventScene": second_id,
                                     "coverage": result.get("commonClearForestCoverageFraction", 0), "status": result["status"]})
                    quality_score = (result["commonClearForestPixels"], result["commonClearForestCoverageFraction"])
                    if best is None or quality_score > best[0]:
                        best = (quality_score, result)
                except Exception as exc:
                    attempts.append({"baselineScene": first_id, "eventScene": second_id,
                                     "status": "UNAVAILABLE", "errorType": type(exc).__name__})
                    logging.warning("HLS forest pair failed (%s): %s / %s", type(exc).__name__, first_id, second_id)
            if best is None:
                message = "The available HLS pairs could not be read or aligned."
                date_results.append({"date": target_date, "status": "UNAVAILABLE", "referenceValidated": False,
                    "summary": message, "pairCount": len(pair_candidates), "attempts": attempts})
                for candidate in candidates_date:
                    candidate["assessment"]["opticalEvidence"] = {"status": "UNAVAILABLE", "summary": message,
                                                                    "referenceValidated": False}
                continue
            date_result = best[1]
            date_result.update({"date": target_date, "nisarCandidateCount": len(candidates_date),
                                "nisarCandidatePixelCount": candidate_area_pixels,
                                "dateToleranceDays": DATE_TOLERANCE_DAYS, "attempts": attempts,
                                "selectionMethod": "Maximum common clear forest-mask coverage; ties are not selected by agreement with radar candidates."})
            date_results.append(date_result)

            for candidate in candidates_date:
                candidate["assessment"]["opticalEvidence"] = {
                    "status": date_result.get("status", "UNAVAILABLE"),
                    "summary": date_result.get("summary", "No independent HLS evidence was produced."),
                    "referenceValidated": False,
                    "baselineDate": date_result.get("baselineDate"), "eventDate": date_result.get("eventDate"),
                    "candidateMedianNdviChange": date_result.get("candidateMedianNdviChange"),
                    "candidateMedianNbrChange": date_result.get("candidateMedianNbrChange"),
                    "commonClearForestCoverageFraction": date_result.get("commonClearForestCoverageFraction"),
                    "commonClearForestPixels": date_result.get("commonClearForestPixels"),
                    "baselineScene": date_result.get("baselineScene"), "eventScene": date_result.get("eventScene"),
                    "resolutionMeters": date_result.get("resolutionMeters", 30)}
        available = [item for item in date_results if item.get("status") not in ("UNAVAILABLE", "INCONCLUSIVE")]
        if available and any(item["status"] == "SUPPORTS_OPTICAL_VEGETATION_CHANGE" for item in available):
            overall_status = "SUPPORTS_OPTICAL_VEGETATION_CHANGE"
        elif available:
            overall_status = "NO_STRONG_OPTICAL_SIGNAL"
        elif date_results and all(item.get("status") == "UNAVAILABLE" for item in date_results):
            overall_status = "UNAVAILABLE"
        else:
            overall_status = "INCONCLUSIVE"
        # Optical context never counts as a PASS/validation outcome: it is not field truth.
        check_status = "PARTIAL" if overall_status in ("SUPPORTS_OPTICAL_VEGETATION_CHANGE", "NO_STRONG_OPTICAL_SIGNAL") else "INFO"
        check_message = f"HLS comparisons completed for {sum(item.get('status') not in ('UNAVAILABLE', 'INCONCLUSIVE') for item in date_results)} of {len(date_results)} candidate dates. Optical support is not field validation."
        summary = {"status": overall_status, "summary": check_message, "dates": date_results,
                   "searches": searches, "source": "NASA Harmonized Landsat Sentinel-2 (HLS) v2.0 L30/S30",
                   "sourceUrl": "https://hls.gsfc.nasa.gov/data-products/", "referenceValidated": False,
                   "method": {"indices": {"NDVI": "(NIR-red)/(NIR+red)", "NBR": "(NIR-SWIR2)/(NIR+SWIR2)"},
                              "screeningThresholds": {"deltaNDVI": NDVI_CHANGE_SCREEN, "deltaNBR": NBR_CHANGE_SCREEN},
                              "minimumClearForestCoverageFraction": MIN_CLEAR_COVERAGE, "minimumClearPixels": MIN_CLEAR_PIXELS,
                              "dateToleranceDays": DATE_TOLERANCE_DAYS,
                              "Fmask": "Excludes cloud, cloud/shadow adjacency, shadow, snow/ice and high-aerosol pixels."},
                   "limitations": ["HLS index change is independent optical context, not ground truth.",
                       "The exploratory NDVI/NBR thresholds have not been calibrated for this site.",
                       "HLS is 30 m; coarser optical pixels can mix radar candidate and non-candidate land.",
                       "Cloud, seasonal phenology, moisture, timing offsets and forest-mask errors remain possible confounders."]}
        _set_independent_check(analysis, check_status, check_message)
        analysis["limitations"] = list(dict.fromkeys([*analysis.get("limitations", []), *summary["limitations"]]))
        return summary
    except Exception as exc:
        logging.warning("Independent HLS forest comparison unavailable: %s", exc)
        for candidate in candidates:
            candidate["assessment"]["opticalEvidence"] = {"status": "UNAVAILABLE", "summary": str(exc), "referenceValidated": False}
        summary = {"status": "UNAVAILABLE", "summary": f"Independent NASA HLS comparison was not available: {exc}",
                   "dates": [{"date": target, "status": "UNAVAILABLE", "summary": str(exc)} for target in target_dates],
                   "source": "NASA HLS L30/S30 v2.0", "sourceUrl": "https://hls.gsfc.nasa.gov/data-products/",
                   "referenceValidated": False,
                   "limitations": ["The independent optical comparison was unavailable for this run; no optical corroboration is claimed."]}
        _set_independent_check(analysis, "INFO", summary["summary"])
        analysis["limitations"] = list(dict.fromkeys([*analysis.get("limitations", []), *summary["limitations"]]))
        return summary
