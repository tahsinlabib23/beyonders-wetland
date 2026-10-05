"""Import the mapped Tanguar Haor polygon from Bangladesh's CRIIPS haor layer.

The CRIIPS feature is a mapped haor boundary, not the Ramsar site 1031 boundary.
Use --source-file with a saved ArcGIS feature JSON when this shell has no network.
"""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

from pyproj import Geod
from shapely.geometry import Polygon, mapping


FEATURE_URL = "https://www.arcgisbd.com/server/rest/services/ADB005/CRIIPS/MapServer/147/202?f=pjson"
OUTPUT = Path(__file__).parent / "data" / "tanguar_haor_adb_boundary.geojson"


def prepare(source_file=None, output=OUTPUT):
    if source_file:
        source = json.loads(Path(source_file).read_text(encoding="utf-8"))
    else:
        with urlopen(FEATURE_URL, timeout=30) as response:
            source = json.load(response)
    feature = source.get("feature", {})
    attributes = feature.get("attributes", {})
    if attributes.get("OBJECTID") != 202 or attributes.get("HAOR_NAME") != "Tanguar Haor":
        raise ValueError("The source is not CRIIPS Tanguar Haor feature 202.")
    rings = feature.get("geometry", {}).get("rings", [])
    if len(rings) != 1:
        raise ValueError("Expected one Tanguar exterior ring; inspect the source geometry before importing.")
    polygon = Polygon(rings[0])
    if polygon.is_empty or not polygon.is_valid:
        raise ValueError("The mapped Tanguar polygon is empty or invalid.")
    west, south, east, north = polygon.bounds
    if not (90.9 < west < 91.1 and 25.0 < south < 25.2 and
            91.1 < east < 91.2 and 25.1 < north < 25.3):
        raise ValueError("Tanguar polygon bounds are outside the expected location.")
    area_km2 = abs(Geod(ellps="WGS84").geometry_area_perimeter(polygon)[0]) / 1_000_000
    reported_area = float(attributes["AREA_SQKM"])
    if abs(area_km2 - reported_area) / reported_area > 0.02:
        raise ValueError("Geometry area differs by more than 2% from the source's reported area.")
    document = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {
            "name": "Tanguar Haor",
            "boundary_source": "Bangladesh CRIIPS Haor Boundary layer 147, OBJECTID 202; mapped haor, not Ramsar site 1031",
            "source_url": FEATURE_URL,
            "source_area_km2": reported_area,
            "geodesic_area_km2": round(area_km2, 4),
        },
        "geometry": mapping(polygon),
    }]}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Saved: {output.resolve()}")
    print(f"Geodesic area: {area_km2:.2f} km²; bounds: {west:.6f}, {south:.6f}, {east:.6f}, {north:.6f}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, help="Previously downloaded ArcGIS feature 202 JSON")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    prepare(args.source_file, args.output)
