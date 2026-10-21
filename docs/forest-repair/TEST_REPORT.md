# Test report

Environment: Linux sandbox, Python 3.12.3, Node 22.22.2, Chromium via Playwright. **No Windows, no internet access to NASA services,
no Earthdata credentials.** Your venv is Python 3.14.3 on Windows; neither was available. Every number below was observed in this
session; nothing is carried over from earlier attempts.

**Final verification was repeated on a fresh GitHub clone of `Rubai-dev` (commit 3981ec6) with this overlay applied and no `pipeline/output`**
(`git status` there: exactly 57 new + 8 modified files and nothing else; the manifest file added afterwards makes it 58 + 8). Results: Python 104 OK (2 skipped), `npm test` 56/56, `tsc` 0 errors,
ESLint 0, `next build` OK, `forest_smoke.py` 54/54, `forest_saved_run_smoke.py` 39/39. Raw outputs: `evidence/final_*.txt`.
The wetland/explore regression comparison (section 3) was run on the working copy, whose files are byte-identical to the overlay.

## 1. Static checks and unit tests: before and after

| Check | Command | Uploaded state | Final |
|---|---|---|---|
| Python compile | `python -m compileall -q pipeline` | OK | OK |
| Python tests | `python -m unittest discover -s pipeline -p "test_*.py"` | 56 tests OK (2 skipped) | **104 tests OK (2 skipped)** |
| Node unit tests | `npm test` | 34 pass (forest-analysis tests were not in the script) | **56 pass, 0 fail** |
| TypeScript | `npx tsc --noEmit` | **3 errors** | **0** |
| ESLint | `npx eslint` | exit 0 (but see change report item 6) | **exit 0, 0 problems** |
| Production build | `npm run build` | **FAILS** at type-check | **passes** |

The 2 skipped Python tests need a local legacy NISAR run and skip on any checkout without `pipeline/output`. They are not new skips.
New Python tests: 18 end-to-end worker tests, 19 job/sanitiser/Earthdata-check tests, 11 coverage-scan tests (48 new).
Node tests added to the script: 10 job helpers (new), 7 coverage logic (new), and the 5 existing forest-analysis tests that the old script never ran (34 + 22 = 56).

## 2. Reproduction of the reported errors (on the unmodified code)
`pipeline/test_forest_run_integration.py` was run **before** any fix: `UnboundLocalError` ('manifest') from a complete worker run, and
`TypeError: 'DatasetReader' object is not subscriptable` from the grid helper. Both now pass as regression tests. A static test also
fails if any forest module subscripts a dataset opened with `with rasterio.open(...) as ds`.

## 3. Browser tests (production build, real Chromium)

| Suite | What it drives | Result |
|---|---|---|
| `tests/e2e/forest_smoke.py` | Part A: real app, real API routes, real Python worker. Part B: UI states from hand-made API responses | **54/54**, no application errors |
| `tests/e2e/forest_saved_run_smoke.py` | A completed run built by the real worker (synthetic inputs) served through the real routes, plus stalled/cancel API checks | **39/39**, no application errors |
| `tests/e2e/wetland_smoke.py` (existing) | Wetland experience | 59/71 here; **identical set of 16 failing checks as the uploaded state** |
| `tests/e2e/explore_smoke.py` (existing) | Landing and Explore | 19/23; same failing checks as the uploaded state |

The comparison was done by diffing the exact check names: **no check fails after my changes that did not already fail before.**
Those pre-existing failures were *not* repaired or edited: the scripts predate the forest module being switched on (`/forest` used to be a
briefing page; the registry now marks Forests available), the landing/pin features they look for, and one timing-dependent check (the
store autoplays the timeline when the showcase loads, so "295 regions at the peak" depends on timing). I did not root-cause each one.

## 4. Which evidence is which

| Step in your 20-step workflow | How it was validated |
|---|---|
| 1 Open forest page | Real app (A1) |
| 2 Search place, select area | Real geocode route: honest error offline (A19). Result list/selection with a **fixture** geocoder response (B1) |
| 3 Bounding box / boundary handling | Unit tests + oversized-area warning in the browser (A21). Uploading a GeoJSON boundary is covered by the existing Python tests; **not driven in a browser** |
| 4 Query the live NISAR catalog | **NOT VERIFIED.** The sandbox cannot reach NASA CMR. Real worker, real code path: fails with network guidance and diagnostics (A9-A18) |
| 5-6 Dates, compatibility, insufficient data | Grouping/verdict logic by unit tests and a fixture catalog (Python `test_forest_coverage`, Node `forest-coverage`, B2-B11) |
| 7 Earthdata status | Real `earthaccess`, no credentials: reports `not_connected` (A2-A8). The `connected` path only with a mocked `earthaccess` |
| 8-9 Authenticated download of real data | **NOT VERIFIED** (no credentials, no network) |
| 10 Extract raster channels | **Synthetic**: extraction functions were replaced by fakes that write GeoTIFFs. The real HDF5 extractors are covered only by the pre-existing suite |
| 11-12 Metadata, grid alignment, mask, nodata, detector | **Real code on synthetic rasters** (mixed grids force both the same-grid and reprojection paths) |
| 13 Radar previews | Real preview code on synthetic rasters; browser loads the image overlays and HH/HV switching (C16-C17); a missing preview answers 404 with no placeholder (C18) |
| 14-15 Timeline, candidates, evidence | Fixture run through real routes and UI (C7-C15) |
| 16 Reports and exports | Real downloads, parsed: report JSON, candidate CSV, GeoJSON (C19-C22) |
| 17 Save and reopen | C23, C31, C32 |
| 18 Blocked / failed / interrupted / cancelled | Blocked: integration test. Failed at 6 different stages: integration tests. Cancelled: worker test + API (C34-C36) + UI (B12-B14). Interrupted: stale-job API (C33). A real `kill` of a running worker was **not** performed |
| 19 Failed run preserves last good run | Integration tests and browser (C1-C4) |
| 20 Diagnostics explain, not just "FAILED" | A9-A15, B15, C4 |

Evidence classes in the brief's terms: (1) synthetic fixtures: most of the above; (2) actual local NISAR data files: **none were run**
(the uploaded `pipeline/output/forest/runs` contains rasters from your earlier real downloads but no completed analysis; I did not
build anything from them); (3) live public catalog: **none**; (4) authenticated downloads: **none**; (5) independent optical data:
**none**; (6) ground truth: none exists.

## 5. Accessibility and layout
- Contrast audit of every text element on the forest page (empty state and completed-run state): 0 below WCAG AA. The same audit run on the uploaded
  build finds the login command at **1.07:1**, so the check can fail.
- Login command: **16.99:1**. Keyboard: Test connection reachable by Tab with a visible focus ring (A22). All controls have accessible names (C29).
- No horizontal overflow at 1440, 1280, 1100, 1000, 820, 768 and 390 px with and without a completed run.
- Not tested: screen-reader output, real touch devices, Safari/Firefox.

## 6. How to re-run
```
python -m unittest discover -s pipeline -p "test_*.py"
npm test && npx tsc --noEmit && npx eslint && npm run build
PYTHON=pipeline/venv/bin/python npx next start -p 3140     # Windows: $env:PYTHON="pipeline\venv\Scripts\python.exe"
python tests/e2e/forest_smoke.py http://localhost:3140
python tests/e2e/make_forest_fixture_run.py /tmp/forest_fixture/forest   # absolute path; then restart with FOREST_OUTPUT_DIR set to it
python tests/e2e/forest_saved_run_smoke.py http://localhost:3140 /tmp/forest_fixture/forest
```
Fixture folders are throwaway test data. Never copy them into `pipeline/output`.
