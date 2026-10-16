"""Shared grid checks, area calculation and atomic output helpers."""
import json
import os
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from shapely.ops import transform as transform_geometry


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, indent=2, allow_nan=False)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def same_grid(reference, other):
    return (reference["crs"] == other.crs and
            reference["width"] == other.width and reference["height"] == other.height and
            reference["transform"].almost_equals(other.transform, precision=1e-8))


def read_rasters(paths):
    arrays, profile = [], None
    for path in paths:
        with rasterio.open(path) as src:
            if src.crs is None or src.count != 1:
                raise ValueError(f"Missing CRS or non-single-band input: {path}")
            if profile is not None and not same_grid(profile, src):
                raise ValueError(f"Raster grids differ: {path}. Reproject/resample explicitly before comparing.")
            profile = src.profile.copy() if profile is None else profile
            arrays.append(src.read(1, masked=True).astype("float64").filled(np.nan))
    if not arrays:
        raise ValueError("At least one raster is required.")
    return arrays, profile


def write_temporal_median(paths, out_path):
    """Create a per-pixel median dB baseline and summarize temporal MAD."""
    from pathlib import Path
    import warnings

    arrays, profile = read_rasters(paths)
    stack = np.stack(arrays, axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        median = np.nanmedian(stack, axis=0).astype("float32")
        deviations = np.abs(stack - median[None, ...])
        mad_grid = np.nanmedian(deviations, axis=0)
    valid_mad = mad_grid[np.isfinite(mad_grid)]
    profile.update(count=1, dtype="float32", nodata=np.nan, compress="deflate")
    if not profile.get("tiled"):
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
    path = Path(out_path)
    temporary = path.with_name(path.name + ".partial.tif")
    try:
        with rasterio.open(temporary, "w", **profile) as destination:
            destination.write(median, 1)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    temporal_mad = float(np.median(valid_mad)) if valid_mad.size else None
    return str(path), temporal_mad


def area_km2(geometry, crs):
    source = CRS.from_user_input(crs)
    if source.is_geographic:
        area, _ = source.get_geod().geometry_area_perimeter(geometry)
        return abs(area) / 1e6
    if not source.is_projected or len(source.axis_info) < 2:
        raise ValueError("Area requires a geographic or projected horizontal CRS.")
    units = [axis.unit_conversion_factor for axis in source.axis_info[:2]]
    return abs(geometry.area) * units[0] * units[1] / 1e6


def to_wgs84(geometry, crs):
    from shapely.geometry import MultiPolygon
    from shapely.geometry.polygon import orient
    converter = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    result = transform_geometry(converter.transform, geometry)
    if result.geom_type == "Polygon":
        return orient(result, sign=1)
    if result.geom_type == "MultiPolygon":
        return MultiPolygon([orient(part, sign=1) for part in result.geoms])
    raise ValueError("Region geometry must be Polygon or MultiPolygon.")


def classify(arrays, config, threshold=None):
    hh_b, hh_a, hv_b, hv_a = arrays
    cfg = config["processing"]
    valid = np.logical_and.reduce([np.isfinite(values) for values in arrays])
    dh, dv = hh_a - hh_b, hv_a - hv_b
    water_cutoff = abs(float(cfg["open_water_delta_hh"])) if threshold is None else float(threshold)
    veg_cutoff = float(cfg["vegetated_delta_hh"]) if threshold is None else float(threshold)
    if water_cutoff <= 0 or veg_cutoff <= 0:
        raise ValueError("Change thresholds must be positive magnitudes.")
    grid = np.zeros(hh_b.shape, dtype=np.uint8)
    grid[valid & (dh <= -water_cutoff)] = 1
    grid[valid & (dh >= veg_cutoff) & (np.abs(dv) <= cfg["vegetated_delta_hv_max"])] = 2
    return grid, valid, dh, dv


def remove_small_regions(grid, minimum_pixels):
    from scipy.ndimage import label
    cleaned = np.zeros_like(grid)
    for cls in (1, 2):
        labels, _ = label(grid == cls)
        counts = np.bincount(labels.ravel())
        keep = counts >= int(minimum_pixels)
        keep[0] = False
        cleaned[keep[labels]] = cls
    return cleaned
