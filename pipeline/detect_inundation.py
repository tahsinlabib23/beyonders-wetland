"""Measured candidate statistics from masked, aligned rasters.
Threshold/evidence rules are illustrative; they are not field validation.
"""
import hashlib
import numpy as np
from rasterio.features import shapes
from rasterio.windows import Window, transform as window_transform
from scipy.ndimage import label, find_objects
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from raster_utils import atomic_json, read_rasters, classify, remove_small_regions, area_km2, to_wgs84


def process_inundation(before_hh_path, after_hh_path, before_hv_path, after_hv_path,
                       config, date_label, out_geojson, data_source="UNVERIFIED",
                       threshold=None, previous_class_grid=None, baseline_metadata=None):
    arrays, profile = read_rasters([before_hh_path, after_hh_path, before_hv_path, after_hv_path])
    grid, valid, dh, dv = classify(arrays, config, threshold)
    minimum = int(config["processing"]["minimum_region_pixels"])
    if minimum < 1:
        raise ValueError("Minimum region pixels must be at least one.")
    grid = remove_small_regions(grid, minimum)
    features = []
    if previous_class_grid is not None and previous_class_grid.shape != grid.shape:
        raise ValueError("Previous observation has a different grid.")
    for cls in (1, 2):
        labels, _ = label(grid == cls)
        for component, window in enumerate(find_objects(labels), 1):
            if window is None:
                continue
            mask = labels[window] == component
            row, col = window
            raster_window = Window(col.start, row.start, col.stop-col.start, row.stop-row.start)
            local_transform = window_transform(raster_window, profile["transform"])
            pieces = [shape(geometry) for geometry, _ in shapes(mask.astype("uint8"), mask=mask, transform=local_transform)]
            geometry = unary_union(pieces)
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("Detector generated an invalid region geometry.")
            geographic = to_wgs84(geometry, profile["crs"])
            centroid = geographic.centroid
            quality_fraction = float(valid[window].mean())
            magnitude = abs(config["processing"]["open_water_delta_hh"]) if cls == 1 else config["processing"]["vegetated_delta_hh"]
            cutoff = float(magnitude if threshold is None else threshold)
            low = classify([a[window] for a in arrays], config, max(.1, cutoff-.5))[0] == cls
            high = classify([a[window] for a in arrays], config, cutoff+.5)[0] == cls
            variation = float((low.sum()-high.sum())/low.sum()) if low.any() else 1.0
            temporal_overlap = (float(np.count_nonzero((previous_class_grid[window] == cls) & mask) / mask.sum())
                                if previous_class_grid is not None else None)
            sample = lambda a: float(np.mean(a[window][mask]))
            identifier = hashlib.sha256(f"{date_label}:{cls}:{row.start}:{col.start}".encode()).hexdigest()[:12]
            properties = {
                "id": f"wetland_patch_{identifier}", "date": date_label,
                "area_km2": area_km2(geometry, profile["crs"]), "pixel_count": int(mask.sum()),
                "classification": "OPEN_WATER" if cls == 1 else "VEGETATED_INUNDATION",
                "interpretation_label": "HH darkening candidate" if cls == 1 else "HH increase / HV stability candidate",
                "mean_delta_db": sample(dh), "median_delta_db": float(np.median(dh[window][mask])),
                "hh_before": sample(arrays[0]), "hh_after": sample(arrays[1]),
                "hv_before": sample(arrays[2]), "hv_after": sample(arrays[3]),
                "delta_hh": sample(dh), "delta_hv": sample(dv),
                "valid_fraction": quality_fraction, "valid_fraction_scope": "region bounding box, all four channels",
                "vegetated_fraction": 1.0 if cls == 2 else 0.0,
                "quality_status": "PASS" if quality_fraction >= config["processing"]["minimum_valid_fraction"] else "PARTIAL",
                "spatial_status": "PASS" if mask.sum()/mask.size >= .5 else "PARTIAL",
                "temporal_status": "PASS" if temporal_overlap is not None and temporal_overlap >= .5 else "PARTIAL",
                "temporal_overlap_fraction": temporal_overlap,
                "threshold_stability": "STABLE" if variation <= .2 else "SENSITIVE",
                "threshold_variation_fraction": variation,
                "evidence_state": "UNCERTAIN", "centroid": [centroid.y, centroid.x],
                "data_source": data_source,
                "evidence_method": "Illustrative rule checks; no reference validation.",
            }
            if baseline_metadata:
                properties.update(baseline_metadata)
            features.append({"type": "Feature", "geometry": mapping(geographic), "properties": properties})
    result = {"type": "FeatureCollection", "data_source": data_source,
              "date": date_label, "features": features}
    atomic_json(out_geojson, result)
    return result, grid
