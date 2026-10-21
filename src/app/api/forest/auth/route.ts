import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { PIPELINE, SANITIZE_ROOTS, WORKER, findPython, missingPackages, workerEnv } from "@/lib/forest-runtime";
import { lastJsonObject, loginCommands, normalizeAuthReport, repairCommands, sanitizeLog } from "@/lib/forest-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * Real Earthdata check. The worker calls earthaccess.login non-interactively (it never prompts and never prints a
 * secret); Earthdata itself must accept the saved login for the answer to be "connected".
 * Public CMR catalog searches do not need this; downloading NISAR/HLS data does.
 */
export async function GET() {
  const commands = { login: loginCommands(process.platform), repair: repairCommands(process.platform) };
  const python = await findPython();
  if (!python) {
    return NextResponse.json({ auth: { state: "environment_missing", message: "No working Python environment was found.", guidance: "Create the project environment with the repair commands, then test again." },
      python: null, commands, catalogAvailable: false }, { headers: NO_STORE });
  }
  const missing = await missingPackages(python.path);
  if (missing.length) {
    return NextResponse.json({ auth: { state: "environment_missing", message: `The Python environment is missing: ${missing.join(", ")}.`, guidance: "Install the requirements with the repair commands, then test again." },
      python: { source: python.source, version: python.version }, missing, commands, catalogAvailable: false }, { headers: NO_STORE });
  }
  try {
    const { stdout } = await run(python.path, [WORKER, "auth-check"], { cwd: PIPELINE, timeout: 60_000, windowsHide: true, env: workerEnv(), maxBuffer: 1_000_000 });
    const auth = normalizeAuthReport(lastJsonObject(stdout));
    return NextResponse.json({ auth, python: { source: python.source, version: python.version }, commands, catalogAvailable: true }, { headers: NO_STORE });
  } catch (error) {
    const message = sanitizeLog(error instanceof Error ? error.message : "The connection check failed.", SANITIZE_ROOTS).slice(0, 400);
    return NextResponse.json({ auth: { state: "check_failed", message, guidance: "The check did not finish. Try again; if it repeats, read the message above." },
      python: { source: python.source, version: python.version }, commands, catalogAvailable: true }, { headers: NO_STORE });
  }
}
