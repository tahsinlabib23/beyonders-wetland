"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { ForestBoundaryGeoJson, ForestDiscoveryResult } from "./ForestWorkflowControls";
import "./forest.css";

const ForestMap = dynamic(() => import("./ForestMap"), {
  ssr: false,
  loading: () => <div className="forest-map-loading">Opening the real basemap…</div>,
});

type Props = {
  discovery: ForestDiscoveryResult | null;
  studyBounds: [number, number, number, number] | null;
  onStudyBoundsChange?: (bounds: [number, number, number, number]) => void;
  studyBoundaryGeoJson?: ForestBoundaryGeoJson | null;
};

export default function ForestPreviewWorkspace({ discovery, studyBounds, onStudyBoundsChange, studyBoundaryGeoJson }: Props) {
  const scenes = discovery?.scenes ?? [];
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setActiveSceneIndex(Math.max(0, scenes.length - 1));
      setPlaying(false);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [scenes.length, discovery?.siteName]);
  useEffect(() => {
    if (!playing || scenes.length < 2) return;
    const timer = window.setInterval(() => setActiveSceneIndex((current) => (current + 1) % scenes.length), 1100);
    return () => window.clearInterval(timer);
  }, [playing, scenes.length]);
  const activeScene = scenes[activeSceneIndex] ?? null;
  const ready = discovery?.status === "READY" && scenes.length >= 3;
  const selectScene = (index: number) => setActiveSceneIndex(Math.min(Math.max(0, index), Math.max(0, scenes.length - 1)));

  return (
    <section className="forest-preview-workspace" aria-label="Forest time machine and map">
      <section className="forest-panel forest-time-machine" aria-labelledby="forest-empty-timeline-title">
        <div className="forest-panel-head">
          <div><p className="forest-kicker">LIVE WORKSPACE / 01</p><h2 id="forest-empty-timeline-title">Forest Time Machine</h2></div>
          <span className={`forest-status forest-status--${ready ? "pass" : "info"}`}>{ready ? "CATALOG LOADED" : "AWAITING REAL DATA"}</span>
        </div>
        <p className="forest-muted">The timeline appears immediately. Before processing, dates below are real catalog acquisition metadata only; raster values and detection layers appear only after a completed NISAR run.</p>
        {scenes.length ? <>
          <div className="forest-timeline-toolbar forest-catalog-playback" role="group" aria-label="Catalog acquisition timeline controls">
            <button type="button" onClick={() => { setPlaying(false); selectScene(activeSceneIndex - 1); }} disabled={scenes.length < 2} aria-label="Previous catalog acquisition">← Previous</button>
            <button type="button" className="forest-button-primary" onClick={() => setPlaying((value) => !value)} disabled={scenes.length < 2} aria-pressed={playing}>{playing ? "Pause timeline" : "Play timeline"}</button>
            <input aria-label="Catalog acquisition position" type="range" min={0} max={Math.max(0, scenes.length - 1)} value={Math.min(activeSceneIndex, Math.max(0, scenes.length - 1))} disabled={scenes.length < 2} onChange={(event) => { setPlaying(false); selectScene(Number(event.target.value)); }} />
            <button type="button" onClick={() => { setPlaying(false); selectScene(activeSceneIndex + 1); }} disabled={scenes.length < 2} aria-label="Next catalog acquisition">Next →</button>
            <strong>{activeScene?.date ?? "No date"}</strong>
          </div>
          <div className="forest-catalog-timeline" role="group" aria-label="Actual NISAR acquisition dates from live catalog">
            {scenes.map((scene, index) => <button type="button" key={scene.sceneId} className={index === activeSceneIndex ? "is-active" : ""} onClick={() => { setPlaying(false); selectScene(index); }} aria-pressed={index === activeSceneIndex}>
              <span className="forest-catalog-tick" aria-hidden="true" /><strong>{scene.date}</strong><small>CATALOG ONLY</small>
            </button>)}
          </div>
          {activeScene && <div className="forest-observation-detail forest-catalog-scene-detail">
            <div><span>Acquisition date</span><strong>{activeScene.date}</strong></div>
            <div><span>Track / direction</span><strong>{activeScene.track} / {activeScene.direction}</strong></div>
            <div><span>Frame / release</span><strong>{activeScene.frame} / {activeScene.processingRelease}</strong></div>
            <div><span>Polarization mode</span><strong>{activeScene.polarizationMode}/{activeScene.pairedPolarizationMode}</strong></div>
            <div className="forest-catalog-scene-id"><span>Actual source scene ID</span><strong><code>{activeScene.sceneId}</code></strong></div>
          </div>}
          {discovery && <p className="forest-warning-note">NASA CMR returned {discovery.catalogHits} catalog records. This is a compatible series of {scenes.length} distinct acquisition dates. It is not a processed raster timeline yet.</p>}
        </> : <div className="forest-timeline-empty" role="status">
          <div className="forest-timeline-empty-line" aria-hidden="true" />
          <strong>{discovery ? "No compatible acquisition series was returned" : "No acquisition dates loaded yet"}</strong>
          <p>{discovery?.message ?? "Use the real-data controls below to search NASA&apos;s live NISAR catalog. No example dates or fabricated observations are inserted here."}</p>
        </div>}
      </section>
      <section className="forest-panel forest-preview-map-panel" aria-labelledby="forest-empty-map-title">
        <div className="forest-panel-head"><div><p className="forest-kicker">LIVE WORKSPACE / 02</p><h2 id="forest-empty-map-title">Study area & evidence map</h2></div><span className="forest-data-label">NO SYNTHETIC LAYERS</span></div>
        <p className="forest-muted">The dashed outline is only the WGS84 study box entered below. It is not a forest boundary. The OpenStreetMap basemap is geographic context; it is not a forest-classification layer.</p>
        <ForestMap analysis={null} studyBounds={studyBounds} studyBoundaryGeoJson={studyBoundaryGeoJson} onStudyBoundsChange={onStudyBoundsChange} activeDate={activeScene?.date ?? null} selectedCandidateId={null} onSelectCandidate={() => undefined} />
      </section>
    </section>
  );
}
