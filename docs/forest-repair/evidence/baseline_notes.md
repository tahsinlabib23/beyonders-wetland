# Baseline (before any change)
- Upload: geonexsar.zip sha256 9b1724590ec7a02c49ca82b641ac254207c7b32683ea3f86d427795531569c3f (kept immutable at /home/claude/forest/original)
- ZIP HEAD tree == GitHub Rubai-dev HEAD tree (3981ec6, "Initial project upload"); identical git tree hash.
- 145 files "modified" in the ZIP = 139 CRLF-only (Windows checkout; repo blobs are LF) + 6 real edits:
  pipeline/requirements.txt, src/app/forest/page.tsx, src/components/global/{GlobalDetectionsExplorer,NisarProcessingPanel}.tsx,
  src/components/wetland/WetlandExperience.tsx, src/phenomena/registry.ts
- Untracked forest module: pipeline/forest_{analysis,optical_reference,previews,workflow}.py + 3 tests, src/app/api/forest/*, src/components/forest/*, src/lib/forest-analysis(.test).ts, 2 docs.
- ZIP also bundles bulk that must not ship: pipeline/venv (614MB), .next (99MB), pipeline/output (93MB local forest runs).
- Python: compileall OK; unittest discover = 56 tests OK (2 skipped).
- ESLint: 0 problems in ZIP (GitHub baseline: 4 errors, 3 warnings -> user's attempted fixes cleared them).
- tsc: 3 errors (identical on GitHub baseline): GlobalDetectionsExplorer.tsx ProcessingProgress import + implicit any 'current'; wetland/Drawers.tsx:392 SetStateAction.
- next build: FAILS at type-check on those 3 errors (+3 Turbopack spawn-tracing warnings).
- npm test: 34/34 pass, but script omits src/lib/forest-analysis.test.ts.
- npm ci fails on Linux (lockfile lacks optional @emnapi entries) - pre-existing; npm install used, lockfile restored.
- Real failed jobs in pipeline/output/forest/jobs: 2x "'DatasetReader' object is not subscriptable", 2x "cannot access local variable 'manifest'..."; jobs store only a one-line error (no traceback/stage).
