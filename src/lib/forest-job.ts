/**
 * Pure helpers behind /api/forest/workflow and /api/forest/auth: which Python to run, how to spawn it without
 * opening a console window, how to tell a finished job from a dead one, and how to show logs safely.
 * No I/O here, so every decision is unit-tested.
 */

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "CANCELLED" | "STALLED";

export interface ForestJobRecord {
  id: string;
  action?: "discover" | "run" | "coverage";
  status: JobStatus;
  stage?: string;
  error?: string | null;
  errorType?: string;
  failedStage?: string;
  pid?: number;
  createdAt?: string;
  updatedAt?: string;
  heartbeatAt?: string;
  cancelRequested?: boolean;
  diagnostics?: Record<string, unknown>;
  result?: unknown;
  logTail?: string[];
  stalledReason?: string;
}

const join = (sep: string, ...parts: string[]) => parts.join(sep).replace(new RegExp(`\\${sep}{2,}`, "g"), sep);

/** Interpreters to try, best first: the project venv, an explicit PYTHON override, then the system Python. */
export function pythonCandidates(platform: string, pipelineDir: string, envPython?: string): { path: string; source: "venv" | "env" | "system" }[] {
  const windows = platform === "win32";
  const sep = windows ? "\\" : "/";
  const list: { path: string; source: "venv" | "env" | "system" }[] = [
    { path: windows ? join(sep, pipelineDir, "venv", "Scripts", "python.exe") : join(sep, pipelineDir, "venv", "bin", "python"), source: "venv" },
  ];
  if (envPython && envPython.trim()) list.push({ path: envPython.trim(), source: "env" });
  list.push({ path: windows ? "python" : "python3", source: "system" });
  return list;
}

/**
 * Spawn options for the background worker.
 *
 * Windows: do NOT use `detached`. A detached process starts with no console, and the venv's python.exe is a launcher
 * stub that starts the real interpreter (a console program) as a child; Windows then gives that child a brand-new,
 * visible, empty console window. `windowsHide` on an attached child keeps the whole process tree hidden.
 * macOS/Linux have no such windows, so the worker is detached to survive a dev-server restart.
 */
export function workerSpawnOptions<E extends Record<string, string | undefined>>(platform: string, cwd: string, env: E, logFd: number) {
  return {
    cwd,
    env,
    detached: platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", logFd, logFd] as ["ignore", number, number],
    shell: false,
  } as const;
}

const NOW = (value?: string) => (value ? Date.parse(value) : NaN);

/**
 * A job file that says RUNNING is only believable while its worker is alive and recently wrote to it.
 * Anything else is reported as STALLED so the UI never shows eternal progress from a dead process.
 */
export function classifyJob(job: ForestJobRecord, nowMs: number, isPidAlive: (pid: number) => boolean, staleAfterMs = 120_000): ForestJobRecord {
  if (job.status !== "RUNNING" && job.status !== "QUEUED") return job;
  const last = Math.max(NOW(job.heartbeatAt) || 0, NOW(job.updatedAt) || 0, NOW(job.createdAt) || 0);
  const silentFor = last ? nowMs - last : Infinity;
  const alive = typeof job.pid === "number" ? isPidAlive(job.pid) : null;
  if (alive === false) return { ...job, status: "STALLED", stalledReason: "The worker process is no longer running, but the job never finished. It likely crashed or the computer restarted." };
  if (silentFor > staleAfterMs) return { ...job, status: "STALLED", stalledReason: `No progress was recorded for ${Math.round(silentFor / 1000)} seconds.` };
  return job;
}

/** Mask credentials and absolute paths in text that originated on the user's machine. */
export function sanitizeLog(text: string, roots: string[] = []): string {
  let out = text;
  out = out.replace(/(bearer\s+)[A-Za-z0-9._\-~+/=]{8,}/gi, "$1<redacted>");
  out = out.replace(/((?:access_)?token|password|passwd|secret|authorization)(['"]?\s*[:=]\s*['"]?)[^\s'",;&}]{4,}/gi, "$1$2<redacted>");
  out = out.replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1<redacted>@");
  for (const root of [...roots].filter((r) => r && r.length > 3).sort((a, b) => b.length - a.length)) {
    out = out.split(root).join("<project>").split(root.replace(/\\/g, "/")).join("<project>");
  }
  // Any user directory, known root or not: C:\\Users\\name\\..., /Users/name/..., /home/name/...
  out = out.replace(/\b[a-z]:[\\/]+users[\\/]+[^\\/\s"'<>|:]+/gi, "~").replace(/(?:\/Users|\/home)\/[^/\s"'<>|:]+/g, "~");
  return out;
}

export function tailLines(text: string, max = 40): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-max);
}

export type AuthState = "unchecked" | "connected" | "not_connected" | "check_failed" | "dependency_missing" | "environment_missing";

export interface AuthReport {
  state: AuthState;
  checkedAt?: string;
  message: string;
  guidance: string;
  strategy?: string;
  tokenExpires?: string;
}

/** The one login command. It uses the project's own earthaccess flow so there is a single authentication system. */
export function loginCommands(platform: string) {
  const windows = platform === "win32";
  return {
    primary: windows
      ? ".\\pipeline\\venv\\Scripts\\python.exe pipeline\\forest_workflow.py login"
      : "./pipeline/venv/bin/python pipeline/forest_workflow.py login",
    shell: windows ? "PowerShell" : "a terminal",
    where: "Run it from the repository root (the folder that contains package.json), not inside the browser.",
  };
}

export function repairCommands(platform: string) {
  const windows = platform === "win32";
  return windows
    ? ["py -3 -m venv pipeline\\venv", ".\\pipeline\\venv\\Scripts\\python.exe -m pip install -r pipeline\\requirements.txt"]
    : ["python3 -m venv pipeline/venv", "./pipeline/venv/bin/python -m pip install -r pipeline/requirements.txt"];
}

/** The last JSON object printed on stdout (workers may log before printing it). */
export function lastJsonObject(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* keep looking */ }
  }
  return null;
}

const AUTH_STATES: AuthState[] = ["connected", "not_connected", "check_failed", "dependency_missing"];

/** Never trust worker output blindly: anything unrecognised becomes check_failed rather than an optimistic state. */
export function normalizeAuthReport(raw: Record<string, unknown> | null): AuthReport {
  if (!raw || typeof raw.state !== "string" || !AUTH_STATES.includes(raw.state as AuthState)) {
    return { state: "check_failed", message: "The connection check returned an unreadable answer.", guidance: "Try again. If it keeps happening, repair the Python environment shown below." };
  }
  return {
    state: raw.state as AuthState,
    message: typeof raw.message === "string" ? raw.message : "",
    guidance: typeof raw.guidance === "string" ? raw.guidance : "",
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : undefined,
    strategy: typeof raw.strategy === "string" ? raw.strategy : undefined,
    tokenExpires: typeof raw.tokenExpires === "string" ? raw.tokenExpires : undefined,
  };
}
