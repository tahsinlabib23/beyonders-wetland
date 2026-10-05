"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";

export interface GlobalScene {
  sceneId: string;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
  orbitDirection: string;
  trackNumber: string;
  browseUrl: string | null;
  dataUrl: string | null;
  product: string;
}

type SceneFeature = Feature<MultiPolygon, GlobalScene>;
type SceneCollection = FeatureCollection<MultiPolygon, GlobalScene>;
interface CoverageResponse {
  date: string;
  product: string;
  totalHits: number;
  loadedFeatures: number;
  truncated: boolean;
  features: SceneFeature[];
  error?: string;
  snapshotFallback?: boolean;
}

const GlobalSceneMap = dynamic(() => import("./GlobalSceneMap"), {
  ssr: false,
  loading: () => <div className="global-map-loading">Loading world map…</div>,
});

const FIRST_PROVISIONAL_DATE = "2026-06-17";

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function recentArchiveDate() {
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  return recent.toISOString().slice(0, 10);
}

function formatAcquisition(value: string | null) {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function downloadInventory(date: string, scenes: SceneFeature[]) {
  const columns = ["scene_id", "acquisition_start_utc", "acquisition_end_utc", "orbit_direction", "track", "browse_url", "science_file_url"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = scenes.map(({ properties }) => [
    properties.sceneId,
    properties.acquisitionStart,
    properties.acquisitionEnd,
    properties.orbitDirection,
    properties.trackNumber,
    properties.browseUrl,
    properties.dataUrl,
  ].map(escape).join(","));
  const blob = new Blob([[columns.join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nisar-global-scene-inventory-${date}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GlobalCoverageExplorer() {
  const [date, setDate] = useState(recentArchiveDate);
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [selected, setSelected] = useState<GlobalScene | null>(null);
  const [sceneQuery, setSceneQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const today = utcToday();

  function beginQuery() {
    setLoading(true);
    setError("");
    setData(null);
    setSelected(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wetland/global-coverage?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as CoverageResponse;
        if (!response.ok) throw new Error(result.error || "Could not load the NASA catalog.");
        return result;
      })
      .then((result) => {
        setData(result);
        setSelected(result.features[0]?.properties ?? null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Could not load the NASA catalog.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date, refreshKey]);

  const collection = useMemo<SceneCollection>(() => ({
    type: "FeatureCollection",
    features: data?.features ?? [],
  }), [data]);

  const matchingScenes = useMemo(() => {
    const query = sceneQuery.trim().toLowerCase();
    if (query.length < 2 || !data) return [];
    return data.features.filter(({ properties }) =>
      properties.sceneId.toLowerCase().includes(query) ||
      properties.trackNumber.toLowerCase().includes(query) ||
      properties.orbitDirection.toLowerCase().includes(query)
    );
  }, [data, sceneQuery]);

  const selectScene = useCallback((scene: GlobalScene) => setSelected(scene), []);
  const chosenScene = data?.features.find((feature) => feature.properties.sceneId === selected?.sceneId)?.properties ?? selected;
  const dateIsToday = date >= today;

  function shiftDate(days: number) {
    const shifted = new Date(`${date}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    beginQuery();
    setDate(shifted.toISOString().slice(0, 10));
  }

  return (
    <main className="global-coverage-page">
      <header className="global-header">
        <div className="global-brand">
          <span className="global-brand__mark" aria-hidden="true">B</span>
          <div><strong>BEYONDERS</strong><span>WETLAND PULSE</span></div>
          <span className="global-header__divider" aria-hidden="true" />
          <span className="global-header__section">Worldwide scene coverage</span>
        </div>
        <div className="detection-header-actions">
          <Link className="global-back-link" href="/wetland/global">Global detections <span aria-hidden="true">↗</span></Link>
          <Link className="global-back-link" href="/wetland?source=raster">Haor analysis <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="global-intro" aria-labelledby="global-title">
        <div>
          <p className="global-eyebrow">REAL NASA NISAR SATELLITE SCENES</p>
          <h1 id="global-title">See where the satellite has observed</h1>
          <p className="global-description">Choose a date to see satellite-image coverage around the world. Each outline marks one image footprint; select it for a preview and data link. Coverage outlines are not wetland or flood detections.</p>
        </div>
        <div className="global-date-control">
          <label htmlFor="coverage-date">Observation date (UTC)</label>
          <div className="global-date-inputs">
            <button type="button" aria-label="Previous day" onClick={() => shiftDate(-1)} disabled={date <= FIRST_PROVISIONAL_DATE}>‹</button>
            <input
              id="coverage-date"
              type="date"
              value={date}
              min={FIRST_PROVISIONAL_DATE}
              max={today}
              onChange={(event) => { beginQuery(); setDate(event.target.value); }}
            />
            <button type="button" aria-label="Next day" onClick={() => shiftDate(1)} disabled={dateIsToday}>›</button>
          </div>
        </div>
      </section>

      <div className="global-status-row" aria-live="polite">
        <div className="global-count">
          <strong>{loading ? "…" : (data?.totalHits ?? 0).toLocaleString()}</strong>
          <span>{loading ? "Searching NASA catalog" : "scenes listed for this date"}</span>
        </div>
        <div className="global-status-meta">
          <span className={`global-source-pill ${loading ? "global-source-pill--loading" : error ? "global-source-pill--error" : data?.snapshotFallback ? "global-source-pill--snapshot" : "global-source-pill--live"}`} aria-live="polite"><i aria-hidden="true" />{loading ? "Checking NASA catalog…" : error ? "NASA catalog unavailable" : data?.snapshotFallback ? "Saved snapshot · Oct 1, 2026" : "NASA catalog · live"}</span>
          <button className="global-refresh" type="button" onClick={() => { beginQuery(); setRefreshKey((value) => value + 1); }} disabled={loading}>Refresh</button>
          <button className="global-refresh" type="button" onClick={() => data && downloadInventory(date, data.features)} disabled={loading || !data?.features.length}>Download scene CSV</button>
        </div>
      </div>

      <section className="global-workspace" aria-label="Global NISAR coverage explorer">
        <div className="global-map-panel">
          <div className="global-map-topline">
            <span>WORLDWIDE COVERAGE</span>
            <span>{data ? `${data.loadedFeatures.toLocaleString()} scenes on map` : "Daily satellite coverage"}</span>
          </div>
          <div className="global-map-wrap" role="region" aria-label="World map showing NISAR scene coverage footprints">
            <GlobalSceneMap date={date} refreshKey={refreshKey} features={collection} selectedSceneId={chosenScene?.sceneId ?? null} onSelect={selectScene} />
            {loading && <div className="global-map-overlay" role="status">Searching NASA’s global scene catalog…</div>}
            {!loading && !error && data?.features.length === 0 && (
              <div className="global-map-overlay global-map-overlay--empty">
                <strong>No footprints listed for {date}</strong>
                <span>Try an adjacent UTC date. Archive ingest can lag behind acquisition.</span>
              </div>
            )}
            {error && <div className="global-map-overlay global-map-overlay--empty" role="alert"><strong>Catalog request failed</strong><span>{error}</span></div>}
          </div>
          <div className="global-map-legend" aria-label="Orbit direction legend">
            <span><i className="global-legend-swatch global-legend-swatch--ascending" />Ascending orbit</span>
            <span><i className="global-legend-swatch global-legend-swatch--descending" />Descending orbit</span>
            <span className="global-legend-note">Coverage only · no wetland detections</span>
          </div>
        </div>

        <aside className="global-scene-panel" aria-label="Selected scene details">
          <div className="global-scene-panel__heading">
            <div><p className="global-eyebrow">SELECTED SCENE</p><h2>{chosenScene ? "Scene details" : "Choose a footprint"}</h2></div>
            <span className="global-live-mark" title="NASA scene catalog record"><i />NASA record</span>
          </div>

          {data?.features.length ? <div className="global-scene-picker">
            <label htmlFor="scene-search">Find a scene by ID, track, or orbit</label>
            <input id="scene-search" type="search" value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} placeholder="e.g. 012 or ascending" autoComplete="off" />
            <p className="global-scene-search-help">Or choose a colored footprint on the map.</p>
            {sceneQuery.trim().length >= 2 && <div className="global-scene-results" role="listbox" aria-label="Matching satellite scenes">
              {matchingScenes.length === 0 ? <p className="global-scene-results__empty">No scenes match “{sceneQuery.trim()}”. Try a track number or part of the scene ID.</p> : <>
                {matchingScenes.slice(0, 8).map(({ properties }) => (
                  <button key={properties.sceneId} type="button" role="option" aria-selected={chosenScene?.sceneId === properties.sceneId} title={properties.sceneId} onClick={() => { setSelected(properties); setSceneQuery(""); }}>
                    <strong>Track {properties.trackNumber} · {properties.orbitDirection}</strong>
                    <span>{properties.sceneId}</span>
                  </button>
                ))}
                <p className="global-scene-results__count">Showing {Math.min(matchingScenes.length, 8)} of {matchingScenes.length.toLocaleString()} matches</p>
              </>}
            </div>}
          </div> : null}

          {chosenScene ? <>
            <div className="global-scene-preview">
              {chosenScene.browseUrl ? <a href={chosenScene.browseUrl} target="_blank" rel="noreferrer" aria-label="Open NISAR browse image in a new tab">
                {/* NASA's public browse preview is served directly from its catalog URL. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chosenScene.browseUrl} alt={`NISAR browse preview for ${chosenScene.sceneId}`} loading="lazy" />
                <span>Open full browse image ↗</span>
              </a> : <div className="global-scene-preview__empty">Browse image unavailable for this record</div>}
            </div>
            <dl className="global-scene-metadata">
              <div><dt>Acquisition start</dt><dd>{formatAcquisition(chosenScene.acquisitionStart)}</dd></div>
              <div><dt>Acquisition end</dt><dd>{formatAcquisition(chosenScene.acquisitionEnd)}</dd></div>
              <div><dt>Orbit direction</dt><dd><span className={`global-orbit-dot global-orbit-dot--${chosenScene.orbitDirection.toLowerCase()}`} />{chosenScene.orbitDirection}</dd></div>
              <div><dt>Track</dt><dd>{chosenScene.trackNumber}</dd></div>
              <div className="global-scene-metadata__id"><dt>Granule ID</dt><dd>{chosenScene.sceneId}</dd></div>
            </dl>
            <p className="global-provisional-note">NISAR L2 GCOV is provisional. This scene footprint and browse image show where an acquisition exists; no global inundation classification has been computed.</p>
            {chosenScene.dataUrl ? <a className="global-data-link" href={chosenScene.dataUrl} target="_blank" rel="noreferrer">Open science file <span>Earthdata Login may be required ↗</span></a> : <p className="global-data-link global-data-link--disabled">Science file link unavailable</p>}
          </> : <p className="global-empty-detail">Choose a colored footprint on the map or select a scene after the catalog loads.</p>}
        </aside>
      </section>

      <footer className="global-footer">
        <span>Catalog source: NASA CMR · {data?.product ?? "NISAR_L2_GCOV_PROVISIONAL_V1"}</span>
        <span>{data?.snapshotFallback ? "Snapshot fallback for 1 Oct 2026; choose another date when live CMR access is available." : data?.truncated ? "Catalog result limit reached; narrow the date to inspect a smaller set." : "Browse data may be public; science HDF5 access can require Earthdata Login."}</span>
      </footer>
    </main>
  );
}
