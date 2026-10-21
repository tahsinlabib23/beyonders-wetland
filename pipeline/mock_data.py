"""Repeatable fictional observations, binary masks and GCOV-shaped HDF5 fixtures."""
from pathlib import Path
from datetime import date
import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import Transformer

DATES = ["2025-06-01", "2025-06-13", "2025-06-25", "2025-07-07",
         "2025-07-19", "2025-07-31", "2025-08-12", "2025-08-24"]
HYDROGRAPH = [.18, .35, .7, 1, .8, .5, .3, .12]


def _write_raster(path, values, profile):
    with rasterio.open(path, "w", **dict(profile, dtype=str(values.dtype), nodata=None if values.dtype == np.uint8 else np.nan)) as dst:
        dst.write(values, 1)
    return str(path)


def _write_h5(path, hh, hv, profile):
    transform = profile["transform"]
    height, width = hh.shape
    with h5py.File(path, "w") as handle:
        group = handle.create_group("science/LSAR/GCOV/grids/frequencyA")
        group.create_dataset("HHHH", data=np.power(10, hh/10).astype("float32"))
        group.create_dataset("HVHV", data=np.power(10, hv/10).astype("float32"))
        group.create_dataset("xCoordinates", data=transform.c + (np.arange(width)+.5)*transform.a)
        group.create_dataset("yCoordinates", data=transform.f + (np.arange(height)+.5)*transform.e)
        group.create_dataset("xCoordinateSpacing", data=transform.a)
        group.create_dataset("yCoordinateSpacing", data=transform.e)
        group.create_dataset("projection", data=32646)
        handle.attrs["data_source"] = "SIMULATED_DEMO"


def generate_mock_series(output_dir, config):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    settings = config["demo"]
    seed, spacing = int(settings["seed"]), float(settings["pixel_spacing_m"])
    if not np.isfinite(spacing) or spacing <= 0:
        raise ValueError("Demo pixel spacing must be positive.")
    acquired = settings.get("dates", DATES)
    if len(acquired) != len(HYDROGRAPH) or sorted(acquired) != acquired or len(set(acquired)) != len(acquired):
        raise ValueError("Demo requires eight unique chronological dates.")
    for value in acquired:
        date.fromisoformat(value)
    rng = np.random.default_rng(seed)
    shape = (200, 200)
    hh = rng.normal(-8, .8, shape).astype("float32")
    hv = rng.normal(-15, .8, shape).astype("float32")
    x, y = Transformer.from_crs(4326, 32646, always_xy=True).transform(92.05, 24.64)
    profile = {"driver": "GTiff", "count": 1, "height": shape[0], "width": shape[1],
               "crs": "EPSG:32646", "transform": from_origin(x, y, spacing, spacing)}
    row, col = np.indices(shape)
    wetland = ((row >= 10) & (row < 190) & (col >= 10) & (col < 190)).astype("uint8")
    quality = np.ones(shape, dtype="uint8")
    quality[:, 58:62] = 0
    quality[85:100, 132:150] = 0
    _write_raster(output/"wetland_mask.tif", wetland, profile)
    _write_raster(output/"quality_mask.tif", quality, profile)
    _write_h5(output/"before.h5", hh, hv, profile)
    observations = []
    for index, (acquired_date, extent) in enumerate(zip(acquired, HYDROGRAPH)):
        scale = np.sqrt(extent)
        water = ((row-110)/(35*scale))**2 + ((col-55)/(30*scale))**2 <= 1
        vegetation = ((row-85)/(40*scale))**2 + ((col-140)/(28*scale))**2 <= 1
        after_hh, after_hv = hh.copy(), hv.copy()
        after_hh[water] -= (4.5 + 1.5*np.cos(col[water]/15)).astype("float32")
        after_hv[water] -= 3
        after_hh[vegetation] += (3.5 + np.sin(row[vegetation]/12)).astype("float32")
        after_hv[vegetation] += .8
        # Strong change outside the wetland must be excluded by preprocessing.
        after_hh[:8, :8] -= 8
        name = f"after_{index:02d}.h5"
        _write_h5(output/name, after_hh, after_hv, profile)
        observations.append({"date": acquired_date, "path": str(output/name)})
    return {"before": str(output/"before.h5"), "observations": observations,
            "quality": str(output/"quality_mask.tif"), "wetland": str(output/"wetland_mask.tif"),
            "seed": seed, "pixel_spacing_m": spacing}
