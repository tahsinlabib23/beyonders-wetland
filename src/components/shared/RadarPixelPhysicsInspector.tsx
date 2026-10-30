"use client";

import { useEffect, useState } from "react";
import RadarSonifier, { type SonificationSample } from "./RadarSonifier";

type Point = { lat: number; lon: number };
type SampleGrid = {
  schema_version: 1;
  kind: "wetland" | "forest";
  site: string;
  band: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  sampling: string;
  units: string;
  baseline_dates?: string[];
  baseline_date?: string;
  event_date?: string;
  baseline_hh_db?: (number | null)[];
  baseline_hv_db?: (number | null)[];
  hh_before_db?: (number | null)[];
  hv_before_db?: (number | null)[];
  hh_after_db?: (number | null)[];
  hv_after_db?: (number | null)[];
  frames?: Record<string, { hh_db: (number | null)[]; hv_db: (number | null)[] }>;
  limitations: string[];
};

function validGrid(grid: SampleGrid): boolean {
  if (grid?.schema_version !== 1 || !["wetland", "forest"].includes(grid.kind) ||
      !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1 ||
      !Array.isArray(grid.bbox) || grid.bbox.length !== 4 || !grid.bbox.every(Number.isFinite) ||
      grid.bbox[0] >= grid.bbox[2] || grid.bbox[1] >= grid.bbox[3]) return false;
  const length = grid.width * grid.height;
  const arrays = grid.kind === "wetland"
    ? [grid.hh_before_db, grid.hv_before_db, grid.hh_after_db, grid.hv_after_db]
    : [grid.baseline_hh_db, grid.baseline_hv_db, ...Object.values(grid.frames ?? {}).flatMap(frame => [frame.hh_db, frame.hv_db])];
  return arrays.length > 0 && arrays.every(values => Array.isArray(values) && values.length === length &&
    values.every(value => value === null || typeof value === "number" && Number.isFinite(value)));
}

function sampleIndex(grid: SampleGrid, point: Point | null) {
  if (!point) return null;
  const [west, south, east, north] = grid.bbox;
  if (point.lon < west || point.lon > east || point.lat < south || point.lat > north) return null;
  const column = Math.min(grid.width - 1, Math.floor((point.lon - west) / (east - west) * grid.width));
  const row = Math.min(grid.height - 1, Math.floor((north - point.lat) / (north - south) * grid.height));
  return { column, row, index: row * grid.width + column,
    lat: north - (row + 0.5) * (north - south) / grid.height,
    lon: west + (column + 0.5) * (east - west) / grid.width };
}

const power = (db: number) => 10 ** (db / 10);
const ratioDb = (hh: number | null, hv: number | null) => hh === null || hv === null ? null : hh - hv;
const rfdi = (hh: number | null, hv: number | null) => {
  if (hh === null || hv === null) return null;
  const hhPower = power(hh);
  const hvPower = power(hv);
  const total = hhPower + hvPower;
  return total > 0 ? (hhPower - hvPower) / total : null;
};
const dbAmplitude = (value: number | null) => value === null ? null : Math.max(0, Math.min(1, (value + 35) / 35));

function rowSamples(grid: SampleGrid, index: number, mode: "wetland" | "forest", date: string | undefined): SonificationSample[] {
  const row = Math.floor(index / grid.width);
  const frame = mode === "forest" ? grid.frames?.[date ?? ""] : null;
  const hh = mode === "wetland" ? grid.hh_after_db : frame?.hh_db;
  const hv = mode === "wetland" ? grid.hv_after_db : frame?.hv_db;
  if (!hh || !hv) return [];
  const result: SonificationSample[] = [];
  const stride = Math.max(1, Math.floor(grid.width / 48));
  for (let column = 0; column < grid.width; column += stride) {
    const at = row * grid.width + column;
    result.push({ value: mode === "forest" ? rfdi(hh[at], hv[at]) : ratioDb(hh[at], hv[at]), amplitude: dbAmplitude(mode === "forest" ? hv[at] : hh[at]) });
  }
  return result;
}

export default function RadarPixelPhysicsInspector({
  mode,
  dataUrl,
  date,
  point,
  onPointChange,
}: {
  mode: "wetland" | "forest";
  dataUrl: string | null;
  date?: string;
  point?: Point | null;
  onPointChange?: (point: Point) => void;
}) {
  const [state, setState] = useState<{ url: string; grid: SampleGrid | null; error: string | null }>({ url: "", grid: null, error: null });
  const [coordinateDraft, setCoordinateDraft] = useState<{ pointKey: string; lat: string; lon: string } | null>(null);
  useEffect(() => {
    if (!dataUrl) return;
    const controller = new AbortController();
    fetch(dataUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Published sample grid is unavailable.");
      return await response.json() as SampleGrid;
    }).then(grid => {
      if (!validGrid(grid) || grid.kind !== mode) throw new Error("Published sample grid failed validation.");
      setState({ url: dataUrl, grid, error: null });
    }).catch(error => { if (error.name !== "AbortError") setState({ url: dataUrl, grid: null, error: error.message }); });
    return () => controller.abort();
  }, [dataUrl, mode]);
  const grid = state.url === dataUrl ? state.grid : null;
  const fallback = grid ? { lat: (grid.bbox[1] + grid.bbox[3]) / 2, lon: (grid.bbox[0] + grid.bbox[2]) / 2 } : null;
  const activePoint = point ?? fallback;
  const pointKey = activePoint ? `${activePoint.lat}:${activePoint.lon}` : "";
  const latInput = coordinateDraft?.pointKey === pointKey ? coordinateDraft.lat : activePoint?.lat.toFixed(5) ?? "";
  const lonInput = coordinateDraft?.pointKey === pointKey ? coordinateDraft.lon : activePoint?.lon.toFixed(5) ?? "";
  const location = grid && activePoint ? sampleIndex(grid, activePoint) : null;
  const selectedFrame = mode === "forest" ? grid?.frames?.[date ?? ""] : null;
  const selectedHH = mode === "wetland" ? grid?.hh_after_db : selectedFrame?.hh_db;
  const selectedHV = mode === "wetland" ? grid?.hv_after_db : selectedFrame?.hv_db;
  const hh = location && selectedHH ? selectedHH[location.index] : null;
  const hv = location && selectedHV ? selectedHV[location.index] : null;
  const baselineHH = location ? (mode === "wetland" ? grid?.hh_before_db?.[location.index] : grid?.baseline_hh_db?.[location.index]) : null;
  const baselineHV = location ? (mode === "wetland" ? grid?.hv_before_db?.[location.index] : grid?.baseline_hv_db?.[location.index]) : null;
  const sound = grid && location ? rowSamples(grid, location.index, mode, date) : [];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      setCoordinateDraft(null);
      onPointChange?.({ lat, lon });
    }
  }

  const title = mode === "forest" ? "Forest scattering · RFDI" : "Wetland scattering · HH/HV";
  return <section className="radar-physics" aria-label={title}>
    <header><div><h3>{title}</h3><p>{grid ? `${grid.band} · ${mode === "forest" ? date ?? "No frame selected" : `${grid.baseline_date} → ${grid.event_date}`}` : "Loading published pixel samples…"}</p></div><span className="radar-physics__badge">Sampled preview</span></header>
    <form onSubmit={submit} className="radar-physics__coordinates">
      <label>Latitude<input type="number" step="any" min="-90" max="90" value={latInput} onChange={event => setCoordinateDraft({ pointKey, lat: event.target.value, lon: lonInput })} required /></label>
      <label>Longitude<input type="number" step="any" min="-180" max="180" value={lonInput} onChange={event => setCoordinateDraft({ pointKey, lat: latInput, lon: event.target.value })} required /></label>
      <button type="submit">Inspect location</button>
    </form>
    {state.error && <p role="status" className="radar-physics__message">{state.error} Full map layers remain available.</p>}
    {grid && !location && <p role="status" className="radar-physics__message">The selected coordinate is outside this processed sample grid.</p>}
    {grid && location && <>
      <small className="radar-physics__location">Nearest sampled cell · {location.lat.toFixed(5)}°, {location.lon.toFixed(5)}° · preview grid {grid.width} × {grid.height}</small>
      {mode === "forest" ? <dl>
        <div><dt>HH · {date}</dt><dd>{hh == null ? "Unassessed" : `${hh.toFixed(2)} dB`}</dd></div>
        <div><dt>HV · {date}</dt><dd>{hv == null ? "Unassessed" : `${hv.toFixed(2)} dB`}</dd></div>
        <div><dt>RFDI · sampled values</dt><dd>{rfdi(hh, hv) == null ? "Unassessed" : rfdi(hh, hv)!.toFixed(3)}</dd></div>
        <div><dt>HH/HV ratio</dt><dd>{ratioDb(hh, hv) == null ? "Unassessed" : `${ratioDb(hh, hv)!.toFixed(2)} dB`}</dd></div>
        <div><dt>Baseline HV</dt><dd>{baselineHV == null ? "Unassessed" : `${baselineHV.toFixed(2)} dB`}</dd></div>
        <div><dt>HV change from baseline</dt><dd>{hv == null || baselineHV == null ? "Unassessed" : `${(hv - baselineHV > 0 ? "+" : "")}${(hv - baselineHV).toFixed(2)} dB`}</dd></div>
      </dl> : <dl>
        <div><dt>HH · event</dt><dd>{hh == null ? "Unassessed" : `${hh.toFixed(2)} dB`}</dd></div>
        <div><dt>HV · event</dt><dd>{hv == null ? "Unassessed" : `${hv.toFixed(2)} dB`}</dd></div>
        <div><dt>HH/HV ratio · event</dt><dd>{ratioDb(hh, hv) == null ? "Unassessed" : `${ratioDb(hh, hv)!.toFixed(2)} dB`}</dd></div>
        <div><dt>HH change</dt><dd>{hh == null || baselineHH == null ? "Unassessed" : `${(hh - baselineHH > 0 ? "+" : "")}${(hh - baselineHH).toFixed(2)} dB`}</dd></div>
        <div><dt>HV change</dt><dd>{hv == null || baselineHV == null ? "Unassessed" : `${(hv - baselineHV > 0 ? "+" : "")}${(hv - baselineHV).toFixed(2)} dB`}</dd></div>
        <div><dt>Matched C-band</dt><dd>Not included</dd></div>
      </dl>}
      <p className="radar-physics__limits">{mode === "forest"
        ? "RFDI = (HH − HV) / (HH + HV), computed from linear power after converting the displayed dB values. It describes polarization contrast; it is not a biomass estimate or proof of clearing."
        : "HH/HV values are backscatter measurements, not a unique water or flooded-vegetation label. This publication has no matched C-band pixel, so no C/L-band difference is calculated."}</p>
      <RadarSonifier samples={sound} label="Hear the selected latitude transect" explanation={mode === "forest" ? "Pitch follows sampled RFDI; loudness follows HV backscatter. The sweep is an educational translation of the sampled row, not an alert." : "Pitch follows sampled HH/HV contrast; loudness follows HH backscatter. The sweep is an educational translation of the sampled row, not a flood alarm."} />
    </>}
    <details><summary>Sampling and limits</summary><p>{grid?.sampling} The full-resolution analysis and published areas use the native raster grid. {grid?.limitations.join(" ")}</p></details>
  </section>;
}
