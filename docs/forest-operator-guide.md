# Forest operator workflow

Run from the repository/code folder. Install the locked environment using the
[main operator guide](operator-guide.md). Processing requires Python 3.13 and
private Earthdata access. The website only reads publications; it cannot start
forest jobs, in either local or public mode.

```powershell
$python = ".\pipeline\venv\Scripts\python.exe"
& $python -c "import earthaccess; earthaccess.login(persist=True)"
& $python .\pipeline\forest_pipeline.py discover
& $python .\pipeline\forest_pipeline.py process
```

Copy the printed `Forest run: ...` ID. Never paste credentials into chat or
commit them. Discovery is public. Processing reads spatial subsets, using
cached HH/HV/quality crops, positive calibrated power and categorical WorldCover.
The full granule size is not a cropped transfer estimate.

```powershell
$forestRun = "REPLACE_WITH_PRINTED_RUN_ID"
& $python .\pipeline\forest_pipeline.py reference --run $forestRun
& $python .\pipeline\forest_pipeline.py verify-run --run $forestRun
& $python .\pipeline\forest_pipeline.py publish --run $forestRun --version 2026.10.08-v1
```

The reference command uses HLS, not the wetland MNDWI algorithm. Inspect each
date's native masks, RGB and index changes before making claims. Bounds, dates
and all numeric rules are in `pipeline/forest_rondonia.json`. Changing the rule
requires a separately versioned method and evaluation, not just modifying a
threshold to improve agreement.

## Storage and reliable reruns

- Private, ignored: `pipeline/output/forests/cache`, `optical-cache` and
  `runs/RUN_ID`. Progress is persisted in `progress.json`; completed manifests
  remain available after later failures. Safe connection retries are bounded.
- Processes share `pipeline/output/.run.lock` with the wetland worker, so do not
  run both simultaneously. After a crash, confirm no worker is running before
  removing a stale lock. Volcano processing should also be run separately.
- Rerunning `process` creates a new run and reuses validated cached subsets.
  It does not overwrite a prior publication. Reference reading can be retried
  against the same run without reopening NISAR.
- `verify-run` recomputes every classification and statistic from saved native
  subsets without authentication, network access or changes to the run. It fails
  if outputs or the method version differ. Extract a native release into
  `pipeline/output/forests/runs/RUN_ID` to verify it in a fresh checkout.
- Public compact artifacts: `public/forests/rondonia/VERSION`. `catalog.json`
  and `rondonia/index.json` select the current package. Version directories are
  immutable; publishing the same version fails.
- Native subset distribution: the publisher creates
  `pipeline/output/forests/publication-downloads/rondonia-VERSION-native.zip`.
  Upload this explicitly to a GitHub Release if a public download is needed.
  Raw scenes, native subset caches, credentials and logs do not enter the viewer
  deployment. The compact evidence ZIP includes previews, provenance, method,
  configuration and checksums; it does not contain native rasters.

If the native archive is already published on GitHub, a **new** publication may
include `--native-download-url https://github.com/OWNER/REPO/releases/download/TAG/ASSET.zip`.
The download URL and SHA-256 are recorded; no private path is exposed.

## Optional GLAD-S2 import

Download/export a spatial subset from the official GLAD-S2 viewer linked by
<https://glad.umd.edu/dataset/glad-forest-alerts>. Prepare a one-band categorical
GeoTIFF with explicit positive values and a metadata JSON, for example:

```json
{
  "source_url": "https://glad.earthengine.app/view/s2-forest-alerts",
  "retrieved": "2026-10-08",
  "alert_date_range": ["2026-07-20", "2026-09-29"],
  "date_encoding": "Export was filtered to this date interval before categorical encoding; original per-alert dates retained in the source export metadata",
  "confidence_values": {"1": "low", "2": "high"},
  "alert_values": [1, 2]
}
```

Use the actual export's encoding/dates, not this illustrative metadata. The
pipeline intentionally does not guess arbitrary packed alert-date encodings.

```powershell
& $python .\pipeline\forest_pipeline.py import-glad --run $forestRun --raster .\my-glad-s2-export.tif --metadata .\my-glad-s2-metadata.json
& $python .\pipeline\forest_pipeline.py publish --run $forestRun --version 2026.10.08-v2
```

No-alert values are never interpreted as assessed negatives. The map's magenta
overlay is positive context only, with its metadata interval. It does not
automatically verify NISAR classifications or supply an accuracy score.

## Checks, deployment and rollback

```powershell
& $python -m unittest discover -s pipeline -p test_forest.py -v
npm run lint
$env:BEYONDERS_MODE = "public"
$env:NEXT_PUBLIC_BEYONDERS_MODE = "public"
npm run build
npm run start -- --port 3015
```

Open `/forest/global` and `/forest/rondonia`. Verify date selection changes all
maps, figures and GeoJSON links. Exercise place/coordinate errors, missing
catalogs/tiles, mobile navigation and layer legends. Public processing POSTs
must return 403; viewing never requires Earthdata.

To restore a prior publication, point `rondonia/index.json` and its catalog entry
to the prior immutable version, then redeploy. Verify package checksums first.
No satellite processing is required for rollback. Keep operator outputs backed
up separately; publishing is not a backup of raw science data.
