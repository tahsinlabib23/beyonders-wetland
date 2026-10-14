# Data and publication specification

## Pipeline run

The run folder holds `run_manifest.json`, `observations.json`, `case_study.json`, `site_boundary.geojson`, `wetland_pulse.json`, `sensitivity_results.json`, per-date candidate FeatureCollections, aligned HH/HV previews and optional reference evidence. Native cropped GeoTIFFs preserve the detector grid. Run ID is a 32-character lowercase hexadecimal identifier. The atomic `current_run.json` pointer selects the last complete run; failed attempts do not replace it.

Catalog entries have `hazard_type`. Wetland publications use `wetland_flood_change`; the separate volcano catalog uses `volcanic_deformation`. GUNW BETA and PROVISIONAL records retain distinct maturity labels. Volcano run completion, reference availability, and scientific interpretation are distinct fields. `COMPLETE` is processing status; `PHASE_DERIVED_LOS_CANDIDATES` and `CROSS_SENSOR_CONTEXT` are not confirmation or accuracy labels. The source paper workflow is separately marked `NOT_REPRODUCED`.

- Dates: ISO 8601 `YYYY-MM-DD`, UTC acquisition date.
- Coordinates: GeoJSON WGS84 longitude, latitude order; displayed probe labels use latitude, longitude.
- Change: HH/HV in dB; area in km², calculated from original grid CRS/resolution.
- Nodata: masked/absent values are not zero-water. For HLS categorical masks, QA value 255 is nodata; in the area-averaged reference metric, zero valid/candidate fraction is a measured absence.
- Class names: `OPEN_WATER` and exploratory `VEGETATED_INUNDATION`; both are candidate interpretations.
- Reference: status (including `INCONCLUSIVE`/`UNAVAILABLE`), product, scene IDs, offsets, common-clear fraction/area, candidate assessment and supported metrics. Cross-sensor status is separate from field validation.

## Public package

`catalog.json` indexes the currently displayed study per run ID and keeps prior entries in `releases[]`. A release is stored at `releases/<version>/runs/<run-id>/` and includes versioned methods, evidence, web-sized date layers, `publication.json`, and `evidence_card.json`. The manifest stores artifact SHA-256, byte count, date list, maturity, reference status, interpretation and optional GitHub Release URLs. Same run/version is immutable; update by choosing a new version.

Candidate GeoJSON geometry in the public package is simplified in EPSG:6933 at 10 m tolerance and rounded for display. `display_geometry.not_for_measurement=true`; use local source GeoJSON/native rasters for measurements. Attributes retain statistics from the untouched source run. Source ZIP contains original GeoTIFFs/candidate vectors; keep it locally or add it as a GitHub Release asset.

Do not publish Earthdata tokens/passwords, private local paths, full raw granules, job logs or cached Earthdata/HLS source tiles.

## Forest package (schema 1)

`public/forests/catalog.json` lists forest studies, publication/method versions,
input dates, run IDs and separate `processing_status`, `reference_availability`
and `scientific_interpretation` fields. `rondonia/index.json` points to an
immutable `VERSION/study.json`, compact evidence ZIP and checksums. It records
the compact/native ZIP SHA-256 and an optional public GitHub native download URL.
No native source paths or operator logs are exposed.

`study.json` has WGS84 `[west,south,east,north]` bounds, geographic boundary
provenance, exact native CRS/transform/shape and pixel area, every input granule,
three baseline dates, and per-date `stats`, `reference`, `layers` and candidate
GeoJSON. Continuous backscatter, changes and baseline MAD are dB. Optical
NDVI/NBR and differences are dimensionless. Areas are native-grid km².
Classification values: 1 candidate, 0 assessed without persistent candidate,
255 unassessed. NaN is continuous NoData; a finite 0 dB/index is valid.

Reference categories: 1 candidate with both optical indices decreasing,
2 assessed candidate without that signature, 3 unassessed candidate, 255
outside candidate display support. They are not accuracy/ground-truth classes.
Native HLS area support avoids multiplying optical samples onto finer radar
cells. Below 20% common clear coverage the comparison is inconclusive and
overlap fraction is null. Precision, recall and F1 are null without explicit
assessed negatives. Imported GLAD alerts are separately attributed positive
context with date/confidence encoding; zero alerts are not unchanged labels.

PNG layers are resampled geographic previews and cannot supply exact native
pixel measurements. Candidate polygons and statistics retain native geometry
and area. Compact packages contain maps, GeoJSON, methods and provenance;
native rasters are in the separate locally generated release asset.

## Volcanic phase package (schema 1)

`public/volcanoes/catalog.json` indexes hazard, publication version, available acquisitions, method, evidence states and artifact URLs. `hayli-gubbi/index.json` selects an immutable version and stores the study-manifest SHA-256. Each `study.json` lists input products/pairs, native CRS/transform/spacing, source checksums, phase conventions, wavelength, reference box, screens, regional statistics, comparison coverage/offsets and unapplied corrections. The package also has `evidence-card.json`, method/config/requirements, `checksums.json`, and `evidence.zip`.

- Bounds: `[west, south, east, north]`, WGS84 decimal degrees.
- Phase: original unwrapped radians. Apparent LOS: centimeters, positive toward the sensor; each interval separately referenced.
- Coherence: 0–1 quality indicator, not probability of deformation.
- Native screened fraction: assessed pixel centers / centers in the geographic analysis box. Native envelope size is reported separately. Areas use the native grid; geographic ARIA cells use geodesic area.
- Reference MAD: scaled spatial median absolute deviation in cm, not accuracy.
- Common screened fraction: shared nearest-neighbor geographic display grid; 20% comparison floor, no LOS accuracy score across different geometries.
- Display `grid.json`: width/height, bounds, row-major flattened `los_cm`, `coherence`, `phase_radians`, `component`; row zero is north, column zero west. Null is missing/screened/unassessed. A finite phase zero is valid where quality permits.
- `los.png`/`coherence.png`/`assessed.png`: exact grid bounds, transparent where missing (coherence may remain visible where phase was screened out). Red LOS away, blue toward; previews saturate at ±60 cm. Inspector values do not saturate. Native GeoTIFFs retain original grids and NaN NoData; `assessed.tif` uses 1/0 for pass/fail, not motion.
- Cropped official source arrays and rasters are intentional, compact public derivatives with metadata. Full remote scenes and credentials stay private. The evidence ZIP contains crops, not full SLC archives.
