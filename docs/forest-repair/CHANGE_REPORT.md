# Change report

Scope: repair and harden the forest module, make Earthdata authentication and NISAR coverage discovery understandable,
and prove the wetland workflow was not disturbed. Nothing was committed, pushed, merged or branch-switched.

## A. What was broken, and the root cause of each

| # | Reported symptom | Root cause (verified) | Evidence |
|---|---|---|---|
| 1 | `'DatasetReader' object is not subscriptable` | Grid helpers indexed their first argument like a dict (`reference["crs"]`). Passing an open Rasterio dataset raised the TypeError. The uploaded `align_raster_to_reference` already passed a profile, but `_same_grid` stayed fragile and nothing exercised it. | Reproduced on unmodified code (`TypeError` in `_same_grid`); `pipeline/output/forest/jobs` held two real jobs with this error. |
| 2 | `cannot access local variable 'manifest'` | In `_run_analysis` the dict literal that *defines* `manifest` contained `manifest["site"]["boundary_source"]`. Python reads the name before it exists, so every run that reached manifest creation failed. | Reproduced from a full run (`UnboundLocalError` at that line); two more real jobs failed this way. |
| 3 | Empty PowerShell/terminal window | The forest route spawned Python with `detached: true` on Windows. A detached child starts with no console; the project venv's `python.exe` is a launcher stub (the file contains `venvlauncher.pdb`) that starts the real interpreter, a console program, which Windows then gives a new visible empty console. Output was also discarded (`stdio: "ignore"`), so the window had nothing to show. | Venv launcher confirmed in the uploaded `pipeline/venv`. **The Windows window itself could not be observed here (no Windows).** The fix removes the cause; see Known limitations. |
| 4 | Earthdata command "almost invisible" | `.forest-login-note code` used the light token `--bg-elevated` (#FBFAF6) while inheriting the page's light text (#edf4f1): **1.07:1** contrast. The forest stylesheet used light-theme tokens throughout a near-black page. | Contrast computed from the CSS values; a browser contrast audit flags it on the upload and finds 0 problems after. |
| 5 | `npm run build` failing | 3 TypeScript errors: wrong import path for `ProcessingProgress` (also causing an implicit `any`), and a `string` assigned to a union-typed state in `wetland/Drawers.tsx`. | `tsc` on upload and on GitHub `Rubai-dev`; the build stops at type-check. |
| 6 | Latent lint error | ESLint passed only because the React Compiler lint could not analyse `ForestWorkflowControls`; once it could, it flagged an effect that copies a prop into state. | Fixed with React's render-phase "adjust state when a prop changes" pattern, no suppression. |
| 7 | Failed jobs said only "FAILED" | The worker recorded one line of error text. No stage, traceback, guidance or log; jobs could stay `RUNNING` forever; orphan run folders were left behind. | Real job records in the upload. |

## B. What changed, by area

### Forest pipeline (Python)
- `pipeline/forest_workflow.py` (modified): `_grid_of`/`_same_grid` accept datasets or profiles (Rasterio `Profile` is a `UserDict`, handled through `Mapping`); `manifest` self-reference removed; `run_worker` rewritten so every outcome (including a malformed request) ends in `COMPLETE`/`FAILED`/`CANCELLED`; failed attempts leave a `failure.json` marker and lose their intermediate rasters; the last good result is never touched; new `coverage` action (`scan_coverage`); discovery now also returns `seriesOptions`; new `auth-check` and `environment` commands; `FOREST_OUTPUT_DIR` override (default unchanged).
- `pipeline/forest_jobs.py` (new): job recorder (heartbeat, cancel marker file, fresh record per job so nothing is inherited), sanitiser (tokens, bearer values, credentials in URLs, project and user paths), failure guidance chosen from the real exception.

### Forest API and UI (TypeScript)
- `src/app/api/forest/workflow/route.ts` (rewritten): preflight (finds a working Python, checks required packages) so an unusable environment is reported in the app; spawn options per OS (Windows: attached and hidden, never detached); stdout/stderr captured to a per-job log; unexpected worker exit recorded; `STALLED` detection from pid and heartbeat; `cancel` action; sanitised log tail returned.
- `src/app/api/forest/auth/route.ts` (new): a real, non-interactive Earthdata check through the project's own `earthaccess` flow.
- `src/lib/forest-runtime.ts`, `forest-job.ts`, `forest-coverage.ts` (new): pure helpers with unit tests.
- Components (new): `ForestEarthdataConnection`, `ForestJobStatus`, `ForestCoverageExplorer`, `ForestCoverageCalendar`, `useForestJob`.
- `ForestWorkflowControls.tsx` (modified): hosts the new panels, a three-step flow (find area, define area and dates, connect Earthdata), `CANCELLED`/`STALLED` as terminal states, no stale progress, discovery calendar and a plain-language verdict, oversized-area warning before a job exists.
- `forest.css` (modified): dark-theme token overrides scoped to the forest workbench (fixes the unreadable notes and run picker), styles for the new panels, wrapping of long scene IDs, responsive grid fix.

### Shared wetland / NISAR code: 2 files, 4 changed lines
- `src/components/global/GlobalDetectionsExplorer.tsx`: import `ProcessingProgress` from `@/lib/processing-progress` (where it is defined).
- `src/components/wetland/Drawers.tsx`: validate the export-format `<select>` value before setting union-typed state.
No wetland detector, threshold, saved-run, HLS reference or pipeline file was modified (`git diff` against `Rubai-dev` shows `pipeline/requirements.txt` as the only non-forest pipeline file, and that `+requests` line was already in the uploaded work).

### Test tooling
- `package.json`: the `test` script now also runs `forest-analysis.test.ts` (which was silently excluded), `forest-job.test.ts`, `forest-coverage.test.ts`.
- `tests/e2e/forest_smoke.py`, `forest_saved_run_smoke.py`, `make_forest_fixture_run.py`, `contrast_audit.fn.txt` (new).

## C. Forest-specific versus shared
Forest-specific: everything under `pipeline/forest_*`, `pipeline/test_forest_*`, `src/*/forest*`, `src/app/api/forest/**`, `src/components/forest/**`, `tests/e2e/forest_*`.
Shared: the two one-line type fixes above, and `package.json` (test list only).

## D. Design decisions worth knowing
- **Catalog records are never presented as results.** Every coverage answer states its geographic and temporal scope, that nothing was downloaded, and that it says nothing about other places or dates. Coverage uses NASA's public CMR (no login); downloads need Earthdata.
- **No mocks in the shipped app.** Synthetic fixtures exist only in tests and temporary folders (see the test report for exactly which test used what).
- **Cancellation is a separate file**, because the worker rewrites its job file every heartbeat and would erase a flag stored inside it.
