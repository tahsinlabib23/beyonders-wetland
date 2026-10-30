# Operator guide

## Install for a fresh Windows checkout

Requirements: Node.js 20+, Python 3.13 (matching the current locked scientific environment), NASA Earthdata Login only for remote science assets.

```powershell
npm ci
py -3.13 -m venv pipeline/venv
.\pipeline\venv\Scripts\python.exe -m pip install -r pipeline/requirements.txt
npm run dev -- --port 3015
```

Open `/wetland/global`. Simulated walkthrough: `/wetland`; latest local NISAR run: `/wetland?source=raster`.

## Earthdata login and study workflow

Run `earthaccess.login(persist=True)` once from the repository terminal and complete login there. Do not paste credentials into the site/chat/repository. Select a saved boundary or draw a WGS84 rectangle/polygon, choose a temporal range, inspect compatible scene IDs and size metadata, choose scenes and process. Full granule size is not the expected cropped transfer size. A rectangular search box does not establish a wetland boundary.

Example reusable commands:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/discover_study_area.py --site-name "Site" --bbox WEST SOUTH EAST NORTH --start-date YYYY-MM-DD --end-date YYYY-MM-DD
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode real --site-name "Site" --bbox WEST SOUTH EAST NORTH --start-date YYYY-MM-DD --end-date YYYY-MM-DD
.\pipeline\venv\Scripts\python.exe pipeline/check_saved_date.py RUN_ID YYYY-MM-DD
.\pipeline\venv\Scripts\python.exe pipeline/audit_saved_evidence.py --output docs/evidence-inventory.json
```

The UI worker accepts one process at a time. Its job state and log are local. Failed jobs leave the prior complete run published. An unavailable optical comparison does not invalidate the saved radar run; retry it after Earthdata access returns.

## Volcano coverage and real Hayli Gubbi processing

Open `/volcano/global`, choose a Smithsonian volcano, set search dates, and use **Check NISAR coverage**. This read-only search does not run processing. The cyan rectangle links to the completed Hayli Gubbi / Erta Ale phase study at `/volcano/hayli-gubbi`. BETA and PROVISIONAL hits remain separate. See [actual inputs and method](volcano-method.md).

From the repository folder in PowerShell:

```powershell
.\pipeline\venv\Scripts\python.exe -c "import earthaccess; earthaccess.login(persist=True)"
.\pipeline\venv\Scripts\python.exe pipeline/volcano_pipeline.py --version YOUR_NEW_VERSION
```

The fixed, documented `pipeline/volcano_hayli_gubbi.json` selects three actual NISAR HH BETA GUNWs and two ARIA Sentinel-1 pairs. The processor reads crops, verifies grids/units/dates, applies coherence/component/reference screening, then atomically publishes only a complete package. This is a CLI workflow with no public job-submission endpoint. An independent scene acquisition failure stops a new publication and preserves the previous one. Earthdata must approve ASF access if it returns an EULA failure: sign in privately at `https://urs.earthdata.nasa.gov/approve_app?client_id=BO_n7nTIlMljdvU6kRRB3g` and accept the terms if appropriate, then rerun.

For cached input reproduction without downloading again:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/volcano_pipeline.py --offline --version YOUR_NEW_VERSION
.\pipeline\venv\Scripts\python.exe pipeline/download_volcano_context.py
```

Cached source crops are under `pipeline/output/volcano-inputs/hayli-gubbi` (excluded from Git). Publications are under `public/volcanoes/hayli-gubbi/VERSION`, selected by `index.json`. A version cannot be overwritten. The evidence ZIP includes source crops, source metadata, native GeoTIFFs, method/configuration, pinned requirements and SHA-256 checksums. To reconstruct the cache from the ZIP, copy each pair's `source-subset.npz` to `PAIR_ID.npz` and `source.json` to `PAIR_ID.json` in that cache directory, and use the exported config with `--config`. Run in a checkout with the matching method code and dependencies. Statistics/rasters reproduce; publication timestamps and ZIP bytes need not match.

After a new publication, update `public/volcanoes/catalog.json` to its version, method and URLs, then review/build. Previous versions are immutable rollback options. The current published method is `gunw-relative-los-1.0.1`; source paper GAMMA/3D processing remains a separate, unreproduced workflow.

## Publish a run

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/publish_study.py RUN_ID --version 2026.10.07
```

Optional GitHub release-asset base:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/publish_study.py RUN_ID --version 2026.10.07 --downloads-url https://github.com/OWNER/REPO/releases/download/TAG
```

Inspect `public/studies/catalog.json`, each `publication.json`, evidence card, package checksums and the source ZIP before committing viewer JSON/PNG packages. Large source archives are excluded from Git by `.gitignore`; upload them to a GitHub Release yourself. Do not include account credentials in a release.

## Chókwè case investigation

NASA CMR contains the paired compatible BETA scenes and the sample non-authoritative 0.1° study box is `pipeline/data/chokwe_event_box.geojson`. Confirm dates again before processing. With private Earthdata login configured, run:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode real --config pipeline/chokwe_beta.yaml --site-name "Chokwe event study box"
```

This produces an independent local run. The available adjacent HLS comparisons, common-clear coverage, and offsets determine whether an optical check is usable. The NASA event visualization is regional context. Do not attribute the NASA product's published flood outlines to the local detector.

The current completed run is `ec8fa5ee15ae41d1aa89f930f2b47e36`, published as `2026.10.29-chokwe`. It produced 127 HH-darkening candidate patches (29.87 km²), not confirmed flood polygons. Its best HLS pair is 7 January → 22 January with 1.26% common-clear study coverage; none of the candidate area was assessed, so the optical comparison is inconclusive and no accuracy score should be reported. The published package can be selected in the Wetlands saved-study control.

The later UNOSAT positive-only comparison is reproduced from the official Sentinel-1 GIS product. Download and extract the SHP archive into the ignored local cache path, then run:

```powershell
$zip = ".\pipeline\output\reference-cache\unosat_4232_sentinel1_flood_shp.zip"
$dest = ".\pipeline\output\reference-cache\unosat_4232_shp"
New-Item -ItemType Directory -Force $dest | Out-Null
Invoke-WebRequest "https://unosat.org/static/unosat_filesystem/4232/FL20251231MOZ_SHP.zip" -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
.\pipeline\venv\Scripts\python.exe pipeline/compare_chokwe_unosat.py
```

The script rasterizes the 23 and 24 January Sentinel-1 water and analysis extent layers onto the run's native NISAR grid and writes `docs/chokwe-unosat-overlap.json`. It reports positive overlap and candidate-footprint coverage only. The reference is six/seven days after the NISAR event and preliminary, not field-validated; there are no assessed negative labels, so do not calculate precision, recall, or F1 from this overlay. The local source archive is excluded from Git; the public UI links directly to the official UNOSAT source.
