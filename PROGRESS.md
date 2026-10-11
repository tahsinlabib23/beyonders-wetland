# GeoNexSAR v11 — Global Change Investigator

## Implemented

- Added place-name lookup through OpenStreetMap Nominatim. Searches are user-submitted, throttled, validated, attributed, and return explicit error/no-result states. Place lookup never creates scientific candidates.
- Added opt-in map-click pin selection to the worldwide map. A selected pin can create a small editable analysis rectangle and carry coordinates/place label into the local processing workflow. The UI explicitly says that this geometry is user-selected, not a wetland boundary or detection.
- Made the NASA catalogue step a clear availability/compatibility preflight: it shows returned scene dates/IDs, catalog hits, search-limit status and an explicit no-compatible-scenes message. Processing is available only for returned compatible observations.
- Added export builders for CSV, GeoJSON, JSON provenance snapshots and printable HTML reports with source, product maturity, date, run, reference status and caveats. Included share links for packaged showcase cases and run/date links for local analyses. A fresh candidate-layer load is count-checked against the pulse manifest; failures stay visibly unavailable and report exports remain disabled instead of implying zero candidates.
- Kept the existing real-data Wetland Time Machine, synchronized discrete timeline, comparison drawer, threshold challenge/sensitivity, independent-reference evidence, and region investigation controls.
- Kept Forest and Volcano as explicitly planned modules. The architecture is reusable, but their scientific processing methods remain separate and are not represented as implemented.
- Updated the README with the new workflow, OpenStreetMap attribution, export/report details and limitations.

## Verification on this revision

- `npm test`: **34 passed, 0 failed**. The suite includes tests for place search validation, report formats, share URL state and candidate-file count integrity.
- `python -m unittest pipeline.test_legacy_showcase`: **9 passed, 2 expected skips** because local legacy runs are not bundled.
- `cd pipeline && python -m unittest test_pipeline test_raster_fixtures test_evidence`: **17 passed** using a temporary import-only `earthaccess` shim because the Earthdata client package is unavailable here. The shim was outside the project and is not included in the release.
- TypeScript/TSX parser check: **72 source/test files parsed, 0 syntax errors**.
- Local import resolution: **89 relative/alias imports checked, 0 missing files**.
- Data/asset audit: **32 JSON/GeoJSON files parsed** (12 GeoJSON FeatureCollections), seven date-specific candidate sets matched their pulse counts, all seven radar preview indexes and referenced images were present, and the showcase index contained only the featured case.
- The packaged Tanguar Haor showcase is preserved; no NISAR processing was rerun and no replacement scientific data were fabricated.

## Not independently verified

`npm ci` could not finish because package tarball requests to `registry.npmjs.org` repeatedly returned `EAI_AGAIN`. Consequently `npm run lint` and `npm run build` cannot start here (`eslint` and `next` binaries are absent), and browser end-to-end tests are **not verified** on this revision. Live OpenStreetMap lookup, NASA CMR/GIBS access, Windows Earthdata authentication, and a new real NISAR processing run also require online/local testing; they are not claimed as live-tested here.

## Scientific constraints

- A radar-change candidate is not confirmed flooding, forest loss, or ground deformation.
- The packaged Tanguar optical comparison remains inconclusive because common clear coverage is about 0.333% of the study mask, below the configured 20% minimum.
- Global imagery and acquisition footprints show observations/context, not global change classifications.
- Forest and Volcano processing is planned, not implemented.
- Synthetic raster data exist only as temporary unit-test fixtures. They are not exposed by the web app or the production CLI.
