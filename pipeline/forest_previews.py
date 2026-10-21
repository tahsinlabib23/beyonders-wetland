"""Render real GCOV dB layers as transparent, map-aligned quicklooks.

The quicklooks are visualizations of observed NISAR layers. They do not depict a
classification, and invalid pixels/outside-mask pixels remain transparent.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from matplotlib import colormaps
from rasterio.warp import transform_bounds

from forest_analysis import _atomic_write

MAX_PREVIEW_DIMENSION = 1500
MAX_SCALE_SAMPLE = 200_000


def _valid_values(path: Path, mask: np.ndarray, quality_path: Path | None) -> tuple[np.ndarray, np.ndarray, dict]:
    with rasterio.open(path) as source:
        values = source.read(1, masked=True).astype("float32").filled(np.nan)
        profile = source.profile.copy()
        if values.shape != mask.shape:
            raise ValueError(f"Radar preview grid does not match the forest mask: {path.name}")
        valid = mask & np.isfinite(values)
        if quality_path is not None:
            with rasterio.open(quality_path) as quality:
                if (quality.crs != source.crs or quality.width != source.width or quality.height != source.height
                        or not quality.transform.almost_equals(source.transform, precision=1e-8)):
                    raise ValueError(f"Quality-mask grid does not match {path.name}")
                quality_values = quality.read(1, masked=True).filled(0)
                valid &= quality_values > 0
        if source.nodata is not None:
            valid &= values != source.nodata
    return values, valid, profile


def render_run_previews(manifest_path: str | Path, output_directory: str | Path,
                        max_dimension: int = MAX_PREVIEW_DIMENSION) -> dict:
    """Create date/channel PNGs with a consistent dB scale across the real run."""
    manifest_path = Path(manifest_path).resolve()
    output_directory = Path(output_directory).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base = manifest_path.parent
    observations = manifest.get("observations")
    site = manifest.get("site")
    if not isinstance(observations, list) or not isinstance(site, dict):
        raise ValueError("A forest workflow manifest with observations and site metadata is required.")
    mask_path = (base / site["forest_mask_path"]).resolve()
    with rasterio.open(mask_path) as mask_source:
        mask = mask_source.read(1, masked=True).filled(0).astype("uint8") > 0
        mask_profile = mask_source.profile.copy()
    output_directory.mkdir(parents=True, exist_ok=True)

    source_paths: list[dict] = []
    scale_samples: dict[str, list[np.ndarray]] = {"hh": [], "hv": []}
    for observation in observations:
        if not isinstance(observation, dict):
            continue
        for channel, path_key in (("hh", "hh_path"), ("hv", "hv_path")):
            path = (base / observation.get(path_key, "")).resolve()
            quality_value = observation.get("quality_mask_path")
            quality_path = (base / quality_value).resolve() if quality_value else None
            values, valid, profile = _valid_values(path, mask, quality_path)
            sampled = values[valid].ravel()
            if sampled.size > MAX_SCALE_SAMPLE:
                step = max(1, sampled.size // MAX_SCALE_SAMPLE)
                sampled = sampled[::step][:MAX_SCALE_SAMPLE]
            if sampled.size:
                scale_samples[channel].append(sampled.astype("float32", copy=False))
            source_paths.append({"date": observation["date"], "sceneId": observation.get("scene_id", ""),
                                 "channel": channel, "path": path, "qualityPath": quality_path,
                                 "profile": profile})

    scales: dict[str, tuple[float, float] | None] = {}
    for channel, arrays in scale_samples.items():
        if not arrays:
            scales[channel] = None
            continue
        sample = np.concatenate(arrays)
        low, high = (float(value) for value in np.nanpercentile(sample, [2, 98]))
        if not np.isfinite(low) or not np.isfinite(high):
            scales[channel] = None
        elif high <= low:
            scales[channel] = (low - 0.5, high + 0.5)
        else:
            scales[channel] = (low, high)

    outputs = []
    for entry in source_paths:
        channel, day = entry["channel"], entry["date"]
        png_path = output_directory / f"{day}_{channel}.png"
        meta_path = output_directory / f"{day}_{channel}.json"
        scale = scales[channel]
        metadata = {"date": day, "sceneId": entry["sceneId"], "channel": channel,
                    "measurement": f"NISAR GCOV {channel.upper()} power, dB",
                    "dataSource": "NISAR_L2_GCOV_PROVISIONAL_V1", "isClassification": False,
                    "forestMaskSource": site.get("forest_mask_source"), "generatedAt": datetime.now(timezone.utc).isoformat(),
                    "available": False, "boundsWgs84WestSouthEastNorth": None,
                    "scaleMinDb": scale[0] if scale else None, "scaleMaxDb": scale[1] if scale else None,
                    "validForestPixelFraction": 0.0, "limitations": [
                        "Quicklook shows measured GCOV backscatter in dB; it is not a forest-loss classification.",
                        "Color scale is shared across dates for this channel and clipped at pooled 2nd/98th percentiles.",
                        "Pixels outside the sourced forest mask or invalid in the GCOV quality mask are transparent."]}
        try:
            values, valid, profile = _valid_values(entry["path"], mask, entry["qualityPath"])
            with rasterio.open(entry["path"]) as source:
                bounds = transform_bounds(source.crs, "EPSG:4326", source.bounds.left, source.bounds.bottom,
                                          source.bounds.right, source.bounds.top, densify_pts=21)
                metadata["boundsWgs84WestSouthEastNorth"] = [float(value) for value in bounds]
            metadata["validForestPixelFraction"] = float(valid.sum() / mask.sum()) if mask.sum() else 0.0
            if scale is None or not valid.any():
                metadata["message"] = "No valid masked pixels were available for this channel/date."
            else:
                low, high = scale
                normed = np.clip((values - low) / (high - low), 0.0, 1.0)
                rgba = colormaps["magma"](np.nan_to_num(normed, nan=0.0), bytes=True)
                rgba[..., 3] = np.where(valid, 185, 0).astype("uint8")
                image = Image.fromarray(rgba, mode="RGBA")
                width, height = image.size
                ratio = min(1.0, float(max_dimension) / max(width, height))
                if ratio < 1.0:
                    image = image.resize((max(1, round(width * ratio)), max(1, round(height * ratio))), Image.Resampling.BILINEAR)
                image.save(png_path, format="PNG", optimize=True)
                metadata["available"] = True
                metadata["imageWidthPx"], metadata["imageHeightPx"] = image.size
        except Exception as exc:
            metadata["message"] = f"Preview unavailable for this measured layer: {type(exc).__name__}: {exc}"
        _atomic_write(meta_path, metadata)
        outputs.append({"date": day, "channel": channel, "available": metadata["available"],
                        "metadataPath": str(meta_path.relative_to(base)),
                        "imagePath": str(png_path.relative_to(base)) if metadata["available"] else None})

    available = sum(1 for item in outputs if item["available"])
    return {"status": "AVAILABLE" if available else "UNAVAILABLE", "source": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "count": available, "requestedCount": len(outputs),
            "dates": sorted({item["date"] for item in outputs}), "channels": ["hh", "hv"],
            "sharedPercentileScale": {channel: ({"minDb": value[0], "maxDb": value[1]} if value else None)
                                      for channel, value in scales.items()},
            "items": outputs,
            "message": (f"Rendered {available} of {len(outputs)} real NISAR radar quicklooks."
                        if available else "No real NISAR radar quicklooks could be rendered; no placeholder imagery was created.")}
