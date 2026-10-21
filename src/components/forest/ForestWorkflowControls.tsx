"use client";

import { useEffect, useMemo, useState } from "react";
import ForestCoverageCalendar from "./ForestCoverageCalendar";
import ForestCoverageExplorer from "./ForestCoverageExplorer";
import ForestEarthdataConnection from "./ForestEarthdataConnection";
import ForestJobStatus from "./ForestJobStatus";
import { requestCancel } from "./useForestJob";
import { coverageVerdict, studyAreaProblem, type CoverageStack } from "@/lib/forest-coverage";

export interface ForestBoundaryGeoJson {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown }; properties?: Record<string, unknown> }>;
}

interface ForestWorkflowRequest {
  siteName: string;
  bbox: [number, number, number, number];
  startDate: string;
  endDate: string;
  thresholdDb: number;
  robustMultiplier: number;
  minimumRegionPixels: number;
  minimumValidFraction: number;
  boundaryGeoJson?: ForestBoundaryGeoJson;
}
export interface ForestDiscoveredScene {
  date: string;
  sceneId: string;
  track: string;
  direction: string;
  frame: string;
  bandwidth: string;
  polarizationMode: string;
  pairedPolarizationMode: string;
  processingRelease: string;
}
export interface ForestDiscoveryResult {
  status: "READY" | "INSUFFICIENT_OBSERVATIONS";
  siteName: string;
  product: string;
  productMaturity?: string;
  frequency?: string;
  catalogSource?: string;
  catalogHits: number;
  compatibleSeriesCount?: number;
  minimumRequiredObservations: number;
  selectedSceneIds: string[];
  scenes: ForestDiscoveredScene[];
  compatibility?: Record<string, unknown>;
  /** Every compatible stack found in the catalog for this box (the one used is `usedSeriesId`). */
  seriesOptions?: CoverageStack[];
  usedSeriesId?: string;
  message: string;
}
interface WorkflowResult {
  runId?: string;
  analysisPath?: string;
  runDirectory?: string;
  analysisStatus?: string;
  observationCount?: number;
  candidateCount?: number;
  opticalSummary?: string;
  message?: string;
  status?: string;
  selectedSceneIds?: string[];
  scenes?: ForestDiscoveredScene[];
  siteName?: string;
  catalogHits?: number;
  minimumRequiredObservations?: number;
  product?: string;
  productMaturity?: string;
  compatibleSeriesCount?: number;
  compatibility?: Record<string, unknown>;
  catalogSource?: string;
}
interface ForestJob {
  id: string;
  jobId?: string;
  action: "discover" | "run";
  status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "CANCELLED" | "STALLED";
  stage?: string;
  error?: string | null;
  errorType?: string;
  failedStage?: string;
  stalledReason?: string;
  diagnostics?: Record<string, unknown>;
  logTail?: string[];
  result?: WorkflowResult;
}

const localToday = new Date();
const DEFAULT_END = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`;
const INITIAL_FORM = {
  siteName: "",
  west: "", south: "", east: "", north: "",
  startDate: "2026-06-17", endDate: DEFAULT_END,
  thresholdDb: "2.5", robustMultiplier: "3.0", minimumRegionPixels: "20", minimumValidFraction: "70",
};
const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED", "STALLED"]);

export type ForestStudyBounds = [number, number, number, number];

export default function ForestWorkflowControls({ onAnalysisReady, onDiscoveryUpdate, onStudyAreaChange, onBoundaryChange, mapSelectedBounds }: {
  onAnalysisReady: (runId?: string) => void;
  onDiscoveryUpdate?: (discovery: ForestDiscoveryResult | null) => void;
  onStudyAreaChange?: (bounds: ForestStudyBounds | null) => void;
  onBoundaryChange?: (boundary: ForestBoundaryGeoJson | null) => void;
  mapSelectedBounds?: ForestStudyBounds | null;
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [job, setJob] = useState<ForestJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [discoveryData, setDiscoveryData] = useState<ForestDiscoveryResult | null>(null);
  const [boundaryGeoJson, setBoundaryGeoJson] = useState<ForestBoundaryGeoJson | null>(null);
  const [boundaryFilename, setBoundaryFilename] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastAction, setLastAction] = useState<"discover" | "run">("discover");
  const [cancelling, setCancelling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || (jobStatus && TERMINAL.has(jobStatus))) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/forest/workflow?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const next = await response.json() as ForestJob | { error?: string };
        if (!response.ok || !("status" in next)) throw new Error("Could not read the forest job status.");
        if (disposed) return;
        setJob(next);
        setPollError(null);
        if (next.status === "COMPLETE" && next.action === "discover") {
          const discovered = next.result as ForestDiscoveryResult | undefined;
          const validDiscovery = discovered && Array.isArray(discovered.scenes) && Array.isArray(discovered.selectedSceneIds)
            ? discovered : null;
          setDiscoveryData(validDiscovery);
          setSelectedSceneIds(validDiscovery?.status === "READY" ? [...validDiscovery.selectedSceneIds] : []);
        }
        if (next.status === "COMPLETE" && next.action === "run" && next.result?.runId) onAnalysisReady(next.result.runId);
        if (!TERMINAL.has(next.status)) timer = window.setTimeout(poll, 1600);
      } catch (error) {
        if (!disposed) {
          setPollError(error instanceof Error ? error.message : "Unknown polling error");
          timer = window.setTimeout(poll, 3000);
        }
      }
    };
    void poll();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [jobId, jobStatus, onAnalysisReady]);

  const discovery = discoveryData;

  useEffect(() => {
    onDiscoveryUpdate?.(discovery);
  }, [discovery, onDiscoveryUpdate]);

  const studyBounds = useMemo<ForestStudyBounds | null>(() => {
    const values = [form.west, form.south, form.east, form.north];
    if (values.some((value) => !value.trim())) return null;
    const [west, south, east, north] = values.map(Number);
    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north ||
        west < -180 || east > 180 || south < -90 || north > 90) return null;
    return [west, south, east, north];
  }, [form.west, form.south, form.east, form.north]);

  useEffect(() => {
    onStudyAreaChange?.(studyBounds);
  }, [studyBounds, onStudyAreaChange]);
  useEffect(() => {
    onBoundaryChange?.(boundaryGeoJson);
  }, [boundaryGeoJson, onBoundaryChange]);

  const update = (key: keyof typeof INITIAL_FORM, value: string) => {
    if (["west", "south", "east", "north"].includes(key) && boundaryGeoJson) {
      setBoundaryGeoJson(null);
      setBoundaryFilename(null);
    }
    setForm((current) => ({ ...current, [key]: value }));
  };

  const readBoundaryFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
          (parsed as { type?: unknown }).type !== "FeatureCollection" ||
          !Array.isArray((parsed as { features?: unknown }).features) || !(parsed as { features: unknown[] }).features.length) {
        throw new Error("Upload a GeoJSON FeatureCollection containing Polygon or MultiPolygon features.");
      }
      const features = (parsed as { features: unknown[] }).features;
      const coordinates: Array<[number, number]> = [];
      const walk = (node: unknown) => {
        if (Array.isArray(node) && node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
          const [longitude, latitude] = node;
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
            throw new Error("GeoJSON coordinates must be finite WGS84 longitude/latitude positions.");
          }
          coordinates.push([longitude, latitude]);
          return;
        }
        if (Array.isArray(node)) { for (const child of node) walk(child); }
      };
      const cleanFeatures = features.map((rawFeature) => {
        if (typeof rawFeature !== "object" || rawFeature === null || Array.isArray(rawFeature)) throw new Error("Each GeoJSON feature must be an object.");
        const feature = rawFeature as { type?: unknown; geometry?: unknown; properties?: unknown };
        if (feature.type !== "Feature" || typeof feature.geometry !== "object" || feature.geometry === null || Array.isArray(feature.geometry)) throw new Error("Each GeoJSON feature must contain a geometry.");
        const geometry = feature.geometry as { type?: unknown; coordinates?: unknown };
        if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") throw new Error("Only Polygon and MultiPolygon GeoJSON boundaries are supported.");
        walk(geometry.coordinates);
        if (feature.properties !== undefined && (typeof feature.properties !== "object" || feature.properties === null || Array.isArray(feature.properties))) throw new Error("GeoJSON feature properties must be an object when provided.");
        return { type: "Feature" as const, geometry: geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown }, properties: (feature.properties ?? {}) as Record<string, unknown> };
      });
      if (!coordinates.length) throw new Error("No polygon coordinates were found in this GeoJSON file.");
      const west = Math.min(...coordinates.map((point) => point[0]));
      const south = Math.min(...coordinates.map((point) => point[1]));
      const east = Math.max(...coordinates.map((point) => point[0]));
      const north = Math.max(...coordinates.map((point) => point[1]));
      if (west >= east || south >= north) throw new Error("The GeoJSON boundary must span a non-zero area.");
      setBoundaryGeoJson({ type: "FeatureCollection", features: cleanFeatures });
      setBoundaryFilename(file.name);
      setForm((current) => ({ ...current, west: String(Number(west.toFixed(7))), south: String(Number(south.toFixed(7))), east: String(Number(east.toFixed(7))), north: String(Number(north.toFixed(7))) }));
      setFormError(null);
    } catch (error) {
      setBoundaryGeoJson(null);
      setBoundaryFilename(null);
      setFormError(error instanceof Error ? error.message : "Could not read the GeoJSON boundary.");
    }
  };
  // A box drawn on the map replaces the typed coordinates. Adjusting state while rendering (keyed by the bounds' values) is
  // React's supported way to derive state from a changed prop; an effect would render once with stale fields first.
  const mapBoundsKey = mapSelectedBounds ? mapSelectedBounds.join(",") : "";
  const [appliedMapBounds, setAppliedMapBounds] = useState("");
  if (mapSelectedBounds && mapBoundsKey !== appliedMapBounds) {
    setAppliedMapBounds(mapBoundsKey);
    const [west, south, east, north] = mapSelectedBounds;
    setBoundaryGeoJson(null);
    setBoundaryFilename(null);
    setForm((current) => ({ ...current, west: String(west), south: String(south), east: String(east), north: String(north) }));
    setFormError(null);
  }
  const applyStudyArea = (box: ForestStudyBounds, label: string) => {
    setBoundaryGeoJson(null);
    setBoundaryFilename(null);
    setForm((current) => ({ ...current, west: String(box[0]), south: String(box[1]), east: String(box[2]), north: String(box[3]), siteName: current.siteName.trim() ? current.siteName : label.slice(0, 80) }));
    setDiscoveryData(null);
    setSelectedSceneIds([]);
    setJob(null);
    setJobId(null);
    setFormError(null);
  };
  const cancelJob = async () => {
    if (!jobId) return;
    setCancelling(true);
    const problem = await requestCancel(jobId);
    if (problem) setFormError(problem);
    setCancelling(false);
  };
  const getRequest = (): ForestWorkflowRequest | null => {
    const coordinates = [form.west, form.south, form.east, form.north];
    if (!form.siteName.trim()) { setFormError("Enter a clear name for this forest study area."); return null; }
    if (coordinates.some((value) => value.trim() === "")) { setFormError("Enter all four bounding-box coordinates. Use WGS84 decimal degrees in west, south, east, north order."); return null; }
    const bbox = coordinates.map(Number);
    if (!bbox.every(Number.isFinite)) { setFormError("All bounding-box values must be finite numbers."); return null; }
    if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) { setFormError("West must be less than east, and south must be less than north."); return null; }
    if (bbox[2] - bbox[0] > 0.20 || bbox[3] - bbox[1] > 0.20 || (bbox[2]-bbox[0])*(bbox[3]-bbox[1]) > 0.025) {
      setFormError("Choose a smaller study box: maximum 0.20° per side and 0.025 square degrees."); return null;
    }
    if (!form.startDate || !form.endDate || form.startDate > form.endDate || form.endDate > DEFAULT_END) {
      setFormError("Choose an ordered date range that does not extend into the future."); return null;
    }
    const thresholdDb = Number(form.thresholdDb);
    const robustMultiplier = Number(form.robustMultiplier);
    const minimumRegionPixels = Number(form.minimumRegionPixels);
    const minimumValidFraction = Number(form.minimumValidFraction) / 100;
    if (!Number.isFinite(thresholdDb) || thresholdDb < 0.5 || thresholdDb > 8) {
      setFormError("The change threshold must be between 0.5 and 8 dB."); return null;
    }
    if (!Number.isFinite(robustMultiplier) || robustMultiplier < 1 || robustMultiplier > 8) {
      setFormError("The robust MAD multiplier must be between 1 and 8."); return null;
    }
    if (!Number.isInteger(minimumRegionPixels) || minimumRegionPixels < 1 || minimumRegionPixels > 1000000) {
      setFormError("Minimum candidate size must be a whole number between 1 and 1,000,000 pixels."); return null;
    }
    if (!Number.isFinite(minimumValidFraction) || minimumValidFraction < 0.1 || minimumValidFraction > 1) {
      setFormError("Minimum valid coverage must be between 10% and 100%."); return null;
    }
    setFormError(null);
    return { siteName: form.siteName.trim(), bbox: bbox as ForestWorkflowRequest["bbox"], startDate: form.startDate, endDate: form.endDate,
      thresholdDb, robustMultiplier, minimumRegionPixels, minimumValidFraction,
      ...(boundaryGeoJson ? { boundaryGeoJson } : {}) };
  };

  const startJob = async (action: "discover" | "run") => {
    const request = getRequest();
    if (!request) return;
    if (action === "run" && selectedSceneIds.length < 3) {
      setFormError("Select at least three compatible acquisition dates before starting analysis."); return;
    }
    setLastAction(action); setPollError(null);
    setSubmitting(true); setFormError(null); setJob(null); setJobId(null);
    if (action === "discover") setDiscoveryData(null);
    try {
      const response = await fetch("/api/forest/workflow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, request, ...(action === "run" ? { selectedSceneIds } : {}) }),
      });
      const body = await response.json() as ForestJob | { error?: string };
      if (!response.ok || !("jobId" in body) || !body.jobId) {
        const failure = body as { error?: string; repair?: string[] };
        throw new Error([failure.error || `Could not start the forest job (${response.status}).`, failure.repair?.length ? `Repair: ${failure.repair.join("  then  ")}` : ""].filter(Boolean).join(" "));
      }
      setJob(body as ForestJob); setJobId(body.jobId);
      if (action === "discover") setSelectedSceneIds([]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start the real-data forest workflow.");
    } finally { setSubmitting(false); }
  };

  const busy = submitting || Boolean(job && !TERMINAL.has(job.status));
  return (
    <section className="forest-panel forest-workflow-setup" aria-labelledby="forest-live-workflow-title">
      <div className="forest-panel-head"><div><p className="forest-kicker">00 / Live data pipeline</p><h2 id="forest-live-workflow-title">Start a real forest investigation</h2></div><span className="forest-data-label">NASA CMR → NISAR → ESA → HLS</span></div>
      <p className="forest-muted">Choose a compact study box and dates. Discovery queries NASA&apos;s live catalog; running analysis opens real GCOV science files, reads only the relevant blocks of ESA WorldCover cloud-optimized tiles, and attempts a date-matched HLS vegetation-index comparison. No forest results or fallback data are bundled.</p>
      <ForestCoverageExplorer startDate={form.startDate} endDate={form.endDate} studyBounds={studyBounds} onUseArea={applyStudyArea} />
      <p className="forest-kicker forest-step-kicker">Step 2 · Define the study area and dates</p>
      <div className="forest-input-grid">
        <label className="forest-input-field forest-input-field--wide"><span>Study area name</span><input value={form.siteName} onChange={(e) => update("siteName", e.target.value)} placeholder="e.g. Northern Borneo forest study" maxLength={80} /></label>
        <label className="forest-input-field"><span>West longitude</span><input type="number" step="any" value={form.west} onChange={(e) => update("west", e.target.value)} placeholder="e.g. 114.0" /></label>
        <label className="forest-input-field"><span>South latitude</span><input type="number" step="any" value={form.south} onChange={(e) => update("south", e.target.value)} placeholder="e.g. 1.0" /></label>
        <label className="forest-input-field"><span>East longitude</span><input type="number" step="any" value={form.east} onChange={(e) => update("east", e.target.value)} placeholder="e.g. 114.15" /></label>
        <label className="forest-input-field"><span>North latitude</span><input type="number" step="any" value={form.north} onChange={(e) => update("north", e.target.value)} placeholder="e.g. 1.15" /></label>
        <label className="forest-input-field forest-input-field--wide"><span>Optional sourced forest study boundary (GeoJSON)</span><input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => void readBoundaryFile(event.target.files?.[0] ?? null)} /></label>
        {boundaryFilename && <div className="forest-boundary-loaded forest-input-field--wide"><strong>{boundaryFilename}</strong><span>Polygon boundary will be applied to the rasterized forest mask; the bbox above is used for NASA catalog discovery.</span><button type="button" onClick={() => { setBoundaryGeoJson(null); setBoundaryFilename(null); }}>Remove boundary</button></div>}
        <label className="forest-input-field"><span>From date</span><input type="date" min="2026-06-17" max={form.endDate || DEFAULT_END} value={form.startDate} onChange={(e) => update("startDate", e.target.value)} /></label>
        <label className="forest-input-field"><span>To date</span><input type="date" min={form.startDate || "2026-06-17"} max={DEFAULT_END} value={form.endDate} onChange={(e) => update("endDate", e.target.value)} /></label>
      </div>
      {(() => { const problem = studyBounds ? studyAreaProblem(studyBounds) : null; return problem ? <p className="forest-workflow-error" role="status">{problem}</p> : null; })()}
      <details className="forest-advanced-settings"><summary>Detector settings (defaults are exploratory)</summary><div className="forest-input-grid forest-input-grid--compact">
        <label className="forest-input-field"><span>Absolute change threshold (dB)</span><input type="number" min="0.5" max="8" step="0.1" value={form.thresholdDb} onChange={(e) => update("thresholdDb", e.target.value)} /></label>
        <label className="forest-input-field"><span>Robust MAD multiplier</span><input type="number" min="1" max="8" step="0.1" value={form.robustMultiplier} onChange={(e) => update("robustMultiplier", e.target.value)} /></label>
        <label className="forest-input-field"><span>Minimum candidate pixels</span><input type="number" min="1" max="1000000" step="1" value={form.minimumRegionPixels} onChange={(e) => update("minimumRegionPixels", e.target.value)} /></label>
        <label className="forest-input-field"><span>Minimum valid forest coverage (%)</span><input type="number" min="10" max="100" step="1" value={form.minimumValidFraction} onChange={(e) => update("minimumValidFraction", e.target.value)} /></label>
      </div><p className="forest-muted">These parameters tune candidate screening; they are not a calibrated forest-loss model. Record and compare settings before interpreting results.</p></details>
      <p className="forest-warning-note">The bbox defines where to search and analyze; it is not a mapped forest boundary. The automatic mask streams only needed blocks from actual ESA WorldCover 2021 v200 COGs (tree-cover and mangrove classes). It is a 2021 land-cover mask, not a current forest inventory. Keep the area small for manageable NISAR data and memory use.</p>
      {formError && <p className="forest-workflow-error" role="alert">{formError}</p>}
      <div className="forest-workflow-actions"><button type="button" onClick={() => void startJob("discover")} disabled={busy}>{busy ? "Working…" : "1. Discover real NISAR scenes"}</button><button type="button" className="forest-button-primary" onClick={() => void startJob("run")} disabled={busy || !discovery || discovery.status !== "READY" || selectedSceneIds.length < 3}>2. Run full forest analysis</button></div>
      <p className="forest-kicker forest-step-kicker">Step 3 · Connect Earthdata (needed to download data)</p>
      <ForestEarthdataConnection />

      <ForestJobStatus job={job} pollError={pollError} onCancel={() => void cancelJob()} onRetry={() => void startJob(lastAction)} cancelling={cancelling} />
      {discovery && <div className="forest-discovery-result"><div className="forest-panel-head"><div><p className="forest-kicker">Live catalog result</p><h3>{discovery.siteName}</h3></div><span className={`forest-status forest-status--${discovery.status === "READY" ? "pass" : "warning"}`}>{discovery.status.replaceAll("_", " ")}</span></div><p className="forest-muted">NASA CMR hits: {discovery.catalogHits} · compatible series dates: {discovery.scenes.length} · minimum: {discovery.minimumRequiredObservations}</p><p>{discovery.message}</p>
        {discovery.scenes.length > 0 && <><div className="forest-discovery-signature"><span>Track <strong>{String(discovery.compatibility?.track ?? "—")}</strong></span><span>Pass <strong>{String(discovery.compatibility?.direction ?? "—")}</strong></span><span>Frame <strong>{String(discovery.compatibility?.frame ?? "—")}</strong></span><span>Release <strong>{String(discovery.compatibility?.release ?? "—")}</strong></span></div><div className="forest-scene-select-list">{discovery.scenes.map((scene) => <label key={scene.sceneId} className="forest-scene-select"><input type="checkbox" checked={selectedSceneIds.includes(scene.sceneId)} disabled={discovery.status !== "READY" || busy} onChange={(e) => setSelectedSceneIds((current) => e.target.checked ? [...current, scene.sceneId] : current.filter((id) => id !== scene.sceneId))} /><span><strong>{scene.date}</strong><small>{scene.sceneId}</small></span><em>{scene.direction} · track {scene.track} · pol {scene.polarizationMode}/{scene.pairedPolarizationMode} · mode {scene.bandwidth}</em></label>)}</div><p className="forest-muted">Selected {selectedSceneIds.length} of {discovery.scenes.length} acquisitions. Keep at least three unique dates; the server rechecks every scene against NASA&apos;s live catalog before processing.</p></>}
        {discovery.status === "READY" && <p className="forest-warning-note">These are catalog records. Starting the analysis downloads the real GCOV science files (this needs the Earthdata connection above to say Connected), reads the ESA WorldCover mask, and attempts an HLS comparison. If a required source is missing, the run records a failure or an unavailable reference instead of inventing data.</p>}
        {discovery.seriesOptions && discovery.seriesOptions.length > 0 && <><p className="forest-kicker">Coverage calendar for this box</p><ForestCoverageCalendar stacks={discovery.seriesOptions} windowStart={form.startDate} windowEnd={form.endDate} usedId={discovery.usedSeriesId} /></>}
        {(() => { const v = coverageVerdict({ catalogHits: discovery.catalogHits, usableStacks: discovery.seriesOptions ? discovery.seriesOptions.filter((o) => o.sufficient).length : (discovery.status === "READY" ? 1 : 0), bestCount: discovery.seriesOptions?.[0]?.count ?? discovery.scenes.length }); return <p className={`forest-verdict-line forest-verdict-line--${v.tone}`}><strong>{v.headline}.</strong> {v.detail}</p>; })()}
      </div>}
      {job?.action === "run" && job.status === "COMPLETE" && job.result?.runId && <div className={`forest-run-complete${job.result.analysisStatus === "BLOCKED" ? " is-blocked" : ""}`}><strong>{job.result.analysisStatus === "BLOCKED" ? "Diagnostic report saved · analysis blocked" : "Run " + job.result.runId}</strong><p>{job.result.message}</p><p>Run ID: {job.result.runId} · Observations: {job.result.observationCount ?? "—"} · candidate regions: {job.result.candidateCount ?? "—"} · optical check: {job.result.opticalSummary ?? "status saved in report"}</p><button type="button" onClick={() => onAnalysisReady(job.result?.runId)}>Open this analysis ↻</button></div>}
    </section>
  );
}
