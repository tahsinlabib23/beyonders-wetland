import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { FOREST_OUTPUT } from "@/lib/forest-runtime";
import { parseForestAnalysis } from "@/lib/forest-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOREST_ROOT = FOREST_OUTPUT;
const RUN_ID_RE = /^[a-f0-9]{32}$/;

export async function GET() {
  const runsRoot = join(FOREST_ROOT, "runs");
  const runs: Array<{ runId: string; siteName: string; createdAt: string; observationCount: number; candidateCount: number; productMaturity: string | null; readiness: string }> = [];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_ID_RE.test(entry.name)) continue;
      try {
        const raw = await readFile(join(runsRoot, entry.name, "forest_analysis.json"), "utf8");
        const analysis = parseForestAnalysis(JSON.parse(raw) as unknown);
        if (!analysis || analysis.runId !== entry.name || analysis.dataSource !== "NISAR") continue;
        runs.push({ runId: analysis.runId, siteName: analysis.site.name, createdAt: analysis.createdAt,
          observationCount: analysis.observations.length, candidateCount: analysis.candidates.length,
          productMaturity: analysis.productMaturity, readiness: analysis.readiness.status });
      } catch {
        // Ignore incomplete/failed run folders. They are not published analyses.
      }
    }
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ runs: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ error: "Could not list saved forest runs." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
