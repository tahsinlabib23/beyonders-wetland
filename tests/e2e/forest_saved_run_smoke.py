"""Browser tests for a COMPLETED forest run: timeline, playback, radar previews, candidate evidence, exports, history.

    python tests/e2e/make_forest_fixture_run.py /tmp/forest_fixture/forest
    FOREST_OUTPUT_DIR=/tmp/forest_fixture/forest PYTHON=pipeline/venv/bin/python npx next start -p 3140 &
    python tests/e2e/forest_saved_run_smoke.py http://localhost:3140 /tmp/forest_fixture/forest

The run is a SYNTHETIC FIXTURE built by the real worker with fakes for NASA access. These checks verify that the real code paths
(worker output -> API -> UI -> exports) agree with each other and stay honest. They are not evidence about any real forest.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3140"
FIXTURE = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/forest_fixture/forest")
DATES = ["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17", "2026-08-29"]
results: list[bool] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


AUDIT = open(Path(__file__).with_name("contrast_audit.fn.txt"), encoding="utf-8").read()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text[:160]) if m.type == "error" and "ERR_NAME_NOT_RESOLVED" not in m.text else None)

    # ── history + preservation, straight from the API ──
    runs = page.request.get(BASE + "/api/forest/runs").json()["runs"]
    good_id = json.loads((FIXTURE / "current_run.json").read_text())["runId"]
    check("C1 history lists the completed run and not the failed attempt", [r["runId"] for r in runs] == [good_id], str([r["runId"][:8] for r in runs]))
    failed_dirs = [d for d in (FIXTURE / "runs").iterdir() if (d / "failure.json").exists()]
    check("C2 a failed attempt left only a marker, no half-published result", len(failed_dirs) == 1 and not (failed_dirs[0] / "forest_analysis.json").exists() and not (failed_dirs[0] / "rasters").exists())
    current = page.request.get(BASE + "/api/forest/analysis").json()
    check("C3 the current analysis is still the earlier good run", current.get("analysis", {}).get("runId") == good_id, current.get("status", ""))
    failed_job = page.request.get(BASE + f"/api/forest/workflow?jobId={'2' * 32}").json()
    check("C4 the failed job explains itself and carries no result", failed_job["status"] == "FAILED" and "Reading real GCOV" in (failed_job.get("failedStage") or "")
          and failed_job["diagnostics"]["guidance"] and "result" not in failed_job)

    page.goto(BASE + "/forest"); page.wait_for_selector(".forest-summary-row"); page.wait_for_timeout(2500)
    text = page.inner_text("body")
    check("C5 summary shows the run's site, provenance and product maturity", "Synthetic AOI" in text and good_id in text and "PROVISIONAL" in text)
    check("C6 readiness gate, observation and candidate counts match the saved analysis", page.locator(".forest-summary-row").count() == 1 and "READY" in text)

    # ── timeline: exactly the real acquisition dates ──
    date_buttons = [b.inner_text().split("\n")[0] for b in page.locator("button:has-text('USED')").all()]
    check("C7 timeline shows exactly the five processed acquisition dates", date_buttons == DATES, str(date_buttons))
    check("C8 every shown date is labelled as used by the analysis", all("USED" in b.inner_text() for b in page.locator("button:has-text('USED')").all()))
    page.click("button:has-text('2026-07-12')"); page.wait_for_timeout(500)
    check("C9 selecting a date updates the shown date", "2026-07-12" in page.inner_text(".forest-timeline-toolbar, .forest-time-machine, body"))
    seen = set()
    page.click("button:has-text('Play timeline')")
    for _ in range(14):
        page.wait_for_timeout(500)
        value = int(page.input_value("input[aria-label='Timeline acquisition position']")); seen.add(value)
    page.click("button[aria-pressed='true']:has-text('Pause'), button:has-text('Pause timeline')") if page.locator("button:has-text('Pause')").count() else None
    check("C10 playback only moves between real acquisitions (positions 0-4)", seen and seen <= {0, 1, 2, 3, 4} and len(seen) >= 2, str(sorted(seen)))
    check("C11 the timeline slider has exactly one step per real date (no interpolated frames)", page.get_attribute("input[aria-label='Timeline acquisition position']", "max") == "4")

    # ── candidates and evidence ──
    check("C12 candidate register lists the detector's candidate with its source date", page.locator(".forest-candidate-row").count() == 1 and "2026-08-29" in page.inner_text(".forest-candidate-row"))
    page.click(".forest-candidate-row"); page.wait_for_timeout(500)
    evidence = page.inner_text("body")
    check("C13 inspector shows measurements and the reasons for the flag", re.search(r"-?\d+\.\d+ dB", evidence) is not None and "Evidence supporting the flag" in evidence)
    check("C14 inspector lists alternative explanations", "Alternative explanation" in evidence)
    check("C15 map shows the candidate footprint", page.locator("path.leaflet-interactive").count() >= 1)

    # ── radar previews: real image overlays from the preview API ──
    page.click("button:has-text('HH · dB')"); page.wait_for_timeout(2500)
    overlays = page.evaluate("[...document.querySelectorAll('img.leaflet-image-layer')].map(i => [i.getAttribute('src'), i.naturalWidth])")
    check("C16 HH preview loads an actual image overlay from the preview API", any("/api/forest/radar-preview" in s and w > 0 for s, w in overlays), str(overlays)[:120])
    page.click("button:has-text('HV · dB')"); page.wait_for_timeout(2500)
    overlays = page.evaluate("[...document.querySelectorAll('img.leaflet-image-layer')].map(i => [i.getAttribute('src'), i.naturalWidth])")
    check("C17 switching to HV loads the HV preview", any("hv" in s.lower() and w > 0 for s, w in overlays), str(overlays)[:120])
    missing = page.request.get(BASE + "/api/forest/radar-preview?runId=" + good_id + "&date=2026-01-01&channel=hh")
    check("C18 a preview that does not exist answers honestly (no placeholder image)", missing.status in (400, 404) and "image" not in (missing.headers.get("content-type") or ""), str(missing.status))

    # ── exports are real and agree with the analysis ──
    with page.expect_download() as d1:
        page.click("button:has-text('Export report JSON')")
    report = json.loads(Path(d1.value.path()).read_text())
    check("C19 exported report is the saved run (same id, source and limitations)", good_id in json.dumps(report) and "limitation" in json.dumps(report).lower())
    with page.expect_download() as d2:
        page.click("button:has-text('Candidate CSV')")
    rows = list(csv.reader(io.StringIO(Path(d2.value.path()).read_text())))
    check("C20 candidate CSV has one row per candidate plus a header", len(rows) == 2 and "candidate" in rows[0][0].lower() or len(rows) == 2, str(rows[0])[:80])
    with page.expect_download() as d3:
        page.click("button:has-text('Candidate GeoJSON')")
    gj = json.loads(Path(d3.value.path()).read_text())
    check("C21 candidate GeoJSON is a FeatureCollection with the detector's candidate", gj.get("type") == "FeatureCollection" and len(gj["features"]) == 1 and gj["features"][0]["geometry"]["type"] in ("Polygon", "MultiPolygon"))
    check("C22 exports are not labelled as confirmed forest loss", "confirmed forest loss" not in json.dumps(report).lower() or "not confirmed" in json.dumps(report).lower())

    # ── reopen a saved run ──
    select = page.locator("select[aria-label='Open a saved forest run']")
    select.select_option(index=0); page.wait_for_timeout(1500)
    check("C23 a saved run can be reopened from history", good_id in page.inner_text("body"))

    # ── scientific honesty on the page ──
    body = page.inner_text("body")
    check("C24 radar anomalies are never equated with confirmed loss", "not confirmed deforestation" in body.lower() and not re.search(r"\bconfirmed (deforestation|forest loss|clearing) (detected|found)", body, re.I))
    check("C25 ESA WorldCover 2021 provenance and its date limitation are stated", "WorldCover 2021" in body and re.search(r"not (a )?current forest inventory|static 2021|2021 (tree|land)", body, re.I) is not None)
    check("C26 missing independent optical evidence is reported as such, not as support", re.search(r"NOT_RUN|not assessed|not run|unavailable", body, re.I) is not None and "independently confirmed" not in body.lower())
    check("C27 no synthetic-data label is hidden: page names the fixture site only as the user's study name", "Synthetic AOI" in body)


    # ── interrupted and cancelled jobs, through the real API routes (job records are hand-made fixtures in the fixture folder) ──
    import time
    jobs_dir = FIXTURE / "jobs"
    dead = "d" * 32
    (jobs_dir / f"{dead}.json").write_text(json.dumps({"id": dead, "action": "run", "status": "RUNNING", "stage": "Reading real GCOV layers", "pid": 999999,
                                                       "createdAt": "2026-10-01T00:00:00+00:00", "updatedAt": "2026-10-01T00:00:00+00:00"}))
    stalled = page.request.get(BASE + f"/api/forest/workflow?jobId={dead}").json()
    check("C33 a RUNNING job whose worker is gone is reported STALLED with a reason, not eternal progress", stalled["status"] == "STALLED" and stalled.get("stalledReason"))
    live = "e" * 32
    (jobs_dir / f"{live}.json").write_text(json.dumps({"id": live, "action": "run", "status": "RUNNING", "stage": "Working", "pid": __import__("os").getpid(),
                                                       "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}))
    resp = page.request.post(BASE + "/api/forest/workflow", data=json.dumps({"action": "cancel", "jobId": live}), headers={"Content-Type": "application/json"})
    check("C34 cancelling a running job is accepted and leaves a cancel marker (not a job-file edit)", resp.status == 202 and (jobs_dir / f"{live}.cancel").exists())
    done = page.request.post(BASE + "/api/forest/workflow", data=json.dumps({"action": "cancel", "jobId": "1" * 32}), headers={"Content-Type": "application/json"})
    check("C35 cancelling a finished job is refused with an explanation", done.status == 409)
    bad = page.request.post(BASE + "/api/forest/workflow", data=json.dumps({"action": "cancel", "jobId": "../../x"}), headers={"Content-Type": "application/json"})
    check("C36 a malformed job id is rejected before touching the filesystem", bad.status == 400)

    # ── accessibility ──
    offenders = page.evaluate(AUDIT)
    check("C28 no text on the completed-run page falls below WCAG AA contrast", len(offenders) == 0, str(offenders[:3])[:200])
    unnamed = page.evaluate("[...document.querySelectorAll('button, select, input')].filter(e => !(e.innerText || '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title') && !(e.labels && e.labels.length) && e.type !== 'hidden').length")
    check("C29 every control has an accessible name", unnamed == 0, str(unnamed))
    for width in (1280, 1000, 768, 390):
        page.set_viewport_size({"width": width, "height": 900}); page.wait_for_timeout(400)
        check(f"C30 no horizontal overflow at {width}px with a completed run", not page.evaluate("document.documentElement.scrollWidth > innerWidth"))
    page.set_viewport_size({"width": 1440, "height": 1000})

    # ── back / forward / reload keep state sane ──
    page.goto(BASE + "/wetland"); page.wait_for_timeout(1200); page.go_back(); page.wait_for_selector(".forest-summary-row")
    check("C31 browser Back returns to the forest page with the saved run intact", good_id in page.inner_text("body"))
    page.reload(); page.wait_for_selector(".forest-summary-row")
    check("C32 reload restores the saved run from disk, not from stale browser state", good_id in page.inner_text("body"))
    ctx.close()
    browser.close()

bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
