"use client";
import { useEffect, useState } from "react";
import { GeoJSON, ImageOverlay, MapContainer, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import GlobalWorldBounds, { WORLD_BOUNDS } from "@/components/global/GlobalWorldBounds";
import type { ForestCandidates, ForestCoverage } from "@/lib/forest-study";
export type ForestFocus = {
    lat: number;
    lon: number;
    zoom: number;
};
function Interactions({ focus, reportZoom }: {
    focus: ForestFocus | null;
    reportZoom: (value: number) => void;
}) {
    const map = useMap();
    useMapEvents({ zoomend: () => reportZoom(map.getZoom()) });
    useEffect(() => { if (focus)
        map.setView([focus.lat, focus.lon], focus.zoom); }, [map, focus]);
    return null;
}
function bounds(b: number[]): LatLngBoundsExpression { return [[b[1], b[0]], [b[3], b[2]]]; }
export default function ForestMap({ focus, treeCover = false, imagery = false, mosaicDate = "", coverage = null, candidates = null, bbox, imageUrl, studyPublished = false, gladImageUrl, globalView = false }: {
    focus?: ForestFocus | null;
    treeCover?: boolean;
    imagery?: boolean;
    mosaicDate?: string;
    coverage?: ForestCoverage | null;
    candidates?: ForestCandidates | null;
    bbox?: number[];
    imageUrl?: string;
    studyPublished?: boolean;
    gladImageUrl?: string;
    globalView?: boolean;
}) {
    const [zoom, setZoom] = useState(2);
    const [failed, setFailed] = useState<Record<string, boolean>>({});
    const time = mosaicDate ? `${mosaicDate}/` : "";
    const nisar = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/${time}GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;
    // The advertised REST template currently rejects requests without SERVICE.
    // Use the verified WMTS KVP interface and its categorical map-layer ID.
    const tree = "https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&FORMAT=image/png&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&TIME=2021-01-01";
    const error = (key: string) => () => setFailed(p => ({ ...p, [key]: true }));
    return <div className="forest-map-surface">
    <MapContainer center={bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : [0, 0]} zoom={bbox ? 11 : 2} minZoom={0} maxZoom={17} zoomSnap={.25} maxBounds={WORLD_BOUNDS} maxBoundsViscosity={1} style={{ height: "100%", width: "100%" }}>
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri, USGS, NOAA" bounds={WORLD_BOUNDS} noWrap eventHandlers={{ tileerror: error("background") }}/>
      {(!bbox || globalView) && <GlobalWorldBounds />}
      <Interactions focus={focus ?? null} reportZoom={setZoom}/>
      {treeCover && <TileLayer url={tree} key="worldcover2021" minZoom={6} maxNativeZoom={14} opacity={.65} bounds={[[-60, -180], [83, 180]]} noWrap attribution="ESA WorldCover 2021 v200 / Terrascope · historical land cover" eventHandlers={{ tileerror: error("tree") }}/>}
      {imagery && <TileLayer key={nisar} url={nisar} opacity={.85} maxNativeZoom={13} noWrap bounds={WORLD_BOUNDS} attribution="NASA NISAR GCOV / GIBS · imagery, not classified forest loss" eventHandlers={{ tileerror: error(nisar) }}/>}
      {coverage?.features.length ? <GeoJSON key={JSON.stringify(coverage.features.map(f => f.properties.sceneId))} data={coverage} style={{ color: "#dfab45", weight: 1.3, fillOpacity: .04 }} onEachFeature={(feature, layer) => { const p = feature.properties; layer.bindTooltip(`${p.start?.slice(0, 10) ?? "Unknown date"} · ${p.product}`); }}/> : null}
      {bbox && <Rectangle bounds={bounds(bbox)} pathOptions={{ color: "#53cbb9", weight: 2, fill: false, dashArray: "6 4" }}><Tooltip>{studyPublished ? "Published analysis rectangle" : "Analysis rectangle · no published result available"}</Tooltip></Rectangle>}
      {imageUrl && bbox && <ImageOverlay key={imageUrl} url={imageUrl} bounds={bounds(bbox)} opacity={.9} eventHandlers={{ error: error(imageUrl) }}/>}
      {gladImageUrl && bbox && <ImageOverlay key={gladImageUrl} url={gladImageUrl} bounds={bounds(bbox)} opacity={.8} eventHandlers={{ error: error(gladImageUrl) }}/>}
      {candidates && <GeoJSON key={JSON.stringify(candidates)} data={candidates} style={{ color: "#ffb646", weight: 1, fillOpacity: .65 }}/>}
    </MapContainer>
    {(treeCover && zoom < 6 || Object.values(failed).some(Boolean)) && <div className="forest-map-notice" role="status">
      {treeCover && zoom < 6 && <p>Zoom in to level 6 to view historical WorldCover land cover. Green represents tree cover in 2021.</p>}
      {failed.background && <p>Satellite background tiles are unavailable. Published study layers remain available.</p>}
      {treeCover && failed.tree && <p>WorldCover context tiles could not load. This does not indicate absent forests.</p>}
      {imagery && failed[nisar] && <p>NISAR mosaic tiles are unavailable for this date or place. Try another date.</p>}
      {imageUrl && failed[imageUrl] && <p>This published layer could not load. Choose another layer or reload.</p>}
    </div>}
  </div>;
}
