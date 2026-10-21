"use client";

import { useState } from "react";
import type { ForestJobRecord } from "@/lib/forest-job";

const LABEL: Record<string, string> = { QUEUED: "Queued", RUNNING: "Working", COMPLETE: "Finished", FAILED: "Stopped with an error", CANCELLED: "Cancelled", STALLED: "Stalled" };

interface Props {
  job: ForestJobRecord | null;
  pollError?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  cancelling?: boolean;
}

/** Shows what a job is really doing, and when it stopped, where and what to do next. Never shows "FAILED" alone. */
export default function ForestJobStatus({ job, pollError, onCancel, onRetry, cancelling }: Props) {
  const [copied, setCopied] = useState(false);
  if (!job && !pollError) return null;
  if (!job) return <div className="forest-job-state is-error" role="alert"><div><strong>Cannot read job status</strong></div><p>{pollError}</p></div>;
  const failed = job.status === "FAILED" || job.status === "STALLED";
  const running = job.status === "QUEUED" || job.status === "RUNNING";
  const diagnostics = job.diagnostics as { traceback?: string[]; guidance?: string; message?: string; environment?: unknown } | undefined;
  const copyDiagnostics = async () => {
    const text = JSON.stringify({ jobId: job.id, action: job.action, status: job.status, failedStage: job.failedStage, error: job.error, errorType: job.errorType, diagnostics: job.diagnostics, logTail: job.logTail }, null, 2);
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <div className={`forest-job-state${failed ? " is-error" : ""}${job.status === "CANCELLED" ? " is-muted" : ""}`} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} data-job-status={job.status}>
      <div>
        <span className={`forest-job-dot${running ? " is-live" : ""}`} aria-hidden="true" />
        <strong>{LABEL[job.status] ?? job.status}</strong>
        <span>{job.status === "STALLED" ? "No longer making progress" : job.stage || "Processing"}</span>
      </div>
      {running && (
        <p className="forest-job-hint">This runs on your computer. You can leave this page; progress is saved to the job.
          {onCancel && <button type="button" className="forest-link-button" onClick={onCancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</button>}
        </p>
      )}
      {failed && (
        <div className="forest-job-failure">
          {job.failedStage && <p><strong>Stopped during:</strong> {job.failedStage}</p>}
          {job.status === "STALLED" && job.stalledReason && <p>{job.stalledReason}</p>}
          {job.error && <p className="forest-job-error-text"><strong>What happened:</strong> {job.error}</p>}
          {diagnostics?.guidance && <p className="forest-job-guidance"><strong>What to do next:</strong> {diagnostics.guidance}</p>}
          <p className="forest-job-hint">No partial result was saved as a successful run, and your earlier saved results were not changed.</p>
          <div className="forest-job-actions">
            {onRetry && <button type="button" className="forest-button-secondary" onClick={onRetry}>Try again</button>}
            <button type="button" className="forest-button-secondary" onClick={() => void copyDiagnostics()}>{copied ? "Copied" : "Copy diagnostics"}</button>
          </div>
          <details className="forest-job-details">
            <summary>Technical details</summary>
            {(diagnostics?.traceback?.length ?? 0) > 0 && <><p className="forest-micro">Where it failed</p><pre>{diagnostics!.traceback!.join("\n")}</pre></>}
            {(job.logTail?.length ?? 0) > 0 && <><p className="forest-micro">Last lines of the job log</p><pre>{job.logTail!.join("\n")}</pre></>}
            {diagnostics?.environment !== undefined && <><p className="forest-micro">Environment</p><pre>{JSON.stringify(diagnostics.environment, null, 2)}</pre></>}
          </details>
        </div>
      )}
      {job.status === "CANCELLED" && <p className="forest-job-hint">You stopped this job. Earlier saved results are untouched.</p>}
      {pollError && running && <p className="forest-job-hint">Temporarily unable to refresh the status ({pollError}). Retrying…</p>}
    </div>
  );
}
