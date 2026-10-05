import { PipelineOutputError, readPipelineOutput, pipelineRun } from "./pipeline-output";

export function referenceEvidence(run: ReturnType<typeof pipelineRun>) {
  const evidence = readPipelineOutput("reference_evidence.json", run) as { run_id: string; comparison: unknown; metrics: { matching_pixels: number; radar_only_pixels: number; optical_only_pixels: number }; artifacts: string[] };
  const reference = readPipelineOutput("reference_validation.json", run) as { comparison: unknown; metrics: { true_positive_pixels: number; false_positive_pixels: number; false_negative_pixels: number } };
  if (evidence.run_id !== run.manifest.run_id || JSON.stringify(evidence.comparison) !== JSON.stringify(reference.comparison) ||
    evidence.metrics.matching_pixels !== reference.metrics.true_positive_pixels || evidence.metrics.radar_only_pixels !== reference.metrics.false_positive_pixels ||
    evidence.metrics.optical_only_pixels !== reference.metrics.false_negative_pixels) {
    throw new PipelineOutputError("Reference evidence is from an earlier comparison. Prepare optical evidence again.", 409);
  }
  return evidence;
}
