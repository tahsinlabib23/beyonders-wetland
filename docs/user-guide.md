# User guide and roadmap

## Read the global map

Use the top header to switch between **Wetlands** and **Volcanoes**. The two sections use different data and methods.

- NASA GIBS mosaic: NISAR GCOV false-colour backscatter, not a global flood classification.
- NASA CMR footprints: acquired-scene coverage; outline color identifies orbit direction, not flood status.
- Published study boundary: area where one completed detector run was processed.
- Candidate polygons: rule-based radar change under the case's dates, HH/HV rule and mask.
- Blank area: no detector result available.

Select a published study and acquisition date to synchronize map, statistics, inputs, evidence and downloads. Open the radar panel to compare baseline/after/change layers. Optical evidence shows HLS clear coverage and cross-sensor water-change agreement; gray/unassessed regions contain insufficient comparable data. A low common-clear fraction means scores are suppressed. Exact pixel values require the local operator app.

## Interpret claims

Read each case's evidence card and validation page. A completed run means the workflow finished. It does not mean the algorithm's interpretation was confirmed. “Cross-sensor check” is a satellite comparison; field truth requires independent field/reference evidence. Vegetated inundation is exploratory in this version.

## Explore forest evidence

Choose **Forests** in the header. The global page supports place names, decimal
coordinates, saved studies and observation dates. Green WorldCover land-cover
tiles describe tree cover in **2021** and appear from zoom 6. Other WorldCover
colors represent other land-cover classes. NASA mosaic colors are backscatter
imagery, not classified loss. Amber outlines are acquired scene footprints;
filled amber polygons are published unverified radar-change candidates.

Open the Rondônia evidence page for the fixed three-date baseline and later
observations. Date selection changes statistics, maps, reference information
and candidate downloads. Compare HH/HV, HV change, baseline variability,
assessed persistence coverage, current radar quality, actual optical imagery
and vegetation-index changes. A transparent candidate layer does not prove
unchanged forest; inspect assessed coverage and masks. The first post-baseline
date has no persistence pair and is deliberately unassessed for classification.

The independent comparison reports actual HLS dates and offsets, common clear
coverage and candidate support/unassessed area. Passing 20% coverage makes it
assessable, not confirmed. NDVI/NBR decreases are exploratory vegetation
signatures with multiple causes; no precision/recall/F1 is inferred. GLAD-S2,
when imported, is positive context only. Missing alerts are not negatives.

The public viewer cannot run processing or probe exact native forest pixels.
Use the evidence package for provenance and web maps; native crops can be
downloaded only when an operator explicitly publishes their release asset.

## Next work

1. Investigate Hakaluki's weak independent agreement and existing-water candidates.
2. Seek an adequately clear independent Tanguar comparison; do not quote its present score.
3. Process the Chókwè January 5/17 BETA pair separately from PROVISIONAL studies and check it against independent local evidence.
4. Collect diverse independently validated sites/dates before making generalized accuracy claims.
5. Extend volcanic phase investigations with independent corrections/reference checks before stronger attribution; there is no eruption forecasting. See [volcano method and limitations](volcano-method.md).

## Explore volcano evidence

Open **Volcanoes**, then **Open the Hayli Gubbi case**. The cyan global-map rectangle identifies the published study box. The case has three NISAR intervals: before, spanning, and after the November 23, 2025 eruption. Switch intervals to change the NISAR map, table, inspector and native raster download together. These are separately referenced intervals, not cumulative motion.

Choose apparent LOS (red away / blue toward, cm), coherence (dark low / light high), or screened coverage (white assessed / transparent unassessed). Select ascending or descending Sentinel-1 for the second map. Both sensors have different observation windows and satellite directions, so equal colors are not an accuracy test. Transparent LOS means no usable phase result, not zero deformation. Coherence itself is not a confidence percentage.

Select a region button, click a map, or enter latitude and longitude to inspect both views at that location. Values come from a published geographic grid using nearest native samples; use the native GeoTIFF for exact analysis. The evidence package contains actual source crops, masks, method, provenance and checksums. It loads in public mode without Earthdata login. Optical pictures and the eruption report supply event context. Published paper peaks below the explorer are separately attributed literature values.
