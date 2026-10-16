# Volcano method and evidence

## Scope and status

The global directory shows Smithsonian GVP catalog points and NASA CMR GUNW footprints. Only the Hayli Gubbi / Erta Ale regional study has processed phase layers. Empty places mean no processed result available. The wetland GCOV detector is not used here.

Current publication: `public/volcanoes/hayli-gubbi/2026.10.07-v2/`; method `gunw-relative-los-1.0.1`. This is post-processing of **official geocoded unwrapped interferograms**, not raw-SLC interferometry or reproduction of a paper's GAMMA/3D inversion. Run completion is COMPLETE, reference availability AVAILABLE, scientific interpretation PHASE_DERIVED_LOS_CANDIDATES; comparison is CROSS_SENSOR_CONTEXT. None of those states means confirmed volcanic causation or prediction.

## Actual inputs

| Sensor / product | Interval (UTC) | Geometry / maturity |
|---|---|---|
| NISAR L2 GUNW, frequency A HH | 2025-11-10 → 2025-11-22 | Track 172, frame 008, ascending left-looking; BETA X05010 |
| NISAR L2 GUNW, frequency A HH | 2025-11-22 → 2025-12-04 | Same track/frame/release; spans November 23 eruption |
| NISAR L2 GUNW, frequency A HH | 2025-12-04 → 2025-12-16 | Same track/frame/release |
| ARIA Sentinel-1 GUNW VV v3.0.1 | 2025-11-19 → 2025-11-25 | Track 014, ascending right-looking |
| ARIA Sentinel-1 GUNW VV v3.0.1 | 2025-11-18 → 2025-11-30 | Track 079, descending right-looking |

Exact granule IDs, CMR concept IDs, original authenticated download URLs, processor metadata, transforms and input SHA-256 are in `study.json` and each `source.json`. NISAR dates were checked in original HDF5 identification metadata. ARIA dates are identified from the original product names. NISAR native spacing is 80 m in EPSG:32637; ARIA is about 0.000833333° in EPSG:4326. Wavelengths come from original center frequency or wavelength datasets: approximately 0.243932 m and 0.055466 m respectively.

## Processing

1. Discover the exact products with `earthaccess` against NASA CMR, open with private Earthdata authentication, and read only the spatial crop. Three NISAR pairs use one track, frame, HH channel and release. Bounded retries apply to transient network failures; existing crops are checksum-checked and reused offline.
2. Read unwrapped phase (radians), coherence (0–1), connected components, and NISAR source mask. Verify regular north-up coordinates, shape alignment and units. Source NoData remains NaN. Preserve legitimate zero phase even when ARIA metadata declares zero fill: coherence and connected-component validity screen those samples. NoData is never zero motion.
3. Restrict interpretation to native pixel centers inside the WGS84 study rectangle `[40.55, 13.4, 40.85, 13.75]` (west, south, east, north). This operator-defined box is not a geological boundary. Version 1.0.0 used the entire native crop envelope; version 1.0.1 adds this exact box mask and uses the in-box denominator. Both publications remain available.
4. Require finite phase/coherence/components, coherence at least 0.3 and at most 1, components greater than zero. NISAR excludes water-flagged pixels, fill mask 255 and samples with either reference/secondary subswath digit zero.
5. Use the patch `[40.58, 13.64, 40.61, 13.67]` west of the volcanic chain as an **assumed-stable** reference. Keep its dominant connected component only, require at least 25 screened reference pixels, and subtract its phase median. Insufficient reference support fails publication; no zero reference is invented.
6. Convert reference-subtracted phase φ to apparent LOS centimeters: NISAR `−φ λ/(4π) × 100`; ARIA `+φ λ/(4π) × 100`. Both outputs define positive toward the sensor. The sign difference follows each product's earlier/later reference convention. LOS is not vertical motion, uplift, or magma depth.
7. Compute statistics on native grids. Projected cells use their grid area; ARIA cell areas are geodesic. Report assessed fraction/area inside the analysis box and separate crop-envelope area. Circular regional samples (1 km Erta Ale north/south, 1.5 km Hayli Gubbi) are analyst-defined ROIs, not established crater boundaries.
8. Publish native cropped GeoTIFFs and source arrays plus nearest-neighbor geographic previews. The display grid samples native values; the public inspector is labeled as a geographic display sample. Rounded JSON is unsuitable for exact measurements; use native GeoTIFFs.

Ionosphere phase-screen arrays are retained when present, but **ionosphere, troposphere and solid-Earth-tide corrections are not applied**. Residual propagation, orbital, DEM, reference-motion and unwrap errors may contribute to every apparent LOS value. Reference-patch dispersion is `1.4826 × median absolute deviation`; this is spatial dispersion, not per-pixel uncertainty or displacement accuracy.

## Independent comparison and interpretation

Compare the event NISAR pair to the two ARIA views on the same nearest-neighbor geographic grid. Report screened common fraction and temporal offsets. Preserve the 20% floor: passing it makes spatial comparison available; it does not validate physical deformation. No raw LOS RMSE, F1 or precision is computed across unmatched viewing geometries and dates.

The event NISAR interval has substantially wider regional ranges near Erta Ale than its pre/post intervals. Sentinel-1 also shows localized phase structure there, with different ranges and lower regional coverage. Hayli Gubbi has much lower event NISAR coverage than surrounding areas. Consult the publication's actual regional counts/ranges before interpreting a map; the different sensor signs and magnitudes do not by themselves prove disagreement or a particular eruption mechanism. The current data supports showing **apparent LOS evidence and uncertainty**, not attribution of every feature to the eruption.

The Smithsonian/USGS report independently records the November 23 eruption, ash and gas; it is event context, not deformation ground truth. NASA optical images dated November 15, 23 and 24 show event context and are locally cached with source/checksum provenance.

## Literature comparator

Xu et al. report a separate raw-SLC GAMMA workflow and three-component inversion, including published peak values near 60 cm and 15 cm. Those values are explicitly separated from this app's measurements. The paper's November 2024 reference date conflicts with the mission launch; the linked archive has November 2025 VV filenames while the paper describes HH. This unresolved archive/paper discrepancy limits reproducing that workflow. It does not invalidate the official HH GUNWs whose 2025 metadata was checked directly.

## Sources

- [ASF NISAR GUNW guide](https://nisar-docs.asf.alaska.edu/gunw/) and [phase limitations](https://nisar-docs.asf.alaska.edu/phase/).
- [ASF ARIA GUNW guide](https://hyp3-docs.asf.alaska.edu/guides/gunw_product_guide/) for units, data layout and opposite phase convention.
- [Smithsonian GVP inventory](https://volcano.si.edu/database/webservices.cfm) and [eruption report](https://volcano.si.edu/showreport.cfm?wvar=GVP.WVAR20251126-221091).
- [NASA optical imagery](https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/).
- [Published study](https://doi.org/10.1016/j.geog.2026.06.002) and [its source archive](https://zenodo.org/records/18500929).
