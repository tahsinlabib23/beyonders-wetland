"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Pane,
  GeoJSON as LeafletGeoJSON,
  useMap,
  useMapEvents,
  ZoomControl
} from "react-leaflet";
import { useWetlandStore } from "@/lib/store";
import { MAP_CONFIG } from "@/lib/constants";
import type { WetlandGeometry, WetlandPatch } from "@/lib/types";
import { demoPatches, patchPolygon } from "@/lib/demo-engine";
import SarProbe, { ProbePopup } from "./SarProbe";
import InundationLayer from "./InundationLayer";
import "leaflet/dist/leaflet.css";

function ComparisonClip({ position, active }: { position: number; active: boolean }) {
  const map = useMap();
  const update = () => {
    const pane = map.getPane("splitPane");
    if (!pane) return;
    if (!active) { pane.style.clipPath = "none"; return; }
    const origin = map.containerPointToLayerPoint([0, 0]);
    const size = map.getSize();
    const x = origin.x + size.x * position / 100;
    pane.style.clipPath = `polygon(${x}px ${origin.y}px, ${origin.x + size.x}px ${origin.y}px, ${origin.x + size.x}px ${origin.y + size.y}px, ${x}px ${origin.y + size.y}px)`;
  };
  useMapEvents({ move: update, zoomend: update, resize: update });
  useEffect(update, [map, position, active]);
  return null;
}

const DEMO_BOUNDS = demoPatches(3, 0.5).flatMap(patchPolygon);

function geometryPoints(geometry: WetlandGeometry): [number, number][] {
  const points: [number, number][] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push([value[1], value[0]]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return points;
}

function ResizeMap() {
  const map = useMap();
  const { patches, demoMode, pipelineRunId, pulseData } = useWetlandStore();
  const fittedRunId = useRef<string | null>(null);
  const fittedBounds = useRef<[number, number][] | null>(null);
  useEffect(() => {
    const fitCurrentData = () => {
      if (demoMode) {
        fittedRunId.current = null;
        fittedBounds.current = null;
        map.fitBounds(DEMO_BOUNDS, { paddingTopLeft: [32, 100], paddingBottomRight: [32, 80], maxZoom: 12 });
        return;
      }
      const siteBounds = pulseData?.site_bounds;
      if (siteBounds && siteBounds.length === 4 && siteBounds.every(Number.isFinite)) {
        const [west, south, east, north] = siteBounds;
        map.fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 11 });
        return;
      }
      if (fittedRunId.current !== pipelineRunId) {
        const positions = patches.flatMap((patch: WetlandPatch) => patch.geometry
          ? geometryPoints(patch.geometry)
          : [patch.centroid]);
        fittedBounds.current = positions.length ? positions : null;
        fittedRunId.current = pipelineRunId;
      }
      if (fittedBounds.current?.length) map.fitBounds(fittedBounds.current, { padding: [48, 48], maxZoom: 13 });
      else map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    };
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      fitCurrentData();
    });
    observer.observe(map.getContainer());
    fitCurrentData();
    return () => observer.disconnect();
  }, [map, patches, demoMode, pipelineRunId, pulseData]);
  return null;
}

export default function WetlandMap() {
  const { mapMode, selectedDateIndex, pulseData, siteBoundary, probeActive, probeResult, setProbeResult, satelliteBasemap: satellite, setSatelliteBasemap: setSatellite, demoMode } = useWetlandStore();
  const [splitPos, setSplitPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (mapMode !== "SPLIT") return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const rect = containerRef.current.getBoundingClientRect();
      const pos = ((clientX - rect.left) / rect.width) * 100;
      setSplitPos(Math.max(0, Math.min(100, pos)));
    };
    
    const handleUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };
    
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchend', handleUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchend', handleUp);
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };
  }, [mapMode]);

  return (
    <div className="map-container" ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapContainer
        center={MAP_CONFIG.center}
        zoom={12}
        minZoom={MAP_CONFIG.minZoom}
        maxZoom={MAP_CONFIG.maxZoom}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
      >
        <ResizeMap />
        <ZoomControl position="bottomright" />
        {satellite && <TileLayer
          url={MAP_CONFIG.tileUrl}
          attribution={MAP_CONFIG.tileAttribution}
        />}
        {demoMode && (mapMode === "BEFORE" || mapMode === "SPLIT") && <Pane name="baselinePane" style={{ zIndex: 399 }}><InundationLayer baseline /></Pane>}

        {/* We use a Leaflet Pane to clip the layers in SPLIT mode */}
        <Pane 
          name="splitPane" 
          style={{ zIndex: 400 }}
        >
          {mapMode !== "BEFORE" && <InundationLayer />}
        </Pane>
        {!demoMode && siteBoundary && <Pane name="boundaryPane" style={{ zIndex: 450 }}>
          <LeafletGeoJSON
            data={siteBoundary}
            style={{ color: "#67e8f9", weight: 2, opacity: 0.95, fillOpacity: 0.025, dashArray: "5 4" }}
            interactive={false}
          />
        </Pane>}
        <ComparisonClip position={splitPos} active={mapMode === "SPLIT"} />
        <SarProbe />

      </MapContainer>

      {/* Draggable Split Slider UI overlay */}
      {mapMode === "SPLIT" && (
        <div 
          role="slider" tabIndex={0} aria-label="Before and after comparison divider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(splitPos)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            setSplitPos((current) => e.key === "Home" ? 0 : e.key === "End" ? 100 : Math.max(0, Math.min(100, current + (e.key === "ArrowLeft" ? -5 : 5))));
          }}
          onMouseDown={() => { isDragging.current = true; document.body.style.cursor = 'ew-resize'; }}
          onTouchStart={() => { isDragging.current = true; }}
          style={{ 
            position: "absolute", top: 0, bottom: 0, left: `${splitPos}%`, width: "4px", 
            background: "var(--accent-primary)", zIndex: 1000, cursor: "ew-resize", 
            transform: "translateX(-50%)", boxShadow: "0 0 10px rgba(0, 212, 255, 0.8)", 
            display: "flex", alignItems: "center", justifyContent: "center" 
          }}
        >
          <div style={{ width: "24px", height: "40px", background: "var(--bg-tertiary)", border: "2px solid var(--accent-primary)", borderRadius: "4px", display: "flex", gap: "2px", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ width: "2px", height: "20px", background: "var(--text-muted)" }} />
            <div style={{ width: "2px", height: "20px", background: "var(--text-muted)" }} />
          </div>
        </div>
      )}

      {/* Map Mode Title Overlays for Split View */}
      {mapMode === "SPLIT" && (
        <>
          <div style={{ position: "absolute", top: "70px", left: "16px", background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: "4px", color: "white", zIndex: 1000, fontSize: "0.6rem", fontWeight: "bold", pointerEvents: "none" }}>
            BASELINE · FIRST DEMO DATE
          </div>
          <div style={{ position: "absolute", top: "120px", right: "16px", background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: "4px", color: "white", zIndex: 1000, fontSize: "0.6rem", fontWeight: "bold", pointerEvents: "none" }}>
            CURRENT DEMO DATE
          </div>
        </>
      )}
      <details className="map-caption" open={probeActive && probeResult ? true : undefined}>
        <summary>{probeActive && probeResult ? "Sample result & map layers" : "Map layers & help"}</summary>
        <button onClick={() => setSatellite(!satellite)} aria-pressed={satellite}>{satellite ? "Use simple map" : "Show satellite imagery"}</button>
        <p>{demoMode ? "Illustrative geometry" : pulseData?.data_source === "NISAR" ? "NISAR provisional candidates · dashed line: reference haor boundary" : "Generated synthetic raster polygons"} · {mapMode === "BEFORE" ? pulseData?.dates[0]?.date : pulseData?.dates[selectedDateIndex]?.date}</p>
        <p>{probeActive ? `Click the map to sample ${demoMode ? "a browser simulation" : pulseData?.data_source === "NISAR" ? "the selected NISAR observation" : "the selected generated raster date"}.` : satellite ? (pulseData?.data_source === "NISAR" ? "Satellite basemap · candidate detections come from NISAR provisional data." : "Basemap needs internet. Candidate signals remain simulated.") : "Schematic map · no map tile requests"}</p>
        {probeActive && probeResult && <div className="map-probe" aria-live="polite"><button onClick={() => setProbeResult(null)}>Clear probe</button><ProbePopup /></div>}
      </details>
    </div>
  );
}
