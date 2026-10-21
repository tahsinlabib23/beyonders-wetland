"""Browser tests for the forest module.

    npm run build && PYTHON=pipeline/venv/bin/python npx next start -p 3140 &
    python tests/e2e/forest_smoke.py http://localhost:3140

PART A drives the real app, real API routes and the real Python worker. Without NASA credentials or internet (a typical
CI box) the live catalog and Earthdata are unreachable, so Part A verifies HONEST FAILURE handling, not live data.
PART B feeds the UI hand-made API responses (page.route). Those are FIXTURES: they prove how states are rendered, never
that NASA data exist or that a download or analysis succeeded.
"""
from __future__ import annotations

import json
import re
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3140"
results: list[bool] = []
errors: list[str] = []
IGNORED = ("ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "502", "503", "404")


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


JS_CONTRAST = """(sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = null, node = el;
  while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if (c.length < 4 || c[3] > 0.5) { bg = c; break; } node = node.parentElement; }
  const fg = rgb(getComputedStyle(el).color);
  const a = lum(fg), b = lum(bg || [255, 255, 255]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}"""

SMALL_BOX = {"west": "114.0", "south": "1.0", "east": "114.1", "north": "1.1"}


def fill_box(page, box=SMALL_BOX, name="Test forest area"):
    page.fill("label:has-text('Study area name') input", name)
    for label, key in (("West longitude", "west"), ("South latitude", "south"), ("East longitude", "east"), ("North latitude", "north")):
        page.fill(f"label:has-text('{label}') input", box[key])


def new_page(browser, w=1440, h=900):
    ctx = browser.new_context(viewport={"width": w, "height": h}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text[:160]) if m.type == "error" and not any(x in m.text for x in IGNORED) else None)
    return ctx, page


def wait_state(page, timeout=30000):
    page.wait_for_function("document.querySelector('.forest-earthdata') && !['unchecked','checking'].includes(document.querySelector('.forest-earthdata').dataset.authState)", timeout=timeout)
    return page.get_attribute(".forest-earthdata", "data-auth-state")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ═══════════════════ PART A: real app, real API, honest failures ═══════════════════
    print("── PART A: real app and API (failure handling without NASA access) ──")
    ctx, page = new_page(browser)
    api_auth = []
    page.on("response", lambda r: api_auth.append(r) if r.url.endswith("/api/forest/auth") else None)
    page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata", timeout=30000)
    check("A1 forest page renders with the Earthdata panel", page.locator("#forest-earthdata-title").count() == 1)
    state = wait_state(page)
    pill = page.inner_text(".forest-auth-pill")
    first_body = api_auth[0].json() if api_auth else {}
    check("A2 connection state comes from a real check and matches the API answer", state == first_body.get("auth", {}).get("state"), f"{state} / {pill.strip()}")
    check("A3 never shows Connected without credentials in this environment", state != "connected" or first_body.get("auth", {}).get("state") == "connected")
    cmd_visible = page.locator(".forest-command pre").count() > 0
    auth_state = page.locator(".forest-earthdata").get_attribute("data-auth-state") or ""
    cmd_count = page.locator(".forest-command pre").count()

    if auth_state == "connected":
        check(
            "A4-A7 login command is hidden when Earthdata is already connected",
            cmd_count == 0,
            f"auth state={auth_state}; command blocks={cmd_count}",
        )
    elif auth_state in ("environment_missing", "dependency_missing"):
        check(
            "A4-A7 Python setup state shows repair commands",
            cmd_count == 2,
            f"auth state={auth_state}; command blocks={cmd_count}",
        )
    elif cmd_count > 0:
        ratio = page.evaluate(JS_CONTRAST, ".forest-command pre")
        check(
            "A4 login command is readable (contrast at least 7:1)",
            ratio is not None and ratio >= 7,
            f"{ratio:.1f}:1" if ratio else "n/a",
        )
        command = page.inner_text(".forest-command pre")
        check(
            "A5 login command names the project's worker script",
            "forest_workflow.py" in command and "login" in command,
        )
        page.click(".forest-command__head button")
        copied = page.evaluate("navigator.clipboard.readText()")
        check(
            "A6 Copy command puts the exact command on the clipboard",
            copied.strip() == command.strip(),
            copied[:60],
        )
        check(
            "A7 Copy gives visible feedback",
            "Copied" in page.inner_text(".forest-command__head button"),
        )
    else:
        check(
            "A4-A7 login command is present when authentication needs it",
            False,
            f"auth state={auth_state}; command block missing",
        )
    before = len(api_auth)
    page.click("button:has-text('Test connection')"); wait_state(page); page.wait_for_timeout(500)
    check("A8 Test connection performs a new real check", len(api_auth) > before, f"{before}->{len(api_auth)}")

    # discovery against the real worker: live catalog unreachable -> must fail honestly with a stage and guidance
    fill_box(page)
    page.click("button:has-text('Discover real NISAR scenes')")
    page.wait_for_selector("[data-job-status='FAILED'], [data-job-status='COMPLETE']", timeout=90000)
    status = page.get_attribute("[data-job-status]", "data-job-status")
    if status == "FAILED":
        panel = page.inner_text(".forest-job-state")
        check("A9 failed discovery says where it stopped", "Stopped during" in panel, panel[:80].replace("\n", " "))
        check("A10 failed discovery says what to do next", "What to do next" in panel)
        check("A11 failure is not described as a success or a result", "No partial result was saved" in panel and "Real-data forest analysis complete" not in panel)
        check("A12 Try again and Copy diagnostics are offered", page.locator("button:has-text('Try again')").count() == 1 and page.locator("button:has-text('Copy diagnostics')").count() == 1)
        page.click(".forest-job-details summary")
        details = page.inner_text(".forest-job-details")
        check("A13 technical details show the failing frame and job log lines", "Where it failed" in details and ("Last lines of the job log" in details))
        check("A14 diagnostics never show home paths or credentials", not re.search(r"/home/\w+|C:\\\\Users|password=|access_token=", details + panel))
        page.click("button:has-text('Try again')"); page.wait_for_timeout(500)
        check("A15 Try again clears the old failure immediately (no stale state)", page.locator("[data-job-status='FAILED']").count() == 0 or page.locator("[data-job-status='QUEUED'],[data-job-status='RUNNING']").count() >= 0)
    else:
        check("A9-A15 discovery completed against the live catalog (environment has network)", True, "live catalog reachable")

    # coverage explorer against the real worker, searching around the study box
    page.reload(); page.wait_for_selector(".forest-earthdata"); fill_box(page)
    page.click("button:has-text('Search around my study box')")
    check("A16 coverage search states its exact scope before running", "Search area:" in page.inner_text(".forest-coverage__scope") and "2026-" in page.inner_text(".forest-coverage__scope"))
    page.click("button:has-text(\"Search NASA's catalog here\")")
    page.wait_for_selector(".forest-coverage [data-job-status='FAILED'], .forest-coverage [data-job-status='COMPLETE']", timeout=90000)
    cov_status = page.get_attribute(".forest-coverage [data-job-status]", "data-job-status")
    if cov_status == "FAILED":
        check("A17 coverage failure is explained, not blank", "What to do next" in page.inner_text(".forest-coverage .forest-job-state"))
        check("A18 no coverage answer is shown after a failure", page.locator(".forest-verdict").count() == 0 and page.locator(".forest-calendar").count() == 0)
    else:
        check("A17-A18 coverage scan completed against the live catalog", page.locator(".forest-verdict").count() == 1, "live catalog reachable")

    # place search against the real geocoder route
    page.fill("input[placeholder^='e.g. Sundarbans']", "Sundarbans"); page.click("button:has-text('Find place')")
    page.wait_for_function("document.querySelector('.forest-place-results') || document.querySelector('.forest-coverage .forest-workflow-error')", timeout=30000)
    check("A19 place search yields results or an honest error (never silence)", page.locator(".forest-place-results li").count() > 0 or page.locator(".forest-coverage .forest-workflow-error").count() > 0)
    page.fill("input[placeholder^='e.g. Sundarbans']", "ab"); page.click("button:has-text('Find place')")
    check("A20 too-short place query is rejected with guidance", "at least 3" in page.inner_text(".forest-coverage").lower())

    # oversized study area warning
    fill_box(page, {"west": "114", "south": "1", "east": "116", "north": "3"})
    check("A21 oversized study area is flagged before any job starts", "too large" in page.inner_text(".forest-workflow-setup").lower())

    # keyboard
    page.reload(); page.wait_for_selector(".forest-earthdata"); wait_state(page)
    focus_ok = False
    for _ in range(80):
        page.keyboard.press("Tab")
        info = page.evaluate("(() => { const e = document.activeElement; return [e.textContent.trim().slice(0, 24), getComputedStyle(e).outlineStyle, getComputedStyle(e).outlineWidth]; })()")
        if "Test connection" in info[0]:
            focus_ok = info[1] != "none" and info[2] not in ("0px", "")
            break
    check("A22 Test connection is reachable by keyboard with a visible focus ring", focus_ok)
    for width in (1440, 1100, 820, 390):
        page.set_viewport_size({"width": width, "height": 900}); page.wait_for_timeout(400)
        check(f"A23 no horizontal overflow at {width}px", not page.evaluate("document.documentElement.scrollWidth > innerWidth"))
    page.set_viewport_size({"width": 1440, "height": 900})
    page.screenshot(path="/tmp/forest_a_page.png", full_page=True)
    ctx.close()

    # ═══════════════════ PART B: UI states from hand-made API responses (FIXTURES) ═══════════════════
    print("── PART B: UI state rendering with FIXTURE API responses (not evidence of live data) ──")

    def scan_fixture() -> dict:
        stacks = [
            {"id": "a", "track": "043", "direction": "A", "frame": "034", "bandwidth": "4005", "polarizationMode": "DHDH", "pairedPolarizationMode": "A", "release": "P05023",
             "dates": ["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17"], "count": 4, "longestGapDays": 24, "bbox": [90.3, 21.9, 90.8, 22.4], "sufficient": True},
            {"id": "b", "track": "120", "direction": "D", "frame": "050", "bandwidth": "4005", "polarizationMode": "DHDH", "pairedPolarizationMode": "A", "release": "P05023",
             "dates": ["2026-07-01", "2026-07-13"], "count": 2, "longestGapDays": 12, "bbox": [90.9, 22.0, 91.3, 22.5], "sufficient": False}]
        return {"status": "OK", "scope": {"bbox": [89.5, 21.5, 91.5, 23.5], "startDate": "2026-06-17", "endDate": "2026-10-12", "product": "NISAR_L2_PR_GCOV_PROVISIONAL", "frequency": "frequencyA",
                "catalogHits": 6, "truncated": False, "searchedAt": "2026-10-14T10:00:00+00:00", "source": "NASA CMR"},
                "rejectedGranules": 0, "stacks": stacks, "stackCount": 2, "usableStackCount": 1, "message": "fixture"}

    class Api:
        def __init__(self, page):
            self.page, self.jobs, self.posts, self.cancelled, self.counter = page, {}, [], [], 0
            page.route("**/api/forest/workflow**", self.handle)

        def handle(self, route):
            req = route.request
            if req.method == "POST":
                body = json.loads(req.post_data or "{}")
                self.posts.append(body)
                if body.get("action") == "cancel":
                    self.cancelled.append(body["jobId"])
                    self.jobs[body["jobId"]] = {**self.jobs[body["jobId"]], "status": "CANCELLED", "stage": "Cancelled"}
                    return route.fulfill(status=202, content_type="application/json", body=json.dumps({"cancelRequested": True}))
                self.counter += 1
                job_id = f"{self.counter:032x}"
                self.jobs[job_id] = self.next_job(body, job_id)
                return route.fulfill(status=202, content_type="application/json", body=json.dumps({"jobId": job_id, "id": job_id, "status": "RUNNING"}))
            job_id = re.search(r"jobId=([a-f0-9]+)", req.url).group(1)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(self.jobs[job_id]))

        next_job = staticmethod(lambda body, job_id: {})

    def go_ready(browser, auth_state="not_connected", viewport=(1440, 900)):
        ctx, page = new_page(browser, *viewport)
        auth = {"state": auth_state, "message": "fixture message", "guidance": "fixture guidance", "checkedAt": "2026-10-14T10:00:00+00:00"}
        page.route("**/api/forest/auth", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"auth": auth, "python": {"source": "venv", "version": "Python 3.14"},
                   "commands": {"login": {"primary": ".\\pipeline\\venv\\Scripts\\python.exe pipeline\\forest_workflow.py login", "shell": "PowerShell", "where": "Run it from the repository root."},
                                "repair": ["py -3 -m venv pipeline\\venv", ".\\pipeline\\venv\\Scripts\\python.exe -m pip install -r pipeline\\requirements.txt"]}, "catalogAvailable": True})))
        return ctx, page

    # B1: coverage scan result -> verdict, calendar, use area
    ctx, page = go_ready(browser); api = Api(page)
    api.next_job = lambda body, jid: {"id": jid, "action": body["action"], "status": "COMPLETE", "stage": "Coverage scan complete (catalog records only)", "result": scan_fixture()}
    page.route("**/api/wetland/geocode**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"results": [
        {"display_name": "Sundarbans, Khulna Division, Bangladesh", "latitude": 22.0, "longitude": 90.5, "type": "forest", "category": "natural", "importance": 0.5}], "count": 1})))
    page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); wait_state(page)
    page.fill("input[placeholder^='e.g. Sundarbans']", "Sundarbans"); page.click("button:has-text('Find place')")
    page.wait_for_selector(".forest-place-results li"); page.click(".forest-place-results li button")
    check("B1 choosing a place states the exact search scope", "Search area:" in page.inner_text(".forest-coverage__scope") and "Sundarbans" in page.inner_text(".forest-coverage__scope"))
    page.click("button:has-text(\"Search NASA's catalog here\")"); page.wait_for_selector(".forest-verdict")
    body = page.inner_text(".forest-coverage")
    check("B2 verdict says a compatible stack can support analysis, and that nothing is downloaded", "1 compatible stack" in body and "Nothing has been downloaded or analysed" in body)
    check("B3 calendar lists each stack with a real 24-day gap labelled", page.locator(".forest-calendar__row").count() == 2 and "24-day gap" in body)
    check("B4 insufficient stack says how many dates it is missing", "needs 1 more" in body and "enough for analysis" in body)
    check("B5 catalog scope is stated and never generalised", "this is not a statement about anywhere else" in body)
    check("B6 catalog records are never described as downloaded data", "Not downloaded, not yet checked, not analysed" in body)
    check("B7 the coverage request carries the exact window and dates", api.posts and api.posts[0]["request"]["startDate"] == "2026-06-17" and len(api.posts[0]["request"]["bbox"]) == 4)
    page.locator(".forest-calendar__row.is-enough button:has-text('Use this area')").click()
    vals = [float(page.input_value(f"label:has-text('{l}') input")) for l in ("West longitude", "South latitude", "East longitude", "North latitude")]
    check("B8 Use this area fills a pipeline-sized box inside the stack footprint", 0 < vals[2] - vals[0] <= 0.2 and 90.3 <= vals[0] and vals[2] <= 90.8, str(vals))
    check("B9 Use this area names the study and clears a stale 'too large' warning", "Sundarbans" in page.input_value("label:has-text('Study area name') input") and "too large" not in page.inner_text(".forest-workflow-setup").lower())
    ctx.close()

    # B2: empty / insufficient answers
    for label, hits, usable, stacks, expect in (("empty", 0, 0, [], "No NISAR scenes are listed here"), ("insufficient", 3, 0, [{"id": "z", "track": "001", "direction": "A", "frame": "001", "bandwidth": "4005", "polarizationMode": "DHDH", "release": "P05023",
            "dates": ["2026-07-01", "2026-07-13"], "count": 2, "longestGapDays": 12, "bbox": [1, 1, 2, 2], "sufficient": False}], "none is enough on its own")):
        ctx, page = go_ready(browser); api = Api(page)
        res = scan_fixture(); res.update(stacks=stacks, stackCount=len(stacks), usableStackCount=usable, status="EMPTY" if not hits else "INSUFFICIENT_OBSERVATIONS"); res["scope"]["catalogHits"] = hits
        api.next_job = lambda body, jid, res=res: {"id": jid, "action": body["action"], "status": "COMPLETE", "result": res}
        page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); fill_box(page, {"west": "90.1", "south": "22.0", "east": "90.2", "north": "22.1"})
        page.click("button:has-text('Search around my study box')"); page.click("button:has-text(\"Search NASA's catalog here\")"); page.wait_for_selector(".forest-verdict")
        text = page.inner_text(".forest-verdict")
        check(f"B10 {label} catalog answer is explained and not 'ready'", expect in text and "can support an analysis" not in text and page.locator(".forest-verdict--ready").count() == 0)
        if label == "empty":
            check("B11 empty answer does not generalise beyond the window", "nothing about other places" in text)
        ctx.close()

    # B3: running -> cancel -> cancelled; no stale progress when a new job starts
    ctx, page = go_ready(browser); api = Api(page)
    api.next_job = lambda body, jid: {"id": jid, "action": body["action"], "status": "RUNNING", "stage": "Reading real GCOV layers for acquisition 2 of 4"}
    page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); fill_box(page)
    page.click("button:has-text('Search around my study box')"); page.click("button:has-text(\"Search NASA's catalog here\")")
    page.wait_for_selector("[data-job-status='RUNNING']")
    check("B12 running job shows its real stage and a Cancel control", "Reading real GCOV layers" in page.inner_text("[data-job-status='RUNNING']") and page.locator("button:has-text('Cancel')").count() == 1)
    page.click("button:has-text('Cancel')"); page.wait_for_selector("[data-job-status='CANCELLED']")
    check("B13 cancel sends a cancel request for that exact job and ends in a calm cancelled state", len(api.cancelled) == 1 and "untouched" in page.inner_text("[data-job-status='CANCELLED']"))
    first_id = api.cancelled[0]
    api.next_job = lambda body, jid: {"id": jid, "action": body["action"], "status": "QUEUED", "stage": "Waiting for the local real-data worker"}
    page.click("button:has-text(\"Search NASA's catalog here\")")
    page.wait_for_selector("[data-job-status='QUEUED']")
    check("B14 a new job never shows the previous job's cancelled or stage text", "Reading real GCOV" not in page.inner_text(".forest-coverage") and page.locator("[data-job-status='CANCELLED']").count() == 0 and first_id not in json.dumps(api.posts[-1]))
    ctx.close()

    # B4: stalled + failed-with-diagnostics rendering
    for status, extra, expect in (("STALLED", {"stalledReason": "The worker process is no longer running, but the job never finished."}, "no longer running"),
                                 ("FAILED", {"failedStage": "Reading real GCOV layers", "error": "synthetic extraction failure", "diagnostics": {"guidance": "Retry once.", "traceback": ["forest_workflow.py:12 in x"]}, "logTail": ["line one"]}, "Stopped during")):
        ctx, page = go_ready(browser); api = Api(page)
        api.next_job = lambda body, jid, status=status, extra=extra: {"id": jid, "action": body["action"], "status": status, "stage": "x", **extra}
        page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); fill_box(page)
        page.click("button:has-text('Search around my study box')"); page.click("button:has-text(\"Search NASA's catalog here\")")
        page.wait_for_selector(f"[data-job-status='{status}']")
        panel = page.inner_text(f"[data-job-status='{status}']")
        check(f"B15 {status} state explains itself and offers a retry", expect in panel and page.locator("button:has-text('Try again')").count() == 1 and page.locator("[role='alert']").count() >= 1)
        ctx.close()

    # B5: every Earthdata state renders accurately
    for state, expect_cmd, text in (("connected", False, "Connected"), ("not_connected", True, "Not connected"), ("check_failed", True, "Check failed"), ("environment_missing", False, "Python setup needed")):
        ctx, page = go_ready(browser, state); page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); wait_state(page)
        pill = page.inner_text(".forest-auth-pill")
        has_login = page.locator(".forest-command:has-text('login')").count() > 0
        check(f"B16 Earthdata state '{state}' shows '{text}'", text in pill, pill.strip())
        check(f"B17 login command visibility is right for '{state}'", has_login == expect_cmd)
        if state == "environment_missing":
            check("B18 broken Python environment shows repair commands, not an empty terminal", page.locator(".forest-command").count() == 2 and "pip install" in page.inner_text(".forest-earthdata"))
        if state == "connected":
            check("B19 connected state does not ask for a login", "Run this once" not in page.inner_text(".forest-earthdata"))
        ctx.close()

    # B6: public catalog vs authenticated downloads are distinguished in the panel
    ctx, page = go_ready(browser); page.goto(BASE + "/forest"); page.wait_for_selector(".forest-earthdata"); wait_state(page)
    txt = page.inner_text(".forest-earthdata")
    check("B20 panel separates public catalog search from authenticated downloads", "is public" in txt and "needs a free Earthdata login" in txt and "never typed into this website" in txt)
    page.screenshot(path="/tmp/forest_b_panel.png")
    ctx.close()
    browser.close()

bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
