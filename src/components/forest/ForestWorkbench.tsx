"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  forestCandidateCsv,
  forestCandidateGeoJson,
  forestReadinessLabel,
  forestReadinessTone,
  parseForestAnalysis,
  type ForestAnalysisDocument,
  type ForestApiPayload,
  type ForestCandidate,
  type ForestObservation,
  type ForestAnalysisProvenance,
} from "@/lib/forest-analysis";
import ForestWorkflowControls, { type ForestBoundaryGeoJson, type ForestDiscoveryResult, type ForestStudyBounds } from "@/components/forest/ForestWorkflowControls";
import ForestPreviewWorkspace from "@/components/forest/ForestPreviewWorkspace";
import "./forest.css";

type ForestRunSummary = {
  runId: string;
  siteName: string;
  createdAt: string;
  observationCount: number;
  candidateCount: number;
  productMaturity: string | null;
  readiness: string;
};

const ForestMap = dynamic(() => import("./ForestMap"), {
  ssr: false,
  loading: () => <div className="forest-map-loading">Opening the study map…</div>,
});

const EMPTY_PAYLOAD: ForestApiPayload = {
  status: "NOT_RUN", analysis: null,
  message: "No processed forest analysis is available yet. The page will not display sample detections or invented metrics.",
};

function fmtNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function fmtPct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function SignalChart({ observations, activeDate }: { observations: ForestObservation[]; activeDate: string | null }) {
  const values = observations.flatMap((o) => [o.medianHhDb, o.medianHvDb]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return <div className="forest-chart-empty">No usable HH/HV measurements to plot.</div>;
  const low = Math.min(...values) - 1;
  const high = Math.max(...values) + 1;
  const x = (index: number) => observations.length <= 1 ? 50 : 20 + index * (560 / (observations.length - 1));
  const y = (value: number | null) => value === null ? null : 168 - ((value - low) / (high - low || 1)) * 130;
  const adjacentSegments = (key: "medianHhDb" | "medianHvDb") => observations.slice(0, -1).flatMap((observation, index) => {
    const first = observation[key]; const second = observations[index + 1][key];
    const firstY = y(first); const secondY = y(second);
    if (firstY === null || secondY === null) return [];
    return [{ x1: x(index), y1: firstY, x2: x(index + 1), y2: secondY, key: `${key}-${observation.date}-${observations[index + 1].date}` }];
  });
  const hhSegments = adjacentSegments("medianHhDb");
  const hvSegments = adjacentSegments("medianHvDb");
  return (
    <div className="forest-chart-wrap">
      <svg className="forest-chart" viewBox="0 0 600 214" role="img" aria-label="Observed median HH and HV backscatter in dB by acquisition date">
        {[0, 1, 2, 3].map((i) => <line key={i} x1="20" x2="580" y1={38 + i * 40} y2={38 + i * 40} className="forest-chart-grid" />)}
        {hhSegments.map((segment) => <line key={segment.key} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} className="forest-chart-hh" />)}
        {hvSegments.map((segment) => <line key={segment.key} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} className="forest-chart-hv" />)}
        {observations.map((obs, i) => {
          const hhY = y(obs.medianHhDb); const hvY = y(obs.medianHvDb);
          return <g key={`${obs.date}-${obs.sceneId}`}>
            {hhY !== null && <circle cx={x(i)} cy={hhY} r={obs.date === activeDate ? 5 : 3} className="forest-dot-hh" />}
            {hvY !== null && <circle cx={x(i)} cy={hvY} r={obs.date === activeDate ? 5 : 3} className="forest-dot-hv" />}
            <text x={x(i)} y="197" textAnchor="middle" className={`forest-chart-date${obs.date === activeDate ? " is-active" : ""}`}>{obs.date.slice(5)}</text>
          </g>;
        })}
      </svg>
      <div className="forest-chart-legend"><span><i className="forest-chart-legend-hh" />HH median (dB)</span><span><i className="forest-chart-legend-hv" />HV median (dB)</span><span>Observed values from loaded rasters</span></div>
    </div>
  );
}

function ReadinessPanel({ analysis }: { analysis: ForestAnalysisDocument }) {
  return (
    <section className="forest-panel" aria-labelledby="forest-readiness-heading">
      <div className="forest-panel-head"><div><p className="forest-kicker">01 / Data checks</p><h2 id="forest-readiness-heading">Readiness gate</h2></div><span className={`forest-status forest-status--${forestReadinessTone(analysis.readiness.status)}`}>{forestReadinessLabel(analysis.readiness.status)}</span></div>
      <p className="forest-muted">The detector runs only after compatibility, chronology, forest mask, raster alignment and valid-coverage checks.</p>
      <div className="forest-check-list">
        {analysis.readiness.checks.map((check) => (
          <article className="forest-check" key={check.id}>
            <span className={`forest-check-dot forest-check-dot--${check.status.toLowerCase()}`} aria-hidden="true" />
            <div><div className="forest-check-title"><strong>{check.label}</strong><span>{check.status}</span></div><p>{check.message}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CandidateInspector({ candidate }: { candidate: ForestCandidate }) {
  return (
    <section className="forest-panel forest-inspector" aria-labelledby="forest-inspector-heading">
      <div className="forest-panel-head"><div><p className="forest-kicker">03 / Candidate audit</p><h2 id="forest-inspector-heading">{candidate.id}</h2></div><span className="forest-status forest-status--warning">Potential</span></div>
      <p className="forest-muted">Observed {candidate.date} · {candidate.sceneId}. This is a radar anomaly, not a confirmed forest-loss event.</p>
      <div className="forest-metric-grid">
        <div><span>Candidate area</span><strong>{fmtNumber(candidate.areaKm2, 3)} km²</strong></div>
        <div><span>Flagged pixels</span><strong>{candidate.pixelCount.toLocaleString()}</strong></div>
        <div><span>HH change vs baseline</span><strong>{fmtNumber(candidate.evidence.medianHhChangeDb)} dB</strong></div>
        <div><span>HV change vs baseline</span><strong>{fmtNumber(candidate.evidence.medianHvChangeDb)} dB</strong></div>
        <div><span>Valid forest coverage</span><strong>{fmtPct(candidate.evidence.validCoverageFraction)}</strong></div>
        <div><span>Retained at +0.5 dB</span><strong>{fmtPct(candidate.evidence.stricterThresholdRetainedFraction)}</strong></div>
      </div>
      <div className="forest-explain-block"><h3>Evidence supporting the flag</h3><ul>{candidate.assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
      <div className="forest-explain-block"><h3>Alternative explanations</h3><div className="forest-alternatives">{candidate.assessment.alternatives.map((alternative) => <article key={alternative.name}><div><strong>{alternative.name}</strong><span className={`forest-mini-status forest-mini-status--${alternative.status.toLowerCase()}`}>{alternative.status}</span></div><p>{alternative.note}</p></article>)}</div></div>
      <div className="forest-optical"><div><p className="forest-kicker">Independent evidence lens</p><h3>{candidate.assessment.opticalEvidence.status.replaceAll("_", " ")}</h3></div><p>{candidate.assessment.opticalEvidence.summary}</p><p className="forest-warning-note">Cause remains unknown. Do not interpret a missing reference as support or contradiction.</p></div>
    </section>
  );
}

function PersistencePanel({ candidate }: { candidate: ForestCandidate }) {
  return (
    <section className="forest-panel">
      <div className="forest-panel-head"><div><p className="forest-kicker">04 / Temporal history</p><h2>Persistence tracker</h2></div><span className="forest-status forest-status--info">{candidate.persistence.replaceAll("_", " ")}</span></div>
      <p className="forest-muted">A date is listed when at least 25% of this candidate&apos;s pixels overlap a detected anomaly on that observation. This simple overlap track is exploratory, not a formal object-tracking algorithm.</p>
      <div className="forest-persistence-dates">{candidate.detectedDates.map((date) => <span key={date}>{date}</span>)}</div>
      <p className="forest-warning-note">“Not redetected” would not mean “recovered.” This analysis does not infer forest recovery.</p>
    </section>
  );
}

function ProvenancePanel({ provenance }: { provenance?: ForestAnalysisProvenance }) {
  if (!provenance) return <section className="forest-panel forest-limitations"><h2>Provenance not available</h2><p>This saved analysis predates the provenance bundle, or source metadata could not be recorded. Do not infer source details that are not present.</p></section>;
  const mask = provenance.forestMask;
  const catalog = provenance.catalog;
  const optical = provenance.independentOpticalContext;
  const radarQuicklooks = provenance.radarQuicklooks;
  const selectedScenes = catalog?.selectedScenes ?? [];
  const opticalDates = optical?.dates ?? [];
  return (
    <section className="forest-panel forest-provenance" aria-labelledby="forest-provenance-heading">
      <div className="forest-panel-head"><div><p className="forest-kicker">06 / Audit trail</p><h2 id="forest-provenance-heading">Source data & reproducibility</h2></div><span className="forest-data-label">PROVENANCE</span></div>
      <div className="forest-provenance-grid">
        <article><h3>NASA NISAR</h3><p>{catalog?.product ?? "Product not recorded"} · {catalog?.maturity ?? "Maturity not recorded"}</p><p>{catalog?.source ?? "Catalog source not recorded"}</p><p>{selectedScenes.length} selected source scenes</p><ul>{selectedScenes.map((scene) => <li key={`${scene.date}-${scene.granuleId}`}><strong>{scene.date}</strong><code>{scene.granuleId}</code></li>)}</ul></article>
        <article><h3>Forest-cover mask</h3><p>{mask?.dataset ?? "Mask dataset not recorded"}</p><p>{typeof mask?.forestPixelCount === "number" ? `${mask.forestPixelCount.toLocaleString()} forest pixels` : "Pixel count not recorded"}{typeof mask?.forestPixelFractionOfGrid === "number" ? ` · ${(mask.forestPixelFractionOfGrid * 100).toFixed(1)}% of the raster grid` : ""}</p>
          {mask?.sourceUrl && <p><a href={mask.sourceUrl} target="_blank" rel="noreferrer">Open official mask source ↗</a></p>}
          {mask?.attribution && <p>{mask.attribution}</p>}
          {mask?.limitations && <p className="forest-warning-note">{mask.limitations}</p>}
          {mask?.tileSources?.map((tile) => tile.sourceUrl ? <p key={tile.tile ?? tile.sourceUrl}><a href={tile.sourceUrl} target="_blank" rel="noreferrer">{tile.tile ?? "WorldCover tile"} ↗</a> · {tile.accessMode ?? "access mode not recorded"}</p> : null)}
        </article>
        <article><h3>Independent optical context</h3><p><strong>{optical?.status ?? "NOT_RECORDED"}</strong></p><p>{optical?.source ?? "Reference source not recorded"}</p>
          {optical?.sourceUrl && <p><a href={optical.sourceUrl} target="_blank" rel="noreferrer">Open HLS product documentation ↗</a></p>}
          <p>Reference validated: {optical?.referenceValidated === true ? "Yes (must not be interpreted as field truth without a documented reference)" : "No"}</p>
          {opticalDates.map((row, index) => <article className="forest-provenance-subrow" key={`${String(row.date ?? "date")}-${index}`}><strong>{String(row.date ?? "Date not recorded")} · {String(row.status ?? "status not recorded")}</strong><p>{String(row.summary ?? "No summary recorded")}</p><p>{row.baselineScene ? `Baseline scene: ${String(row.baselineScene)}` : ""}</p><p>{row.eventScene ? `Event scene: ${String(row.eventScene)}` : ""}</p></article>)}
        </article>
        <article><h3>Measured radar quicklooks</h3><p><strong>{radarQuicklooks?.status ?? "NOT_RECORDED"}</strong></p><p>{typeof radarQuicklooks?.count === "number" && typeof radarQuicklooks.requestedCount === "number" ? `${radarQuicklooks.count} of ${radarQuicklooks.requestedCount} actual HH/HV layer previews rendered` : "Quicklook count not recorded"}</p><p>{radarQuicklooks?.channels?.map((channel) => channel.toUpperCase()).join(" / ") || "Channels not recorded"} · {radarQuicklooks?.source ?? "Source not recorded"}</p>{radarQuicklooks?.message && <p>{radarQuicklooks.message}</p>}</article>
      </div>
      {provenance.detectorSettings && <p className="forest-muted">Screening settings: {provenance.detectorSettings.thresholdDb ?? "—"} dB threshold · {provenance.detectorSettings.robustMultiplier ?? "—"} MAD multiplier · {provenance.detectorSettings.minimumRegionPixels ?? "—"} pixels minimum · {typeof provenance.detectorSettings.minimumValidFraction === "number" ? `${(provenance.detectorSettings.minimumValidFraction * 100).toFixed(0)}%` : "—"} minimum valid coverage.</p>}
      {provenance.cautions && <ul className="forest-provenance-cautions">{provenance.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>}
    </section>
  );
}

export default function ForestWorkbench() {
  const [payload, setPayload] = useState<ForestApiPayload>(EMPTY_PAYLOAD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeObservationIndex, setActiveObservationIndex] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [discovery, setDiscovery] = useState<ForestDiscoveryResult | null>(null);
  const [studyBounds, setStudyBounds] = useState<ForestStudyBounds | null>(null);
  const [mapSelectedBounds, setMapSelectedBounds] = useState<ForestStudyBounds | null>(null);
  const [studyBoundaryGeoJson, setStudyBoundaryGeoJson] = useState<ForestBoundaryGeoJson | null>(null);
  const [savedRuns, setSavedRuns] = useState<ForestRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const handleDiscoveryUpdate = useCallback((value: ForestDiscoveryResult | null) => setDiscovery(value), []);
  const handleStudyAreaChange = useCallback((value: ForestStudyBounds | null) => setStudyBounds(value), []);
  const handleBoundaryChange = useCallback((value: ForestBoundaryGeoJson | null) => setStudyBoundaryGeoJson(value), []);
  const handleMapStudyBoundsChange = useCallback((value: ForestStudyBounds) => {
    setMapSelectedBounds(value);
    setStudyBounds(value);
    setStudyBoundaryGeoJson(null);
  }, []);

  const refresh = useCallback(async (runId?: string) => {
    setLoading(true); setError(null);
    try {
      const endpoint = runId ? `/api/forest/analysis?runId=${encodeURIComponent(runId)}` : "/api/forest/analysis";
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json() as ForestApiPayload;
      if (!response.ok && body.status !== "INVALID") throw new Error(`Forest analysis request failed (${response.status}).`);
      if (body.status === "READY") {
        const parsed = parseForestAnalysis(body.analysis);
        if (!parsed) throw new Error("Forest analysis did not pass schema validation.");
        const firstCandidate = parsed.candidates[0];
        const candidateDateIndex = parsed.observations.findIndex((observation) => observation.date === firstCandidate?.date);
        setActiveObservationIndex(candidateDateIndex >= 0 ? candidateDateIndex : 0);
        setSelectedCandidateId(firstCandidate?.id ?? null);
        setSelectedRunId(parsed.runId);
      } else {
        setActiveObservationIndex(0);
        setSelectedCandidateId(null);
      }
      setPayload(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load forest analysis.");
    } finally { setLoading(false); }
  }, []);

  const refreshSavedRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/forest/runs", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { runs?: ForestRunSummary[] };
      if (Array.isArray(body.runs)) setSavedRuns(body.runs);
    } catch {
      // Run discovery is auxiliary; the loaded analysis remains available if listing fails.
    }
  }, []);

  const handleAnalysisReady = useCallback((runId?: string) => {
    void refresh(runId);
    void refreshSavedRuns();
  }, [refresh, refreshSavedRuns]);

  useEffect(() => {
    const initialRefreshTimer = window.setTimeout(() => {
      void refresh();
      void refreshSavedRuns();
    }, 0);
    return () => window.clearTimeout(initialRefreshTimer);
  }, [refresh, refreshSavedRuns]);
  const analysis = payload.status === "READY" ? payload.analysis : null;
  const observations = analysis?.observations ?? [];
  const safeActiveObservationIndex = Math.min(activeObservationIndex, Math.max(0, observations.length - 1));
  const activeObservation = observations[safeActiveObservationIndex] ?? null;
  useEffect(() => {
    if (!playing || observations.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveObservationIndex((current) => (current + 1) % observations.length);
      setSelectedCandidateId(null);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [playing, observations.length]);
  useEffect(() => {
    if (analysis) return;
    const pauseTimer = window.setTimeout(() => setPlaying(false), 0);
    return () => window.clearTimeout(pauseTimer);
  }, [analysis]);
  const candidates = useMemo(() => analysis?.candidates ?? [], [analysis]);
  const visibleCandidates = activeObservation ? candidates.filter((candidate) => candidate.date === activeObservation.date) : candidates;
  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.id === selectedCandidateId) ?? visibleCandidates[0] ?? (!activeObservation ? candidates[0] : null),
    [candidates, visibleCandidates, selectedCandidateId, activeObservation]);
  const selectObservation = (index: number) => {
    setActiveObservationIndex(index);
    const chosen = observations[index];
    const match = candidates.find((candidate) => candidate.date === chosen?.date);
    setSelectedCandidateId(match?.id ?? null);
  };
  const selectCandidate = (candidate: ForestCandidate) => {
    setSelectedCandidateId(candidate.id);
    const index = observations.findIndex((observation) => observation.date === candidate.date);
    if (index >= 0) setActiveObservationIndex(index);
  };

  const exportReport = (format: "json" | "csv" | "geojson") => {
    if (!analysis) return;
    const prefix = `geonexsar-forest-${analysis.runId}`;
    if (format === "json") downloadFile(`${prefix}.json`, `${JSON.stringify(analysis, null, 2)}\n`, "application/json");
    if (format === "csv") downloadFile(`${prefix}-candidates.csv`, forestCandidateCsv(analysis), "text/csv;charset=utf-8");
    if (format === "geojson") downloadFile(`${prefix}-candidates.geojson`, `${JSON.stringify(forestCandidateGeoJson(analysis), null, 2)}\n`, "application/geo+json");
  };

  return (
    <main className="forest-workbench">
      <header className="forest-topbar"><Link href="/" className="forest-brand">GeoNexSAR <span>/ Forest module</span></Link><nav><Link href="/wetland">Wetland case</Link><Link href="/wetland/global">NISAR worldwide</Link><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh analysis ↻"}</button></nav></header>
      <section className="forest-hero">
        <div><p className="forest-eyebrow"><span /> REAL-DATA FOREST WORKSPACE</p><h1>Investigate the<br /><em>forest signal.</em></h1><p className="forest-hero-copy">A forest-specific NISAR L-band anomaly screen, with evidence you can inspect and limitations that stay visible. It does not equate a backscatter change with confirmed forest loss.</p><div className="forest-hero-actions"><a href="#forest-analysis">Open analysis ↓</a><span>GCOV · frequencyA · HH / HV</span></div></div>
        <div className="forest-hero-instrument"><p>ANALYSIS STATE</p><strong>{loading ? "LOADING" : analysis ? analysis.readiness.status : payload.status}</strong><span>{analysis ? analysis.site.name : "No site loaded"}</span><div className="forest-instrument-rule" /><div className="forest-instrument-meta"><div><span>Observations</span><strong>{analysis ? observations.length : "—"}</strong></div><div><span>Candidate regions</span><strong>{analysis ? candidates.length : "—"}</strong></div><div><span>Independent reference</span><strong>{analysis ? "Not assumed" : "—"}</strong></div></div></div>
      </section>

      <section className="forest-disclaimer"><strong>Science guardrail</strong><p>These outputs are potential structural backscatter anomalies. They are not confirmed deforestation, damage cause, biomass loss, carbon emissions or ecological recovery. No forest results are displayed unless a compatible real-data analysis is saved locally.</p></section>

      <section id="forest-analysis" className="forest-main">
        {!analysis && <ForestPreviewWorkspace discovery={discovery} studyBounds={studyBounds} studyBoundaryGeoJson={studyBoundaryGeoJson} onStudyBoundsChange={handleMapStudyBoundsChange} />}
        <ForestWorkflowControls onAnalysisReady={handleAnalysisReady} onDiscoveryUpdate={handleDiscoveryUpdate} onStudyAreaChange={handleStudyAreaChange} onBoundaryChange={handleBoundaryChange} mapSelectedBounds={mapSelectedBounds} />
        {loading && <section className="forest-empty"><div className="forest-spinner" /><h2>Checking for a processed forest run…</h2><p>Looking for <code>pipeline/output/forest/forest_analysis.json</code>. No example detections are substituted.</p></section>}
        {!loading && error && <section className="forest-empty forest-empty--error"><h2>Could not load forest analysis</h2><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></section>}
        {!loading && !error && !analysis && <section className="forest-empty"><div className="forest-empty-icon">F / 01</div><p className="forest-kicker">No processed case loaded</p><h2>The forest workspace is ready.<br />The data are not loaded yet.</h2><p>{payload.message ?? EMPTY_PAYLOAD.message}</p><div className="forest-empty-grid"><article><strong>1. Discover real scenes</strong><span>Query NASA CMR for at least three compatible NISAR L2 GCOV observations over your forest study box.</span></article><article><strong>2. Authenticate and fetch inputs</strong><span>Earthdata credentials open actual NISAR/HLS science layers; ESA WorldCover tiles are downloaded from the official public source.</span></article><article><strong>3. Inspect the real run</strong><span>The local worker writes provenance, raster evidence and exports. Missing sources cause a visible stop or an inconclusive reference—not a substitute result.</span></article></div>{savedRuns.length > 0 && <label className="forest-run-select forest-run-select--empty"><span>Open a saved forest run</span><select aria-label="Open a saved forest run" defaultValue="" onChange={(event) => { const runId = event.target.value; if (runId) { setSelectedRunId(runId); void refresh(runId); } }}><option value="" disabled>Choose a recorded run…</option>{savedRuns.map((run) => <option key={run.runId} value={run.runId}>{run.siteName} · {run.createdAt.slice(0, 10)} · {run.readiness} · {run.observationCount} dates</option>)}</select></label>}<button type="button" onClick={() => void refresh()}>Check again ↻</button><Link href="/wetland/global">Discover actual NISAR coverage →</Link></section>}
        {!loading && !error && analysis && <>
          <div className="forest-summary-row"><div><p className="forest-kicker">Current case</p><h2>{analysis.site.name}</h2><p className="forest-muted">Run {analysis.runId} · {analysis.createdAt.slice(0, 10)} · {analysis.product ?? "Product not recorded"} · {analysis.productMaturity ?? "Maturity not recorded"}</p>{savedRuns.length > 0 && <label className="forest-run-select"><span>Open a saved real run</span><select aria-label="Open a saved forest run" value={selectedRunId ?? analysis.runId} onChange={(event) => { const runId = event.target.value; setSelectedRunId(runId); void refresh(runId); }}><option value={analysis.runId}>{analysis.site.name} · {analysis.createdAt.slice(0, 10)} · current view</option>{savedRuns.filter((run) => run.runId !== analysis.runId).map((run) => <option key={run.runId} value={run.runId}>{run.siteName} · {run.createdAt.slice(0, 10)} · {run.observationCount} dates</option>)}</select></label>}</div><div className="forest-export-actions"><button type="button" onClick={() => exportReport("json")}>Export report JSON</button><button type="button" onClick={() => exportReport("csv")}>Candidate CSV</button><button type="button" onClick={() => exportReport("geojson")}>Candidate GeoJSON</button></div></div>
          <ReadinessPanel analysis={analysis} />
          <div className="forest-two-col">
            <section className="forest-panel"><div className="forest-panel-head"><div><p className="forest-kicker">02 / Time machine</p><h2>Observed signal history</h2></div><span className="forest-data-label">OBSERVED</span></div><p className="forest-muted">Per-date median HH/HV values from loaded NISAR rasters, not simulated trends. Selecting or playing an acquisition changes the active map date and candidate list.</p><div className="forest-timeline-toolbar" role="group" aria-label="Time Machine playback controls"><button type="button" onClick={() => { setPlaying(false); selectObservation((safeActiveObservationIndex - 1 + observations.length) % observations.length); }} disabled={observations.length < 2} aria-label="Previous acquisition">← Previous</button><button type="button" className="forest-button-primary" onClick={() => setPlaying((value) => !value)} disabled={observations.length < 2} aria-pressed={playing}>{playing ? "Pause timeline" : "Play timeline"}</button><input aria-label="Timeline acquisition position" type="range" min={0} max={Math.max(0, observations.length - 1)} value={safeActiveObservationIndex} disabled={observations.length < 2} onChange={(event) => { setPlaying(false); selectObservation(Number(event.target.value)); }} /><button type="button" onClick={() => { setPlaying(false); selectObservation((safeActiveObservationIndex + 1) % observations.length); }} disabled={observations.length < 2} aria-label="Next acquisition">Next →</button><strong>{activeObservation?.date ?? "No date"}</strong></div><SignalChart observations={observations} activeDate={activeObservation?.date ?? null} /><div className="forest-timeline" role="group" aria-label="Select observation date">{observations.map((observation, index) => <button key={`${observation.date}-${observation.sceneId}`} type="button" className={`${index === safeActiveObservationIndex ? "is-active" : ""}${observation.used ? "" : " is-excluded"}`} onClick={() => selectObservation(index)}><span>{observation.date}</span><strong>{observation.used ? "USED" : "EXCLUDED"}</strong></button>)}</div>{activeObservation && <div className="forest-observation-detail"><div><span>Acquisition date</span><strong>{activeObservation.date}</strong></div><div><span>Scene ID</span><strong>{activeObservation.sceneId}</strong></div><div><span>Valid forest coverage</span><strong>{fmtPct(activeObservation.validCoverageFraction)}</strong></div><div><span>Median HH / HV</span><strong>{fmtNumber(activeObservation.medianHhDb)} / {fmtNumber(activeObservation.medianHvDb)} dB</strong></div>{activeObservation.reason && <p>{activeObservation.reason}</p>}</div>}</section>
            <section className="forest-panel"><div className="forest-panel-head"><div><p className="forest-kicker">Map / selected study area</p><h2>Candidate footprints</h2></div><span className="forest-data-label">DERIVED</span></div><p className="forest-muted">Only polygons emitted from the loaded forest analysis are drawn. Basemap imagery provides geographic context, not forest classification.</p><ForestMap analysis={analysis} activeDate={activeObservation?.date ?? null} selectedCandidateId={selectedCandidate?.id ?? null} onSelectCandidate={(id) => { const candidate = candidates.find((item) => item.id === id); if (candidate) selectCandidate(candidate); }} /></section>
          </div>
          <section className="forest-panel"><div className="forest-panel-head"><div><p className="forest-kicker">Candidate register</p><h2>Potential structural anomalies</h2></div><span>{candidates.length} regions</span></div>{candidates.length === 0 ? <p className="forest-zero-candidates">No candidates passed the current screen. This is not evidence that no forest disturbance occurred; inspect the coverage and method checks before drawing a conclusion.</p> : <><div className="forest-candidate-list">{candidates.map((candidate) => <button type="button" key={candidate.id} className={`forest-candidate-row${candidate.id === selectedCandidate?.id ? " is-active" : ""}`} onClick={() => selectCandidate(candidate)}><span className="forest-candidate-dot" /><span className="forest-candidate-main"><strong>{candidate.id}</strong><small>{candidate.date} · {candidate.persistence.replaceAll("_", " ")}</small></span><span>{fmtNumber(candidate.areaKm2, 3)} km²</span><span className="forest-arrow">↗</span></button>)}</div>{selectedCandidate ? <div className="forest-two-col"><CandidateInspector candidate={selectedCandidate} /><PersistencePanel candidate={selectedCandidate} /></div> : <p className="forest-zero-candidates">No candidate is flagged on the selected date. Choose a candidate in this register to jump to its acquisition date.</p>}</>}</section>
          <section className="forest-panel forest-limitations"><div className="forest-panel-head"><div><p className="forest-kicker">05 / Trust boundaries</p><h2>What this run cannot conclude</h2></div></div><ul>{analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p>Method: {analysis.method.name ?? analysis.methodVersion}. Thresholds must be calibrated against independent forest-disturbance reference data before making performance claims.</p></section>
          <ProvenancePanel provenance={analysis.provenance} />
        </>}
      </section>
      <footer className="forest-footer"><span>GeoNexSAR / Forest monitoring workspace</span><span>Observed → Derived → Uncertain</span><nav><Link href="/">Home</Link><Link href="/wetland">Wetland case</Link><Link href="/wetland/global">NISAR worldwide</Link></nav></footer>
    </main>
  );
}
