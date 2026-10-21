# Known limitations and what is still unverified

## Not verified (could not be tested in this environment)
1. **Live NASA catalog (CMR).** Unreachable from the sandbox. The coverage scan and discovery were exercised only with hand-made catalog records (unit and UI fixtures) and, for the real code path, as honest network failures. Whether a particular area has compatible NISAR stacks today is therefore *unknown to this report*.
2. **Authenticated Earthdata access and real downloads.** No credentials. `auth-check` was run against the real `earthaccess` library and correctly reports `not_connected`; the `connected` branch is verified only with a mocked library. Its accuracy rests on `earthaccess.login` returning `authenticated=True` only after Earthdata accepts the saved login; this was not re-verified against Earthdata itself.
3. **A full real run on real NISAR HDF5 files.** The worker, alignment, mask handling, detector, previews, manifest, exports and history were run end to end, but with fake extractors writing synthetic GeoTIFFs. The pre-existing suite covers the HDF5 reading code with its own fixtures. Your earlier real downloads (`pipeline/output/forest/runs/*/rasters`) were left alone.
4. **The Windows empty-window fix.** The cause is inferred from your uploaded venv (launcher stub confirmed) and Node/Windows process semantics; the spawn rule is unit-tested, and the actual spawn was exercised on Linux only. **Please confirm on Windows:** run Discover, and check that no console window appears and that `pipeline/output/forest/jobs/<id>.log` fills. If a window still appears, tell me the Python path shown in the Earthdata panel ("venv", "env" or "system").
5. **Python 3.14.3 (your venv).** Tested on 3.12.3. Package wheels for 3.14 were not checked.
6. **Browsers other than Chromium, screen readers and touch devices.**
7. **The wetland PowerShell login launcher** (`src/app/api/wetland/processing/route.ts`, unchanged): it still opens a PowerShell window by design, using `cmd /c start`. Paths containing spaces may be mishandled by that quoting; not tested, not changed (shared wetland code).

## Pre-existing failures I did not repair
- 16 checks in `tests/e2e/wetland_smoke.py` and `explore_smoke.py` fail identically on the uploaded state (raw outputs of the before/after runs are in `evidence/`). They look like expectations from before the forest module was enabled and before the landing changes, plus one timing issue; each was not individually root-caused.
- `npm ci` fails on Linux because `package-lock.json` lacks optional `@emnapi` entries. Unchanged; works on Windows.
- Turbopack build warnings about process spawning in the wetland processing route. Unchanged.

## Behavioural limits of the new code
- **Cancellation** is cooperative: it takes effect at the next stage boundary (between scenes), not in the middle of a download or a single file read.
- **Stall detection** uses the worker's process id and a heartbeat (120 s of silence). It cannot see a worker on another machine.
- **Coverage scan**: window up to 6 degrees per side; at most 2000 catalog scenes per query (flagged when reached); stacks are grouped by track, direction, frame, bandwidth, polarisation modes and release as encoded in the granule name, so a stack that spans a processing-release change is listed as separate stacks. "Enough" means at least three dates in one stack, which is the app's minimum, not a statement that three dates are scientifically adequate.
- **Coverage is catalog metadata only.** It does not show that a granule is downloadable, valid or free of problems.
- **Run history lists completed runs only.** A failed attempt appears through its job record (stage, error, guidance, log tail), not as a history entry.
- **Place search** uses the existing OpenStreetMap Nominatim route (public service, rate-limited, names only; it supplies no satellite or forest information).
- The scene selector in discovery shows which stack was used and lists the alternatives; **choosing a different stack is not yet supported.**

## Scientific limits (unchanged by this work, restated)
- A candidate is a radar backscatter anomaly relative to a temporal baseline. It is **not** confirmed deforestation, degradation, fire, clearing, regrowth, biomass change, carbon emission or a legal violation. Soil and canopy moisture, seasonality, terrain, acquisition geometry, speckle and sparse revisit intervals all change backscatter.
- The forest mask is ESA WorldCover 2021 v200 (tree cover and mangroves): a static 2021 land-cover map with reported global overall accuracy around 77%, "tree cover" meaning at least 10% canopy. It is not a current forest inventory or precise boundary.
- HLS optical context is only as good as shared clear-sky coverage; with little overlap the result is "inconclusive", which is not disagreement and not a score of zero.
- NISAR GCOV used here is a **provisional** product release; results are exploratory.

## Required user setup
Create or repair `pipeline/venv` (the Earthdata panel prints the exact commands), run the login command once, and press Test connection before a download.
