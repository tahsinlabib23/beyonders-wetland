# GeoNexSAR Forest Monitoring Workspace — real-data workflow

## What is included

The `/forest` workspace adds a separate forest-monitoring pipeline to the existing GeoNexSAR app. It does not use the wetland inundation classifier, does not ship a forest case, and does not display generated/sample detections.

The live flow is:

1. **Study-area entry and readiness:** enter a WGS84 bounding box and date range; the AOI is a search/analysis boundary, not a claimed forest boundary.
2. **Live NASA discovery:** query NASA Common Metadata Repository (CMR) for `NISAR_L2_GCOV_PROVISIONAL_V1` and select at least three chronological scenes from one compatible `frequencyA` series. Product maturity, track, direction, frame, bandwidth/modes, acquisition mode and release must match.
3. **Authenticated science data:** NASA Earthdata Login opens actual GCOV HDF5 scenes. The existing `pipeline/extract_gcov.py` extracts calibrated `HHHH`/`HVHV` diagonal power layers to dB and records the GCOV number-of-looks/validity sidecars.
4. **Actual forest mask:** reads official ESA WorldCover 2021 v200 COG data (class 10 tree cover and class 95 mangroves) on the selected scene grid. Remote reads use GDAL `/vsicurl/` range requests when a verified cached tile is absent; the workflow does not substitute a built-in mask.
5. **Forest-specific analysis:** uses a leave-one-observation-out temporal median and a robust MAD-based anomaly screen. It outputs *potential structural backscatter anomalies*, not a deforestation label or cause.
6. **Independent optical context:** searches NASA HLS L30/S30, reads date-matched NIR/red/SWIR2/Fmask layers, computes NDVI/NBR changes, and checks cloud/adjacency/shadow/snow/high-aerosol flags. Results can be supportive, weak, inconclusive or unavailable; they are never marked as field validation.
7. **Map-ready measured layers:** renders transparent HH/HV dB quicklooks from the actual raster values and quality mask, with a common per-channel percentile scale across dates. The map overlay has no synthetic fallback. The time machine, candidate register, evidence audit and persistence tracker use saved run values.
8. **Persistence and provenance:** saves manifest, selected scene identifiers, mask citation/version, detector settings, raster quality, optical references, quicklook metadata, candidate report and limitations. Completed and data-readiness-blocked reports are kept under their run IDs; a blocked report never replaces the previous successful current run.
9. **Exports:** JSON report, CSV candidate register and GeoJSON FeatureCollection. The report keeps the candidate/unknown-cause interpretation and reference limitations.

## Requirements

- Node.js **20.9+** and npm for the website.
- Python **3.10+** for the science pipeline.
- Internet access to NASA CMR/ASF, ESA WorldCover S3 and NASA HLS.
- A NASA Earthdata Login to open real NISAR and HLS science files. Do not put credentials in the form, `.env` committed to Git, or source code.

## Setup on Windows

Run these from the local repository root on the `Rubai-dev` branch:

```powershell
npm ci
python -m venv pipeline\venv
.\pipeline\venv\Scripts\python.exe -m pip install --upgrade pip
.\pipeline\venv\Scripts\python.exe -m pip install -r pipeline\requirements.txt
.\pipeline\venv\Scripts\python.exe pipeline\forest_workflow.py login
npm run dev
```

Open `http://localhost:3000/forest`. The timeline and basemap workspace appear immediately. Before analysis, it displays no invented dates or detections; after discovery it can browse the actual catalog dates marked CATALOG ONLY. After a run, the measured timeline, HH/HV curves, raster overlays and candidate register use that saved run. The login command opens the Earthdata login flow and persists authentication using Earthaccess's local configuration. Credentials stay outside the repository.

## Run a forest investigation

In `/forest`, choose a site name, WGS84 bounds (`west, south, east, north`) and an observation window. Click **Discover real NISAR scenes**. The form lists live results and the exact compatible acquisition series returned by CMR. Check that at least three dates are selected, then click **Run full forest analysis**.

The browser's local Next.js server starts the Python worker. The worker rechecks the selected scenes against the live catalog before streaming science files; it does not trust stale browser metadata. Expect downloads and processing to take time depending on the scene count, connection and hardware.

The UI restricts each study box to at most 0.20 degrees in either dimension and 0.025 square degrees to keep transfers and memory bounded. Use a small, forested area initially. If CMR does not return at least three compatible observations, the workflow stops without generating a result. An ESA mask with no tree-cover/mangrove pixels also stops the run.

### CLI alternative

You can use the same live workflow without the webpage. Discover first, check that status is `READY`, then run the site from the UI or use the equivalent command below (bounds and dates here are examples only; they do not imply data availability for that location):

```powershell
.\pipeline\venv\Scripts\python.exe pipeline\forest_workflow.py discover --site-name "My forest AOI" --bbox 78 10 78.1 10.1 --start-date 2026-06-17 --end-date 2026-10-12
.\pipeline\venv\Scripts\python.exe pipeline\forest_workflow.py run --site-name "My forest AOI" --bbox 78 10 78.1 10.1 --start-date 2026-06-17 --end-date 2026-10-12
```

The CLI `run` performs discovery again and selects the current best compatible series. The web workflow instead runs the series explicitly selected from discovery.

## Saved outputs

Real outputs are saved outside source code under:

- `pipeline/output/forest/runs/<run-id>/forest_manifest.json`
- `pipeline/output/forest/runs/<run-id>/forest_analysis.json`
- `pipeline/output/forest/runs/<run-id>/forest_optical_evidence.json`
- `pipeline/output/forest/runs/<run-id>/workflow_provenance.json`
- `pipeline/output/forest/runs/<run-id>/rasters/` (measured HH/HV, quality and sourced mask rasters)
- `pipeline/output/forest/runs/<run-id>/previews/` (transparent HH/HV PNG quicklooks and metadata)
- `pipeline/output/forest/forest_analysis.json` (latest successfully completed report)
- `pipeline/output/forest/current_run.json` (pointer to the latest successfully completed real run)

A failed run must not replace a previously successful run. A run that reaches the forest analyzer but fails readiness saves a blocked diagnostic report with zero candidates and actual observation metadata; it remains addressable by run ID but does not replace the current successful-run pointer. The job record explains processing errors. The application does not treat absence of a result as zero detections. Add `pipeline/output/` and local credential files to your local ignore settings and **do not commit them**.

## Testing

Run the normal repository checks after applying the overlay:

```powershell
npm test
npm run lint
npm run build
Set-Location pipeline
python -m unittest test_forest_analysis test_forest_workflow test_forest_previews
python -m unittest test_legacy_showcase
python -m unittest test_pipeline test_evidence
```

The forest unit tests use only temporary synthetic fixtures to verify calculations and failure handling. They do not populate `pipeline/output/` and are not available to the app/production CLI as sample detections. The live NASA data download and end-to-end run must still be executed with internet access and your own Earthdata Login; an offline unit test cannot establish live service availability.

## Scientific constraints

- NISAR GCOV `HHHH`/`HVHV` are measured backscatter power terms converted to dB by the source extractor. Radar anomaly does **not** establish forest loss, fire, logging, cause, biomass loss, carbon emissions or recovery.
- The temporal median/MAD threshold is an exploratory retrospective anomaly screen, not a calibrated universal detector. The initial timeline before processing is catalog metadata, not a measured time series. Candidate thresholds should be evaluated against an independent documented reference before performance claims.
- ESA WorldCover 2021 v200 is a dated land-cover mask, not a current inventory; tree cover may include plantations and the workflow does not assess mask accuracy. Official source and attribution are retained in the report.
- HLS NDVI/NBR provides independent optical context at its own native resolution and date; clouds, aerosols, phenology, moisture, mixed pixels and date offsets remain confounders. `referenceValidated` always remains false.
- NISAR L2 GCOV is provisional. Compatible series may be short, contain observation gaps or be unavailable for a chosen area/window. A missing acquisition is not a no-change observation.
- WorldCover COG tiles are streamed as needed. The UI only shows measured HH/HV quicklooks and polygons from the saved real analysis; no image or candidate is fabricated to fill missing sources.

## Troubleshooting

- **No compatible series / insufficient observations:** try another small AOI or date window, guided by live discovery. Do not weaken compatibility filters to force a series.
- **Earthdata login failed:** rerun `python pipeline\forest_workflow.py login` in a normal PowerShell terminal and confirm your NASA account access.
- **WorldCover COG range read failed:** check internet/GDAL `vsicurl` support; the explicit error names the tile. A missing mask is not replaced with a user-drawn or sample raster.
- **HLS unavailable/inconclusive:** the radar result remains saved with the reference failure reason. It does not imply optical agreement or a validated result.
- **Build/API errors:** run `npm test`, `npm run lint`, and `npm run build`; check the local worker JSON under `pipeline/output/forest/jobs/` for the failure stage/message.

## Repair update

The October 2026 repair (job failures, Earthdata connection panel, NISAR coverage search, diagnostics and tests) is documented in
`docs/forest-repair/`: start with `README.md`, then `CHANGE_REPORT.md`, `TEST_REPORT.md` and `KNOWN_LIMITATIONS.md`.
