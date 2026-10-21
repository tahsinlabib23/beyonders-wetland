# Baseline inventory (before any change)

- Upload: `geonexsar.zip`, SHA-256 `9b1724590ec7a02c49ca82b641ac254207c7b32683ea3f86d427795531569c3f`, kept unmodified; all work was done in separate copies.
- Contents: 15,812 files, 875 MB. Source is ~360 files; the rest is bulk that does **not** belong in a commit: `pipeline/venv` (614 MB, a Windows venv on Python 3.14.3), `.next` (99 MB), `pipeline/output` (93 MB of your forest downloads and jobs), `.git` (29 MB).
- The ZIP's `.git` is on branch `Rubai-dev` at commit `3981ec6` ("Initial project upload"). I cloned `Rubai-dev` from GitHub separately: its tree hash is **identical** to the ZIP's `HEAD` tree, so the upload is exactly that commit plus uncommitted work.
- 145 files showed as "modified": 139 are only Windows CRLF line endings (repository blobs are LF). Real content changes in the upload: `pipeline/requirements.txt` (+`requests`), `src/app/forest/page.tsx` (briefing replaced by the workbench), `src/phenomena/registry.ts` (Forests marked available), `GlobalDetectionsExplorer.tsx`, `NisarProcessingPanel.tsx`, `WetlandExperience.tsx`.
- Untracked forest module (your local work): `pipeline/forest_{analysis,optical_reference,previews,workflow}.py` and 3 tests, `src/app/api/forest/*`, `src/components/forest/*`, `src/lib/forest-analysis(.test).ts`, two Markdown guides.
- Existing wetland and shared NISAR components: `src/components/wetland/*`, `src/components/global/*`, `src/app/api/wetland/*`, `pipeline/*.py` (detector, spatial and temporal analysis, HLS reference, exporter), `public/showcase/featured` (real Tanguar Haor case). **None of these were modified** except the two one-line fixes listed in the change report.
- Your real forest jobs (in `pipeline/output/forest/jobs`): two failed with the `DatasetReader` error and two with the `manifest` error. Their records contained only a single error line.

## Baseline results
| Check | Result |
|---|---|
| `python -m compileall` | OK |
| Python tests | 56 OK (2 skipped) |
| `eslint` | 0 problems (GitHub `Rubai-dev` itself: 4 errors, 3 warnings) |
| `tsc --noEmit` | 3 errors (same 3 on GitHub `Rubai-dev`) |
| `next build` | fails at type-check |
| `npm test` | 34/34 (forest-analysis tests excluded from the script) |
| wetland / explore e2e | 59-60 of 71 and 19 of 23 (dev server; one timing-dependent check varies between runs) |
