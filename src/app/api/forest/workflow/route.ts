import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile, open } from "node:fs/promises";
import { closeSync, openSync, constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { JOBS, PIPELINE, SANITIZE_ROOTS, WORKER, findPython, missingPackages, processAlive, workerEnv } from "@/lib/forest-runtime";
import { classifyJob, repairCommands, sanitizeLog, tailLines, workerSpawnOptions, type ForestJobRecord } from "@/lib/forest-job";
import { publicViewer } from "@/lib/app-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const JOB_ID = /^[a-f0-9]{32}$/;

function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: NO_STORE });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRequestBody(value: unknown): { action: "discover" | "run" | "coverage"; request: Record<string, unknown>; selectedSceneIds?: string[] } | null {
  if (!isObject(value) || (value.action !== "discover" && value.action !== "run" && value.action !== "coverage") || !isObject(value.request)) return null;
  const request = value.request;
  if (value.action !== "coverage" && (typeof request.siteName !== "string" || request.siteName.trim().length < 2 || request.siteName.length > 80)) return null;
  if (!Array.isArray(request.bbox) || request.bbox.length !== 4 || !request.bbox.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (typeof request.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(request.startDate)) return null;
  if (typeof request.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(request.endDate)) return null;
  let selectedSceneIds: string[] | undefined;
  if (value.action === "run") {
    if (!Array.isArray(value.selectedSceneIds) || value.selectedSceneIds.length < 3 ||
        !value.selectedSceneIds.every((scene) => typeof scene === "string" && scene.length > 0 && scene.length < 512) ||
        new Set(value.selectedSceneIds).size !== value.selectedSceneIds.length) return null;
    selectedSceneIds = value.selectedSceneIds as string[];
  }
  return { action: value.action, request, selectedSceneIds };
}

async function readJob(id: string): Promise<ForestJobRecord | null> {
  try { return JSON.parse(await readFile(join(JOBS, `${id}.json`), "utf8")) as ForestJobRecord; }
  catch { return null; }
}

async function writeJob(id: string, job: Record<string, unknown>) {
  await writeFile(join(JOBS, `${id}.json`), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

async function logTail(id: string, max = 40): Promise<string[]> {
  try {
    const handle = await open(join(JOBS, `${id}.log`), "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, 24_000);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return tailLines(sanitizeLog(buffer.toString("utf8"), SANITIZE_ROOTS), max);
    } finally { await handle.close(); }
  } catch { return []; }
}

/** The worker died before it could record anything (for example a failed import). Say so, with its own log. */
async function recordUnexpectedExit(id: string, code: number | null, signal: NodeJS.Signals | null) {
  const job = await readJob(id);
  if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return; // the worker already reported its own outcome
  const tail = await logTail(id, 25);
  await writeJob(id, {
    ...job, status: "FAILED", stage: `Failed during: ${job.stage ?? "start-up"}`, failedStage: job.stage ?? "start-up",
    error: `The worker process ended unexpectedly (${signal ? `signal ${signal}` : `exit code ${code}`}) before reporting a result.`,
    diagnostics: { failedStage: job.stage ?? "start-up", message: "Worker exited without reporting.", traceback: tail,
      guidance: "Read the log lines above. A missing Python package is the most common cause: run the repair commands shown in the Earthdata panel, then retry." },
    completedAt: new Date().toISOString(),
  });
}

async function cancelJob(id: string) {
  const job = await readJob(id);
  if (!job) return fail("Forest workflow job not found.", 404);
  if (!["QUEUED", "RUNNING"].includes(job.status)) return fail(`This job already ${job.status.toLowerCase()}; there is nothing to cancel.`, 409);
  await writeFile(join(JOBS, `${id}.cancel`), "1", "utf8"); // a separate file: the worker rewrites the job file constantly
  return NextResponse.json({ id, status: job.status, cancelRequested: true, message: "Cancel requested. The worker stops at its next checkpoint (between scenes); earlier saved results are kept." }, { status: 202, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (publicViewer()) return NextResponse.json({ error: "Local processing is unavailable in the public viewer." }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return fail("Request body must be valid JSON."); }
  if (isObject(raw) && raw.action === "cancel") {
    return typeof raw.jobId === "string" && JOB_ID.test(raw.jobId) ? cancelJob(raw.jobId) : fail("A valid 32-character forest job ID is required.");
  }
  const input = validRequestBody(raw);
  if (!input) return fail("Invalid workflow request. Provide a study name, WGS84 bounding box, date range, and a discovered series of at least three unique scenes when running analysis.");

  try {
    await access(WORKER, constants.R_OK);
  } catch {
    return fail("pipeline/forest_workflow.py is missing from this checkout.", 500, { code: "WORKER_MISSING" });
  }

  // Preflight: report an unusable Python environment immediately, in the app, instead of failing later in a hidden process.
  const python = await findPython();
  const repair = repairCommands(process.platform);
  if (!python) return fail("No working Python was found. The forest pipeline needs the project's Python environment.", 503, { code: "PYTHON_NOT_FOUND", repair });
  const missing = await missingPackages(python.path);
  if (missing.length) return fail(`The Python environment is missing: ${missing.join(", ")}.`, 503, { code: "PACKAGES_MISSING", missing, repair, python: { source: python.source, version: python.version } });

  const id = randomUUID().replaceAll("-", "");
  const job = { id, action: input.action, status: "QUEUED", stage: "Waiting for the local real-data worker", createdAt: new Date().toISOString() };
  let logFd: number | null = null;
  try {
    await mkdir(JOBS, { recursive: true });
    await writeFile(join(JOBS, `${id}_request.json`), `${JSON.stringify(input, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(join(JOBS, `${id}.json`), `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    logFd = openSync(join(JOBS, `${id}.log`), "a");
    const child = spawn(python.path, [WORKER, "worker", "--job-id", id], workerSpawnOptions(process.platform, PIPELINE, workerEnv(), logFd));
    child.once("error", (error) => {
      void writeJob(id, { ...job, status: "FAILED", stage: "Could not start the Python worker", failedStage: "start-up", error: sanitizeLog(error.message, SANITIZE_ROOTS),
        diagnostics: { guidance: "Python could not be launched. Check the Earthdata panel's environment section." }, completedAt: new Date().toISOString() });
    });
    child.once("exit", (code, signal) => { if (code !== 0) void recordUnexpectedExit(id, code, signal); });
    if (process.platform !== "win32") child.unref();
    return NextResponse.json({ ...job, status: "RUNNING", jobId: id, python: { source: python.source, version: python.version } }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return fail(sanitizeLog(error instanceof Error ? error.message : "Unable to start the local forest workflow.", SANITIZE_ROOTS), 500);
  } finally {
    if (logFd !== null) closeSync(logFd); // the child holds its own copy of the descriptor
  }
}

export async function GET(request: Request) {
  if (publicViewer()) return NextResponse.json({ error: "Local processing is unavailable in the public viewer." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("jobId");
  if (!id || !JOB_ID.test(id)) return fail("A valid 32-character forest job ID is required.");
  const job = await readJob(id);
  if (!job) return fail("Forest workflow job not found. It may have been removed from the local output folder.", 404);
  const classified = classifyJob(job, Date.now(), processAlive);
  const body: ForestJobRecord = { ...classified, logTail: await logTail(id) };
  if (body.error) body.error = sanitizeLog(body.error, SANITIZE_ROOTS);
  return NextResponse.json(body, { headers: NO_STORE });
}
