# Volcano release and acceptance report

Date: 2026-10-07. Current package: `2026.10.07-v2`; method: `gunw-relative-los-1.0.1`. Open `/volcano/hayli-gubbi` for the study and `/volcano/global` for discovery. Processing COMPLETE, independent observations AVAILABLE, interpretation PHASE_DERIVED_LOS_CANDIDATES, comparison CROSS_SENSOR_CONTEXT. Public hosting remains a user-managed deployment step.

## Added

- Three real official NISAR HH BETA GUNW intervals before, across, and after the November 23, 2025 event.
- Real ARIA Sentinel-1 ascending and descending comparisons, each with its own dates, geometry and native provenance.
- Paired apparent LOS, coherence and screened-coverage maps; interval selection; region focus and full-study reset; coordinate/map-sample inspection.
- Native LOS GeoTIFF downloads and a 21,614,709-byte evidence ZIP containing actual source crops, masks, native rasters, method/configuration, requirements, evidence card and checksums.
- Local NASA MODIS/Landsat event-context images with download provenance. Literature results are visibly separate from app-produced layers.
- Separate directory points, catalog footprints and a published-study rectangle on the global volcano map. Unprocessed places have no result available.
- Public-mode data access, useful missing-package/grid/layer/catalog states, protected processing endpoints and documented reproduction/rollback.

Version 1.0.1 screens native pixel centers outside the geographic analysis box. The previous `2026.10.07-v1` publication remains immutable and available as a comparator; thresholds, reference convention and unapplied corrections are unchanged.

## Measured coverage and comparison

| NISAR interval | Native in-box screened fraction | Screened native area | Reference-patch scaled MAD |
|---|---:|---:|---:|
| Nov 10–22 | 83.03% | 1044.06 km² | 0.308 cm |
| Nov 22–Dec 4 | 81.81% | 1028.63 km² | 0.260 cm |
| Dec 4–16 | 80.43% | 1011.38 km² | 0.164 cm |

The native box area is approximately 1257.40 km². Common screened coverage of the geographic display rectangle is 81.53% for ascending Sentinel-1 and 81.55% for descending Sentinel-1 against the event NISAR interval. Ascending starts three days earlier and ends nine days earlier; descending starts and ends four days earlier. Both exceed the 20% availability floor. This does not quantify accuracy.

For the event interval, the Erta Ale north 1 km sample has NISAR 5–95% apparent LOS range −36.67 to +13.71 cm (79.5% screened); south is −45.29 to +18.60 cm (74.5%). Hayli Gubbi's 1.5 km sample is −3.18 to −1.18 cm with only 32.2% screened coverage. These are regional distributions, not peak deformation estimates or error bounds. Sentinel-1 shows different regional distributions and usable coverage; its separate direction/date windows prevent a direct score or vertical-motion inference. Full counts, medians, ranges and native metadata are preserved in the manifest.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run lint` | Passed after excluding generated processing outputs |
| Public-mode `npm run build` | Passed; final Windows sandbox EPERM was resolved by a normal host rebuild |
| `python -m unittest test_release test_volcano -v` from pipeline | 18 tests passed |
| Actual-input reproduction | All five published source crops reproduced native LOS rasters, screened masks and statistics exactly |
| Artifact integrity | All 71 current-package SHA-256 entries verified |
| Desktop browser (1440 × 1000) | Both actual radar image layers loaded; interval/layer/Sentinel selection, coordinate inspection and downloads passed; no page errors |
| Mobile browser (390 × 844) | Controls/maps/images loaded; no page-level horizontal overflow |
| Header navigation | Volcanoes/Wetlands switch routes and active indicators correctly |
| Failure states | Missing publication, inconsistent grid, missing radar image and unavailable catalog displayed useful notices |
| Public endpoint gates | Wetland processing/settings/probe returned 403; volcano interfaces expose no processing route |
| Deployment exclusions | Private pipeline/cache excluded; reviewed public manifest and evidence ZIP included |

Unit invariants include valid zero phase preservation, missing/low-quality/disconnected/water-screened samples remaining unassessed, opposite product phase conventions, failure with inadequate reference, exact analysis-box mask, repeatable classifications/statistics, immutable versions, and preservation of the prior publication after a failure. The temporary browser harness/screenshots and reproduction diagnostic are ignored local artifacts, not release inputs.

## Limits and next scientific gate

The reference patch is assumed stable; no independent survey proves it stationary. Atmospheric, ionospheric and tide corrections are unapplied. Coherence is a quality indicator, and reference MAD is spatial dispersion rather than measurement accuracy. Each interval is independently referenced. The app has not reproduced the paper's raw-SLC GAMMA/3D inversion and does not predict eruptions or attribute every phase feature to volcanic motion.

Stronger attribution requires correction sensitivity, reference stability checks, phase-unwrapping inspection and matched independent geophysical evidence. Public deployment and a fresh off-computer hosted check must be completed by the user before claiming the site is publicly released.

See [method](volcano-method.md), [operator commands](operator-guide.md), [data specification](data-specification.md) and [deployment/rollback](deployment.md).
