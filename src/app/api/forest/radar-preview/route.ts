import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { FOREST_OUTPUT } from "@/lib/forest-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOREST_ROOT = FOREST_OUTPUT;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_RE = /^[a-f0-9]{32}$/;

function fail(message: string, status = 404) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const day = url.searchParams.get("date") ?? "";
  const channel = url.searchParams.get("channel") ?? "";
  const requestedRunId = url.searchParams.get("runId") ?? "";
  const format = url.searchParams.get("format") ?? "meta";
  if (!DATE_RE.test(day) || !["hh", "hv"].includes(channel) || !["meta", "image"].includes(format)) {
    return fail("Choose a valid acquisition date, channel (hh/hv), and format (meta/image).", 400);
  }
  if (requestedRunId && !RUN_RE.test(requestedRunId)) return fail("Invalid forest run ID.", 400);

  try {
    let runId = requestedRunId;
    if (!runId) {
      const current = JSON.parse(await readFile(join(FOREST_ROOT, "current_run.json"), "utf8")) as Record<string, unknown>;
      if (current.status !== "COMPLETE" || current.dataSource !== "NISAR" || typeof current.runId !== "string" || !RUN_RE.test(current.runId)) {
        return fail("No completed real NISAR forest run is available for radar quicklooks.");
      }
      runId = current.runId;
    }
    const runDir = join(FOREST_ROOT, "runs", runId);
    const analysis = JSON.parse(await readFile(join(runDir, "forest_analysis.json"), "utf8")) as Record<string, unknown>;
    if (analysis.dataSource !== "NISAR" || analysis.runId !== runId || analysis.product !== "NISAR_L2_GCOV_PROVISIONAL_V1") {
      return fail("The selected folder does not contain a matching completed real NISAR forest analysis.", 422);
    }
    const previewDir = join(runDir, "previews");
    const stem = `${day}_${channel}`;
    const metadata = JSON.parse(await readFile(join(previewDir, `${stem}.json`), "utf8")) as Record<string, unknown>;
    if (metadata.dataSource !== "NISAR_L2_GCOV_PROVISIONAL_V1" || metadata.date !== day || metadata.channel !== channel) {
      return fail("Radar quicklook provenance does not match the requested acquisition.", 422);
    }
    if (format === "meta") {
      return NextResponse.json(metadata, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    if (metadata.available !== true) return fail(typeof metadata.message === "string" ? metadata.message : "No real raster quicklook exists for this date/channel.");
    const image = await readFile(join(previewDir, `${stem}.png`));
    return new NextResponse(new Uint8Array(image), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return fail("This real NISAR date/channel has no saved quicklook or the requested run is missing. No placeholder image is substituted.");
    }
    return fail("Could not read the saved forest radar quicklook.", 500);
  }
}
