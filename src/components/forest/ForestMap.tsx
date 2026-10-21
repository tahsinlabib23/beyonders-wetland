"use client";

import { useEffect, useState } from "react";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Feature, GeoJsonObject, GeoJsonProperties, Geometry } from "geojson";
import { forestCandidateGeoJson, type ForestAnalysisDocument, type ForestCandidate } from "@/lib/forest-analysis";

type Props = {
  analysis: ForestAnalysisDocument | null;
  selectedCandidateId: string | null;
  activeDate: string | null;
  onSelectCandidate: (id: string) => void;
  studyBounds?: [number, number, number, number] | null;
  onStudyBoundsChange?: (bounds: [number, number, number, number]) => void;
  studyBoundaryGeoJson?: { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown }; properties?: Record<string, unknown> }> } | null;
};

type RadarPreviewMetadata = {
  available: boolean;
  message?: string;
  boundsWgs84WestSouthEastNorth?: [number, number, number, number] | null;
  scaleMinDb?: number | null;
  scaleMaxDb?: number | null;
  validForestPixelFraction?: number;
  measurement?: string;
  sceneId?: string;
};

function FitBounds({ bounds }: { bounds: [number, number, number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const [west, south, east, north] = bounds;
    map.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 11, animate: false });
  }, [bounds, map]);
  return null;
}

function MapClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (point: [number, number]) => void }) {
  useMapEvents({ click: (event) => { if (enabled) onClick([event.latlng.lat, event.latlng.lng]); } });
  return null;
}

function candidateStyle(selectedCandidateId: string | null) {
  return (feature?: Feature<Geometry, GeoJsonProperties>) => {
    const selected = feature?.properties?.id === selectedCandidateId;
    return {
      color: selected ? "#ffe0a4" : "#e59d4f",
      weight: selected ? 3 : 1.6,
      fillColor: selected ? "#ffd27a" : "#d77628",
      fillOpacity: selected ? 0.48 : 0.24,
    };
  };
}

export default function ForestMap({ analysis, selectedCandidateId, activeDate, onSelectCandidate, studyBounds = null, onStudyBoundsChange, studyBoundaryGeoJson = null }: Props) {
  const [radarChannel, setRadarChannel] = useState<"none" | "hh" | "hv">("none");
  const [drawingMode, setDrawingMode] = useState(false);
  const [firstCorner, setFirstCorner] = useState<[number, number] | null>(null);
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<RadarPreviewMetadata | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const bounds = analysis?.site.bounds ?? studyBounds;
  const runId = analysis?.runId ?? null;
  const handleMapClick = (point: [number, number]) => {
    if (!drawingMode) return;
    if (!firstCorner) {
      setFirstCorner(point);
      setDrawMessage("First corner recorded. Click the opposite corner to finish the study box.");
      return;
    }
    const [lat1, lng1] = firstCorner;
    const [lat2, lng2] = point;
    const bounds: [number, number, number, number] = [Math.min(lng1, lng2), Math.min(lat1, lat2), Math.max(lng1, lng2), Math.max(lat1, lat2)];
    if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) {
      setDrawMessage("The selected corners must define a non-zero rectangular study area. Try again.");
      setFirstCorner(null);
      return;
    }
    onStudyBoundsChange?.(bounds);
    setDrawingMode(false);
    setFirstCorner(null);
    setDrawMessage("Study box updated. Check the coordinate limits and available scene coverage before processing.");
  };

  useEffect(() => {
    if (!runId || radarChannel === "none" || !activeDate) {
      const clearTimer = window.setTimeout(() => {
        setPreview(null);
        setPreviewMessage(null);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    let cancelled = false;
    const loadingTimer = window.setTimeout(() => {
      if (cancelled) return;
      setPreview(null);
      setPreviewMessage("Loading the measured NISAR raster preview…");
    }, 0);
    fetch(`/api/forest/radar-preview?date=${encodeURIComponent(activeDate)}&channel=${radarChannel}&format=meta&runId=${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as RadarPreviewMetadata & { error?: string };
        if (!response.ok) throw new Error(body.error || `Radar preview request failed (${response.status}).`);
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setPreview(body);
        setPreviewMessage(body.available ? null : (body.message || "No real raster quicklook exists for this date."));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreviewMessage(error instanceof Error ? error.message : "The measured raster quicklook could not be loaded.");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimer);
    };
  }, [runId, activeDate, radarChannel]);


  const candidates = analysis ? (activeDate ? analysis.candidates.filter((candidate) => candidate.date === activeDate) : analysis.candidates) : [];
  const features = analysis ? forestCandidateGeoJson(analysis, activeDate) : null;
  const center: [number, number] = bounds ? [(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2] : [0, 0];
  const previewBounds = preview?.boundsWgs84WestSouthEastNorth;
  const radarBounds: LatLngBoundsExpression | null = preview?.available && previewBounds
    ? [[previewBounds[1], previewBounds[0]], [previewBounds[3], previewBounds[2]]]
    : null;
  const radarImageUrl = runId && radarChannel !== "none" && activeDate && preview?.available
    ? `/api/forest/radar-preview?date=${encodeURIComponent(activeDate)}&channel=${radarChannel}&format=image&runId=${encodeURIComponent(runId)}`
    : null;

  return (
    <div className="forest-map-shell">
      <div className="forest-map-layer-control" role="group" aria-label="Radar display layer">
        <button type="button" className={radarChannel === "none" ? "is-active" : ""} onClick={() => setRadarChannel("none")}>Candidates</button>
        <button type="button" disabled={Boolean(analysis) || !onStudyBoundsChange} className={drawingMode ? "is-active" : ""} onClick={() => { setDrawingMode((value) => !value); setFirstCorner(null); setDrawMessage(drawingMode ? null : "Click one corner, then the opposite corner, to draw a rectangular study box."); }}>{drawingMode ? "Cancel drawing" : "Draw study box"}</button>
        <button type="button" className={radarChannel === "hh" ? "is-active" : ""} disabled={!analysis || !activeDate} onClick={() => setRadarChannel("hh")}>HH · dB</button>
        <button type="button" className={radarChannel === "hv" ? "is-active" : ""} disabled={!analysis || !activeDate} onClick={() => setRadarChannel("hv")}>HV · dB</button>
      </div>
      {drawMessage && <p className="forest-map-empty" role="status">{drawMessage}</p>}
      <MapContainer center={center} zoom={bounds ? 7 : 2} scrollWheelZoom className={`forest-map${drawingMode ? " forest-map--drawing" : ""}`}>

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds bounds={bounds} />
        <MapClickHandler enabled={drawingMode} onClick={handleMapClick} />
        {firstCorner && <CircleMarker center={firstCorner} radius={6} pathOptions={{ color: "#e59d4f", fillOpacity: 0.9 }} />}
        {bounds && !analysis && !studyBoundaryGeoJson && <Rectangle bounds={[[bounds[1], bounds[0]], [bounds[3], bounds[2]]]} pathOptions={{ color: "#5f91a9", weight: 2, dashArray: "6 5", fillOpacity: 0.025 }}><Tooltip>Selected study box — not a forest boundary or detection</Tooltip></Rectangle>}
        {studyBoundaryGeoJson && !analysis && <GeoJSON key={`uploaded-boundary-${JSON.stringify(bounds)}`} data={studyBoundaryGeoJson as unknown as GeoJsonObject} style={{ color: "#5f91a9", weight: 2, dashArray: "6 5", fillOpacity: 0.035 }} onEachFeature={(_feature, layer) => layer.bindTooltip("User-uploaded study boundary — not a forest classification")} />}
        {radarImageUrl && radarBounds && <ImageOverlay url={radarImageUrl} bounds={radarBounds} opacity={0.72} interactive={false} />}
        {analysis && features && features.features.length > 0 && (
          <GeoJSON
            key={`${analysis.runId}-${activeDate ?? "all"}-${selectedCandidateId ?? "none"}`}
            data={features as unknown as GeoJsonObject}
            style={candidateStyle(selectedCandidateId)}
            onEachFeature={(feature, layer) => {
              const id = typeof feature.properties?.id === "string" ? feature.properties.id : null;
              const candidate = candidates.find((item: ForestCandidate) => item.id === id);
              if (id && candidate) {
                layer.bindTooltip(`${candidate.id} · ${candidate.date} · ${candidate.areaKm2.toFixed(3)} km²`);
                layer.on({ click: () => onSelectCandidate(id) });
              }
            }}
          />
        )}
      </MapContainer>
      <div className="forest-map-legend">
        {!analysis ? (studyBoundaryGeoJson ? "No forest result loaded. The outlined geometry is the user-uploaded study boundary." : "No forest result loaded. The dashed outline marks only the user-selected study box.") : radarChannel === "none" ? <><span className="forest-legend-swatch" /> Potential structural disturbance candidates</> : <><span className="forest-radar-legend-swatch" /> Real NISAR {radarChannel.toUpperCase()} backscatter · shared dB scale {preview && typeof preview.scaleMinDb === "number" && typeof preview.scaleMaxDb === "number" ? `${preview.scaleMinDb.toFixed(1)} to ${preview.scaleMaxDb.toFixed(1)}` : "—"}</>}{activeDate ? ` · ${activeDate}` : " · all dates"}
      </div>
      {!analysis && <p className="forest-map-empty">The map uses a real OpenStreetMap basemap. No radar overlay or candidate region is shown until an actual NISAR analysis has been saved.</p>}
      {analysis && radarChannel !== "none" && previewMessage && <p className="forest-map-empty" role="status">{previewMessage}</p>}
      {analysis && radarChannel !== "none" && preview?.available && <p className="forest-map-attribution">{preview.measurement ?? "NISAR GCOV measured backscatter"}{typeof preview.validForestPixelFraction === "number" ? ` · ${(preview.validForestPixelFraction * 100).toFixed(1)}% valid forest-mask coverage` : ""}. Transparent pixels indicate excluded or invalid data, not zero backscatter.</p>}
      {analysis && candidates.length === 0 && <p className="forest-map-empty">No qualifying candidate polygons on {activeDate ?? "the selected dates"}. This does not establish that no forest change occurred.</p>}
    </div>
  );
}
