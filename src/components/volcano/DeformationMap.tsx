"use client";

import { useEffect, useState } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

export type VolcanoFocus = { lat: number; lon: number; zoom: number; fullStudy?: boolean };

function MapInteraction({ onProbe, focus, bbox }: { onProbe: (lat: number, lon: number) => void; focus: VolcanoFocus | null; bbox: number[] }) {
  const map = useMap();
  useMapEvents({ click: (event) => onProbe(event.latlng.lat, event.latlng.lng) });
  useEffect(() => { if (focus?.fullStudy) map.fitBounds(bounds(bbox)); else if (focus) map.setView([focus.lat, focus.lon], focus.zoom); }, [focus, map, bbox]);
  return null;
}

function bounds(bbox: number[]): LatLngBoundsExpression { return [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]; }

export default function DeformationMap({ bbox, referenceBbox, imageUrl, point, focus, onProbe, regions }: {
  bbox: number[]; referenceBbox: number[]; imageUrl: string; point: {lat: number; lon: number} | null;
  focus: VolcanoFocus | null; onProbe: (lat: number, lon: number) => void;
  regions: {name: string; lat: number; lon: number}[];
}) {
  const [failedImage, setFailedImage] = useState<string|null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  return <><MapContainer bounds={bounds(bbox)} minZoom={7} maxZoom={17} maxBounds={[[12.7,39.8],[14.4,41.6]]} maxBoundsViscosity={1} style={{height:"100%",width:"100%"}}>
    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri, USGS, NOAA" noWrap eventHandlers={{tileerror:()=>setTileFailed(true)}} />
    <ImageOverlay key={imageUrl} url={imageUrl} bounds={bounds(bbox)} opacity={.9} eventHandlers={{error:()=>setFailedImage(imageUrl)}} />
    <Rectangle bounds={bounds(referenceBbox)} pathOptions={{color:"#36e1cb",fill:false,weight:2,dashArray:"5 5"}}><Tooltip>Assumed-stable reference patch</Tooltip></Rectangle>
    {regions.map(region => <CircleMarker key={region.name} center={[region.lat,region.lon]} radius={4} pathOptions={{color:"white",fillColor:"#191e1c",fillOpacity:1,weight:1.5}}><Tooltip permanent direction={region.name.endsWith("south")?"right":"top"}>{region.name}</Tooltip></CircleMarker>)}
    {point && <CircleMarker center={[point.lat,point.lon]} radius={6} pathOptions={{color:"#ffdf63",fill:false,weight:3}} />}
    <MapInteraction onProbe={onProbe} focus={focus} bbox={bbox} />
  </MapContainer>{(failedImage===imageUrl||tileFailed)&&<p className="deformation-map-error" role="status">{failedImage===imageUrl?"This published radar layer could not load. Choose another layer or reload the page.":"Satellite background tiles are unavailable. Published radar layers remain available."}</p>}</>;
}
