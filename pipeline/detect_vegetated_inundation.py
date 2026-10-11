"""Use the same validity and signal rules as the main detector."""
from raster_utils import read_rasters, classify


def process_vegetated_inundation(before_hh_path, after_hh_path, before_hv_path, after_hv_path, config):
    arrays, _ = read_rasters([before_hh_path, after_hh_path, before_hv_path, after_hv_path])
    grid, _, _, _ = classify(arrays, config)
    return grid == 2
