import { NextResponse } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";

export async function GET() {
  try {
    const run = pipelineRun();
    const sensitivity = readPipelineOutput("sensitivity_results.json", run) as Record<string, unknown>;
    if (!Array.isArray(sensitivity.thresholds) || !Array.isArray(sensitivity.stable_range)) throw new Error("Invalid sensitivity.");
    return NextResponse.json({ ...sensitivity, run_id: run.manifest.run_id,
      data_source: "NISAR" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PipelineOutputError ? error.message : "Invalid pipeline sensitivity output." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}
