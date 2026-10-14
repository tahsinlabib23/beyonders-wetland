"use client";

import { useEffect } from "react";
import {
  CircleMarker,
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  Rectangle,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import type { FeatureCollection, MultiPolygon } from "geojson";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import GlobalWorldBounds, { WORLD_BOUNDS } from "./GlobalWorldBounds";
import type { VolcanoRecord } from "@/app/api/volcanoes/catalog/route";
import publicationCatalog from "../../../public/volcanoes/catalog.json";

export interface VolcanoCoverage {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: MultiPolygon;
    properties: { sceneId: string; product: string; maturity: "PROVISIONAL" | "BETA"; start: string | null; end: string | null };
  }>;
}

function FocusVolcano({ selected }: { selected: VolcanoRecord | null }) {
  const map = useMap();
  useEffect(() => {
    if (selected) map.flyTo([selected.latitude, selected.longitude], Math.max(map.getZoom(), 4), { duration: 0.6 });
  }, [map, selected]);
  return null;
}

export default function VolcanoGlobalMap({
  volcanoes,
  selected,
  coverage,
  onSelect,
}: {
  volcanoes: VolcanoRecord[];
  selected: VolcanoRecord | null;
  coverage: VolcanoCoverage | null;
  onSelect: (volcano: VolcanoRecord) => void;
}) {
  const coverageStyle = (): PathOptions => ({ color: "#ef8b36", weight: 1.3, opacity: 0.88, fillColor: "#ef8b36", fillOpacity: 0.1 });

  return (
    <MapContainer
      center={[15, 8]}
      zoom={2}
      minZoom={0}
      maxZoom={12}
      maxBounds={L.latLngBounds([-85.05112878, -180], [85.05112878, 180])}
      maxBoundsViscosity={1}
      zoomControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA"
        bounds={WORLD_BOUNDS}
        noWrap
      />
      <ZoomControl position="bottomright" />
      <GlobalWorldBounds />
      <FocusVolcano selected={selected} />
      {coverage?.features.length ? <LeafletGeoJSON data={coverage as FeatureCollection<MultiPolygon>} style={coverageStyle} /> : null}
      {publicationCatalog.case_studies.filter(study=>study.beyonders_processing_status==="COMPLETE").map(study=>
        <Rectangle key={study.id} bounds={[[study.publication.bbox[1],study.publication.bbox[0]],[study.publication.bbox[3],study.publication.bbox[2]]]} pathOptions={{color:"#36e1cb",weight:3,fillOpacity:.15}}>
          <Popup><strong>{study.name}</strong><p>Published regional phase study · {study.publication.method_version}</p><a href={study.path}>Explore processed radar layers</a></Popup>
        </Rectangle>)}
      {volcanoes.map((volcano) => {
        const isSelected = volcano.id === selected?.id;
        return (
          <CircleMarker
            key={volcano.id}
            center={[volcano.latitude, volcano.longitude]}
            radius={isSelected ? 7 : 3.5}
            pathOptions={{
              color: isSelected ? "#fff8ec" : "#302315",
              weight: isSelected ? 2 : 0.8,
              fillColor: isSelected ? "#ff963d" : "#f4c46b",
              fillOpacity: 0.92,
            }}
            eventHandlers={{ click: () => onSelect(volcano) }}
          />
        );
      })}
    </MapContainer>
  );
}
