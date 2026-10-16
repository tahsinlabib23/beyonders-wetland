"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { probeVolcano, validVolcanoGrid, type VolcanoGrid, type VolcanoPair, type VolcanoStudy } from "@/lib/volcano-study";
import type { VolcanoFocus } from "./DeformationMap";

const Map = dynamic(() => import("./DeformationMap"), {ssr:false,loading:() => <div className="deformation-loading">Loading radar map…</div>});
type Layer = "los_image" | "coherence_image" | "assessed_image";
type Loaded = {study: VolcanoStudy; base: string; evidenceUrl: string};
const date = (value: string) => new Date(value+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
const percent = (value: number) => `${(value*100).toFixed(1)}%`;
const cm = (value: number | null | undefined) => value == null ? "Unassessed" : `${value>0?"+":""}${value.toFixed(2)} cm`;

function useGrid(url: string | null) {
  const [state,setState] = useState<{url:string;grid:VolcanoGrid|null;error:string|null}>({url:"",grid:null,error:null});
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url,{signal:controller.signal}).then(r => {if(!r.ok) throw new Error("Published pixel data could not be loaded.");return r.json();})
      .then((grid:VolcanoGrid) => {
        if(!validVolcanoGrid(grid)) throw new Error("Published grid is inconsistent.");
        setState({url,grid,error:null});
      }).catch(error => {if(error.name!=="AbortError") setState({url,grid:null,error:error.message});});
    return () => controller.abort();
  },[url]);
  return {grid:state.url===url?state.grid:null,error:state.url===url?state.error:null};
}

function Pixel({ pair, grid, point }: {pair:VolcanoPair;grid:VolcanoGrid|null;point:{lat:number;lon:number}|null}) {
  const pixel = point ? probeVolcano(grid,point.lat,point.lon) : null;
  return <div className="deformation-pixel"><strong>{pair.sensor} · {pair.label}</strong>
    {!point ? <p>Select a point on either map or use the coordinate inputs to inspect both views.</p> : !grid ? <p>Loading published pixels…</p> : !pixel ? <p>This point is outside the processed rectangle.</p> : <>
      <dl><div><dt>Apparent LOS change</dt><dd>{cm(pixel.los)}</dd></div><div><dt>Coherence</dt><dd>{pixel.coherence==null?"No observation":pixel.coherence.toFixed(3)}</dd></div><div><dt>Unwrapped phase</dt><dd>{pixel.phase==null?"Unassessed":`${pixel.phase.toFixed(3)} rad`}</dd></div><div><dt>Connected component</dt><dd>{pixel.component??"Unassessed"}</dd></div></dl>
      <p>{pixel.los==null?"Screened out: low coherence, missing data, invalid sample, water flag (NISAR), or a disconnected phase component.":"Passed the published coherence and component screens. Accuracy is not quantified."}</p>
      <small>Published geographic sample at {pixel.centerLat.toFixed(5)}, {pixel.centerLon.toFixed(5)} · nearest native raster value.</small>
    </>}
  </div>;
}

export default function DeformationExplorer() {
  const [loaded,setLoaded] = useState<Loaded|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [selected,setSelected] = useState<string>("");
  const [sentinel,setSentinel] = useState<string>("");
  const [layer,setLayer] = useState<Layer>("los_image");
  const [point,setPoint] = useState<{lat:number;lon:number}|null>(null);
  const [focus,setFocus] = useState<VolcanoFocus|null>(null);
  const [latInput,setLatInput] = useState("13.606");
  const [lonInput,setLonInput] = useState("40.665");
  useEffect(() => {
    const controller=new AbortController();
    fetch("/volcanoes/hayli-gubbi/index.json",{signal:controller.signal,cache:"no-store"})
      .then(r => {if(!r.ok) throw new Error("No processed NISAR package is published yet. Source observations remain available below.");return r.json();})
      .then(async index => {
        const response=await fetch(index.study_url,{signal:controller.signal});
        if(!response.ok) throw new Error("The published deformation package is unavailable.");
        const study:VolcanoStudy=await response.json();
        if(study.schema_version!==1 || study.run_completion!=="COMPLETE" || !Array.isArray(study.pairs) || !study.pairs.some(pair=>pair.id===study.default_pair_id) || !Array.isArray(study.bbox) || study.bbox.length!==4) throw new Error("This publication is incomplete or unsupported.");
        setLoaded({study,base:index.study_url.substring(0,index.study_url.lastIndexOf("/")+1),evidenceUrl:index.evidence_url});
        setSelected(study.default_pair_id);
        setSentinel(study.pairs.find(pair=>pair.sensor==="Sentinel-1")?.id??"");
      }).catch(error=>{if(error.name!=="AbortError")setError(error.message);});
    return ()=>controller.abort();
  },[]);
  const study=loaded?.study;
  const pair=study?.pairs.find(pair=>pair.id===selected);
  const reference=study?.pairs.find(pair=>pair.id===sentinel);
  const primaryGrid=useGrid(loaded&&pair?loaded.base+pair.grid:null);
  const referenceGrid=useGrid(loaded&&reference?loaded.base+reference.grid:null);
  if(error) return <section className="deformation-explorer"><h2>Deformation evidence</h2><p role="status">{error}</p><a href="/docs/volcano-method.md" download>Download method and limitations</a></section>;
  if(!loaded||!study||!pair) return <section className="deformation-explorer"><p role="status">Loading published deformation evidence…</p></section>;
  const comparison=study.comparisons.find(item=>item.nisar_id===pair.id&&item.sentinel_id===reference?.id);
  function choosePoint(lat:number,lon:number) {setPoint({lat,lon});setLatInput(lat.toFixed(5));setLonInput(lon.toFixed(5));}
  function submitCoordinates(event:React.FormEvent) {event.preventDefault();const lat=Number(latInput),lon=Number(lonInput);if(latInput.trim()&&lonInput.trim()&&Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180){choosePoint(lat,lon);setFocus({lat,lon,zoom:13});}}
  return <section className="deformation-explorer" aria-labelledby="deformation-title">
    <header className="deformation-heading"><div><h2 id="deformation-title">Explore the measured radar phase</h2><p>Official NISAR HH interferograms · {study.method_version} · publication {study.publication_version}</p></div><a className="volcano-download-link" href={loaded.evidenceUrl} download>Download the evidence package</a></header>
    <p className="deformation-method-note">Apparent line-of-sight (LOS) change is relative to the cyan reference patch. Atmospheric, ionospheric, and tide corrections are not applied. Positive values point toward the satellite; these are candidates for ground deformation.</p>
    <div className="deformation-timeline" aria-label="NISAR observation intervals">{study.pairs.filter(item=>item.sensor==="NISAR").map(item=><button type="button" key={item.id} aria-pressed={item.id===pair.id} onClick={()=>setSelected(item.id)}><span>{item.label}</span><strong>{date(item.start)} — {date(item.end)}</strong><small>{percent(item.statistics.valid_fraction)} screened coverage</small></button>)}</div>
    <p className="deformation-timeline-note">Eruption reported {date(study.event_date)}. Each interval is independently referenced; this timeline does not show cumulative motion. Selected NISAR interval: {pair.statistics.assessed_area_km2.toFixed(1)} km² screened within the analysis rectangle.</p>
    <div className="deformation-toolbar"><label>Map layer<select value={layer} onChange={event=>setLayer(event.target.value as Layer)}><option value="los_image">Apparent LOS change (cm)</option><option value="coherence_image">Radar coherence (0–1)</option><option value="assessed_image">Screened coverage</option></select></label><label>Independent radar view<select value={sentinel} onChange={event=>setSentinel(event.target.value)}>{study.pairs.filter(item=>item.sensor==="Sentinel-1").map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><div className="deformation-region-buttons">{study.regions.map(region=><button key={region.name} onClick={()=>{choosePoint(region.lat,region.lon);setFocus({lat:region.lat,lon:region.lon,zoom:13});}}>{region.name}</button>)}</div></div>
    <div className="deformation-map-hint"><button type="button" onClick={()=>setFocus({lat:(study.bbox[1]+study.bbox[3])/2,lon:(study.bbox[0]+study.bbox[2])/2,zoom:10,fullStudy:true})}>Show full study</button><span>Use a region button to zoom into localized phase structure on both maps.</span></div>
    <div className="deformation-maps">
      {[pair,...(reference?[reference]:[])].map(item=><article key={item.sensor} className="deformation-map-panel"><header><strong>{item.label} · {item.sensor}</strong><span>{date(item.start)} — {date(item.end)}</span></header><div className="deformation-map"><Map bbox={study.bbox} referenceBbox={study.reference_bbox} imageUrl={loaded.base+item[layer]} point={point} focus={focus} onProbe={choosePoint} regions={study.regions}/></div><footer>{item.direction.toLowerCase()} · {item.look_direction.toLowerCase()} looking · {item.polarization} · {item.maturity}<a href={loaded.base+item.los_download} download>Native LOS GeoTIFF</a></footer></article>)}
    </div>
    <div className="deformation-legend">{layer==="los_image"?<><span>Away · −{study.display_limit_cm} cm</span><i className="deformation-scale"/><span>+{study.display_limit_cm} cm · toward</span></>:layer==="coherence_image"?<><span>Low · 0</span><i className="deformation-scale deformation-scale--gray"/><span>1 · high</span></>:<span>White: passed the quality screens</span>}<b>Transparent areas: unassessed</b></div>
    <div className="deformation-inspector"><form onSubmit={submitCoordinates}><h3>Inspect a map sample</h3><label>Latitude<input type="number" step="any" min="-90" max="90" required value={latInput} onChange={e=>setLatInput(e.target.value)}/></label><label>Longitude<input type="number" step="any" min="-180" max="180" required value={lonInput} onChange={e=>setLonInput(e.target.value)}/></label><button type="submit">Inspect coordinates</button><p>Click either map to inspect the same location in both radar views.</p></form><Pixel pair={pair} grid={primaryGrid.grid} point={point}/>{reference&&<Pixel pair={reference} grid={referenceGrid.grid} point={point}/>}</div>
    {(primaryGrid.error||referenceGrid.error)&&<p role="alert">{primaryGrid.error||referenceGrid.error} Maps remain available; pixel values cannot be inspected until the data loads.</p>}
    <section className="deformation-comparison"><h3>What the independent view can tell us</h3><p>{comparison?`${percent(comparison.common_valid_fraction)} of the published rectangle is screened in both views. Sentinel-1 starts ${Math.abs(comparison.start_offset_days)} days ${comparison.start_offset_days<=0?"earlier":"later"} and ends ${Math.abs(comparison.end_offset_days)} days ${comparison.end_offset_days<=0?"earlier":"later"} than this NISAR interval. ${comparison.interpretation}`:"The selected NISAR interval differs from the event comparison. Sentinel-1 is shown for event context; no pair agreement assessment is available for this interval."}</p>{comparison?.status==="INCONCLUSIVE_COVERAGE"&&<p role="status">Coverage is below the 20% comparison floor; the comparison is inconclusive.</p>}
      <p>Read the regional ranges together with screened coverage. Localized phase structure near Erta Ale appears in both sensors, while the event NISAR interval has much less usable coverage around Hayli Gubbi. Opposite signs or different ranges may reflect viewing direction, timing, or remaining phase errors; they do not establish a detector error or an eruption mechanism.</p>
      <div className="deformation-table-scroll"><table><caption>Regional distributions of apparent LOS change · different sensor directions and time windows</caption><thead><tr><th>Region</th><th>NISAR assessed</th><th>NISAR 5–95% range</th><th>Sentinel-1 assessed</th><th>Sentinel-1 5–95% range</th></tr></thead><tbody>{pair.statistics.regions.map(region=>{const second=reference?.statistics.regions.find(r=>r.name===region.name);return <tr key={region.name}><th>{region.name}</th><td>{percent(region.valid_fraction)}</td><td>{cm(region.p05_cm)} to {cm(region.p95_cm)}</td><td>{second?percent(second.valid_fraction):"Unavailable"}</td><td>{second?`${cm(second.p05_cm)} to ${cm(second.p95_cm)}`:"Unavailable"}</td></tr>;})}</tbody></table></div>
      <p>Coherence helps screen phase quality; it is not a confidence percentage. NISAR reference-patch dispersion: {pair.statistics.reference_mad_cm.toFixed(2)} cm MAD. This is not a per-pixel accuracy estimate. Eruption reports establish event context; they do not attribute every radar feature to volcanic motion.</p>
    </section>
    <details className="deformation-provenance"><summary>Inputs, quality screens, and processing provenance</summary><p>{study.boundary_source}. {study.reference_note}. Coherence floor: {study.coherence_floor}; only the connected phase component containing the reference patch is retained.</p>{[pair,...(reference?[reference]:[])].map(item=><div key={item.id}><strong>{item.sensor} · {item.collection}</strong><code>{item.granule_id}</code><p>{item.phase_sign} Wavelength: {item.wavelength_m.toFixed(6)} m. Native grid: {item.native_crs}, spacing {item.native_spacing.join(" × ")} {item.native_crs==="EPSG:4326"?"degrees":"m"}. {item.original_dates_verified?"Dates checked against original product metadata.":"Dates identified from source product name."}</p>{item.data_url&&<a href={item.data_url} target="_blank" rel="noreferrer">Original product · Earthdata login required</a>}</div>)}<ul>{study.limitations.map(item=><li key={item}>{item}</li>)}</ul><a href={loaded.base+"study.json"} download>Study manifest</a> · <a href={loaded.base+"checksums.json"} download>Artifact checksums</a></details>
  </section>;
}
