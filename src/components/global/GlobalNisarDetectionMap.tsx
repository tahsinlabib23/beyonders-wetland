"use client";

// @refresh reset

import { useEffect, useRef } from "react";
import {
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  TileLayer,
  ZoomControl,
  CircleMarker,
  Popup,
  useMap,
  useMapEvents,
  Rectangle,
} from "react-leaflet";
import type { Feature, FeatureCollection, Geometry, MultiPolygon } from "geojson";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import GlobalWorldBounds, { getGlobalWorldZoom, WORLD_BOUNDS } from "./GlobalWorldBounds";
import type { AreaBounds } from "./NisarProcessingPanel";

export type DetectionProperties = {
  id?: string;
  classification?: string;
  area_km2?: number;
  date?: string;
};

export type DetectionCollection = FeatureCollection<Geometry, DetectionProperties>;
export type BoundaryCollection = FeatureCollection<Geometry, Record<string, unknown>>;
export type CoverageProperties = {
  sceneId: string;
  orbitDirection: string;
  trackNumber: string;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
};
export type CoverageCollection = FeatureCollection<MultiPolygon, CoverageProperties>;

function MapScope({
  detections,
  boundary,
  focusStudyArea,
  coordinateTarget,
}: {
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  focusStudyArea: boolean;
  coordinateTarget: { latitude: number; longitude: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (coordinateTarget) {
      map.flyTo([coordinateTarget.latitude, coordinateTarget.longitude], Math.max(map.getZoom(), 8), { duration: 1.2 });
      return;
    }
    if (!focusStudyArea) {
      map.setView([0, 0], getGlobalWorldZoom(map), { animate: false });
      return;
    }
    const layer = L.featureGroup();
    if (boundary?.features.length) layer.addLayer(L.geoJSON(boundary));
    if (detections.features.length) layer.addLayer(L.geoJSON(detections));
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
  }, [boundary, coordinateTarget, detections, focusStudyArea, map]);

  return null;
}

function detectionStyle(feature?: Feature<Geometry, DetectionProperties>): PathOptions {
  const classification = feature?.properties?.classification;
  const color = classification === "OPEN_WATER" ? "#42d8ef"
    : classification === "VEGETATED_INUNDATION" ? "#83e36f" : "#ffbf69";
  return { color, fillColor: color, weight: 1.5, opacity: 0.95, fillOpacity: 0.48 };
}

function AreaPicker({ drawing, bounds, onSelected }: { drawing: boolean; bounds: AreaBounds | null; onSelected: (bounds: AreaBounds) => void }) {
  const corner = useRef<L.LatLng | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const map = useMapEvents({ click(event) {
    if (!drawing) return;
    if (!corner.current) {
      corner.current = event.latlng;
      marker.current = L.circleMarker(event.latlng, { radius: 6, color: "#ffffff", fillColor: "#ffbf69", fillOpacity: 1 }).addTo(map);
    } else {
      const first = corner.current;
      const second = event.latlng;
      if (Math.abs(first.lng-second.lng) < 0.00001 || Math.abs(first.lat-second.lat) < 0.00001) return;
      onSelected([Math.min(first.lng, second.lng), Math.min(first.lat, second.lat), Math.max(first.lng, second.lng), Math.max(first.lat, second.lat)]);
      marker.current?.remove(); corner.current = null;
    }
  } });
  useEffect(() => {
    map.getContainer().style.cursor = drawing ? "crosshair" : "";
    corner.current = null;
    return () => { marker.current?.remove(); corner.current = null; map.getContainer().style.cursor = ""; };
  }, [drawing, map]);
  useEffect(() => {
    if (bounds && bounds[0] < bounds[2] && bounds[1] < bounds[3]) map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { padding: [30, 30], maxZoom: 12, animate: false });
  }, [bounds, map]);
  return bounds && bounds[0] < bounds[2] && bounds[1] < bounds[3] ? <Rectangle bounds={[[bounds[1], bounds[0]], [bounds[3], bounds[2]]]} pathOptions={{ color: "#ffbf69", weight: 2, fillOpacity: 0.08, dashArray: "7 4" }} interactive={false} /> : null;
}

export default function GlobalNisarDetectionMap({
  detections,
  boundary,
  coverage,
  date,
  focusStudyArea,
  coordinateTarget,
  onLayerReady,
  onLayerError,
  resultKey,
  areaBounds,
  areaDrawing,
  onAreaSelected,
}: {
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  coverage: CoverageCollection;
  date: string | null;
  focusStudyArea: boolean;
  coordinateTarget: { latitude: number; longitude: number } | null;
  onLayerReady: () => void;
  onLayerError: () => void;
  resultKey: string;
  areaBounds: AreaBounds | null;
  areaDrawing: boolean;
  onAreaSelected: (bounds: AreaBounds) => void;
}) {
  const timePath = date ? `${date}/` : "";
  const nisarTileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/${timePath}GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;

  return (
    <MapContainer
      center={[0, 0]}
      zoom={2}
      minZoom={0}
      maxZoom={12}
      zoomSnap={0.25}
      maxBounds={L.latLngBounds([-85.05112878, -180], [85.05112878, 180])}
      maxBoundsViscosity={1}
      zoomControl={false}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA"
        bounds={WORLD_BOUNDS}
        noWrap
      />
      <TileLayer
        key={`nisar-${date ?? "latest"}`}
        url={nisarTileUrl}
        attribution="NASA NISAR L2 GCOV via NASA GIBS"
        opacity={0.92}
        bounds={WORLD_BOUNDS}
        noWrap
        eventHandlers={{ tileload: onLayerReady, tileerror: onLayerError }}
      />
      <GlobalWorldBounds />
      {coverage.features.length > 0 && (
        <LeafletGeoJSON
          key={`coverage-${coverage.features[0]?.properties.sceneId}-${coverage.features.length}`}
          data={coverage}
          interactive={false}
          style={(feature) => {
            const properties = feature?.properties as CoverageProperties | undefined;
            const color = properties?.orbitDirection === "Descending" ? "#ffbf69" : "#42d8ef";
            return { color, fillColor: color, weight: 1, opacity: 0.9, fillOpacity: 0.06 };
          }}
        />
      )}
      <ZoomControl position="bottomright" />
      <MapScope detections={detections} boundary={boundary} focusStudyArea={focusStudyArea} coordinateTarget={coordinateTarget} />
      {coordinateTarget && <CircleMarker
        center={[coordinateTarget.latitude, coordinateTarget.longitude]}
        radius={7}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#ffbf69", fillOpacity: 1 }}
      >
        <Popup>
          Map location<br />
          {coordinateTarget.latitude.toFixed(5)}°, {coordinateTarget.longitude.toFixed(5)}°
        </Popup>
      </CircleMarker>}
      <AreaPicker drawing={areaDrawing} bounds={areaBounds} onSelected={onAreaSelected} />
      {boundary?.features.length ? (
        <LeafletGeoJSON
          key={`boundary-${resultKey}`}
          data={boundary}
          style={{ color: "#e8f2ff", weight: 1.5, opacity: 0.9, fillOpacity: 0, dashArray: "5 5" }}
        />
      ) : null}
      {detections.features.length ? <LeafletGeoJSON key={`detections-${resultKey}`} data={detections} style={detectionStyle} /> : null}
    </MapContainer>
  );
}
