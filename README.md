# GeoNexSAR — Earth Change Atlas

GeoNexSAR is a real-data-first research prototype for inspecting NISAR observations and investigating radar-derived surface-change candidates. The current complete scientific workflow focuses on wetlands. Forest and volcano pages are planned module briefings; they do not claim to run those scientific analyses yet.

**Data integrity rule:** the application does not generate simulated detections for the user interface. It serves the bundled real NISAR showcase or a completed local run whose manifest identifies its source as `NISAR`. If real data or a service is unavailable, GeoNexSAR displays an empty/error state rather than substituting fictional results. Synthetic raster inputs exist only in isolated Python unit-test fixtures and are not available through the application or production CLI.

Project science, data requirements, validation plan, and implementation details: [Beyonders_Wetland_Module_Handoff.md](./Beyonders_Wetland_Module_Handoff.md).

## Start the website

Requirements: Node.js 20.9 or newer and npm.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`.

Useful routes:

- `/` — GeoNexSAR landing page and location picker.
- `/wetland` — Wetland Time Machine with the packaged Tanguar Haor case.
- `/wetland/global` — the Global Change Investigator: worldwide NASA imagery, place-name/coordinate search, map-click location selection, actual acquisition footprints, existing cases, local processing, and reproducible result exports.
- `/wetland/global/scenes` — worldwide scene discovery and metadata.
- `/forest` — planned forest-monitoring briefing; no forest detections are generated here.
- `/volcano` — planned volcano-monitoring briefing; no deformation analysis is generated here.

## Data currently included

The ZIP includes `public/showcase/featured/`, a packaged Tanguar Haor, Bangladesh case derived from real NISAR L2 GCOV provisional observations. It contains seven acquisition dates, HH/HV-derived candidate polygons, radar previews, a GIS study mask and metadata for an independent optical comparison. It can be explored without Earthdata credentials or a local Python environment.

The featured case has an independent optical comparison outcome of **inconclusive**. Common clear coverage is approximately 0.333% of the mapped study area, far below the configured 20% minimum. `reference_validated` remains false. Candidate area is a radar-derived rule output, **not confirmed flood extent**. The mapped polygon is a reference study mask, not a legal or official wetland boundary.

The showcase run ID is `3daecb00658d4f1c969557f2f36944d3`. The seven observations run from June 30 through September 22, 2026. August 29 has the largest saved candidate area (24.4765 km² across 295 radar-change candidate regions); this value is an exploratory candidate area and is not flood truth.

The study boundary is stored at `pipeline/data/tanguar_haor_adb_boundary.geojson`. Its source is [Bangladesh CRIIPS Haor Boundary layer 147, feature 202](https://www.arcgisbd.com/server/rest/services/ADB005/CRIIPS/MapServer/147/202), whose geometry is about 116.61 km². This is not the [Ramsar site 1031 boundary](https://rsis.ramsar.org/ris/1031).

## Global Change Investigator and reproducible reports

The Global Change Investigator follows one clear flow: **find a place → define a study area → check real NASA observations → process compatible scenes → inspect evidence → export a report**. The map supports coordinates, direct map-pin selection, and a place-name search powered by OpenStreetMap Nominatim. Place search results are geographic labels only; they are not NASA data or detections. The interface displays OpenStreetMap attribution, and place lookups are submitted by the user rather than sent as autocomplete requests.

After a real case or run is loaded, export controls can produce a candidate-region CSV, GeoJSON FeatureCollection, JSON provenance snapshot, or a printable HTML report (open it in a browser and use Print / Save PDF). These exports include the known source, product maturity, dates, and limitations. A zero-candidate export is valid but does not prove no change occurred. Share links to packaged showcase cases are portable; links to local runs require that the receiving computer has that exact run saved locally.

## How to use the global explorer

1. Browse the worldwide NISAR GIBS mosaic and acquisition footprints. The mosaic is radar imagery, and footprint outlines mean observations exist; neither is a change classification.
2. Search a place name using the OpenStreetMap-backed search, enter coordinates, or click **Pick a point on map** and select a location. **Use this location for analysis** creates a small, editable rectangular study area centered on the selected pin. This rectangle is user-selected geometry—not a detected wetland boundary and not an analysis result.
3. Review the study-area coordinates and edit the rectangle, draw a different box or upload a GeoJSON `FeatureCollection` containing valid WGS84 `Polygon` or `MultiPolygon` geometry. For work that should follow a known wetland extent, use an appropriate sourced boundary rather than the quick-start box.
4. Select the **From** and **To** catalogue search dates and choose **Search NASA catalog**. The search checks real catalog records for compatible acquired observations. Coverage on the map alone does not guarantee a compatible pair.
5. Select a returned before/after pair. Do not choose dates that are not returned as compatible observations.
6. Connect NASA Earthdata Login when prompted, then launch local processing. The worker accesses real science files and applies the current wetland processing method. Download size and processing time depend on the scenes, location and network.
7. Follow the five-step progress tracker. It marks the study area, successful search, processing launch, completed job and loaded results separately. A completed environment setup is not a completed analysis.
8. Inspect the resulting dates, radar layers, candidate regions, stored sensitivity sweep and any independent-reference comparison. A run may validly return zero candidates. Zero candidates do not prove no environmental change occurred.

Current local processing guardrails: the browser workflow limits a rectangular study bounding box to at most 2 degrees across and cannot cross the date line. A box is an analysis area, not a mapped wetland boundary. The current pipeline requires compatible NISAR L2 GCOV scenes with `HHHH` and `HVHV` power layers and suitable acquisition geometry; other locations may not have a usable pair.

## NASA Earthdata login on Windows

The processing button attempts to open a separate PowerShell window on the computer running the local Node server. A click alone does not prove authentication succeeded. If no window appears, expand **Or run the command yourself**, open a normal PowerShell terminal and run the command shown by the app. Credentials are entered only in that terminal, not into GeoNexSAR.

The local processing features require a local Node server and Python environment. They are not a static-site or unauthenticated public-processing service. NASA GIBS imagery and live catalogue searches also require network access. If the mosaic tile or catalogue service is unavailable, the app should report that condition; it must not fabricate imagery or candidates to fill the gap.

## Run the real NISAR pipeline directly

Use the configured environment and `pipeline/config.yaml`, or pass an explicit boundary, bounding box and observation interval. The public CLI exposes **real mode only**; its default is real data. It does not expose synthetic/demo processing.

```powershell
# From the repository root
.\pipeline\venv\Scripts\python.exe pipeline\main.py --mode real
```

If you have not created the environment yet, install `pipeline/requirements.txt` in a Python virtual environment first. A NASA Earthdata Login is required to access science files. Never add login credentials to source code, a `.env` committed to Git, or a browser form.

The default `pipeline/config.yaml` target is Hakaluki Haor, which is intentionally separate from the packaged Tanguar Haor showcase. A fresh release ZIP does not include local `pipeline/output/` runs. Completed runs are saved under `pipeline/output/runs/` and published through `current_run.json`; a failed attempt must not replace the latest successful result. The web API rejects any run whose manifest is not labelled `NISAR`.

## Results and researcher tools

In the Wetland Time Machine, the timeline, Motion/Radar/Detection/Explain modes, SAR inspection, region register, evidence drawer, stored threshold-sensitivity table, and comparison tools operate on the selected real showcase or completed local run. The threshold table describes saved results: changing or selecting a row does not secretly rerun the detection algorithm or change a packaged result.

The region register supports searching, class filtering, sorting, region selection and export to CSV, GeoJSON or a JSON investigation snapshot. Shareable links restore supported view state. A local-run link only works on a computer that has the matching saved run; the packaged showcase is portable.

Exports identify their data source and retain relevant provenance and limitations. Before sharing results, check the acquisition dates, product maturity, study boundary, valid-data coverage, sensitivity and independent-reference status. An agreement with optical or another satellite product is not field truth.

## Forest and volcano roadmap

Forest and volcano are intentionally separate modules, not aliases for the wetland detector. Forest monitoring needs forest-specific change interpretation and suitable reference data. Volcano deformation requires deformation-appropriate methods, often including interferometric processing when suitable observations are available. Until those methods are built and validated, the corresponding pages remain planned briefings and the product does not display synthetic detections for them.

## Tests and quality checks

```powershell
npm test
npm run lint
npm run build
python -m unittest pipeline.test_legacy_showcase
Set-Location pipeline
python -m unittest test_pipeline test_evidence
```

For browser smoke tests, install Python Playwright and its browser, start a built Next.js server, then run:

```powershell
python tests/e2e/wetland_smoke.py http://localhost:3140
python tests/e2e/explore_smoke.py http://localhost:3140
```

Python test fixtures can generate synthetic rasters inside temporary test directories to verify detector calculations. They are test-only, should never be copied into `pipeline/output/` as science results, and are not exposed by the CLI or user interface.

## Scientific cautions

- Backscatter change is evidence of a change in radar scattering, not automatic proof of inundation, forest loss or ground deformation.
- The current NISAR product is provisional.
- The Tanguar optical comparison is inconclusive due to insufficient common clear coverage; it is not independent validation.
- Satellite imagery and scene footprints indicate observations and context, not global classifications.
- Forest and volcano processing is planned and does not yet exist as a completed scientific workflow.

## Design architecture

`src/components/global/atlas-global.css` defines the Atlas/global-workspace design system, including the Global Change Investigator controls and responsive report tools. `src/components/wetland/` contains the map-first Wetland Time Machine and its Explore/Check/Learn drawers. `src/components/global/` contains worldwide observation browsing, real place lookup, map-pin selection, study-area selection and local NISAR processing. `src/lib/investigation-report.ts` provides pure, tested CSV, GeoJSON, JSON and printable HTML report builders; `src/lib/place-search.ts` validates real place-search results. The shared UI/data discovery architecture is intended to be reused by future forest and volcano workflows, but their scientific algorithms and validation remain separate.
 Future phenomenon-specific pages should reuse the shared layout and workflow state patterns, while keeping scientific algorithms and validation isolated per module.
