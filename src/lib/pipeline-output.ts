import fs from "node:fs";
import path from "node:path";
import { publicViewer } from "./app-mode";

export class PipelineOutputError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export function pipelineRun(runId?: string | null) {
  if (publicViewer()) {
    if (runId && !/^[a-f0-9]{32}$/.test(runId)) throw new PipelineOutputError("Invalid study identifier.", 400);
    const root = path.join(process.cwd(), "public", "studies");
    const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8")) as { studies: { run_id: string; publication_version: string }[] };
    const selected = runId || JSON.parse(fs.readFileSync(path.join(root, "current_run.json"), "utf8")).run_id;
    const entry = catalog.studies.find((item) => item.run_id === selected);
    if (!entry || !/^[a-f0-9]{32}$/.test(entry.run_id) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(entry.publication_version)) throw new PipelineOutputError("Published study unavailable.", 404);
    const folder = path.join(root, "releases", entry.publication_version, "runs", entry.run_id);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "run_manifest.json"), "utf8")) as Record<string, unknown>;
    if (manifest.status !== "COMPLETE" || manifest.run_id !== selected || manifest.data_source !== "NISAR") throw new PipelineOutputError("Invalid published study.");
    return { folder, manifest };
  }
  const root = path.join(process.cwd(), "pipeline", "output");
  if (runId && !/^[a-f0-9]{32}$/.test(runId)) throw new PipelineOutputError("Invalid pipeline run identifier.", 400);
  const pointer = runId ? path.join(root, "runs", runId, "run_manifest.json") : path.join(root, "current_run.json");
  if (!fs.existsSync(pointer)) throw new PipelineOutputError("No completed study is available in this application mode.", 404);
  let manifest = JSON.parse(fs.readFileSync(pointer, "utf8")) as Record<string, unknown>;
  if (manifest.status !== "COMPLETE") throw new PipelineOutputError(`Pipeline run is ${String(manifest.status)}; incomplete or stale output is unavailable.`);
  if (typeof manifest.run_id !== "string" || !/^[a-f0-9]{32}$/.test(manifest.run_id)) throw new PipelineOutputError("Invalid pipeline run identifier.");
  const folder = path.join(root, "runs", manifest.run_id);
  if (!runId && fs.existsSync(path.join(folder, "run_manifest.json"))) {
    manifest = JSON.parse(fs.readFileSync(path.join(folder, "run_manifest.json"), "utf8"));
    if (manifest.status !== "COMPLETE") throw new PipelineOutputError("The selected run is not complete.");
  }
  return { folder, manifest };
}

export function completedNisarRuns() {
  if (publicViewer()) {
    const target = path.join(process.cwd(), "public", "studies", "catalog.json");
    if (!fs.existsSync(target)) return [];
    const catalog = JSON.parse(fs.readFileSync(target, "utf8")) as { studies: { run_id: string }[] };
    return catalog.studies.map((entry) => {
      const { manifest } = pipelineRun(entry.run_id);
      return { ...entry, site_name: String(manifest.site_name), baseline_date: manifest.baseline_date, selected_date: manifest.selected_date,
        completed_at: manifest.completed_at, observation_count: manifest.observation_count, reference_check_status: manifest.reference_check_status, site_bounds: manifest.site_bounds };
    });
  }
  const root = path.join(process.cwd(), "pipeline", "output", "runs");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => /^[a-f0-9]{32}$/.test(id)).flatMap((id) => {
    try {
      const { manifest } = pipelineRun(id);
      if (manifest.data_source !== "NISAR") return [];
      if (manifest.superseded_by) return [];
      return [{ run_id: id, site_name: String(manifest.site_name || "Study area"),
        baseline_date: manifest.baseline_date, selected_date: manifest.selected_date,
        completed_at: manifest.completed_at, observation_count: manifest.observation_count,
        reference_check_status: manifest.reference_check_status, site_bounds: manifest.site_bounds }];
    } catch { return []; }
  }).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
}

export function readPipelineOutput(filename: string, run = pipelineRun()): unknown {
  if (!/^[a-zA-Z0-9_]+\.(json|geojson)$/.test(filename)) throw new PipelineOutputError("Invalid pipeline output filename.");
  const target = path.join(run.folder, filename);
  if (!fs.existsSync(target)) throw new PipelineOutputError("Completed pipeline run is missing an expected artifact.");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
