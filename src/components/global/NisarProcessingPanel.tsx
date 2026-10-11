"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { BoundaryCollection } from "./GlobalNisarDetectionMap";
import { localWorkflowStatus } from "@/lib/local-workflow-status";
import { processingProgress, type ProcessingProgress } from "@/lib/processing-progress";

export type AreaBounds = [number, number, number, number];
type Scene = { date: string; name: string; full_granule_gb: number | null };
type SearchResult = { site_name: string; product: string; scenes: Scene[]; catalog_hits: number; search_limit_reached: boolean; note: string };
type SavedAreaOption = { run_id: string; site_name: string; baseline_date: string; selected_date: string };
type Job = { id: string; action: string; status: string; stage?: string; error?: string;
  result?: SearchResult & { run_id?: string; reference_status?: string; evaluated_pairs?: number; evidence_prepared?: boolean; counts_reproduced?: boolean; matching_pixels?: number; radar_only_pixels?: number } };

export function validArea(bounds: AreaBounds | null): bounds is AreaBounds {
  return !!bounds && bounds.every(Number.isFinite) && bounds[0] >= -180 && bounds[2] <= 180 && bounds[1] >= -85 && bounds[3] <= 85 && bounds[0] < bounds[2] && bounds[1] < bounds[3];
}

export function boundaryBounds(boundary: BoundaryCollection): AreaBounds {
  const points: number[][] = [];
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") points.push(value as number[]);
    else value.forEach(visit);
  }
  boundary.features.forEach((feature) => {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") throw new Error("Use only Polygon or MultiPolygon features.");
    visit(feature.geometry.coordinates);
  });
  if (!points.length || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error("The boundary has no valid coordinates.");
  const bounds: AreaBounds = [Infinity, Infinity, -Infinity, -Infinity];
  points.forEach(([x, y]) => { bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y); });
  if (!validArea(bounds)) throw new Error("Use a WGS84 boundary between 85°S and 85°N that does not cross the date line.");
  return bounds;
}


export default function NisarProcessingPanel({ bounds, boundary, drawing, onDraw, onAreaChange, loadedArea, onRunReady, savedAreas, onLoadSavedArea, onProgress, quickStartBox = false, quickStartSiteName = "" }: {
  bounds: AreaBounds | null; boundary: BoundaryCollection | null; drawing: boolean;
  onDraw: (drawing: boolean) => void; onAreaChange: (bounds: AreaBounds, boundary: BoundaryCollection | null) => void; quickStartBox?: boolean;
  loadedArea: { runId: string; name: string; boundary: BoundaryCollection; baselineDate: string; eventDate: string } | null;
  onRunReady: (runId: string) => void;
  savedAreas: SavedAreaOption[]; onLoadSavedArea: (runId: string) => void;
  onProgress: (progress: ProcessingProgress) => void;
  quickStartSiteName?: string;
}) {
  const [siteName, setSiteName] = useState("");
  const [startDate, setStartDate] = useState("2026-06-17");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loginCommand, setLoginCommand] = useState("");
  const [loginShell, setLoginShell] = useState("a terminal");
  const [venvReady, setVenvReady] = useState<boolean | null>(null);
  const [earthdataMsg, setEarthdataMsg] = useState("");
  const [commandCopied, setCommandCopied] = useState(false);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchedFingerprint, setSearchedFingerprint] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [loadedResultRunId, setLoadedResultRunId] = useState<string | null>(null);
  const [launchedRunRequest, setLaunchedRunRequest] = useState<{ fingerprint: string; before: string; after: string } | null>(null);
  const request = { siteName: siteName.trim(), bbox: bounds, boundary, startDate, endDate };
  const fingerprint = JSON.stringify(request);
  const searchFingerprint = useRef("");
  const busy = submitting || job?.status === "RUNNING" || job?.status === "QUEUED";
  const workflowStatus = localWorkflowStatus(job, submitting);
  const jobId = job?.id;
  const jobStatus = job?.status;
  const usableSearch = search && searchedFingerprint === fingerprint ? search : null;
  const datesValid = !!startDate && !!endDate && startDate <= endDate && endDate <= new Date().toISOString().slice(0, 10);
  const smallEnough = validArea(bounds) && bounds[2]-bounds[0] <= 2 && bounds[3]-bounds[1] <= 2;
  const runFinished = job?.action === "run" && job.status === "COMPLETE" && !!job.result?.run_id;
  useEffect(() => {
    if (runFinished && loadedArea?.runId === job?.result?.run_id) setLoadedResultRunId(job?.result?.run_id ?? null);
  }, [runFinished, loadedArea?.runId, job?.result?.run_id]);
  const progress = processingProgress({
    areaReady: validArea(bounds) && siteName.trim().length >= 2 && smallEnough,
    searchComplete: !!usableSearch && usableSearch.scenes.length >= 2,
    processingStarted: launchedRunRequest?.fingerprint === fingerprint && launchedRunRequest.before === before && launchedRunRequest.after === after && job?.action === "run" && ["QUEUED", "RUNNING", "COMPLETE"].includes(job.status),
    processingComplete: launchedRunRequest?.fingerprint === fingerprint && launchedRunRequest.before === before && launchedRunRequest.after === after && runFinished,
    resultsLoaded: launchedRunRequest?.fingerprint === fingerprint && launchedRunRequest.before === before && launchedRunRequest.after === after && !!loadedResultRunId && loadedResultRunId === loadedArea?.runId,
    failed: launchedRunRequest?.fingerprint === fingerprint && launchedRunRequest.before === before && launchedRunRequest.after === after && job?.action === "run" && job.status === "FAILED",
  });
  const progressKey = JSON.stringify(progress);
  const reportedProgress = useRef("");
  useEffect(() => {
    if (reportedProgress.current === progressKey) return;
    reportedProgress.current = progressKey;
    onProgress(progress);
  }, [progressKey, onProgress, progress]);

  useEffect(() => {
    if (quickStartBox && quickStartSiteName.trim()) setSiteName(quickStartSiteName.slice(0, 80));
  }, [quickStartBox, quickStartSiteName]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const freshLocationHandoff = params.get("analyze") === "1";
    const saved = freshLocationHandoff ? null : localStorage.getItem("beyonders-nisar-job");
    const requestedSite = params.get("site")?.trim();
    if (freshLocationHandoff && requestedSite) setSiteName(requestedSite.slice(0, 80));
    fetch(`/api/wetland/processing${saved ? `?id=${encodeURIComponent(saved)}` : ""}`, { signal: controller.signal })
      .then((r) => r.json()).then((r) => {
        if (r.loginCommand) setLoginCommand(r.loginCommand);
        if (r.loginShell) setLoginShell(r.loginShell);
        if (typeof r.venvReady === "boolean") setVenvReady(r.venvReady);
        const restored = freshLocationHandoff ? null : r.areaRequest;
        if (restored && validArea(restored.bbox) && typeof restored.siteName === "string" && typeof restored.startDate === "string" && typeof restored.endDate === "string") {
          if (restored.boundary) boundaryBounds(restored.boundary);
          setSiteName(restored.siteName); setStartDate(restored.startDate); setEndDate(restored.endDate);
          onAreaChange(restored.bbox, restored.boundary);
          searchFingerprint.current = JSON.stringify({ siteName: restored.siteName.trim(), bbox: restored.bbox,
            boundary: restored.boundary, startDate: restored.startDate, endDate: restored.endDate });
          if (r.job?.action === "search" && r.job.status === "COMPLETE" && r.job.result?.scenes?.length) {
            setSearch(r.job.result); setSearchedFingerprint(searchFingerprint.current);
            setBefore(r.job.result.scenes[0].name); setAfter(r.job.result.scenes.at(-1).name);
          }
        }
        if (r.job && !freshLocationHandoff) setJob(r.job);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [onAreaChange]);

  useEffect(() => {
    if (!jobId || !["RUNNING", "QUEUED"].includes(jobStatus || "")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/wetland/processing?id=${jobId}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not read job progress.");
        const update = result.job as Job;
        setJob(update);
        if (update.status === "COMPLETE") {
          if (update.action === "search" && update.result?.scenes) {
            setSearch(update.result); setSearchedFingerprint(searchFingerprint.current);
            setBefore(update.result.scenes[0].name); setAfter(update.result.scenes.at(-1)?.name || "");
          } else if (update.result?.run_id) onRunReady(update.result.run_id);
          else if (update.action === "setup" && (update.result as { venv_ready?: boolean } | undefined)?.venv_ready) setVenvReady(true);
          return;
        }
        if (update.status === "FAILED") return;
        timer = setTimeout(poll, 2000);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Progress temporarily unavailable.");
        timer = setTimeout(poll, 5000);
      }
    }
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, jobStatus, onRunReady]);

  async function startJob(action: string) {
    setSubmitting(true); setError("");
    onDraw(false);
    if (action === "search") { searchFingerprint.current = fingerprint; setLoadedResultRunId(null); setLaunchedRunRequest(null); }
    if (action === "run") { setLoadedResultRunId(null); setLaunchedRunRequest({ fingerprint, before, after }); }
    try {
      const body = action === "setup" ? { action }
        : action === "reference" || action === "preview" || action === "evidence" ? { action, runId: loadedArea?.runId }
        : { ...request, action, ...(action === "run" ? { sceneNames: [before, after] } : {}) };
      const response = await fetch("/api/wetland/processing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (result.job) { setJob(result.job); localStorage.setItem("beyonders-nisar-job", result.job.id); }
      if (!response.ok) throw new Error(result.error || "Could not start processing.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start processing."); }
    finally { setSubmitting(false); }
  }

  async function connectEarthdata() {
    setEarthdataMsg(""); setError("");
    try {
      const response = await fetch("/api/wetland/processing", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "earthdata-login" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open the sign-in terminal.");
      setEarthdataMsg(result.opened
        ? "A separate PowerShell window was launched. Sign in there; if no window appears, run the command in the expanded section below."
        : (result.error || "Could not open a terminal automatically."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open the sign-in terminal."); }
  }

  function applyCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const area = ["west", "south", "east", "north"].map((key) => Number(data.get(key))) as AreaBounds;
    if (!validArea(area)) { setError("Enter west < east and south < north in WGS84 longitude/latitude."); return; }
    setError(""); onAreaChange(area, null);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 900000) throw new Error("Use a boundary file smaller than 900 KB.");
      const value = JSON.parse(await file.text()) as BoundaryCollection;
      if (value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Upload a GeoJSON FeatureCollection.");
      const area = boundaryBounds(value);
      onAreaChange(area, value); onDraw(false); setError("");
      if (!siteName.trim()) setSiteName(file.name.replace(/\.(geojson|json)$/i, "").replaceAll("_", " "));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid boundary file."); }
  }

  const pairValid = usableSearch && before !== after && (usableSearch.scenes.findIndex((s) => s.name === before) < usableSearch.scenes.findIndex((s) => s.name === after));
  const chosenSize = usableSearch?.scenes.filter((s) => s.name === before || s.name === after).reduce((n, s) => n + (s.full_granule_gb || 0), 0);
  return <section className="nisar-tools-section" id="nisar-process" aria-labelledby="nisar-process-title">
    <div className="nisar-tools-heading"><div><p className="global-eyebrow">LOCAL WORKFLOW</p><h2 id="nisar-process-title">Find a pair. See what changed.</h2>
      <p>Name the place, select its area on the map, then search real NISAR observations.</p></div>
      <span className="global-source-pill">Local processor · Earthdata Login required for science files</span></div>
    {venvReady === false && (
      <div className="nisar-setup-card" role="status">
        <div>
          <h3>Set up the local pipeline</h3>
          <p>One click creates the pipeline&apos;s Python environment and installs its science libraries on this computer (a few minutes, only this project&apos;s own requirements). Nothing is typed by you — except the Earthdata sign-in later, in your terminal.</p>
          {job?.action === "setup" && ["QUEUED", "RUNNING"].includes(job.status ?? "") && (
            <p className="nisar-setup-progress" aria-live="polite"><span className="nisar-spinner" aria-hidden="true" />{job.stage || "Working…"}</p>
          )}
          {job?.action === "setup" && job.status === "FAILED" && (
            <p className="nisar-tool-error" role="alert">{job.error || "Setup failed."}</p>
          )}
        </div>
        <button type="button" className="nisar-primary-button" disabled={busy} onClick={() => void startJob("setup")}>
          {job?.action === "setup" && ["QUEUED", "RUNNING"].includes(job.status ?? "") ? "Setting up…" : "Set up the pipeline"}
        </button>
      </div>
    )}
    <div className="nisar-process-grid">
      <div className="nisar-process-step"><h3>1. Choose the study area</h3>
        <label htmlFor="process-saved-area">Load a saved study area from a previous local run</label>
        <select id="process-saved-area" className="detection-select" value="" disabled={busy || savedAreas.length === 0} onChange={(event) => {
          const savedArea = savedAreas.find((area) => area.run_id === event.target.value);
          if (!savedArea) return;
          setSiteName(savedArea.site_name);
          setError("");
          onLoadSavedArea(savedArea.run_id);
        }}>
          <option value="">{savedAreas.length ? "Choose a saved area…" : "No saved areas yet"}</option>
          {savedAreas.map((area) => <option key={area.run_id} value={area.run_id}>{area.site_name} · {area.baseline_date} → {area.selected_date}</option>)}
        </select>
        <p className="nisar-tool-hint">Only completed processing runs saved on this computer appear here. The bundled Tanguar showcase is separate. Selecting a saved run loads its boundary (or its saved bounding box) and place name.</p>
        <label htmlFor="process-name">Place name for this run</label><input id="process-name" value={siteName} maxLength={80} placeholder="e.g. Your wetland or floodplain" onChange={(e) => setSiteName(e.target.value)} disabled={busy} />
        <p className="nisar-tool-hint">The name is only a label; it does not select an area. Draw a box on the map, upload a GeoJSON boundary, or enter coordinates below to enable the catalog search.</p>
        <div className="nisar-tool-actions"><button type="button" onClick={() => { onDraw(!drawing); document.querySelector(".global-map-wrap")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }} disabled={busy}>{drawing ? "Cancel drawing" : "Draw area on map"}</button>
          {loadedArea && <button type="button" onClick={() => { setSiteName(loadedArea.name); onAreaChange(boundaryBounds(loadedArea.boundary), loadedArea.boundary); onDraw(false); }} disabled={busy}>Use loaded study area</button>}</div>
        <label htmlFor="process-boundary">Or upload a wetland boundary (GeoJSON)</label><input id="process-boundary" type="file" accept=".geojson,.json,application/geo+json" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        <p className="nisar-tool-hint">{boundary ? "Selected polygon is the analysis mask." : "A drawn box is a rectangular analysis area, not a mapped wetland boundary."} Maximum 2° across; smaller areas finish sooner.</p>
        {validArea(bounds) && <p className="nisar-area-readout">{bounds.map((n) => n.toFixed(4)).join(" / ")} · west / south / east / north</p>}
        {quickStartBox && <p className="nisar-tool-hint nisar-quickstart-note">Quick-start rectangle centered on the selected map pin. This is an editable study area, not an existing wetland boundary; draw a box or upload a GeoJSON boundary for a more exact mask.</p>}
        <details><summary>Enter coordinates instead</summary><form key={bounds?.join(",") || "empty"} onSubmit={applyCoordinates}><div className="nisar-coordinate-grid">{["West", "South", "East", "North"].map((label, i) => <label key={label}>{label}<input name={label.toLowerCase()} type="number" step="any" required defaultValue={bounds?.[i]} /></label>)}</div><button type="submit" disabled={busy}>Apply coordinates</button></form></details>
      </div>
      <div className="nisar-process-step"><h3>2. Check NASA coverage &amp; observations</h3>
        <div className="nisar-date-grid"><label>From<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} /></label><label>To<input type="date" value={endDate} min={startDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setEndDate(e.target.value)} disabled={busy} /></label></div>
        <button type="button" className="nisar-primary-button" disabled={busy || siteName.trim().length < 2 || !smallEnough || !datesValid} onClick={() => void startJob("search")}>Check real NASA observations</button>
        <p className="nisar-tool-hint">This performs the real local catalogue search for your boundary and date range. It does not classify the area. A scene footprint is coverage evidence, not a detection.</p>
        {usableSearch && <div className="nisar-catalog-summary" role="status" aria-live="polite">
          <div className="nisar-catalog-summary__head"><strong>NASA catalogue preflight</strong><span>{usableSearch.scenes.length} compatible dates · {usableSearch.catalog_hits} catalogue records</span></div>
          <p>{usableSearch.note || (usableSearch.scenes.length ? "The pipeline found observations meeting its current compatibility checks. Review the dates below before downloading science data." : "No compatible observations were returned for this area and date window.")}</p>
          {usableSearch.search_limit_reached && <p className="nisar-catalog-empty">The query reached its search limit. Narrow the date range to inspect more precisely.</p>}
          {usableSearch.scenes.length > 0 ? <>
            <ul className="nisar-scene-list" aria-label="Compatible NASA observations">
              {usableSearch.scenes.map((scene) => <li key={scene.name}><time dateTime={scene.date}>{scene.date}</time><code title={scene.name}>{scene.name}</code></li>)}
            </ul>
            <label>Before<select value={before} onChange={(e) => setBefore(e.target.value)} disabled={busy}>{usableSearch.scenes.map((scene) => <option key={scene.name} value={scene.name}>{scene.date}</option>)}</select></label>
            <label>After<select value={after} onChange={(e) => setAfter(e.target.value)} disabled={busy}>{usableSearch.scenes.map((scene) => <option key={scene.name} value={scene.name}>{scene.date}</option>)}</select></label>
            <p className="nisar-tool-hint">{chosenSize ? `Selected full granules total about ${chosenSize.toFixed(2)} GB. ` : "Science granules may be several GB each. "}The processor requests cropped radar data; actual transfer depends on file layout.</p>
            <button className="nisar-primary-button" type="button" disabled={busy || !pairValid} onClick={() => void startJob("run")}>Process selected NISAR pair</button>
            {!pairValid && <p className="nisar-tool-hint">Choose an after date later than the before date.</p>}
          </> : <p className="nisar-catalog-empty">No compatible pair is available from this search. Try a different date range or a nearby study area. No detections have been generated.</p>}
        </div>}
      </div>
      <div className="nisar-process-step"><h3>3. Select, launch and follow</h3><p>Completed runs include radar layers, candidate polygons, dates, rules, uncertainty and an attempted independent HLS comparison.</p>
        <div className="nisar-job-status" role="status" aria-live="polite" aria-busy={workflowStatus.busy}><strong>{workflowStatus.title}</strong><span>{workflowStatus.message}</span>
          {busy && <span>Progress updates here. The local job continues if you refresh this page.</span>}
          {job?.action === "reference" && job.result?.reference_status && <span>Reference result for run {job.result.run_id?.slice(0, 8)}: {job.result.reference_status} · {job.result.evaluated_pairs ?? 0} pairs checked{job.result.run_id !== loadedArea?.runId ? " · previous analysis" : ""}</span>}
          {job?.action === "evidence" && job.result?.evidence_prepared && <span>Optical evidence ready for run {job.result.run_id?.slice(0, 8)} · saved counts reproduced: {job.result.counts_reproduced ? "yes" : "no"} · {job.result.matching_pixels ?? 0} matching new-water pixels · {job.result.radar_only_pixels ?? 0} radar-only pixels</span>}</div>
        {(error || job?.error) && <p className="nisar-tool-error" role="alert">{error || job?.error}</p>}
        <div className="nisar-earthdata-card">
          <h4>Connect Earthdata Login once</h4>
          <p className="nisar-tool-hint">Click below to open a separate PowerShell window for NASA Earthdata Login. If no window appears, use the command shown below in a normal PowerShell window. Enter credentials only in that terminal — never in this webpage.</p>
          <div className="nisar-earthdata-actions">
            <button type="button" className="nisar-primary-button" onClick={() => void connectEarthdata()}>Connect Earthdata Login</button>
          </div>
          {earthdataMsg && <p className="nisar-tool-hint" role="status">{earthdataMsg}</p>}
          <details open><summary>Or run the command yourself</summary><p className="nisar-tool-hint">Open {loginShell} and run this command from any folder.</p><code className="nisar-login-command">{loginCommand || "Loading the local Python path…"}</code><button type="button" disabled={!loginCommand} onClick={async () => { try { await navigator.clipboard.writeText(loginCommand); setCommandCopied(true); } catch { setError("Copy the command above manually; clipboard access is unavailable."); } }}>{commandCopied ? "Command copied" : "Copy login command"}</button></details>
          <p className="nisar-tool-hint">After signing in, close the terminal and continue here. The website uses the saved login without receiving your password through the browser.</p>
        </div>
        {loadedArea && <div className="nisar-reference-retry"><h4>Independent check for {loadedArea.name}</h4><p>{loadedArea.baselineDate} → {loadedArea.eventDate}. Retry alternative date-matched optical pairs, selected by cloud-free coverage.</p><button type="button" disabled={busy} onClick={() => void startJob("reference")}>Retry reference check</button><button type="button" disabled={busy} onClick={() => void startJob("preview")}>Prepare radar images</button><button type="button" disabled={busy} onClick={() => void startJob("evidence")}>Prepare optical evidence</button></div>}
      </div>
    </div>
  </section>;
}
