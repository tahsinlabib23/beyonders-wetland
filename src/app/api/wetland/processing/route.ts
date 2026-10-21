import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { earthdataLoginPowerShell, windowsTerminalStartArgs } from "@/lib/earthdata-login";
import { publicViewer } from "@/lib/app-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const jobs = path.join(process.cwd(), "pipeline", "output", "jobs");
const activePath = path.join(jobs, "active.json");
const idPattern = /^[a-f0-9]{32}$/;
// Server-side interpreter for the local pipeline worker.
const python = process.platform === "win32"
  ? path.join(process.cwd(), "pipeline", "venv", "Scripts", "python.exe")
  : path.join(process.cwd(), "pipeline", "venv", "bin", "python");

/** Locate a system Python 3.10+ to bootstrap the venv with. Null when none is found. */
function systemPython(): string[] | null {
  const candidates: string[][] = process.platform === "win32" ? [["py", "-3"], ["python"]] : [["python3"], ["python"]];
  for (const cmd of candidates) {
    try {
      const out = execFileSync(cmd[0], [...cmd.slice(1), "--version"], { encoding: "utf8", timeout: 15000 });
      const m = /Python 3\.(\d+)/i.exec(out);
      if (m && parseInt(m[1], 10) >= 10) return cmd;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Open an interactive terminal for Earthdata authentication. On Windows, use a
 *  temporary .ps1 file rather than nested `cmd`/PowerShell quoting, which breaks
 *  easily when the project path contains spaces. */
async function openEarthdataTerminal(): Promise<boolean> {
  const exe = python; // the venv interpreter, which has earthaccess installed
  try {
    if (process.platform === "win32") {
      fs.mkdirSync(jobs, { recursive: true });
      const scriptPath = path.join(jobs, `earthdata-login-${randomUUID().replaceAll("-", "")}.ps1`);
      fs.writeFileSync(scriptPath, earthdataLoginPowerShell(exe), "utf8");
      const child = spawn("cmd.exe", windowsTerminalStartArgs(scriptPath), {
        cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: false,
      });
      const launched = await new Promise<boolean>((resolve) => {
        child.once("error", () => resolve(false));
        child.once("exit", (code) => resolve(code === 0));
      });
      if (!launched) {
        try { fs.unlinkSync(scriptPath); } catch { /* Keep cleanup best-effort. */ }
        return false;
      }
      child.unref();
      return true;
    }
    if (process.platform === "darwin") {
      const shellCmd = `"${exe}" -c "import earthaccess; earthaccess.login(persist=True)"; echo '---'; echo 'Sign-in done — you can close this window.'`;
      const child = spawn("osascript", ["-e", `tell application "Terminal" to do script "${shellCmd.replace(/"/g, '\\"')}"`],
        { detached: true, stdio: "ignore" });
      return await new Promise<boolean>((resolve) => {
        child.once("error", () => resolve(false));
        child.once("spawn", () => { child.unref(); resolve(true); });
      });
    }
    const terminals: string[][] = [["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["konsole", "-e"], ["xterm", "-e"]];
    for (const [term, ...flag] of terminals) {
      try {
        execFileSync("which", [term], { timeout: 5000 });
        const child = spawn(term, [...flag, exe, "-c", "import earthaccess; earthaccess.login(persist=True)"],
          { detached: true, stdio: "ignore" });
        return await new Promise<boolean>((resolve) => {
          child.once("error", () => resolve(false));
          child.once("spawn", () => { child.unref(); resolve(true); });
        });
      } catch { /* try the next terminal */ }
    }
    return false;
  } catch {
    return false;
  }
}

/** Earthdata login always happens in the user's own terminal — never in the browser.
 *  The site only shows the exact command for that machine's shell. */
function loginInfo(request: NextRequest) {
  const isWindows = /windows/i.test(request.headers.get("user-agent") ?? "");
  const exe = isWindows
    ? path.join(process.cwd(), "pipeline", "venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "pipeline", "venv", "bin", "python");
  const inner = "import earthaccess; earthaccess.login(persist=True)";
  return {
    loginCommand: isWindows ? `& "${exe}" -c "${inner}"` : `"${exe}" -c "${inner}"`,
    loginShell: isWindows ? "PowerShell" : "Terminal",
  };
}
type Job = { id: string; status: string; action: string; stage?: string; pid?: number; error?: string; result?: unknown };

function localOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    return origin.host === request.headers.get("host") && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  } catch { return false; }
}

function readJob(id: string): Job {
  if (!idPattern.test(id)) throw new Error("Invalid processing job.");
  const job = JSON.parse(fs.readFileSync(path.join(jobs, `${id}.json`), "utf8")) as Job;
  if (["QUEUED", "RUNNING"].includes(job.status) && job.pid) {
    try { process.kill(job.pid, 0); } catch {
      job.status = "FAILED"; job.error = "The local processing worker stopped. Start a new search or run.";
      fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
      const pipelineLock = path.join(process.cwd(), "pipeline", "output", ".run.lock");
      try { if (JSON.parse(fs.readFileSync(pipelineLock, "utf8")).pid === job.pid) fs.unlinkSync(pipelineLock); } catch { /* Another CLI run or no lock. */ }
      try { if (JSON.parse(fs.readFileSync(activePath, "utf8")).id === id) fs.unlinkSync(activePath); } catch { /* Already released. */ }
    }
  }
  return job;
}

export async function GET(request: NextRequest) {
  if (publicViewer()) return NextResponse.json({ error: "Local processing is unavailable in the public viewer." }, { status: 403 });
  const { loginCommand, loginShell } = loginInfo(request);
  const venvReady = fs.existsSync(python);
  try {
    const id = request.nextUrl.searchParams.get("id") || (fs.existsSync(activePath) ? JSON.parse(fs.readFileSync(activePath, "utf8")).id : "");
    const job = id ? readJob(id) : null;
    let areaRequest = null;
    if (job && ["search", "run"].includes(job.action)) {
      const saved = JSON.parse(fs.readFileSync(path.join(jobs, `${id}_request.json`), "utf8"));
      areaRequest = { siteName: saved.siteName, bbox: saved.bbox, boundary: saved.boundary ?? null,
        startDate: saved.startDate, endDate: saved.endDate, sceneNames: saved.sceneNames };
    }
    return NextResponse.json({ job, areaRequest, loginCommand, loginShell, venvReady }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "That processing job could not be loaded.", loginCommand, loginShell, venvReady }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  if (publicViewer()) return NextResponse.json({ error: "Local processing is unavailable in the public viewer." }, { status: 403 });
  if (!localOrigin(request)) return NextResponse.json({ error: "Start processing from the local application page." }, { status: 403 });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 1_000_000) return NextResponse.json({ error: "Use a boundary GeoJSON smaller than 1 MB." }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || !["search", "run", "reference", "preview", "evidence", "setup", "earthdata-login"].includes(String(body.action))) return NextResponse.json({ error: "Choose a supported processing action." }, { status: 400 });
  const action = String(body.action);
  // Fire-and-forget: opens a terminal window on this computer with the Earthdata
  // sign-in prompt. No job file — the human types credentials in that window.
  if (action === "earthdata-login") {
    if (!fs.existsSync(python)) return NextResponse.json({ error: "Set up the pipeline first." }, { status: 503 });
    const opened = await openEarthdataTerminal();
    return NextResponse.json(opened ? { opened: true }
      : { opened: false, error: "Could not open a sign-in terminal. Expand ‘Or run the command yourself’ below and run the displayed command in PowerShell." });
  }
  const id = randomUUID().replaceAll("-", "");
  fs.mkdirSync(jobs, { recursive: true });
  if (fs.existsSync(activePath)) {
    try {
      const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
      const job = readJob(active.id);
      if (["QUEUED", "RUNNING"].includes(job.status)) return NextResponse.json({ error: "Another job is running. Its progress is shown below.", job }, { status: 409 });
      fs.unlinkSync(activePath);
    } catch { if (fs.existsSync(activePath)) fs.unlinkSync(activePath); }
  }
  // The setup job bootstraps the venv with a system Python; every other action needs the venv.
  let spawnCmd: string[];
  let spawnScript: string;
  if (action === "setup") {
    const sysPy = systemPython();
    if (!sysPy) return NextResponse.json({ error: "No Python 3.10 or newer was found on this computer. Install it from python.org, restart the app, then try again." }, { status: 400 });
    spawnCmd = sysPy;
    spawnScript = "pipeline/setup_env.py";
  } else {
    if (!fs.existsSync(python)) return NextResponse.json({ error: "The local pipeline Python environment is missing." }, { status: 503 });
    spawnCmd = [python];
    spawnScript = "pipeline/web_job.py";
  }
  let log: number | undefined;
  try {
    fs.writeFileSync(activePath, JSON.stringify({ id }), { flag: "wx" });
    fs.writeFileSync(path.join(jobs, `${id}_request.json`), JSON.stringify(body));
    const job: Job = { id, action, status: "QUEUED", stage: action === "setup" ? "Starting pipeline setup" : "Starting local processor" };
    fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
    log = fs.openSync(path.join(jobs, `${id}.log`), "a");
    const child = spawn(spawnCmd[0], [...spawnCmd.slice(1), spawnScript, id], {
      cwd: process.cwd(), windowsHide: true, detached: true, stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    job.pid = child.pid;
    // The worker owns its status file once it starts; don't overwrite its progress.
    const initial = JSON.parse(fs.readFileSync(path.join(jobs, `${id}.json`), "utf8"));
    if (initial.status === "QUEUED") fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
    child.unref();
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (fs.existsSync(activePath)) {
      try { if (JSON.parse(fs.readFileSync(activePath, "utf8")).id === id) fs.unlinkSync(activePath); } catch { /* Preserve another worker's lock. */ }
    }
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ error: code === "EEXIST" ? "Another job just started. Try again when it finishes." : "Could not start the local processor." }, { status: code === "EEXIST" ? 409 : 500 });
  } finally { if (log !== undefined) fs.closeSync(log); }
}
