"""GCOV extraction with validated coordinates; missing georeferencing is an error."""
import logging
import os
from pathlib import Path
import h5py
import numpy as np
import rasterio
from affine import Affine
from pyproj import CRS, Transformer


def inspect_h5(h5_path):
    with h5py.File(h5_path, "r") as handle:
        handle.visititems(lambda name, obj: logging.info("%s | %s | %s", name, obj.shape, obj.dtype)
                         if isinstance(obj, h5py.Dataset) else None)


def _spacing(group, axis, coordinates):
    key = f"{axis}CoordinateSpacing"
    explicit = float(group[key][()]) if key in group else None
    if coordinates.size > 1:
        differences = np.diff(coordinates)
        spacing = float(differences[0])
        if not np.allclose(differences, spacing, rtol=1e-6, atol=1e-6):
            raise ValueError(f"{axis} coordinates are not evenly spaced.")
        if explicit is not None and not np.isclose(explicit, spacing, rtol=1e-6, atol=1e-6):
            raise ValueError(f"{axis}CoordinateSpacing disagrees with the coordinates.")
    elif explicit is not None:
        spacing = explicit
    else:
        raise ValueError(f"Cannot infer spacing for single {axis} coordinate.")
    if not np.isfinite(spacing) or spacing == 0:
        raise ValueError("Grid spacing must be finite and nonzero.")
    return spacing


def _subset_window(x, y, crs, dx, dy, bbox):
    row_start, row_stop, col_start, col_stop = 0, y.size, 0, x.size
    if bbox is not None:
        west, south, east, north = bbox
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("Invalid geographic bounding box.")
        bounds = Transformer.from_crs(4326, crs, always_xy=True).transform_bounds(west, south, east, north, densify_pts=21)
        columns = np.flatnonzero((x >= bounds[0]-abs(dx)/2) & (x <= bounds[2]+abs(dx)/2))
        rows = np.flatnonzero((y >= bounds[1]-abs(dy)/2) & (y <= bounds[3]+abs(dy)/2))
        if not rows.size or not columns.size:
            raise ValueError("Scene does not overlap the requested area.")
        row_start, row_stop = int(rows[0]), int(rows[-1])+1
        col_start, col_stop = int(columns[0]), int(columns[-1])+1
    return row_start, row_stop, col_start, col_stop


def _write_layer(path, values, crs, transform, nodata):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial.tif")
    try:
        with rasterio.open(temporary, "w", driver="GTiff", height=values.shape[0], width=values.shape[1],
                           count=1, dtype=values.dtype, crs=crs, transform=transform, nodata=nodata,
                           compress="deflate") as destination:
            destination.write(values, 1)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def extract_quality_layers_to_tiff(h5_source, frequency, out_prefix, bbox=None):
    """Write GCOV number-of-looks, averaging-ensemble mask, and a conservative validity mask.

    GCOV ``mask`` describes the contributing averaging ensemble. Its categorical values
    are retained for provenance, not guessed to mean valid/invalid. Only HDF5-declared
    fill values and unusable numberOfLooks values are excluded here.
    """
    with h5py.File(h5_source, "r") as handle:
        group = handle[f"science/LSAR/GCOV/grids/{frequency}"]
        looks_dataset = group.get("numberOfLooks")
        if looks_dataset is None:
            raise ValueError("GCOV numberOfLooks dataset is required for product-quality screening.")
        mask_dataset = group.get("mask")
        x = np.asarray(group["xCoordinates"][:], dtype="float64")
        y = np.asarray(group["yCoordinates"][:], dtype="float64")
        if (looks_dataset.ndim != 2 or looks_dataset.shape != (y.size, x.size) or
                (mask_dataset is not None and (mask_dataset.ndim != 2 or mask_dataset.shape != (y.size, x.size)))):
            raise ValueError("GCOV numberOfLooks/mask dimensions do not match the coordinate grid.")
        dx, dy = _spacing(group, "x", x), _spacing(group, "y", y)
        projection = group["projection"]
        if not isinstance(projection, h5py.Dataset) or projection.shape != ():
            raise ValueError("GCOV projection must be a scalar EPSG dataset.")
        crs = CRS.from_epsg(int(projection[()]))
        row_start, row_stop, col_start, col_stop = _subset_window(x, y, crs, dx, dy, bbox)
        window = np.s_[row_start:row_stop, col_start:col_stop]
        looks_raw = np.asarray(looks_dataset[window])
        looks_fill = looks_dataset.attrs.get("_FillValue")
        valid = np.isfinite(looks_raw) & (looks_raw > 0)
        if looks_fill is not None:
            valid &= looks_raw != looks_fill
        looks = looks_raw.astype("float32")
        looks[~valid] = np.nan
        mask_values = None
        mask_fill = None
        mask_metadata = {}
        if mask_dataset is not None:
            raw_mask = np.asarray(mask_dataset[window])
            mask_fill = mask_dataset.attrs.get("_FillValue")
            mask_values = raw_mask.copy()
            if mask_fill is not None:
                valid &= raw_mask != mask_fill
            for key in ("flag_values", "flag_masks", "flag_meanings", "long_name", "description"):
                if key in mask_dataset.attrs:
                    def json_attribute(value):
                        if isinstance(value, (bytes, np.bytes_)):
                            return value.decode("utf-8", errors="replace")
                        if isinstance(value, np.ndarray):
                            return [json_attribute(item) for item in value.tolist()]
                        if isinstance(value, np.generic):
                            return json_attribute(value.item())
                        return value
                    mask_metadata[key] = json_attribute(mask_dataset.attrs[key])
        looks[~valid] = np.nan
        transform = Affine(dx, 0, x[0]-dx/2+col_start*dx, 0, dy, y[0]-dy/2+row_start*dy)

    prefix = Path(out_prefix)
    looks_path = prefix.with_name(prefix.name + "_number_of_looks.tif")
    valid_path = prefix.with_name(prefix.name + "_quality_valid.tif")
    _write_layer(looks_path, looks, crs, transform, np.nan)
    _write_layer(valid_path, valid.astype("uint8"), crs, transform, 0)
    mask_path = None
    mask_counts = {}
    if mask_values is not None:
        mask_path = prefix.with_name(prefix.name + "_mask_ensemble.tif")
        mask_nodata = mask_fill
        _write_layer(mask_path, mask_values, crs, transform, mask_nodata)
        values, counts = np.unique(mask_values, return_counts=True)
        mask_counts = {str(value.item()): int(count) for value, count in zip(values, counts)
                       if mask_fill is None or value != mask_fill}
    usable_looks = looks_raw[valid]
    return {"number_of_looks_path": str(looks_path), "quality_valid_path": str(valid_path),
            "mask_ensemble_path": str(mask_path) if mask_path else None,
            "number_of_looks_valid_fraction": float(valid.mean()) if valid.size else 0.0,
            "number_of_looks_median": float(np.median(usable_looks)) if usable_looks.size else None,
            "number_of_looks_min": float(np.min(usable_looks)) if usable_looks.size else None,
            "number_of_looks_max": float(np.max(usable_looks)) if usable_looks.size else None,
            "mask_ensemble_counts": mask_counts, "mask_attributes": mask_metadata,
            "mask_interpretation": "Averaging-ensemble provenance only; categorical values are not treated as a validity flag."}


def extract_polarization_to_tiff(h5_source, frequency, pol, out_path, bbox=None):
    """Read only the requested geographic subset. Raise on invalid metadata/data.
    Returned raster is dB power. No dummy transform or suppressed failure.
    """
    out_path = Path(out_path)
    if pol not in ("HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"):
        raise ValueError("Only diagonal power terms can be converted with 10*log10.")
    temporary = out_path.with_name(out_path.name + ".partial.tif")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with h5py.File(h5_source, "r") as handle:
            group = handle[f"science/LSAR/GCOV/grids/{frequency}"]
            dataset = group[pol]
            if dataset.ndim != 2 or np.issubdtype(dataset.dtype, np.complexfloating):
                raise ValueError("Expected a two-dimensional diagonal power term.")
            x = np.asarray(group["xCoordinates"][:], dtype="float64")
            y = np.asarray(group["yCoordinates"][:], dtype="float64")
            if x.ndim != 1 or y.ndim != 1 or dataset.shape != (y.size, x.size) or not x.size or not y.size:
                raise ValueError("Dataset dimensions and coordinate vectors disagree.")
            if not np.isfinite(x).all() or not np.isfinite(y).all():
                raise ValueError("Coordinate vectors contain invalid values.")
            dx, dy = _spacing(group, "x", x), _spacing(group, "y", y)
            projection = group["projection"]
            if not isinstance(projection, h5py.Dataset) or projection.shape != ():
                raise ValueError("GCOV projection must be a scalar EPSG dataset.")
            crs = CRS.from_epsg(int(projection[()]))
            transform = Affine(dx, 0, x[0]-dx/2, 0, dy, y[0]-dy/2)
            row_start, row_stop, col_start, col_stop = _subset_window(x, y, crs, dx, dy, bbox)
            power = dataset[row_start:row_stop, col_start:col_stop].astype("float64")
            valid = np.isfinite(power) & (power > 0)
            if "_FillValue" in dataset.attrs:
                valid &= power != dataset.attrs["_FillValue"]
            if not valid.any():
                raise ValueError("Selected polarization has no valid positive power samples.")
            values = np.full(power.shape, np.nan, dtype="float32")
            values[valid] = (10*np.log10(power[valid])).astype("float32")
            transform = Affine(dx, 0, x[0]-dx/2+col_start*dx, 0, dy, y[0]-dy/2+row_start*dy)
            with rasterio.open(temporary, "w", driver="GTiff", height=values.shape[0], width=values.shape[1],
                               count=1, dtype="float32", crs=crs, transform=transform, nodata=np.nan) as destination:
                destination.write(values, 1)
        os.replace(temporary, out_path)
        return True
    finally:
        temporary.unlink(missing_ok=True)
