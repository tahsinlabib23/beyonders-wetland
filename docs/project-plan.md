# Project plan

## Release goal

Provide a public NISAR Earth-change viewer with a reproducible, operator-managed wetland/flood module and a separate volcano directory/reference-case module. Preserve the global coverage distinction: imagery, volcano locations, and footprints are observations/context; detector polygons exist only for processed studies; blanks indicate no result. Volcanoes have no project-run deformation detector yet; earthquakes and prediction remain deferred.

## Three-week sequence

1. **Days 1–3: baseline.** Inventory app, APIs, Python dependencies, run provenance, science claims and current case evidence. Freeze the detector and define independent evaluation rules.
2. **Days 4–7: disagreement investigation.** Inspect radar-only candidates, masks, baseline water, acquisition alignment, season/date offset and HLS common-clear coverage. Record findings before changing thresholds.
3. **Days 8–11: methods and package.** Keep v1 outputs intact, evaluate any baseline-water screen as a separately versioned diagnostic, run an independent case only when compatible NISAR and reference scenes exist, and package complete runs with checksums.
4. **Days 12–15: public viewer.** Read only published packages, suppress local processing and pixel sampling, check map/date/study state, external service failures and small screens.
5. **Days 16–21: release.** Reproduce a study, check privacy and package checksums, deploy the viewer, document rollback and publish limitations.

## Scientific release gate

Report cross-sensor coverage, date offsets and native-grid/area-supported metrics. The 20% common-clear-area threshold determines whether a comparison can be scored; it does not establish accuracy or ground truth. Do not use HLS reference labels used for final evaluation to create a baseline-water exclusion. Keep the prior rule as a comparator. If a case disagrees, report the disagreement and narrow the claim to unverified radar-change candidates.

## Current evidence and blockers

- Hakaluki September 27 HLS comparison: 50.7% study-mask common-clear area, F1 0.074 (precision 0.129; recall 0.052). Of 773 radar-only cells, 637 were water on both HLS dates. This does not support a confirmed new-flood claim.
- Tanguar August 29: 0.34% common-clear study area. The check is inconclusive; its nominal overlap metrics are not reportable.
- NASA CMR returned two compatible Chókwè NISAR GCOV BETA scenes (January 5 and 17, 2026). No matching PROVISIONAL series was found. Do not mix BETA with PROVISIONAL or call the new location detector-validated until it is processed and independently assessed.
- Local deployment has not happened yet. This machine's approval reviewer stopped the beta-scene download/process command before execution. The user will publish the repository themselves.

## Done means

A fresh browser can explore published studies with no local worker running; the scientific report distinguishes measured quantities from interpretation; complete packages have provenance and verifiable checksums; a developer can reproduce the local flow; failures preserve prior results; a rollback is documented. A deployment URL and a supported flood claim remain open until the user deploys and evidence supports the claim.
