"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { BoundaryCollection } from "./GlobalNisarDetectionMap";

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

export default function NisarProcessingPanel({ bounds, boundary, drawing, onDraw, onAreaChange, loadedArea, onRunReady, savedAreas, onLoadSavedArea }: {
  bounds: AreaBounds | null; boundary: BoundaryCollection | null; drawing: boolean;
  onDraw: (drawing: boolean) => void; onAreaChange: (bounds: AreaBounds, boundary: BoundaryCollection | null) => void;
  loadedArea: { runId: string; name: string; boundary: BoundaryCollection; baselineDate: string; eventDate: string } | null;
  onRunReady: (runId: string) => void;
  savedAreas: SavedAreaOption[]; onLoadSavedArea: (runId: string) => void;
}) {
  const [siteName, setSiteName] = useState("");
  const [startDate, setStartDate] = useState("2026-06-17");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loginCommand, setLoginCommand] = useState("");
  const [commandCopied, setCommandCopied] = useState(false);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchedFingerprint, setSearchedFingerprint] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const request = { siteName: siteName.trim(), bbox: bounds, boundary, startDate, endDate };
  const fingerprint = JSON.stringify(request);
  const searchFingerprint = useRef("");
  const busy = submitting || job?.status === "RUNNING" || job?.status === "QUEUED";
  const jobId = job?.id;
  const jobStatus = job?.status;
  const usableSearch = search && searchedFingerprint === fingerprint ? search : null;
  const datesValid = !!startDate && !!endDate && startDate <= endDate && endDate <= new Date().toISOString().slice(0, 10);
  const smallEnough = validArea(bounds) && bounds[2]-bounds[0] <= 2 && bounds[3]-bounds[1] <= 2;

  useEffect(() => {
    const controller = new AbortController();
    const saved = localStorage.getItem("beyonders-nisar-job");
    fetch(`/api/wetland/processing${saved ? `?id=${encodeURIComponent(saved)}` : ""}`, { signal: controller.signal })
      .then((r) => r.json()).then((r) => {
        if (r.loginCommand) setLoginCommand(r.loginCommand);
        const restored = r.areaRequest;
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
        if (r.job) setJob(r.job);
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
    if (action === "search") searchFingerprint.current = fingerprint;
    try {
      const body = action === "reference" || action === "preview" || action === "evidence" ? { action, runId: loadedArea?.runId }
        : { ...request, action, ...(action === "run" ? { sceneNames: [before, after] } : {}) };
      const response = await fetch("/api/wetland/processing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (result.job) { setJob(result.job); localStorage.setItem("beyonders-nisar-job", result.job.id); }
      if (!response.ok) throw new Error(result.error || "Could not start processing.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start processing."); }
    finally { setSubmitting(false); }
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
    <div className="nisar-tools-heading"><div><p className="global-eyebrow">PROCESS ANOTHER PLACE</p><h2 id="nisar-process-title">Find a pair. See what changed.</h2>
      <p>Name the place, select its area on the map, then search real NISAR observations.</p></div>
      <span className="global-source-pill">Local processor · Earthdata Login required for science files</span></div>
    <div className="nisar-process-grid">
      <div className="nisar-process-step"><h3>1. Choose the study area</h3>
        <label htmlFor="process-saved-area">Load a saved study area</label>
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
        <p className="nisar-tool-hint">Selecting one loads its saved boundary when available (otherwise its saved bounding box) and fills in the place name.</p>
        <label htmlFor="process-name">Place name for this run</label><input id="process-name" value={siteName} maxLength={80} placeholder="e.g. Your wetland or floodplain" onChange={(e) => setSiteName(e.target.value)} disabled={busy} />
        <div className="nisar-tool-actions"><button type="button" onClick={() => { onDraw(!drawing); document.querySelector(".global-map-wrap")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }} disabled={busy}>{drawing ? "Cancel drawing" : "Draw area on map"}</button>
          {loadedArea && <button type="button" onClick={() => { setSiteName(loadedArea.name); onAreaChange(boundaryBounds(loadedArea.boundary), loadedArea.boundary); onDraw(false); }} disabled={busy}>Use loaded study area</button>}</div>
        <label htmlFor="process-boundary">Or upload a wetland boundary (GeoJSON)</label><input id="process-boundary" type="file" accept=".geojson,.json,application/geo+json" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        <p className="nisar-tool-hint">{boundary ? "Selected polygon is the analysis mask." : "A drawn box is a rectangular analysis area, not a mapped wetland boundary."} Maximum 2° across; smaller areas finish sooner.</p>
        {validArea(bounds) && <p className="nisar-area-readout">{bounds.map((n) => n.toFixed(4)).join(" / ")} · west / south / east / north</p>}
        <details><summary>Enter coordinates instead</summary><form key={bounds?.join(",") || "empty"} onSubmit={applyCoordinates}><div className="nisar-coordinate-grid">{["West", "South", "East", "North"].map((label, i) => <label key={label}>{label}<input name={label.toLowerCase()} type="number" step="any" required defaultValue={bounds?.[i]} /></label>)}</div><button type="submit" disabled={busy}>Apply coordinates</button></form></details>
      </div>
      <div className="nisar-process-step"><h3>2. Find matching observations</h3>
        <div className="nisar-date-grid"><label>From<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} /></label><label>To<input type="date" value={endDate} min={startDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setEndDate(e.target.value)} disabled={busy} /></label></div>
        <button type="button" className="nisar-primary-button" disabled={busy || siteName.trim().length < 2 || !smallEnough || !datesValid} onClick={() => void startJob("search")}>Search NASA catalog</button>
        <p className="nisar-tool-hint">Only acquired scenes can be processed. Search finds a compatible series with HH/HV and the same orbit geometry; it does not classify the world.</p>
        {usableSearch && <div className="nisar-pair-selection"><p>{usableSearch.scenes.length} compatible dates · {usableSearch.catalog_hits} catalog records{usableSearch.search_limit_reached ? " · limit reached; narrow dates" : ""}</p>
          <label>Before<select value={before} onChange={(e) => setBefore(e.target.value)} disabled={busy}>{usableSearch.scenes.map((s) => <option key={s.name} value={s.name}>{s.date}</option>)}</select></label>
          <label>After<select value={after} onChange={(e) => setAfter(e.target.value)} disabled={busy}>{usableSearch.scenes.map((s) => <option key={s.name} value={s.name}>{s.date}</option>)}</select></label>
          <p className="nisar-tool-hint">{chosenSize ? `Selected full granules total about ${chosenSize.toFixed(2)} GB. ` : "Science granules may be several GB each. "}The processor requests cropped radar data; actual transfer depends on file layout.</p>
          <button className="nisar-primary-button" type="button" disabled={busy || !pairValid} onClick={() => void startJob("run")}>Process selected NISAR pair</button>
          {!pairValid && <p className="nisar-tool-hint">Choose an after date later than the before date.</p>}</div>}
      </div>
      <div className="nisar-process-step"><h3>3. Follow the evidence</h3><p>Completed runs include radar layers, candidate polygons, dates, rules, uncertainty and an attempted independent HLS comparison.</p>
        <div className="nisar-job-status" role="status" aria-live="polite" aria-busy={busy}><strong>{busy ? "Working…" : job?.status === "FAILED" ? "Job failed" : job?.status === "COMPLETE" ? "Job complete" : "Ready when you are"}</strong><span>{submitting ? "Starting local processor…" : job?.stage || "Select an area and search for observations."}</span>
          {busy && <span>Progress updates here. The local job continues if you refresh this page.</span>}
          {job?.action === "reference" && job.result?.reference_status && <span>Reference result for run {job.result.run_id?.slice(0, 8)}: {job.result.reference_status} · {job.result.evaluated_pairs ?? 0} pairs checked{job.result.run_id !== loadedArea?.runId ? " · previous analysis" : ""}</span>}
          {job?.action === "evidence" && job.result?.evidence_prepared && <span>Optical evidence ready for run {job.result.run_id?.slice(0, 8)} · saved counts reproduced: {job.result.counts_reproduced ? "yes" : "no"} · {job.result.matching_pixels ?? 0} matching new-water pixels · {job.result.radar_only_pixels ?? 0} radar-only pixels</span>}</div>
        {(error || job?.error) && <p className="nisar-tool-error" role="alert">{error || job?.error}</p>}
        <details><summary>Connect Earthdata Login once</summary><p className="nisar-tool-hint">Open PowerShell and run this command from any folder. Enter credentials only in that terminal.</p><code className="nisar-login-command">{loginCommand || "Loading the local Python path…"}</code><button type="button" disabled={!loginCommand} onClick={async () => { try { await navigator.clipboard.writeText(loginCommand); setCommandCopied(true); } catch { setError("Copy the command above manually; clipboard access is unavailable."); } }}>{commandCopied ? "Command copied" : "Copy login command"}</button><p className="nisar-tool-hint">Then retry here. The website uses the saved login without receiving your password through the browser.</p></details>
        {loadedArea && <div className="nisar-reference-retry"><h4>Independent check for {loadedArea.name}</h4><p>{loadedArea.baselineDate} → {loadedArea.eventDate}. Retry alternative date-matched optical pairs, selected by cloud-free coverage.</p><button type="button" disabled={busy} onClick={() => void startJob("reference")}>Retry reference check</button><button type="button" disabled={busy} onClick={() => void startJob("preview")}>Prepare radar images</button><button type="button" disabled={busy} onClick={() => void startJob("evidence")}>Prepare optical evidence</button></div>}
      </div>
    </div>
  </section>;
}
