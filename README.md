This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Project science, data requirements, validation plan, and current implementation audit: [Beyonders_Wetland_Module_Handoff.md](./Beyonders_Wetland_Module_Handoff.md).

## Demo without satellite data

Open `/wetland` to explore a deterministic, clearly labeled simulated scenario. No Earthdata login, Python pipeline, downloaded radar scenes, or map tiles are needed. The app must be served locally or hosted; this is not an offline installation/PWA. Optional satellite basemap tiles and web fonts use internet, with a schematic map and system-font fallback by default.

- Date and threshold changes recalculate the map, candidate regions and pulse together.
- A four-step guided tour covers baseline, peak, sensitivity and uncertainty.
- Selecting a region shows synthetic evidence and scopes the Counterfactual Lab.
- Before/Split compare the first fictional date with the current date at the same threshold. Difference colors show current candidate classes.
- The client-side probe reports region-average synthetic signals inside illustrated polygons.
- Download current-date regions in the class filter as CSV/GeoJSON, or a JSON evidence snapshot with settings, baseline regions and limitations.
- Copy view links to restore date, threshold, class filter, map mode and selection. Localhost links work only on the server's computer.
- Search/sort the region table and open the method glossary for signal and evidence explanations.

All dates, signals, quality inputs, verdicts and geometry in this browser mode are fictional. The 2025 demo timeline is separate from the real archive. No measured accuracy or ground-truth validation is claimed.

Core implementation: `src/lib/demo-engine.ts`, `src/lib/store.ts`, `src/lib/demo-export.ts`, and `src/components/dashboard/DemoExperience.tsx`. The handoff documents the science limitations and follow-on validation work.

Checks: `npm run lint` and `npm run build`.

Generated sample exports are in `data/demo-export-examples/`. The in-app browser's download event could not be observed during checking; serialization and the export action were checked, but saving through that browser was not confirmed.

## Raster pipeline

The pipeline keeps deterministic fake data as the safe default. Demo mode does not contact Earthdata or require credentials. It generates eight fictional observations, applies masks, and computes region statistics, area, pulse and sensitivity from generated rasters.

From the code folder on Windows, using the existing environment:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode demo
.\pipeline\venv\Scripts\python.exe pipeline/test_pipeline.py -v
```

For a fresh checkout, create a Python virtual environment and install `pipeline/requirements.txt`. With that environment active, `python pipeline/main.py --mode demo` works from the code folder, or `python main.py --mode demo` from `pipeline/`.

Real mode searches NASA CMR for compatible NISAR L2 GCOV provisional scenes over Hakaluki Haor, extracts the HH/HV observations, rasterizes the configured haor boundary onto each scene, and runs the same detector. The pulse chart spaces points by their actual acquisition dates and leaves longer gaps unfilled. You need a NASA Earthdata Login account to open scenes. Run this from a terminal so Earthaccess can use configured credentials or prompt you there; never add credentials to source files:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode real
```

On `/wetland/global`, **Process another place** now selects both the analysis area and its name. Draw a box with two map clicks, enter WGS84 coordinates, or upload a polygon GeoJSON FeatureCollection. A box is a rectangular study mask, not an established wetland boundary. Local browser jobs are limited to areas up to 2° across and cannot cross the date line. Search NASA's public catalog, choose a compatible before/after pair, then select **Process selected NISAR pair**. The worker saves a separate run and loads it on completion. The **Saved study areas** selector reopens completed real runs; failed jobs leave previous results available.

Connect Earthdata Login once in a normal PowerShell terminal. Use the full-path command displayed under **Connect Earthdata Login once**; it works from any folder. If the terminal is already in this code folder:

```powershell
.\pipeline\venv\Scripts\python.exe -c "import earthaccess; earthaccess.login(persist=True)"
```

The local worker reads the saved private login. Credentials are not submitted through the web form. Start the development server from a normal terminal with network access (`npm run dev -- --port 3015`); a sandboxed server can load existing results while its spawned Python worker is blocked from contacting NASA. The browser job controls require a local Node server and the existing Windows `pipeline/venv`; they are not suitable for a static deployment or an unauthenticated public processing service.

**Actual detector inputs** displays HH/HV before, after, and after−before from each selected observation's saved measured rasters. Before/after use the same brightness scale and geographic extent. These display PNGs use bilinear resampling in Web Mercator; detection/statistics keep the original grid. Download links provide native cropped GeoTIFFs, candidate GeoJSON, classifications, and case evidence. These are spatial subsets, not full raw NISAR HDF5 granules.

**Does the change agree?** shows measured HLS true-colour images (B04/B03/B02), QA-masked MNDWI water masks, common clear coverage, an agreement map and an adjustable radar overlay. Both dates share a fixed RGB display scale and every panel uses the same geographic extent. Grey comparison pixels are unassessed, not non-water. The comparison selector can show a closer optical pair chosen by date offset among previously evaluated pairs meeting the unchanged coverage requirement; it does not replace the primary maximum-coverage comparison. The table separates radar-only pixels that were already optical water, remained optical non-water, or became non-water. This context is independent evidence, not a replacement SAR classifier or field truth. Water on both reference dates does not establish permanent water.

Select **Prepare optical evidence** to rebuild images and the investigation from the saved reference scenes. Cropped source bands are cached locally in the run's ignored `reference_source_cache/` directory. Evidence is published only if its reconstructed common coverage and TP/FP/FN counts reproduce the recorded reference. The viewer and downloads reject stale evidence after a reference changes. New real runs and reference retries attempt to prepare the evidence automatically; a preparation failure preserves the radar run/reference statistics and can be retried. No new full NISAR download is needed.

The standalone command for the current case is:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/reference_evidence.py ab8c780a3e204035a34cbb0c09d886a4
```

For this September case, all 1,088 primary-reference assessed radar candidate pixels are water on both optical dates. The September 24 alternate reference assesses 1,773 candidate pixels and also finds them already water. The HH-decrease rule does not require a previously dry surface to become water; it can therefore flag change over existing water. The primary and alternate comparisons still have zero new-water overlap. This identifies a limitation in flood interpretation, while leaving the physical cause unresolved. Thresholds and original detector outputs have not been tuned to these reference scores.

**Retry reference check** uses saved NISAR results and tests up to 32 nearby-date HLS pairs from Sentinel-2 S30 and Landsat L30, selecting by common clear coverage. Dates, offsets, QA exclusions, and minimum coverage criteria remain explicit. It may still return `INCONCLUSIVE` or `UNAVAILABLE`; a computable satellite comparison is not field validation. **Prepare radar images** backfills previews for older saved runs without downloading NISAR again. Jobs/progress/logs persist locally in ignored `pipeline/output/jobs/`. A browser refresh does not cancel the Python job.

If all reference pairs are cloudy, screen other dates already saved in a real NISAR run. These commands run from this code folder:

To check a later observation while preserving its saved multi-date median radar baseline, use the date-specific command. It writes HLS statistics and aligned comparison images under the run's `date_checks/<date>/` folder; it does not change the published peak-date case or current-run pointer:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/check_saved_date.py d6e65a58802e4cf4907ddefa42a435d6 2026-09-27
```

The median-baseline check uses the midpoint of its preceding NISAR dates to seek a nearby optical baseline. Read the reported HLS dates and coverage before interpreting agreement. Its `evidence.json` separates radar-only candidates that were water on both optical dates, non-water on both, or optical water recession. A satellite comparison remains distinct from field validation.

**Current two-site evidence (5 October 2026):** The saved Hakaluki September 27 median-baseline check has 50.7% comparable HLS area and only 7.4% native-cell, area-weighted change-agreement F1. Of 773 aligned radar-only cells, 637 were HLS water on both optical dates. This does not corroborate a confirmed new-flood claim. The Tanguar September 22 check evaluated 32 HLS pairs but found only two common clear native cells (0.0018 km²) in the current study box, so its status is `INCONCLUSIVE` and no score should be quoted. When you choose those observation dates on the worldwide page, **Independent check for this date** shows the saved result; Hakaluki also has aligned before/after and agreement images. The featured case panel still describes each run's selected peak observation.

The old Tanguar run uses a 61.0 km² rectangular study box. A separate mapped **haor** polygon is now saved at `pipeline/data/tanguar_haor_adb_boundary.geojson`. It comes from [Bangladesh CRIIPS Haor Boundary layer 147, feature 202](https://www.arcgisbd.com/server/rest/services/ADB005/CRIIPS/MapServer/147/202), which reports 116.5 km²; its WGS84 geometry measures 116.59 km². This is **not** the [Ramsar site 1031 boundary](https://rsis.ramsar.org/ris/1031), whose listed area is 9,500 ha (95 km²). CRIIPS also has a separate feature called “Tangua Haor,” so feature 202 was chosen by its exact “Tanguar Haor” name. The saved rectangle run must not be relabeled or spatially clipped as though it had been processed on this polygon.

To create a new real run on the mapped haor polygon from this code folder in PowerShell, first check catalog coverage for the polygon's bounds, then run the full series:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/discover_study_area.py --site-name "Tanguar Haor mapped boundary" --bbox 90.960080 25.089216 91.128588 25.189314 --start-date 2026-06-17 --end-date 2026-09-30
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode real --site-name "Tanguar Haor mapped boundary" --boundary-geojson .\pipeline\data\tanguar_haor_adb_boundary.geojson --start-date 2026-06-17 --end-date 2026-09-30
```

The second command rereads the science files for the larger polygon; the cropped rectangular rasters cannot fill its western and eastern portions. Its resulting run ID will differ from the study-box run. If September 22 remains a processed date, rerun `check_saved_date.py` with that **new** run ID; optical clear coverage may still be poor. To regenerate the polygon from the CRIIPS source JSON, use `pipeline/prepare_tanguar_boundary.py` (or `--source-file PATH` with a saved feature 202 JSON). The importer checks the source ID/name, geometry validity, location and reported versus measured area.

The mapped-boundary run completed as `3b01cdb5674a44ea9c6c3d17ec8c07b8` and is now published. It has seven comparison dates from June 30 to September 22; the largest saved result is August 29 (295 HH-darkening regions, 24.4765 km²). Its August 29 HLS comparison is `INCONCLUSIVE`: only 0.388 km², about 0.34% of the mapped mask, was common clear. The optical evidence images are useful for seeing that coverage gap, but zero-valued overlap/F1 from this tiny subset is not a valid accuracy result. The website now suppresses agreement scores and disagreement conclusions in its optical evidence viewer when the reference status is inconclusive. The regions remain unverified radar-change candidates.

For a second area, first check public catalog availability with `pipeline/discover_study_area.py --site-name NAME --bbox WEST SOUTH EAST NORTH --start-date YYYY-MM-DD --end-date YYYY-MM-DD`. Only run `pipeline/main.py --mode real` with the same options after a compatible series is reported. A bbox is a rectangular analysis box, not an official wetland boundary; use `--boundary-geojson` with an authoritative polygon when available.

The older commands below rank short NISAR **pairs** by optical QA and create a separate two-scene run. That run uses one preceding radar scene rather than the saved multi-date median:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/find_reference_case.py pipeline/output/runs/49f40700785144a7969c15b1cfc516b4
.\pipeline\venv\Scripts\python.exe pipeline/process_reference_case.py 49f40700785144a7969c15b1cfc516b4
```

Replace the run ID for another saved real analysis. Screening reads HLS quality masks only and ranks date pairs (up to 24 days apart) by shared clear coverage, then shorter radar interval. It does not inspect detection agreement. Processing requires the screened pair to meet the unchanged 20% coverage floor, reuses measured HH/HV dB subsets for the identical study polygon/product/frequency, and then performs the full spectral comparison. Spectral validity can reduce coverage after screening. The new run retains source-run and date-selection provenance, and the original stays available in **Saved study areas and runs**. HLS requests still require Earthdata Login. Saved radar values are already in dB and are not log-transformed again.

On Windows, Earthaccess can read a local `%USERPROFILE%\_netrc` entry for `urs.earthdata.nasa.gov`, or the documented Earthdata environment variables. A background worker cannot use an earlier interactive login unless that login was persisted. Keep credentials in your private local configuration; do not put them in this repository or send them in chat. See the [NISAR Earthdata access guide](https://nisar-docs.asf.alaska.edu/earthdata-search/), which documents Earthaccess login and streaming.

The current configured archive window is 17 June–30 September 2026. The selected NISAR product is provisional. Change the `nisar.temporal` dates in `pipeline/config.yaml` to query another window. The boundary is a reference GIS study mask attributed in that file; it is not a legal wetland extent. For the peak open-water candidate, real mode attempts a date-matched NASA HLS Sentinel-2/Landsat check using green/SWIR MNDWI over shared clear pixels. S30 uses B03/B11; L30 uses B03/B06. Cloud, adjacency, shadow, snow/ice and high-aerosol pixels are excluded. If coverage or water-change pixels are insufficient, the result is `INCONCLUSIVE`; if HLS access or processing fails, the NISAR run can still complete with status `UNAVAILABLE`. A completed cross-sensor comparison is not field truth, a formal accuracy estimate, or validation of vegetated inundation. The manifest keeps `reference_validated` false and reports `cross_sensor_check_completed` separately.

Open `/wetland/global` for the NASA GIBS worldwide NISAR GCOV false-color backscatter mosaic, using the daily WMTS layer advertised by GIBS. This is real SAR imagery, not a flood or wetland classification. The map also overlays NISAR acquisition footprints from NASA CMR for the selected UTC date, colored by orbit direction. These outlines show observed scene coverage only. Actual inundation candidate polygons appear only in areas processed by a completed real pipeline run. The current published run covers the Tanguar study box; saved Hakaluki runs remain selectable. Simulated outputs are hidden. Unprocessed map areas mean **no detector result is available**, not “no change.” The footprint picker defaults to October 1, 2026 so the bundled 859-footprint catalog snapshot works in the offline preview; choose a newer date to query live CMR. The separate `/wetland/global/scenes` view offers scene selection, browse previews, science-file links, and a daily metadata inventory CSV. Science HDF5 links may require Earthdata Login.

Completed runs are stored under `pipeline/output/runs/`. An atomic `current_run.json` pointer publishes only a completed run; a failed attempt is recorded separately, leaving the last complete run available. These generated files are ignored by Git, so regenerate them after checkout. If a process is forcibly terminated, check that it has stopped before removing its leftover `pipeline/output/.run.lock`.

- `/api/wetland/pulse`, `/patches` and `/sensitivity` share one completed run and expose either `SIMULATED_DEMO` or `NISAR` provenance. The boundary endpoint serves the exact study mask used for a NISAR run.
- `/api/wetland/patches?date=2026-06-23` selects an observation; the default is the peak date.
- `/api/wetland/nisar-detections?date=2026-06-23` supplies the NISAR map with date-specific candidate polygons and the processed study boundary. It returns no features while the current pipeline run is simulated.
- `/api/wetland/probe?lat=...&lng=...&date=...` samples the corresponding masked rasters and published classification. Invalid coordinates or dates are rejected; masked or outside pixels have unavailable signals.
- The probe uses `pipeline/venv` when present. Set `PYTHON_EXECUTABLE` to another Python environment with the pipeline dependencies when needed. This API requires a local Node server and Python; it is not a static-only deployment feature.

The browser simulation and Python raster pipeline are separate. The dashboard opens the browser simulation by default; choose **Load pipeline run** in its top bar or open `/wetland?source=raster` to show the most recently completed pipeline run. Real runs fit the map to and outline the full reference haor boundary, even when candidate polygons cover only a smaller part. The date, table, map, pulse, exports and pixel probe use the selected run.

The pipeline only treats positive finite HHHH/HVHV powers as valid unless an external QA mask is configured. Missing georeferencing, unavailable polarizations and mismatched grids fail with an error. A real input source does not mean that the inundation classifications are validated.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Open [the demo dashboard](http://localhost:3000/wetland). Its page is `src/app/wetland/page.tsx`.
Open [the worldwide NISAR mosaic and candidate overlay](http://localhost:3000/wetland/global) or [NISAR scene footprints](http://localhost:3000/wetland/global/scenes).

Fonts are configured in `src/app/globals.css` with system fallbacks.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
