/** Human-readable status for the local NISAR workflow panel.
 * Setup completion means the Python environment is ready, not that NISAR data was processed.
 */
export type LocalWorkflowJob = {
  action?: string;
  status?: string;
  stage?: string;
} | null;

export function localWorkflowStatus(job: LocalWorkflowJob, submitting = false) {
  const active = submitting || job?.status === "QUEUED" || job?.status === "RUNNING";

  if (submitting) {
    return {
      title: job?.action === "setup" ? "Setting up pipeline…" : "Working…",
      message: "Starting local processor…",
      busy: true,
    };
  }
  if (job && (job.status === "QUEUED" || job.status === "RUNNING")) {
    return {
      title: job.action === "setup" ? "Setting up pipeline…" : "Working…",
      message: job.stage || "Working…",
      busy: true,
    };
  }
  if (job?.action === "setup" && job.status === "COMPLETE") {
    return {
      title: "Pipeline ready",
      message: "The local science environment is ready. Select a study area and search the NASA catalog to start an analysis.",
      busy: false,
    };
  }
  if (job?.status === "FAILED") {
    return { title: "Job failed", message: job.stage || "The local job failed.", busy: false };
  }
  if (job?.status === "COMPLETE") {
    return { title: "Job complete", message: job.stage || "The local job finished.", busy: false };
  }
  return {
    title: "Ready when you are",
    message: "Select an area and search for observations.",
    busy: active,
  };
}
