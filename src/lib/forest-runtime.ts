import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { pythonCandidates } from "./forest-job.ts";

const run = promisify(execFile);

export const ROOT = process.cwd();
export const PIPELINE = join(ROOT, "pipeline");
/** Where forest jobs and runs live. FOREST_OUTPUT_DIR (absolute path) lets tests use a throwaway folder; unset means the normal location. */
export const FOREST_OUTPUT = process.env.FOREST_OUTPUT_DIR && isAbsolute(process.env.FOREST_OUTPUT_DIR) ? process.env.FOREST_OUTPUT_DIR : join(PIPELINE, "output", "forest");
export const JOBS = join(FOREST_OUTPUT, "jobs");
export const WORKER = join(PIPELINE, "forest_workflow.py");
export const SANITIZE_ROOTS = [ROOT, homedir()];

export interface PythonInfo { path: string; source: "venv" | "env" | "system"; version: string }

/** First interpreter that really runs. Structured arguments only: no shell, so no injection and no console window. */
export async function findPython(): Promise<PythonInfo | null> {
  for (const candidate of pythonCandidates(process.platform, PIPELINE, process.env.PYTHON)) {
    if (candidate.source !== "system" && !existsSync(candidate.path)) continue;
    try {
      const { stdout, stderr } = await run(candidate.path, ["--version"], { timeout: 15_000, windowsHide: true });
      return { ...candidate, version: (stdout || stderr).trim() };
    } catch { /* try the next candidate */ }
  }
  return null;
}

const REQUIRED_MODULES = ["numpy", "scipy", "pandas", "rasterio", "h5py", "earthaccess", "geopandas", "shapely", "pyproj", "yaml", "PIL", "matplotlib", "requests"];

export async function missingPackages(python: string): Promise<string[]> {
  const script = `import importlib.util, json; mods = ${JSON.stringify(REQUIRED_MODULES)}; print(json.dumps([m for m in mods if importlib.util.find_spec(m) is None]))`;
  try {
    const { stdout } = await run(python, ["-c", script], { timeout: 30_000, windowsHide: true, cwd: PIPELINE });
    const parsed: unknown = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : REQUIRED_MODULES;
  } catch {
    return REQUIRED_MODULES;
  }
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function workerEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", GDAL_NUM_THREADS: process.env.GDAL_NUM_THREADS || "2" };
}
