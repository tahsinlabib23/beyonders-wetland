import test from "node:test";
import assert from "node:assert/strict";
import { classifyJob, lastJsonObject, loginCommands, normalizeAuthReport, pythonCandidates, repairCommands, sanitizeLog, tailLines, workerSpawnOptions } from "./forest-job.ts";

test("python: project venv first, then an explicit override, then system python", () => {
  const win = pythonCandidates("win32", "C:\\proj\\pipeline", "D:\\py\\python.exe");
  assert.deepEqual(win.map((c) => c.source), ["venv", "env", "system"]);
  assert.equal(win[0].path, "C:\\proj\\pipeline\\venv\\Scripts\\python.exe");
  assert.equal(pythonCandidates("linux", "/p/pipeline")[0].path, "/p/pipeline/venv/bin/python");
  assert.equal(pythonCandidates("linux", "/p/pipeline").at(-1)?.path, "python3");
  assert.equal(pythonCandidates("win32", "C:\\p", "  ").length, 2);
});

test("windows worker is NOT detached and is hidden (a detached venv launcher opens an empty console window)", () => {
  const win = workerSpawnOptions("win32", "C:\\p", {}, 7);
  assert.equal(win.detached, false);
  assert.equal(win.windowsHide, true);
  assert.equal(win.shell, false);
  assert.deepEqual(win.stdio, ["ignore", 7, 7]); // output is captured to the job log, not lost in a terminal
  assert.equal(workerSpawnOptions("linux", "/p", {}, 3).detached, true);
  assert.equal(workerSpawnOptions("darwin", "/p", {}, 3).windowsHide, true);
});

test("a RUNNING job whose worker died is reported STALLED, never eternal progress", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const base = { id: "a".repeat(32), status: "RUNNING" as const, pid: 4242, updatedAt: "2026-10-14T11:59:50Z" };
  assert.equal(classifyJob(base, now, () => false).status, "STALLED");
  assert.match(classifyJob(base, now, () => false).stalledReason ?? "", /no longer running/);
  assert.equal(classifyJob(base, now, () => true).status, "RUNNING");
});

test("a silent job is stalled after the threshold even when the pid is unknown", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const quiet = { id: "b".repeat(32), status: "RUNNING" as const, updatedAt: "2026-10-14T11:50:00Z" };
  assert.equal(classifyJob(quiet, now, () => true).status, "STALLED");
  const beating = { ...quiet, heartbeatAt: "2026-10-14T11:59:55Z" };
  assert.equal(classifyJob(beating, now, () => true).status, "RUNNING");
});

test("terminal states are never rewritten", () => {
  const now = Date.now();
  for (const status of ["COMPLETE", "FAILED", "CANCELLED"] as const) {
    assert.equal(classifyJob({ id: "c".repeat(32), status, updatedAt: "2020-01-01T00:00:00Z" }, now, () => false).status, status);
  }
});

test("logs are sanitised: tokens, bearer values, credentials in URLs and project paths", () => {
  const raw = "Bearer abcdefghijklmnop; access_token=zzzz1234yyyy; https://me:pw123@urs.earthdata.nasa.gov; C:\\Users\\me\\proj\\pipeline\\x.tif";
  const clean = sanitizeLog(raw, ["C:\\Users\\me\\proj"]);
  for (const secret of ["abcdefghijklmnop", "zzzz1234yyyy", "pw123", "C:\\Users\\me\\proj"]) assert.ok(!clean.includes(secret), secret);
  assert.ok(clean.includes("<project>"));
});

test("tailLines keeps the last non-empty lines", () => {
  assert.deepEqual(tailLines("a\n\nb\nc\n", 2), ["b", "c"]);
});

test("one login command per platform, run from the repository root", () => {
  assert.match(loginCommands("win32").primary, /^\.\\pipeline\\venv\\Scripts\\python\.exe pipeline\\forest_workflow\.py login$/);
  assert.match(loginCommands("linux").primary, /^\.\/pipeline\/venv\/bin\/python pipeline\/forest_workflow\.py login$/);
  assert.match(loginCommands("win32").where, /repository root/);
  assert.equal(repairCommands("win32").length, 2);
});

test("auth output parsing: last JSON line wins, unknown states are never optimistic", () => {
  assert.equal(lastJsonObject("noise\n{\"state\":\"connected\"}\n")?.state, "connected");
  assert.equal(lastJsonObject("no json here"), null);
  assert.equal(normalizeAuthReport({ state: "connected", message: "ok", guidance: "go" }).state, "connected");
  assert.equal(normalizeAuthReport({ state: "definitely-fine" }).state, "check_failed");
  assert.equal(normalizeAuthReport(null).state, "check_failed");
});

test("user directories are masked even when they are not a known project root", () => {
  const clean = sanitizeLog('File "C:\\Users\\Rubai\\AppData\\Python314\\x.py", /home/claude/forest/venv/lib/y.py, /Users/someone/z.py');
  for (const name of ["Rubai", "claude", "someone"]) assert.ok(!clean.includes(name), name);
  assert.ok(clean.includes("venv/lib/y.py"));
});
