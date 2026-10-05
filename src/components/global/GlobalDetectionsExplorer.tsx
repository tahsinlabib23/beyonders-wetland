"use client";

// @refresh reset
// Leaflet's map instance must remount when development refresh reruns effects.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import NisarProcessingPanel, { type AreaBounds } from "./NisarProcessingPanel";
import RadarComparison from "./RadarComparison";
import ReferenceEvidence from "./ReferenceEvidence";
import SavedDateCheck from "./SavedDateCheck";
import MozambiqueFloodCase from "./MozambiqueFloodCase";
import type { BoundaryCollection, CoverageCollection, DetectionCollection } from "./GlobalNisarDetectionMap";

const GlobalNisarDetectionMap = dynamic(() => import("./GlobalNisarDetectionMap"), {
  ssr: false,
  loading: () => <div className="global-map-loading">Loading NISAR map…</div>,
});

interface DetectionResponse {
  run_id: string;
  site_name?: string;
  site_bounds?: AreaBounds;
  boundary_source?: string | null;
  data_source: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
  status: "ready" | "no-real-nisar-run";
  product: string | null;
  product_maturity: string | null;
  reference_validated: boolean;
  cross_sensor_check_completed: boolean;
  reference_check_status: string;
  baseline_date: string | null;
  baseline_scene: string | null;
  selected_baseline?: { baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[] } | null;
  baseline_observation_dates?: string[] | null;
  selected_date: string | null;
  selected_scene: string | null;
  polarizations: string[];
  dates: string[];
  stats: { date: string; area_km2: number; patches: number } | null;
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  case_study: CaseStudy | null;
  reference_validation: ReferenceValidation | null;
}

type ReferenceValidation = {
  status?: string;
  reason?: string | null;
  reference_product?: string;
  source_url?: string;
  comparison?: {
    baseline?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    event?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    hls_tile?: string;
    spatial_resolution_m?: number;
    mndwi_threshold?: number;
  };
  coverage?: { common_clear_fraction?: number; common_clear_area_km2?: number; minimum_clear_fraction_for_check?: number };
  metrics?: { precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  optical_support?: { support?: string; common_clear_fraction?: number; common_clear_area_km2?: number;
    candidate_assessed_fraction?: number | null;
    true_positive_area_km2?: number; false_positive_area_km2?: number; false_negative_area_km2?: number;
    precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  limitations?: string[];
  selection?: { evaluated_pairs?: number; available_pairs?: number; method?: string; date_tolerance_days?: number;
    catalog_searches?: { collection: string; records?: number; status: string }[] };
};

type CaseStudy = {
  title?: string;
  site?: string;
  baseline_date?: string;
  event_date?: string;
  baseline_scene?: string | null;
  baseline_scenes?: string[];
  event_scene?: string | null;
  input_origin?: string;
  source_run_id?: string | null;
  date_pair_selection?: { method?: string; screened_scenes?: number; candidate_pairs?: number } | null;
  polarizations?: string[];
  candidate_patches?: number;
  candidate_area_km2?: number;
  classes?: Record<string, { patches: number; area_km2: number; mean_delta_hh_db?: number | null; mean_delta_hv_db?: number | null }>;
  method?: { open_water_rule?: string; vegetated_inundation_rule?: string; threshold_db?: number; minimum_region_pixels?: number; validity_rule?: string;
    baseline_method?: { baseline_method?: string; baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_hh_temporal_mad_db?: number | null };
    gcov_quality?: { scenes?: { scene?: string; number_of_looks_median?: number | null }[]; number_of_looks_rule?: string; mask_rule?: string } };
  uncertainty?: { threshold_sensitivity?: { stability_verdict?: string; stable_range?: number[]; sensitivity_note?: string }; interpretation?: string };
  reference_validation?: ReferenceValidation;
  impact_context?: string;
  spatial_scope?: string;
};

interface CoverageResponse {
  date: string;
  product: string;
  totalHits: number;
  loadedFeatures: number;
  truncated: boolean;
  snapshotFallback?: boolean;
  features: CoverageCollection["features"];
  error?: string;
}

function emptyCollection(): DetectionCollection {
  return { type: "FeatureCollection", features: [] };
}

type CoordinateAxis = "latitude" | "longitude";

function parseCoordinate(value: string, axis: CoordinateAxis): number | null {
  const input = value.trim().toUpperCase();
  if (!input) return null;

  const hemisphere = input.match(/[NSEW]$/)?.[0];
  if (hemisphere && (axis === "latitude" ? !["N", "S"].includes(hemisphere) : !["E", "W"].includes(hemisphere))) return null;
  const magnitudeText = hemisphere ? input.slice(0, -1).trim() : input;
  const decimal = magnitudeText.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:[°º])?$/);
  if (decimal) {
    const number = Number(decimal[1]);
    if (!Number.isFinite(number)) return null;
    return hemisphere ? (hemisphere === "S" || hemisphere === "W" ? -1 : 1) * Math.abs(number) : number;
  }

  const parts = magnitudeText
    .replace(/[°º˚dD]/g, " ")
    .replace(/[′'’mM]/g, " ")
    .replace(/[″\"”sS]/g, " ")
    .replace(/:/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;

  const degrees = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length === 3 ? Number(parts[2]) : 0;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

  const sign = hemisphere
    ? hemisphere === "S" || hemisphere === "W" ? -1 : 1
    : degrees < 0 ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

const DEFAULT_COVERAGE_DATE = "2026-10-01";

export default function GlobalDetectionsExplorer() {
  const [selectedRun, setSelectedRun] = useState("");
  const [savedRuns, setSavedRuns] = useState<{ run_id: string; site_name: string; baseline_date: string; selected_date: string; completed_at: string }[]>([]);
  const pendingAreaRunId = useRef("");
  const [runsError, setRunsError] = useState("");
  const [areaBounds, setAreaBounds] = useState<AreaBounds | null>(null);
  const [areaBoundary, setAreaBoundary] = useState<BoundaryCollection | null>(null);
  const [areaDrawing, setAreaDrawing] = useState(false);
  const [coordinateLatitude, setCoordinateLatitude] = useState("");
  const [coordinateLongitude, setCoordinateLongitude] = useState("");
  const [coordinateError, setCoordinateError] = useState("");
  const [coordinateTarget, setCoordinateTarget] = useState<{ latitude: number; longitude: number } | null>(null);
  const [candidateDate, setCandidateDate] = useState("");
  const [mosaicDate, setMosaicDate] = useState("");
  const [coverageDate, setCoverageDate] = useState(DEFAULT_COVERAGE_DATE);
  const [mosaicStatus, setMosaicStatus] = useState<"loading" | "ready" | "error">("loading");
  const [focusStudyArea, setFocusStudyArea] = useState(false);
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [coverageData, setCoverageData] = useState<CoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFinishedRun = useCallback((runId: string) => {
    setSelectedRun(runId); setCandidateDate(""); setError(""); setLoading(true);
    setFocusStudyArea(true);
    setCoordinateTarget(null);
    setRefreshKey((key) => key+1);
  }, []);
  const loadSavedAreaForProcessing = useCallback((runId: string) => {
    setAreaBounds(null); setAreaBoundary(null); setAreaDrawing(false);
    pendingAreaRunId.current = runId;
    loadFinishedRun(runId);
  }, [loadFinishedRun]);
  const applyArea = useCallback((bounds: AreaBounds, boundary: BoundaryCollection | null) => {
    setAreaBounds(bounds); setAreaBoundary(boundary); setAreaDrawing(false);
  }, []);
  const searchCoordinates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = parseCoordinate(coordinateLatitude, "latitude");
    const longitude = parseCoordinate(coordinateLongitude, "longitude");
    if (latitude == null || longitude == null) {
      setCoordinateError("Enter decimal degrees or degrees and minutes (for example, 25°09′ N and 91°04′ E). Minutes and seconds must be below 60.");
      return;
    }
    if (latitude < -85.05112878 || latitude > 85.05112878 || longitude < -180 || longitude > 180) {
      setCoordinateError("Latitude must be within the map range (−85.0511 to 85.0511); longitude must be between −180 and 180.");
      return;
    }
    setCoordinateError("");
    setCoordinateTarget({ latitude, longitude });
    setFocusStudyArea(false);
  };

  const locateMozambiqueCase = () => {
    setCoordinateTarget({ latitude: -24.533333, longitude: 32.983333 });
    setFocusStudyArea(false);
    document.getElementById("global-nisar-map")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wetland/runs", { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load saved results.");
      return result;
    }).then((result) => { setSavedRuns(result.runs); setRunsError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setRunsError(reason.message); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (candidateDate) params.set("date", candidateDate);
    if (selectedRun) params.set("run", selectedRun);
    const query = params.size ? `?${params}` : "";

    fetch(`/api/wetland/nisar-detections${query}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as DetectionResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load NISAR detections.");
        return result;
      })
      .then((result) => {
        if (pendingAreaRunId.current === result.run_id) {
          if (result.site_bounds) {
            setAreaBounds(result.site_bounds);
            setAreaBoundary(result.boundary);
            setAreaDrawing(false);
          }
          pendingAreaRunId.current = "";
        }
        setData(result);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (pendingAreaRunId.current === selectedRun) pendingAreaRunId.current = "";
        setData(null);
        setError(reason instanceof Error ? reason.message : "Could not load NISAR detections.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [candidateDate, selectedRun, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/wetland/global-coverage?date=${encodeURIComponent(coverageDate)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as CoverageResponse;
        if (!response.ok) throw new Error(result.error || "Could not load worldwide NISAR footprints.");
        return result;
      })
      .then(setCoverageData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCoverageData(null);
        setCoverageError(reason instanceof Error ? reason.message : "Could not load worldwide NISAR footprints.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCoverageLoading(false);
      });

    return () => controller.abort();
  }, [coverageDate, refreshKey]);

  const detections = data?.detections ?? emptyCollection();
  const coverage: CoverageCollection = { type: "FeatureCollection", features: coverageData?.features ?? [] };
  const isNisar = data?.data_source === "NISAR";
  const today = new Date().toISOString().slice(0, 10);
  const statusText = loading ? "Loading pipeline output…"
    : error ? "NISAR output unavailable"
      : isNisar ? "NISAR · provisional candidates"
        : data?.data_source === "SIMULATED_DEMO" ? "No real NISAR run loaded" : "NISAR run required";
  const statusClass = loading ? "global-source-pill--loading" : error ? "global-source-pill--error"
    : isNisar ? "global-source-pill--live" : "global-source-pill--snapshot";

  return (
    <main className="global-coverage-page detection-page">
      <header className="global-header">
        <div className="global-brand">
          <span className="global-brand__mark" aria-hidden="true">B</span>
          <div><strong>BEYONDERS</strong><span>WETLAND PULSE</span></div>
          <span className="global-header__divider" aria-hidden="true" />
          <span className="global-header__section">Worldwide NISAR observations</span>
        </div>
        <div className="detection-header-actions">
          <Link className="global-back-link" href="/wetland/global/scenes">Global NISAR scenes <span aria-hidden="true">↗</span></Link>
          <Link className="global-back-link" href="/wetland?source=raster">Latest run analysis <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="global-intro detection-intro" aria-labelledby="global-detections-title">
        <div>
          <p className="global-eyebrow">SAR-FIRST · NASA NISAR L2 GCOV</p>
          <h1 id="global-detections-title">Explore NISAR across the world</h1>
          <p className="global-description">Browse NASA’s worldwide NISAR GCOV backscatter mosaic. Experimental radar-change candidates appear as a separate overlay only where this project has processed observations.</p>
        </div>
      </section>

      <div className="global-status-row detection-status" aria-live="polite">
        <div className="global-count">
          <strong>{loading ? "…" : isNisar ? (data?.stats?.patches ?? detections.features.length).toLocaleString() : "—"}</strong>
          <span>radar-change candidates · processed areas only</span>
        </div>
        <div className="global-status-meta">
          <span className={`global-source-pill ${mosaicStatus === "loading" ? "global-source-pill--loading" : mosaicStatus === "error" ? "global-source-pill--error" : "global-source-pill--live"}`}><i aria-hidden="true" />{mosaicStatus === "loading" ? "Loading global NISAR mosaic…" : mosaicStatus === "error" ? "NISAR mosaic unavailable" : "NASA GIBS · daily"}</span>
          {isNisar && data?.stats && <span className="nisar-area-stat"><strong>{data.stats.area_km2.toFixed(2)} km²</strong> mapped candidate area</span>}
          <span className={`global-source-pill ${statusClass}`}><i aria-hidden="true" />{statusText}</span>
          <span className={`global-source-pill ${coverageLoading ? "global-source-pill--loading" : coverageError ? "global-source-pill--error" : coverageData?.snapshotFallback ? "global-source-pill--snapshot" : "global-source-pill--live"}`}><i aria-hidden="true" />{coverageLoading ? "Loading worldwide footprints…" : coverageError ? "Footprints unavailable" : coverageData?.snapshotFallback ? `NASA CMR snapshot · ${coverageData.loadedFeatures.toLocaleString()} footprints` : `${coverageData?.loadedFeatures.toLocaleString() ?? 0} NISAR footprints · ${coverageDate}`}</span>
          <button className="global-refresh" type="button" onClick={() => { setLoading(true); setError(""); setCoverageLoading(true); setCoverageError(""); setRefreshKey((value) => value + 1); }} disabled={loading}>Refresh results</button>
        </div>
      </div>

      <section className="global-workspace detection-workspace" aria-label="Worldwide NISAR observation map with local candidate overlay">
        <div className="global-map-panel">
          <div className="global-map-topline">
            <span>WORLDWIDE NISAR GCOV BACKSCATTER</span>
            <span>Daily acquisition mosaic{mosaicDate ? ` · ${mosaicDate}` : " · latest available"} · {coverage.features.length.toLocaleString()} catalog footprints</span>
          </div>
          <div id="global-nisar-map" className="global-map-wrap" role="region" aria-label="Worldwide NISAR backscatter mosaic with processed candidate overlay">
            <GlobalNisarDetectionMap
              detections={detections}
              boundary={isNisar ? data?.boundary ?? null : null}
              coverage={coverage}
              date={mosaicDate || null}
              focusStudyArea={focusStudyArea}
              coordinateTarget={coordinateTarget}
              onLayerReady={() => setMosaicStatus("ready")}
              onLayerError={() => setMosaicStatus((current) => current === "ready" ? current : "error")}
              resultKey={`${data?.run_id}-${data?.selected_date}`}
              areaBounds={areaBounds}
              areaDrawing={areaDrawing}
              onAreaSelected={(bounds) => { setAreaBounds(bounds); setAreaBoundary(null); setAreaDrawing(false); setCoordinateTarget(null); }}
            />
            {areaDrawing && <div className="nisar-drawing-notice" role="status">Click two opposite corners to select your study area. <button type="button" onClick={() => setAreaDrawing(false)}>Cancel</button></div>}
            {!loading && !isNisar && <div className="detection-map-badge" role="status">No detector result loaded · blank map areas are not classified</div>}
            {!loading && isNisar && detections.features.length === 0 && <div className="detection-map-badge" role="status">No candidates inside the processed boundary for {data?.selected_date} · elsewhere: no result</div>}
            {error && <div className="detection-map-badge detection-map-badge--error" role="alert">Could not load detector output: {error}</div>}
            {mosaicStatus === "error" && <div className="detection-map-badge detection-map-badge--error" role="alert">NASA has no mosaic tiles for this date, or the tile service is unreachable. Choose another date or open NASA Worldview.</div>}
          </div>
          <div className="global-map-legend detection-legend" aria-label="Map legend">
            <span><i className="detection-legend-swatch detection-legend-swatch--backscatter" />NISAR GCOV false-color backscatter · global mosaic</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--coverage" />Scene footprints · {coverageDate} · cyan ascending / amber descending</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--open-water" />HH-darkening candidate · exploratory</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--vegetated" />HH-increase / HV-stability candidate · exploratory</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--uncertain" />Uncertain candidate</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--unprocessed" />No detector result · blank is not no change</span>
            <span className="global-legend-note">Dashed outline · study boundary</span>
          </div>
        </div>

        <aside className="global-scene-panel detection-info-panel" aria-label="Global mosaic and local detection controls">
          <div className="global-scene-panel__heading">
            <div><p className="global-eyebrow">GLOBAL SATELLITE OBSERVATIONS</p><h2>Worldwide NISAR mosaic</h2></div>
            <span className="global-live-mark"><i />NASA GIBS</span>
          </div>
          <p className="detection-panel-copy">The global layer is NASA’s false-color NISAR GCOV backscatter mosaic. It shows radar observations around the world; the colors are not flood or wetland classifications.</p>

          <form className="map-coordinate-form" onSubmit={searchCoordinates} noValidate>
            <label className="detection-field-label" htmlFor="map-coordinate-latitude">Go to map coordinates</label>
            <div className="map-coordinate-fields">
              <div>
                <label htmlFor="map-coordinate-latitude">Latitude</label>
                <input id="map-coordinate-latitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="25.1500 or 25°09′ N" value={coordinateLatitude} onChange={(event) => { setCoordinateLatitude(event.target.value); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
              <div>
                <label htmlFor="map-coordinate-longitude">Longitude</label>
                <input id="map-coordinate-longitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="91.0667 or 91°04′ E" value={coordinateLongitude} onChange={(event) => { setCoordinateLongitude(event.target.value); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
            </div>
            <p className="map-coordinate-help" id="map-coordinate-help">Decimal or degrees/minutes/seconds · map latitude −85.0511 to 85.0511 · longitude −180 to 180</p>
            {coordinateError && <p className="map-coordinate-error" id="map-coordinate-error" role="alert">{coordinateError}</p>}
            <button className="map-coordinate-search-button" type="submit">Search map</button>
            {coordinateTarget && <p className="map-coordinate-result" role="status">Map centered at {coordinateTarget.latitude.toFixed(5)}°, {coordinateTarget.longitude.toFixed(5)}°.</p>}
          </form>

          <p className="detection-field-label">Global observation mosaic</p>
          <p className="detection-panel-copy">NASA GIBS daily NISAR L2 GCOV false-color tiles.</p>

          <label className="detection-field-label" htmlFor="nisar-mosaic-date">Mosaic date (UTC)</label>
          <div className="detection-date-row">
            <input id="nisar-mosaic-date" className="detection-date-input" type="date" max={today} value={mosaicDate} onChange={(event) => { setMosaicStatus("loading"); setMosaicDate(event.target.value); }} />
            {mosaicDate && <button className="global-refresh" type="button" onClick={() => { setMosaicStatus("loading"); setMosaicDate(""); }}>Latest</button>}
          </div>
          <p className="detection-helper">Choose a date with available tiles, or leave blank to use the latest date published by NASA GIBS.</p>

          <label className="detection-field-label" htmlFor="nisar-coverage-date">Worldwide scene footprints (UTC)</label>
          <input id="nisar-coverage-date" className="detection-date-input" type="date" min="2026-06-17" max={today} value={coverageDate} onChange={(event) => { setCoverageLoading(true); setCoverageError(""); setCoverageDate(event.target.value); }} />
          <p className="detection-helper">{coverageLoading ? "Checking NASA’s global catalog…" : coverageError ? coverageError : `${coverageData?.totalHits.toLocaleString() ?? 0} catalog records · ${coverageData?.loadedFeatures.toLocaleString() ?? 0} footprints shown.`} Each outline marks an acquired scene, not a flood detection.</p>

          <div className="detection-note detection-note--static">
            <strong>Backscatter is not a detection</strong>
            <span>Global false-color imagery provides SAR context. Flood or inundation candidates require a temporal classifier and can only be overlaid where this project has processed NISAR scenes.</span>
          </div>

          <details className="detection-note detection-note--radar-guide">
            <summary>How radar reveals different kinds of flooding</summary>
            <div className="detection-radar-guide__content">
              <p>NISAR sends microwave signals and measures what returns from the ground. It can observe through clouds and at night, and its L-band signal can help reveal water beneath vegetation.</p>
              <ul>
                <li><strong>Open water:</strong> often has a low, dark return in radar imagery.</li>
                <li><strong>Flooded vegetation:</strong> water among trees or marsh plants can create a different, sometimes stronger return than dry vegetation.</li>
              </ul>
              <p className="detection-radar-guide__caveat">These are common patterns, not a universal color key. The signal also depends on land cover, polarization, viewing geometry, and image processing. The global mosaic colors alone are not a flood classification.</p>
              <p><strong>Read this run:</strong> dates and radar layers appear under <em>Radar-change candidates</em>; its change rules show the detector method. The case study below reports the independent check and threshold sensitivity when they are available.</p>
              <a className="detection-radar-guide__case-link" href="#nisar-case-story-title">Go to this run’s reference and uncertainty details ↓</a>
              <div className="detection-radar-guide__sources" aria-label="Radar flood mapping sources">
                <a href="https://www.youtube.com/watch?v=2ZMW051InVY" target="_blank" rel="noopener noreferrer">JPL talk · NISAR for Flood Mapping ↗</a>
                <a href="https://svs.gsfc.nasa.gov/5661" target="_blank" rel="noopener noreferrer">NASA example · NISAR flood observations in Mozambique ↗</a>
                <p>The talk’s Hurricane Matthew example is from 2016, before NISAR’s <a href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noopener noreferrer">2025 launch</a>; it illustrates radar mapping, not a NISAR observation.</p>
              </div>
            </div>
          </details>

          <a className="global-data-link" href="#nisar-process">Process another place <span>Select an area, find a NISAR pair and follow its progress ↓</span></a>

          <div className="detection-local-results">
            <div className="global-scene-panel__heading">
              <div><p className="global-eyebrow">DERIVED LAYER · LOCAL RUN</p><h2>{isNisar ? "Radar-change candidates" : "No real candidates loaded"}</h2></div>
              <span className={`global-live-mark ${isNisar ? "" : "detection-static-mark"}`}><i />{isNisar ? "NISAR run" : data?.data_source === "SIMULATED_DEMO" ? "Demo data" : "No run"}</span>
            </div>
              <label className="detection-field-label" htmlFor="nisar-saved-run">Saved study areas and runs</label>
              <select id="nisar-saved-run" className="detection-select" value={selectedRun} onChange={(event) => { setSelectedRun(event.target.value); setCandidateDate(""); setLoading(true); setError(""); setFocusStudyArea(true); setAreaBounds(null); setAreaBoundary(null); setCoordinateTarget(null); }}>
                <option value="">Latest completed result</option>
                {savedRuns.map((run) => <option key={run.run_id} value={run.run_id}>{run.site_name} · {run.baseline_date} → {run.selected_date} · {run.run_id.slice(0, 6)}</option>)}
              </select>
              {runsError && <p className="nisar-tool-error">{runsError}</p>}
            {isNisar ? <>
              <p className="detection-panel-copy">{detections.features.length} candidate regions · {data?.stats?.area_km2.toFixed(2) ?? "0.00"} km² · {data?.selected_date}. Results cover the processed study area only.</p>
              <label className="detection-field-label" htmlFor="nisar-candidate-date">Processed observation</label>
              <select id="nisar-candidate-date" className="detection-select" value={candidateDate || data?.selected_date || ""} onChange={(event) => { setLoading(true); setError(""); setCandidateDate(event.target.value); }}>
                {data?.dates.map((observationDate) => <option key={observationDate} value={observationDate}>{observationDate}</option>)}
              </select>
              <dl className="nisar-run-details">
                <div><dt>Product</dt><dd>{data?.product ?? "NISAR L2 GCOV"}</dd></div>
                <div><dt>{(data?.selected_baseline?.baseline_observation_count ?? 1) > 1 ? "Radar baseline dates" : "Date pair"}</dt><dd>{data?.selected_baseline?.baseline_observation_dates?.join(", ") ?? data?.baseline_date ?? "?"} → {data?.selected_date ?? "?"}</dd></div>
                <div><dt>Radar layers</dt><dd>{data?.polarizations.join(" · ") || "Not recorded"}</dd></div>
                <div><dt>Input scenes</dt><dd title={`${data?.selected_baseline?.baseline_scene_names?.join("\n") ?? data?.baseline_scene ?? ""}\n${data?.selected_scene ?? ""}`}>{data?.selected_baseline?.baseline_scene_names?.length ?? (data?.baseline_scene ? 1 : 0)} baseline scene(s) / {data?.selected_scene ? `${data.selected_scene.slice(0, 24)}…` : "Not recorded"}</dd></div>
                <div><dt>Optical cross-check</dt><dd>{data?.case_study?.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "Complete · no area overlap" : "Comparison complete" : data?.case_study?.reference_validation?.status?.replaceAll("_", " ").toLowerCase() ?? "Not available"}</dd></div>
              </dl>
              {data?.case_study?.method && <div className="detection-method-summary">
                <strong>Change rules · {data.case_study.method.threshold_db?.toFixed(1) ?? "—"} dB base cutoff</strong>
                <span>HH darkening rule · {data.case_study.method.open_water_rule}</span>
                <span>{data.case_study.method.vegetated_inundation_rule}</span>
              </div>}
              <div className="detection-scope-actions">
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(true)} disabled={!data?.boundary}>Zoom to processed area</button>
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(false)}>World view</button>
              </div>
              <p className="detection-helper">NISAR backscatter mosaic is global; derived candidate polygons are from run {data?.run_id.slice(0, 8)} only.</p>
              {data?.boundary_source && <p className="detection-helper">Study mask: {data.boundary_source}.</p>}
            </> : <>
              <p className="detection-panel-copy">The current pipeline run is marked <strong>{data?.data_source ?? "unavailable"}</strong>. Simulated polygons are hidden. The footprints and backscatter mosaic show observations only; no change result is loaded for the rest of the world.</p>
              <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Load or run the local study-area pipeline ↗</span></Link>
            </>}
          </div>

          <div className="detection-note">
            <strong>Map coverage</strong>
            <span>Scene footprints show acquisitions. The dashed outline shows the detector’s processed study mask. Blank land elsewhere means no detector result is available; it does not mean no change occurred.</span>
          </div>
          <Link className="global-data-link" href="/wetland/global/scenes">Inspect worldwide acquisition footprints <span>NASA CMR scene catalog ↗</span></Link>
          <a className="detection-worldview-link" href="https://worldview.earthdata.nasa.gov/?l=NISAR_L2_Geocoded_Polarimetric_Covariance" target="_blank" rel="noreferrer">Open this NISAR layer in NASA Worldview ↗</a>
        </aside>
      </section>

      <NisarProcessingPanel bounds={areaBounds} boundary={areaBoundary} drawing={areaDrawing}
        onDraw={setAreaDrawing} onAreaChange={applyArea}
        savedAreas={savedRuns} onLoadSavedArea={loadSavedAreaForProcessing}
        loadedArea={isNisar && data?.boundary && data.baseline_date && data.case_study?.event_date ? {
          runId: data.run_id, name: data.site_name || data.case_study.site || "Study area", boundary: data.boundary,
          baselineDate: data.baseline_date, eventDate: data.case_study.event_date } : null}
        onRunReady={loadFinishedRun} />
      {isNisar && data?.selected_date && !loading && <RadarComparison runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}
      {isNisar && data?.selected_date && !loading && <SavedDateCheck runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}

      {isNisar && data?.case_study ? <section className="nisar-case-story" aria-labelledby="nisar-case-story-title">
        <div className="nisar-case-story__heading">
          <div><p className="global-eyebrow">FEATURED CASE · {data.case_study.site ?? "LOCAL STUDY AREA"}</p>
            <h2 id="nisar-case-story-title">{data.case_study.title ?? "NISAR change case"}</h2></div>
        <span className={`global-source-pill ${data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" && (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) !== 0 ? "global-source-pill--live" : "global-source-pill--snapshot"}`}>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "HLS check complete · no change overlap" : "HLS cross-sensor check complete"
              : data.case_study.reference_validation?.status === "UNAVAILABLE" ? "HLS data unavailable"
                : data.case_study.reference_validation?.status === "NOT_RUN" ? "HLS check not run" : "HLS check inconclusive"}
          </span>
        </div>
        <p className="nisar-case-story__lead">
          {data.case_study.candidate_patches
            ? `From ${data.case_study.baseline_date} to ${data.case_study.event_date}, the NISAR change rules flagged ${data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² across ${data.case_study.candidate_patches} candidate region${data.case_study.candidate_patches === 1 ? "" : "s"} inside the ${data.case_study.site ?? "study area"} mask. These are places to investigate, not confirmed flood detections.`
            : `For the ${data.case_study.baseline_date} → ${data.case_study.event_date} pair, the detector produced no candidate regions inside its processed study mask. This does not establish that no flooding or surface change occurred.`}
        </p>
        <div className="nisar-case-story__grid">
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">01 · OBSERVATIONS</span>
            <h3>Matched radar dates</h3>
            <p><strong>{data.case_study.method?.baseline_method?.baseline_observation_count && data.case_study.method.baseline_method.baseline_observation_count > 1 ? `Median baseline · ${data.case_study.method.baseline_method.baseline_observation_dates?.join(", ")}` : data.case_study.baseline_date}</strong> baseline<br /><strong>{data.case_study.event_date}</strong> comparison</p>
            <p className="nisar-case-step__detail">NISAR L2 GCOV provisional · {(data.case_study.polarizations ?? ["HHHH", "HVHV"]).join(" / ")}</p>
            {data.case_study.input_origin === "SAVED_NISAR_DB_SUBSETS" && <p className="nisar-case-step__detail">Measured radar subsets reused from saved run {data.case_study.source_run_id?.slice(0, 8)}. The original case remains in Saved analyses.</p>}
            {data.case_study.date_pair_selection && <p className="nisar-case-step__detail">Date selection screened {data.case_study.date_pair_selection.screened_scenes} optical scenes across {data.case_study.date_pair_selection.candidate_pairs} radar pairs. {data.case_study.date_pair_selection.method}</p>}
            <code title={`${(data.case_study.baseline_scenes ?? [data.case_study.baseline_scene]).filter(Boolean).join("\n")}\n${data.case_study.event_scene ?? ""}`}>{data.case_study.baseline_scenes?.length ? `${data.case_study.baseline_scenes.length} baseline scenes · ${data.case_study.baseline_scenes[0]}${data.case_study.baseline_scenes.length > 1 ? " …" : ""}` : data.case_study.baseline_scene ?? "Baseline scene not recorded"}<br />{data.case_study.event_scene ?? "Comparison scene not recorded"}</code>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">02 · DETECTOR RESULT</span>
            <h3>{data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² flagged by rules</h3>
            {Object.entries(data.case_study.classes ?? {}).length ? Object.entries(data.case_study.classes ?? {}).map(([name, summary]) => <p key={name}><strong>{name === "OPEN_WATER" ? "HH darkening candidate" : name === "VEGETATED_INUNDATION" ? "HH increase / HV stability candidate" : name.replaceAll("_", " ").toLowerCase()}</strong> · {summary.patches} regions · {summary.area_km2.toFixed(2)} km² · ΔHH {summary.mean_delta_hh_db?.toFixed(2) ?? "—"} dB</p>) : <p>No algorithmic candidate polygons were produced for this pair.</p>}
            <p className="nisar-case-step__detail">Rules run only within the configured study boundary, after HH/HV alignment and validity masking. HH darkening does not establish a dry-to-water transition or a flood.</p>
            {data.case_study.method?.baseline_method && <p className="nisar-case-step__detail">Baseline: {data.case_study.method.baseline_method.baseline_observation_count ?? 1} preceding observation(s) · {(data.case_study.method.baseline_method.baseline_observation_dates ?? []).join(", ")}. {data.case_study.method.baseline_method.baseline_hh_temporal_mad_db != null ? `Median HH temporal MAD ${data.case_study.method.baseline_method.baseline_hh_temporal_mad_db.toFixed(2)} dB.` : "Single-observation spread is not estimated."}</p>}
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">03 · INDEPENDENT SENSOR</span>
            <h3>{data.case_study.reference_validation?.reference_product ?? "HLS optical reference unavailable"}</h3>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? <>
              <p>Clear overlap: <strong>{((data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}%</strong> of the study mask</p>
              <p className="nisar-case-step__detail">{(data.case_study.reference_validation.optical_support?.common_clear_area_km2 ?? data.case_study.reference_validation.coverage?.common_clear_area_km2)?.toFixed(2) ?? "—"} km² could be compared. The remaining {(100 - (data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}% is unassessed by this reference.</p>
              <p>{data.case_study.reference_validation.optical_support ? "Area-weighted precision" : "Legacy grid precision"} <strong>{(data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision ?? 0) * 100).toFixed(1)}%`}</strong> · Recall <strong>{(data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall ?? 0) * 100).toFixed(1)}%`}</strong> · F1 <strong>{(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1 ?? 0) * 100).toFixed(1)}%`}</strong></p>
              {data.case_study.reference_validation.optical_support?.precision != null
                ? <p className="nisar-case-step__detail">Area-weighted on native HLS cells, {(data.case_study.reference_validation.optical_support.precision * 100).toFixed(1)}% of the assessed HH-darkening candidate area overlaps newly wet HLS support. This is satellite agreement, not confirmed flood accuracy.</p>
                : data.case_study.reference_validation.metrics?.precision != null && <p className="nisar-case-step__detail">Legacy radar-grid comparison: {(data.case_study.reference_validation.metrics.precision * 100).toFixed(1)}% of assessed radar candidate pixels overlap newly wet HLS pixels. This is satellite agreement, not confirmed flood accuracy.</p>}
              {(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 && <p><strong>No overlapping change support.</strong> This comparison does not corroborate the candidates. Different acquisition dates, shoreline mixtures and radar effects require further investigation.</p>}
              <p className="nisar-case-step__detail">MNDWI &gt; {data.case_study.reference_validation.comparison?.mndwi_threshold?.toFixed(2) ?? "0.00"} on cloud-screened {data.case_study.reference_validation.comparison?.spatial_resolution_m ?? 30} m HLS cells. The separate score area-averages valid and candidate radar support to that native grid. Dates: {data.case_study.reference_validation.comparison?.baseline?.hls_date ?? "—"} → {data.case_study.reference_validation.comparison?.event?.hls_date ?? "—"}.</p>
            </> : <p>{data.case_study.reference_validation?.reason ?? "No independent reference result is available for this case."}</p>}
            {data.case_study.reference_validation?.selection && <p className="nisar-case-step__detail">{data.case_study.reference_validation.selection.evaluated_pairs} of {data.case_study.reference_validation.selection.available_pairs} date-matched pairs evaluated. {data.case_study.reference_validation.selection.method}</p>}
            {data.case_study.reference_validation?.selection?.catalog_searches && <p className="nisar-case-step__detail">Collections searched: {data.case_study.reference_validation.selection.catalog_searches.map((item) => `${item.collection}: ${item.status === "SEARCHED" ? `${item.records} records` : "unavailable"}`).join(" · ")}</p>}
            {data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Before reference: {data.case_study.reference_validation.comparison.baseline?.product || "S30"}, {data.case_study.reference_validation.comparison.baseline?.offset_days ?? "—"} days from radar. After reference: {data.case_study.reference_validation.comparison.event?.product || "S30"}, {data.case_study.reference_validation.comparison.event?.offset_days ?? "—"} days from radar.</p>}
            {data.case_study.reference_validation?.status !== "CROSS_SENSOR_CHECK" && data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Reference dates: {data.case_study.reference_validation.comparison.baseline?.hls_date} → {data.case_study.reference_validation.comparison.event?.hls_date}. Common clear coverage: {((data.case_study.reference_validation.coverage?.common_clear_fraction || 0)*100).toFixed(1)}%.</p>}
            <a href="#nisar-process">Retry the independent reference check ↑</a>
            <p><a href="#nisar-reference-evidence">Inspect optical images and the disagreement ↓</a></p>
            <p className="nisar-case-step__detail">Cross-sensor agreement is not field truth or a formal accuracy estimate; vegetated inundation is not checked.</p>
            <a className="detection-worldview-link" href={data.case_study.reference_validation?.source_url || "https://hls.gsfc.nasa.gov/data-products/"} target="_blank" rel="noreferrer">NASA HLS reference source ↗</a>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">04 · UNCERTAINTY</span>
            <h3>{data.case_study.uncertainty?.threshold_sensitivity?.stability_verdict ?? "Threshold stability unavailable"}</h3>
            <p>{data.case_study.uncertainty?.threshold_sensitivity?.stable_range?.length ? `Candidate area was swept across ${data.case_study.uncertainty.threshold_sensitivity.stable_range[0].toFixed(1)}–${data.case_study.uncertainty.threshold_sensitivity.stable_range.at(-1)?.toFixed(1)} dB.` : data.case_study.uncertainty?.threshold_sensitivity?.sensitivity_note ?? "Threshold sensitivity was not computed."}</p>
            <p className="nisar-case-step__detail">{data.case_study.method?.validity_rule} GCOV is provisional; thresholds are exploratory and not field-calibrated.</p>
            {data.case_study.method?.gcov_quality && <>
              <p className="nisar-case-step__detail">numberOfLooks rule: {data.case_study.method.gcov_quality.number_of_looks_rule}. Averaging mask: {data.case_study.method.gcov_quality.mask_rule}.</p>
              {!!data.case_study.method.gcov_quality.scenes?.length && <p className="nisar-case-step__detail">Per-scene median numberOfLooks: {data.case_study.method.gcov_quality.scenes.map((item) => `${item.scene?.slice(-20) ?? "scene"} ${item.number_of_looks_median?.toFixed(1) ?? "—"}`).join(" · ")}.</p>}
            </>}
          </article>
        </div>
        <div className="nisar-case-story__impact"><strong>Why this matters</strong><p>{data.case_study.impact_context}</p></div>
        <p className="nisar-case-story__scope">{data.case_study.spatial_scope}</p>
      </section> : <section className="nisar-case-story nisar-case-story--empty" aria-labelledby="nisar-case-story-title">
        <div><p className="global-eyebrow">CASE STUDY · AWAITING REAL PIPELINE OUTPUT</p><h2 id="nisar-case-story-title">No real NISAR change case is loaded</h2>
          <p>Worldwide footprints mark acquisitions only. Run the real NISAR pipeline for the configured study boundary to create a before-and-after result and attempt the independent HLS Sentinel-2/Landsat cross-check. Until then, blank areas mean no detector result is available.</p>
          <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Run a real NISAR analysis ↗</span></Link></div>
      </section>}

      <MozambiqueFloodCase onLocate={locateMozambiqueCase} />

      {isNisar && data?.case_study && !loading && <ReferenceEvidence runId={data.run_id} refreshKey={refreshKey} />}

      <footer className="global-footer detection-footer">
        <span>Global observation source: NASA GIBS daily NISAR L2 GCOV mosaic.</span>
        <span>{isNisar ? `Local candidate overlay: run ${data?.run_id.slice(0, 8)} · see case study for scope and cross-sensor check.` : "The global mosaic and footprints are observations, not worldwide classifications."}</span>
      </footer>
    </main>
  );
}
