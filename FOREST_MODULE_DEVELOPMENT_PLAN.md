# Forest Module Integration Plan — Rubai-dev

## Baseline inspected

At inspection, `Rubai-dev` pointed to `3981ec6658fee6cef06f21b61aa82b07b2926205`. The repository had a real-data wetland pipeline and shared UI/export patterns; `/forest` was a planned-only briefing. The forest module must not reuse `pipeline/detect_inundation.py` or wetland thresholds. The package remains an overlay, not a full clone of the repository. It keeps the existing wetland detector and study case separate.

## End-to-end design in this overlay

```text
/forest form (AOI + dates + settings)
  -> local Next.js workflow API and job status file
  -> live NASA CMR query, compatible NISAR series selection
  -> re-query chosen IDs, Earthdata login and real ASF/CMR science streams
  -> extract HH/HV dB + GCOV quality, align rasters to one explicit grid
  -> read authentic ESA WorldCover 2021 v200 COG blocks and build forest mask
  -> forest-only temporal median/MAD anomaly screen
  -> actual HH/HV map quicklooks + candidate geometry/persistence
  -> NASA HLS L30/S30 NDVI/NBR and Fmask check when suitable pairs exist
  -> run manifest, measurements, source scene IDs, uncertainty and reference records
  -> atomic publication of current_run + UI map/time machine + JSON/CSV/GeoJSON
```

No forest study area or forest detections are pre-bundled. The UI makes the user define an AOI and uses live discovery to verify whether compatible data are available before processing. No scenes, detections, images, mask pixels or optical results are simulated in the app workflow.

## Main integration decisions

1. **Branch safety:** the PowerShell installer refuses to run unless the current branch is exactly `Rubai-dev`, refuses to overwrite dirty target files, saves a backup outside the repository, applies tolerant homepage/README documentation updates, and provides a hash-guarded restore script. It does not switch branches, merge, commit or push.
2. **Science isolation:** `pipeline/forest_analysis.py` uses a leave-one-observation-out per-pixel median/MAD candidate screen in an explicitly sourced forest mask. Existing wetland detection, configuration and processing are untouched.
3. **Live discovery:** `pipeline/forest_workflow.py` calls NASA CMR through `earthaccess`, groups only compatible NISAR L2 GCOV frequencyA scenes, retains true scene IDs/metadata and requires at least three unique dates.
4. **Real-mask input:** ESA WorldCover classes 10 and 95 create a grid-aligned mask; cloud-optimized GeoTIFF range reads are used when available. The source, tile, access mode and dated-mask caveats are retained.
5. **Optical context:** `pipeline/forest_optical_reference.py` queries and reads actual NASA HLS bands, applies Fmask QA, computes NDVI/NBR changes and labels support/no strong signal/inconclusive/unavailable. It never marks a candidate as field-validated.
6. **Actual raster display:** `pipeline/forest_previews.py` renders the measured HH/HV values using the valid forest/quality mask and a shared per-channel percentile scale. Quicklooks are map overlays aligned to the underlying raster bounds; failure to render is exposed and never filled by a placeholder.
7. **Provenance and durable runs:** the run manifest includes selected granule IDs and compatibility, mask source, method settings and processing lineage. Outputs are staged under a run UUID; a failed attempt does not replace the latest successful pointer/report.
8. **No stale candidate selection:** the initial workspace displays an empty catalog-only timeline until live discovery supplies actual dates; selected catalog dates never masquerade as processed measurements. After a run, the measured timeline starts at an actual observation, selects an associated candidate if one exists, and does not display a candidate from another date when the selected date has none. A blocked run remains openable by run ID and exposes its real readiness checks without replacing a previous successful current run.

## Test gates

| Layer | Offline tests included | Live integration requirement |
|---|---|---|
| AOI and detector settings | input validation, date/bounds checks | user enters an AOI within the interface limit |
| Live CMR grouping | mocked real-shaped granule metadata tests cover release/mode/date compatibility | actual NASA query must return 3+ selected compatible scenes |
| ESA mask | class 10/95 mask/grid tests and empty-source blocking | read the official ESA COG tile(s) for selected AOI |
| HH/HV anomaly detector | temporary-raster anomaly, mask, chronology, compatibility and coverage tests | download actual scenes and review observed candidate patterns |
| NASA HLS context | NDVI/NBR/Fmask numeric tests | authenticated, date-matched HLS pairs; cloud-free coverage may remain inconclusive |
| Radar quicklooks | transparent pixel masking, shared channel scale and no-data no-image tests | visual review of actual HH/HV layer over the actual study area |
| UI report contracts | TypeScript schema/export tests | full local `npm test`, lint, Next build and browser inspection |

Offline fixtures use temporary directories only. They verify calculations and fail-closed rules; they do not show that a particular study site has NISAR coverage or that the live APIs currently work.

## Suggested implementation/commit sequence

Although the overlay is packaged together so the first forest system works end to end, keep later iteration commits small:

1. **Pipeline integration + scene provenance:** keep CMR selection, scene opening, extraction and compatibility checks working. Do not relax compatibility because the AOI lacks a series.
2. **Forest mask + detector:** inspect mask-source/date and scene coverage gates. Calibrate thresholds with a separate reference before claiming detection accuracy.
3. **HLS independent evidence:** test a clear case and cloudy/no-match cases; the latter must produce explicit unavailable/inconclusive states.
4. **Measured layer/time machine:** review the HH/HV map overlays against raster data, confirm invalid areas stay transparent, and confirm changing dates/channels does not show stale frames.
5. **Case evaluation and export:** choose a site only after live discovery, independently document the event/reference, inspect false alarms/missed areas and export/reopen the GeoJSON and report.

## Acceptance criteria for calling it a completed real case

- At least three compatible real NISAR acquisitions were retrieved and recorded by scene ID/date/release.
- The actual ESA WorldCover mask was opened and aligned; pixel counts, URL/tile attribution and the mask's 2021 date are recorded.
- The detector ran on saved real HH/HV dB and GCOV quality masks, with an explicit method/settings and observed coverage checks.
- Date-linked HH/HV map quicklooks are generated from actual raster values or show an explicit unavailable message.
- NASA HLS data were either actually compared with recorded source IDs/clear coverage or marked unavailable/inconclusive; no reference is called ground truth.
- The JSON/CSV/GeoJSON report includes actual IDs, parameters and limitations; no synthetic forest data enter application results.
- The full local project's tests/lint/build and browser smoke checks must pass on the target workstation.

## Science/data limitations

The workflow intentionally identifies *potential structural backscatter anomalies*, not a definitive deforestation map. The detector is exploratory and is not trained/calibrated. Optical indices can add context but cannot establish ground truth. ESA WorldCover 2021 is static and may not represent current forest extent. NISAR L2 GCOV provisional data can be sparse or unavailable in the requested orbit/area/window. If the CMR series, forest pixels, quality masks or HLS references are inadequate, the job fails or the reference is marked inconclusive/unavailable. Those are valid results; inventing a complete map is not.

## Commands

After applying the overlay from repository root, and installing the Python environment:

```powershell
npm test
npm run lint
npm run build
Set-Location pipeline
python -m unittest test_forest_analysis test_forest_workflow test_forest_previews
python -m unittest test_legacy_showcase
python -m unittest test_pipeline test_evidence
```

For actual processing on Windows:

```powershell
Set-Location <repository-root>
.\pipeline\venv\Scripts\python.exe pipeline\forest_workflow.py login
.\pipeline\venv\Scripts\python.exe pipeline\forest_workflow.py discover --site-name "Selected forest AOI" --bbox <WEST> <SOUTH> <EAST> <NORTH> --start-date 2026-06-17 --end-date 2026-10-12
```

Replace placeholder bounds with a real chosen study area. `discover` must report `READY`; otherwise select a different AOI/date window rather than fabricating observations. Processing through `/forest` lets you select the scene series returned by discovery. Do not commit output rasters, run reports, cache files or local Earthdata credentials.
