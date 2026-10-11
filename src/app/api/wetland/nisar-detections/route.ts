import { NextRequest, NextResponse } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";

type PulseDate = { date: string; area_km2: number; patches: number };
type Observation = { date: string; patches_file: string; scene_name?: string | null;
  baseline_method?: { baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[] } };

export async function GET(request: NextRequest) {
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    // pipelineRun rejects every manifest that is not explicitly sourced from real NISAR data.
    if (run.manifest.data_source !== "NISAR") throw new PipelineOutputError("Only completed real NISAR output can be served.", 409);

    const pulse = readPipelineOutput("wetland_pulse.json", run) as { dates?: PulseDate[] };
    const observations = readPipelineOutput("observations.json", run) as Observation[];
    if (!Array.isArray(pulse.dates) || !Array.isArray(observations)) throw new Error("Invalid NISAR observation index.");

    const availableDates = observations.map((item) => item.date)
      .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
    const requestedDate = request.nextUrl.searchParams.get("date");
    const selectedDate = requestedDate || (typeof run.manifest.selected_date === "string" ? run.manifest.selected_date : availableDates.at(-1));
    const observation = observations.find((item) => item.date === selectedDate);
    if (!observation) {
      return NextResponse.json({ error: "That date is not in the completed NISAR run.", dates: availableDates }, { status: 400 });
    }

    const output = readPipelineOutput(observation.patches_file, run) as { type?: unknown; features?: unknown[] };
    if (output.type !== "FeatureCollection" || !Array.isArray(output.features)) throw new Error("Invalid NISAR detection output.");
    const boundary = readPipelineOutput("site_boundary.geojson", run) as { type?: unknown; features?: unknown[] };
    if (boundary.type !== "FeatureCollection" || !Array.isArray(boundary.features)) throw new Error("Invalid NISAR study boundary.");
    const caseStudy = readPipelineOutput("case_study.json", run) as Record<string, unknown>;
    const referenceValidation = readPipelineOutput("reference_validation.json", run) as Record<string, unknown>;

    const stats = pulse.dates.find((item) => item.date === selectedDate) ?? null;
    return NextResponse.json({
      run_id: run.manifest.run_id,
      data_source: "NISAR",
      site_name: run.manifest.site_name ?? "Study area",
      site_bounds: run.manifest.site_bounds ?? null,
      boundary_source: run.manifest.wetland_boundary_source ?? null,
      status: "ready",
      product: run.manifest.product ?? null,
      product_maturity: run.manifest.product_maturity ?? "PROVISIONAL",
      reference_validated: false,
      cross_sensor_check_completed: run.manifest.cross_sensor_check_completed === true,
      reference_check_status: run.manifest.reference_check_status ?? "NOT_RUN",
      baseline_date: run.manifest.baseline_date ?? null,
      baseline_observation_dates: run.manifest.baseline_observation_dates ?? null,
      selected_date: selectedDate,
      baseline_scene: run.manifest.baseline_scene ?? null,
      selected_baseline: observation.baseline_method ?? null,
      selected_scene: observation.scene_name ?? null,
      polarizations: Array.isArray(run.manifest.polarizations) ? run.manifest.polarizations : ["HHHH", "HVHV"],
      dates: availableDates,
      stats,
      detections: { type: "FeatureCollection", features: output.features },
      boundary,
      case_study: caseStudy,
      reference_validation: referenceValidation,
    });
  } catch (error) {
    const status = error instanceof PipelineOutputError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load NISAR detections." }, { status });
  }
}
