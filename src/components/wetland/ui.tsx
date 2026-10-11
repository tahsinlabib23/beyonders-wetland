import React from "react";
import type { DataTier } from "@/lib/store";

export const TIER_COPY: Record<DataTier, { label: string; sub: string; tone: "real" | "local" | "empty" }> = {
  EMPTY: { label: "No real case loaded", sub: "No processed real dataset is currently available", tone: "empty" },
  SHOWCASE: { label: "Real NISAR showcase", sub: "Actual NISAR-derived processed assets, packaged for this site", tone: "real" },
  LOCAL_RUN: { label: "Local NISAR run", sub: "A saved pipeline run read from this machine", tone: "local" },
};

const COMPLETENESS: Record<string, string> = { METADATA_ONLY: "acquisitions only", PARTIAL: "partial export" };

/** Data-source status: always visible, never ambiguous about whether data are real. */
export function TierBadge({ tier, completeness }: { tier: DataTier; completeness?: string }) {
  const c = TIER_COPY[tier]; const extra = completeness ? COMPLETENESS[completeness] : undefined;
  return (
    <span className={`wx-tier wx-tier--${c.tone}`} title={extra ? `${c.sub}. ${extra === "partial export" ? "Candidate regions exist for only some dates." : "Derived change results are not included in this export."}` : c.sub}>
      <i aria-hidden="true" /><span className="wx-tier__full">{c.label}{extra ? ` · ${extra}` : ""}</span><span className="wx-tier__short" aria-hidden="true">{c.tone === "real" ? "NISAR" : c.tone === "local" ? "LOCAL" : "NONE"}</span>
    </span>
  );
}

/** The five shared terms. Used for small category labels everywhere. */
export type Kind = "observed" | "derived" | "context" | "candidate" | "unassessed";
export const KIND_LABEL: Record<Kind, string> = { observed: "Observed", derived: "Derived", context: "Context", candidate: "Candidate", unassessed: "Unassessed" };
export function KindTag({ kind, children }: { kind: Kind; children?: React.ReactNode }) {
  return <span className={`wx-kind wx-kind--${kind}`}>{children ?? KIND_LABEL[kind]}</span>;
}

/** Consistent panel structure for every investigation tool: title, one plain sentence, evidence, limitation, one next action. */
export function ToolFrame({ title, lede, children, limitation, action }: { title: string; lede: string; children: React.ReactNode; limitation?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="wx-tool">
      <h2>{title}</h2>
      <p className="wx-lede">{lede}</p>
      <div className="wx-tool__evidence">{children}</div>
      {limitation && <div className="wx-limit"><span className="wx-micro">Limitation</span><p>{limitation}</p></div>}
      {action && <div className="wx-tool__action">{action}</div>}
    </div>
  );
}

export function Section({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return <section className="wx-sec">{eyebrow && <p className="wx-micro">{eyebrow}</p>}<h3>{title}</h3>{children}</section>;
}
