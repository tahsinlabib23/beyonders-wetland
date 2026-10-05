"""Apply explicit binary masks to an aligned single-band raster."""
from pathlib import Path
import numpy as np
import rasterio
from raster_utils import same_grid


def apply_masks(input_tiff, quality_mask_path=None, wetland_mask_path=None, out_tiff=None):
    out_tiff = Path(out_tiff or str(input_tiff).replace(".tif", "_masked.tif"))
    out_tiff.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(input_tiff) as src:
        profile = src.profile.copy()
        values = src.read(1, masked=True).astype("float32").filled(np.nan)
    quality_paths = quality_mask_path if isinstance(quality_mask_path, (list, tuple)) else [quality_mask_path]
    for path in (*quality_paths, wetland_mask_path):
        if path is None:
            continue
        with rasterio.open(path) as mask:
            if not same_grid(profile, mask):
                raise ValueError(f"Mask grid differs from input: {path}")
            mask_values = mask.read(1, masked=True).filled(0)
            if not np.isin(mask_values, [0, 1]).all():
                raise ValueError("Masks must be binary: 1 valid/in wetland, 0 excluded. Decode product flags first.")
            values[mask_values != 1] = np.nan
    profile.update(dtype="float32", nodata=np.nan)
    if not profile.get("tiled"):
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
    with rasterio.open(out_tiff, "w", **profile) as dst:
        dst.write(values, 1)
    return str(out_tiff)
