"""Optional real-data discovery. Demo runs never import or call Earthaccess."""
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import re


def scene_identity(name, frequency="frequencyA"):
    # Current provisional names omit the legacy explicit L-band token.
    tokens = Path(name).name.removesuffix(".h5").split("_")
    if tokens[:4] == ["NISAR", "L2", "PR", "GCOV"] and len(tokens) >= 18:
        product = tuple(tokens[:4])
        cycle, track, direction, frame, bandwidth, pol, acquisition = tokens[4:11]
        start, stop, release = tokens[11:14]
    # Keep support for early/legacy NISAR product names used by existing runs.
    elif tokens[:5] == ["NISAR", "L", "L2", "PR", "GCOV"] and len(tokens) >= 19:
        product = tuple(tokens[:5])
        cycle, track, direction, frame, bandwidth, pol, acquisition = tokens[5:12]
        start, stop, release = tokens[12:15]
    else:
        raise ValueError(f"Unrecognized GCOV granule name: {name}")
    if frequency not in ("frequencyA", "frequencyB"):
        raise ValueError("Choose frequencyA or frequencyB.")
    if not re.fullmatch(r"\d{3}", track) or direction not in ("A", "D") or not re.fullmatch(r"\d{3}", frame):
        raise ValueError("Granule track/pass/frame fields are invalid.")
    pol = pol[:2] if frequency == "frequencyA" else pol[2:]
    bandwidth = bandwidth[:2] if frequency == "frequencyA" else bandwidth[2:]
    if pol not in ("DH", "QP") or bandwidth not in ("05", "20", "40", "77"):
        raise ValueError("This workflow requires both HH and HV in the selected frequency.")
    acquired = datetime.strptime(start, "%Y%m%dT%H%M%S")
    datetime.strptime(stop, "%Y%m%dT%H%M%S")
    return {"name": name, "date": acquired.date().isoformat(), "timestamp": acquired,
            "compatibility": product + (track, direction, frame, bandwidth, pol, acquisition, release)}


def select_compatible_scenes(results, config):
    groups = defaultdict(list)
    frequency = config["nisar"]["frequency"]
    for result in results:
        try:
            identity = scene_identity(result["umm"]["GranuleUR"], frequency)
        except (KeyError, TypeError, ValueError):
            continue
        groups[identity["compatibility"]].append((identity, result))
    pairs = []
    for group in groups.values():
        ordered = sorted(group, key=lambda item: item[0]["timestamp"])
        for before, after in zip(ordered, ordered[1:]):
            if before[0]["date"] < after[0]["date"]:
                pairs.append((after[0]["timestamp"]-before[0]["timestamp"], before, after))
    if not pairs:
        raise ValueError("No chronologically ordered GCOV pair with matching track, pass, frame, mode, polarizations and release.")
    _, before, after = min(pairs, key=lambda item: item[0])
    return before, after


def select_compatible_series(results, config):
    """Return the longest chronological sequence of matching GCOV acquisitions."""
    groups = defaultdict(list)
    frequency = config["nisar"]["frequency"]
    for result in results:
        try:
            identity = scene_identity(result["umm"]["GranuleUR"], frequency)
        except (KeyError, TypeError, ValueError):
            continue
        groups[identity["compatibility"]].append((identity, result))
    series = []
    for group in groups.values():
        ordered = sorted(group, key=lambda item: item[0]["timestamp"])
        unique = []
        seen = set()
        for item in ordered:
            if item[0]["timestamp"] not in seen:
                unique.append(item)
                seen.add(item[0]["timestamp"])
        if len(unique) >= 2:
            series.append(unique)
    if not series:
        raise ValueError("No chronological GCOV series with matching track, pass, frame, mode, polarizations and release.")
    # Prefer the most observations, then the widest temporal coverage, with a
    # stable final tie-break so reruns select the same orbit track.
    return max(series, key=lambda group: (len(group), group[-1][0]["timestamp"] - group[0][0]["timestamp"],
                                          tuple(group[0][0]["compatibility"])))


def search_scenes(config):
    import earthaccess
    bbox = config["site"]["bbox"]
    bounds = tuple(float(bbox[k]) for k in ("min_lon", "min_lat", "max_lon", "max_lat"))
    if not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90):
        raise ValueError("Invalid search bounds.")
    temporal = config["nisar"].get("temporal")
    if not temporal or len(temporal) != 2:
        raise ValueError("Real search requires a start and end date.")
    start, end = (datetime.fromisoformat(value) for value in temporal)
    if start > end:
        raise ValueError("Search start date must be on or before the end date.")
    # Search is public. Authentication happens only when opening selected data.
    return earthaccess.search_data(short_name=config["nisar"]["product"], bounding_box=bounds,
                                   temporal=tuple(temporal), count=config["nisar"].get("search_limit", 100))
