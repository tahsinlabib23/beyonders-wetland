"use client";

import { useEffect, useState } from "react";
import type { ForestJobRecord } from "@/lib/forest-job";

const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED", "STALLED"]);
export const isTerminalStatus = (status: string | undefined) => !!status && TERMINAL.has(status);

interface Snapshot { id: string; job: ForestJobRecord | null; error: string | null }

/**
 * Polls one job. Returned state always belongs to the CURRENT jobId: switching or clearing the id immediately
 * hides the previous job's progress instead of letting stale stage text or a stale "complete" linger.
 */
export function useForestJob(jobId: string | null, intervalMs = 1500) {
  const [snap, setSnap] = useState<Snapshot>({ id: "", job: null, error: null });

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/forest/workflow?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const body = await response.json() as ForestJobRecord | { error?: string };
        if (disposed) return;
        if (!response.ok || !("status" in body)) throw new Error((body as { error?: string }).error || "Could not read the job status.");
        setSnap({ id: jobId, job: body, error: null });
        if (!isTerminalStatus(body.status)) timer = window.setTimeout(poll, intervalMs);
      } catch (error) {
        if (disposed) return;
        setSnap((previous) => ({ id: jobId, job: previous.id === jobId ? previous.job : null, error: error instanceof Error ? error.message : "Could not read the job status." }));
        timer = window.setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [jobId, intervalMs]);

  const current = jobId !== null && snap.id === jobId;
  return { job: current ? snap.job : null, error: current ? snap.error : null };
}

export async function requestCancel(jobId: string): Promise<string | null> {
  try {
    const response = await fetch("/api/forest/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", jobId }) });
    const body = await response.json() as { error?: string };
    return response.ok ? null : body.error ?? "Could not cancel the job.";
  } catch {
    return "Could not reach the app to cancel the job.";
  }
}
