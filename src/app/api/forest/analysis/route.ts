import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { FOREST_OUTPUT } from "@/lib/forest-runtime";
import { parseForestAnalysis } from "@/lib/forest-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOREST_ROOT = FOREST_OUTPUT;
const RUN_ID_RE = /^[a-f0-9]{32}$/;

export async function GET(request: Request) {
  const requestedRunId = new URL(request.url).searchParams.get("runId");
  if (requestedRunId && !RUN_ID_RE.test(requestedRunId)) {
    return NextResponse.json({ status: "INVALID", analysis: null, message: "Invalid forest run ID." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const analysisPath = requestedRunId
    ? join(FOREST_ROOT, "runs", requestedRunId, "forest_analysis.json")
    : join(FOREST_ROOT, "forest_analysis.json");
  try {
    const raw = await readFile(analysisPath, "utf8");
    const parsedRaw: unknown = JSON.parse(raw);
    const analysis = parseForestAnalysis(parsedRaw);
    if (!analysis || (requestedRunId && analysis.runId !== requestedRunId)) {
      return NextResponse.json({
        status: "INVALID", analysis: null,
        message: "The saved forest analysis is not a supported schema, has mismatched run provenance, or does not identify real NISAR-derived results. No results are displayed.",
      }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ status: "READY", analysis, message: null }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({
        status: "NOT_RUN", analysis: null,
        message: requestedRunId
          ? "That saved forest run could not be found. It may have been removed from the local output folder."
          : "No processed forest analysis is available yet. The page will not display sample detections or invented metrics.",
      }, { status: requestedRunId ? 404 : 200, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      status: "INVALID", analysis: null,
      message: "The saved forest analysis could not be read. Check the output file and server logs; no replacement data were generated.",
    }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
