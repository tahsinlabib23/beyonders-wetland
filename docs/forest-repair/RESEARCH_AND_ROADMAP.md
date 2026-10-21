# Research findings and roadmap

Facts are marked **[official]** (NASA / ASF DAAC / earthaccess / ESA documentation read this session), **[secondary]** (third-party pages quoting official
specifications) or **[inference]** (my reasoning). Nothing here is a claim about a specific place being observable.

## What the documentation says, and how the app uses it
1. **[official] NISAR L2 GCOV** (ASF DAAC NISAR documentation and the NASA SDS product specification D-102274): geocoded polarimetric covariance, radiometrically
   terrain-corrected (gamma-naught normalised) on a map grid; each frequency group carries per-polarisation terms such as `HHHH`/`HVHV`, plus `numberOfLooks`
   and a `mask`. -> The pipeline reads `HHHH`/`HVHV`, the looks layer and the quality mask; the app labels the product **provisional**.
2. **[official] Catalog search is separate from authenticated download.** earthaccess documents three login strategies (`environment`, `netrc`,
   `interactive`, with `persist=True` writing `~/.netrc`, or `~/_netrc` on Windows) and notes CMR metadata queries can be made without logging in.
   -> The coverage scan uses the public catalog only; the Earthdata panel is about downloads and says so; there is one authentication system (the project's own
   `forest_workflow.py login`, read back by `auth-check`).
3. **[official] ESA WorldCover 2021 v200**: 10 m global map for reference year 2021; class 10 = tree cover (at least 10% canopy), class 95 = mangroves; reported
   global overall accuracy around 77%; the producers advise against comparing versions as a change product. -> The app states the mask is static 2021 and not a forest inventory.
4. **[secondary, two sources citing the HLS v2.0 User Guide] Fmask bits**: 1 cloud, 2 adjacent to cloud/shadow, 3 cloud shadow, 4 snow/ice, 5 water, 6-7 aerosol level.
   I checked `forest_optical_reference.py`: it excludes bits 1-4 and high aerosol, matching this layout. Not re-read from the original HLS guide.
5. **[inference]** Repeat-pass anomaly screens need several compatible dates; NISAR's public provisional archive is still short, so "not enough dates in one stack"
   will be a common honest answer. That is why the coverage scan reports stacks and gaps, not just "yes/no".

## Implemented in this package (chosen for value, scientific validity and testability)
| Idea from the brief | Delivered |
|---|---|
| Find an observable area | Place search then a public-catalog scan around it, grouped into compatible stacks with date counts; "Use this area" proposes a pipeline-sized box inside a stack's footprint |
| Coverage calendar | True-time axis, catalog-listed acquisitions, labelled gaps, "enough / needs N more", never implies download |
| Guided first analysis | Steps: find area, define area and dates, connect Earthdata, run; plain-language verdict |
| Why was this area flagged / uncertainty | Already in the workbench; confirmed working on a completed run (evidence, alternatives, limitations) |
| Shareable analysis record | Already present (report JSON, CSV, GeoJSON); verified by parsing real downloads |
| Honest failure | Stage, cause, next step, sanitised log, copyable diagnostics |

## Not implemented (and why)
- Choosing a *different* stack than the one discovery picked (needs per-option scene IDs in discovery output and a selection UI).
- Drawing stack footprints on the map and picking by click (the data are already returned; map interaction needs its own testing).
- Optical context per candidate beyond what the workbench already shows; terrain, soil-moisture or rainfall context layers (new data sources, new provenance to document).
- Real-data end-to-end verification (needs your credentials and network): the first thing to do after integrating.

## Prioritised roadmap
**P0 (before relying on results)**
1. On Windows, run: Test connection, Discover on a small area, Coverage search, then a real 3+ date run; keep `pipeline/output/forest/jobs/*.log` if anything fails.
2. Add CI (GitHub Actions): Python unittest, `npm test`, `tsc`, `eslint`, `next build`, and the two forest e2e scripts against the fixture. Everything needed already exists.
3. Repair or retire the 16 stale wetland/explore e2e expectations (a deliberate, reviewed edit, not done here).

**P1 (high user value, moderate effort)**
4. Stack chooser and map footprints for the coverage results.
5. Failed-attempt history entries (the data already exists in job records).
6. Uncertainty layer: number of looks and valid fraction as a map overlay beside candidates.

**P2 (scientific depth, needs design and evidence)**
7. Season-matched baselines when more repeat cycles exist; report baseline spread per candidate.
8. Terrain and moisture confounder panels with their own provenance.
9. A "how would this conclusion change if..." explorer over detector thresholds using the stored sensitivity sweep.

**P3**
10. Windows launcher script so no terminal is needed; token-based Earthdata login for non-interactive environments.
11. Cached, dated catalog snapshots so a coverage answer can be reproduced later.
