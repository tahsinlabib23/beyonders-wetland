"""Aggregate actual detector outputs from the supplied (possibly fake) observations."""
from datetime import date
from raster_utils import atomic_json


def generate_temporal_data(out_dir, observations, site, wetland_area_km2, data_source="UNVERIFIED"):
    if not observations or wetland_area_km2 <= 0:
        raise ValueError("Temporal analysis requires observations and a positive wetland area.")
    ordered = sorted(observations, key=lambda o: date.fromisoformat(o["date"]))
    if len({o["date"] for o in ordered}) != len(ordered):
        raise ValueError("Duplicate acquisition dates.")
    dates = []
    for observation in ordered:
        patches = observation["features"]
        area = sum(p["properties"]["area_km2"] for p in patches)
        mean = sum(p["properties"]["area_km2"] * p["properties"]["mean_delta_db"] for p in patches) / area if area else 0
        dates.append({"date": observation["date"], "area_km2": area, "fraction": area/wetland_area_km2,
                      "mean_delta_db": mean, "patches": len(patches)})
    peak = max(dates, key=lambda item: item["area_km2"])
    peak_index = dates.index(peak)
    recession = next((d["date"] for d in dates[peak_index+1:] if d["area_km2"] < peak["area_km2"]), None)
    output = {"site": site, "wetland_area_km2": wetland_area_km2, "data_source": data_source,
              "dates": dates, "onset": next((d["date"] for d in dates if d["area_km2"] > 0), None),
              "peak": {"date": peak["date"], "area_km2": peak["area_km2"]}, "recession_start": recession}
    atomic_json(out_dir / "wetland_pulse.json", output)
    return output
