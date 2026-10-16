"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { coordinate, RONDONIA_BBOX } from "@/lib/forest-study";
import type { ForestCandidates, ForestCatalogEntry, ForestCoverage, ForestStudy, ForestPublication } from "@/lib/forest-study";
import type { ForestFocus } from "./ForestMap";
const ForestMap = dynamic(() => import("./ForestMap"), { ssr: false, loading: () => <div className="forest-loading">Loading forest map…</div> });
export default function ForestDirectory() {
    const [studies, setStudies] = useState<ForestCatalogEntry[]>([]);
    const [selected, setSelected] = useState("");
    const [catalogError, setCatalogError] = useState("");
    const [focus, setFocus] = useState<ForestFocus | null>(null);
    const [lat, setLat] = useState("-10.3");
    const [lon, setLon] = useState("-62.65");
    const [query, setQuery] = useState("");
    const [places, setPlaces] = useState<{
        name: string;
        latitude: number;
        longitude: number;
    }[]>([]);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [tree, setTree] = useState(true);
    const [imagery, setImagery] = useState(false);
    const [footprints, setFootprints] = useState(true);
    const [changes, setChanges] = useState(true);
    const [mosaicDate, setMosaicDate] = useState("");
    const [start, setStart] = useState("2026-06-17");
    const [end, setEnd] = useState("2026-09-30");
    const [coverage, setCoverage] = useState<ForestCoverage | null>(null);
    const [candidates, setCandidates] = useState<ForestCandidates | null>(null);
    const [study, setStudy] = useState<ForestStudy | null>(null);
    const [base, setBase] = useState("");
    const [frameDate, setFrameDate] = useState("");
    const request = useRef<AbortController | null>(null);
    useEffect(() => { const c = new AbortController(); fetch("/forests/catalog.json", { signal: c.signal, cache: "no-store" }).then(async (r) => { if (!r.ok)
        throw Error(); return r.json(); }).then(r => setStudies(r.studies)).catch(() => { if (!c.signal.aborted)
        setCatalogError("Published study catalog unavailable. You can still explore places and coverage."); }); return () => c.abort(); }, []);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {
        const entry = studies.find(s => s.id === selected);
        if (!entry)
            return;
        const c = new AbortController();
        fetch(entry.index_url, { signal: c.signal, cache: "no-store" }).then(async (r) => { if (!r.ok)
            throw Error("Publication index unavailable."); return await r.json() as ForestPublication; })
            .then(async (index) => { const r = await fetch(index.study_url, { signal: c.signal }); if (!r.ok)
            throw Error("Published study unavailable."); return { index, study: await r.json() as ForestStudy }; })
            .then(({ index, study }) => { setStudy(study); setBase(index.study_url.replace(/study.json$/, "")); setFrameDate(study.frames.at(-1)?.date ?? ""); })
            .catch(e => { if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "Could not load study."); });
        return () => c.abort();
    }, [selected, studies]);
    useEffect(() => {
        const frame = study?.frames.find(f => f.date === frameDate);
        if (!frame)
            return;
        const c = new AbortController();
        fetch(`${base}${frame.candidates_geojson}`, { signal: c.signal }).then(async (r) => { if (!r.ok)
            throw Error(); return r.json(); }).then(setCandidates).catch(() => { if (!c.signal.aborted)
            setMessage("Candidate layer unavailable for this publication date."); });
        return () => c.abort();
    }, [frameDate, study, base]);
    function clearLookup() { request.current?.abort(); setLoading(false); setCoverage(null); setMessage(""); }
    function move(latitude: number, longitude: number) { request.current?.abort(); setLoading(false); setCoverage(null); setMessage(""); setLat(String(latitude)); setLon(String(longitude)); setFocus({ lat: latitude, lon: longitude, zoom: 10 }); }
    function searchCoordinates() { const a = coordinate(lat, "latitude"), b = coordinate(lon, "longitude"); if (a === null || b === null) {
        setMessage("Enter valid decimal coordinates: latitude −85.0511 to 85.0511, longitude −180 to 180.");
        return;
    } move(a, b); }
    async function searchPlaces() { request.current?.abort(); const c = new AbortController(); request.current = c; setLoading(true); setPlaces([]); setMessage(""); try {
        const r = await fetch(`/api/forests/places?q=${encodeURIComponent(query)}`, { signal: c.signal });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.error);
        setPlaces(body.places);
        if (!body.places.length)
            setMessage("No matching places. Try another name or coordinates.");
    }
    catch (e) {
        if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "Place search failed.");
    }
    finally {
        if (request.current === c)
            setLoading(false);
    } }
    async function searchCoverage() { const a = coordinate(lat, "latitude"), b = coordinate(lon, "longitude"); if (a === null || b === null) {
        searchCoordinates();
        return;
    } request.current?.abort(); const c = new AbortController(); request.current = c; setLoading(true); setCoverage(null); setMessage(""); try {
        const params = new URLSearchParams({ lat: String(a), lon: String(b), start, end });
        const r = await fetch(`/api/forests/coverage?${params}`, { signal: c.signal });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.error);
        setCoverage({ type: "FeatureCollection", features: body.features });
        setMessage(`${body.features.length} acquired scene footprint(s)${body.truncated ? " · search capped; narrow the dates" : ""}${body.status === "SNAPSHOT" ? " · saved catalog snapshot; live service unavailable" : ""}. ${body.features.length ? "Scene coverage is not a disturbance detection." : "No result available; this does not mean no forest change."}`);
    }
    catch (e) {
        if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "NASA coverage search unavailable.");
    }
    finally {
        if (request.current === c)
            setLoading(false);
    } }
    function selectStudy(id: string) { setSelected(id); setStudy(null); setCandidates(null); setFrameDate(""); setBase(""); const s = studies.find(s => s.id === id); if (s)
        move((s.bbox[1] + s.bbox[3]) / 2, (s.bbox[0] + s.bbox[2]) / 2); }
    return <main className="forest-page">
    <header className="forest-heading"><div><p className="forest-topic">Forest change</p><h1>Follow the changing forest</h1><p>Explore historical tree cover and worldwide NISAR observations, then inspect a published radar-change study.</p></div><Link className="forest-button" href="/forest/rondonia">Explore Rondônia evidence</Link></header>
    <div className="forest-status">Historical context: ESA WorldCover 2021 · Acquired scenes: NASA CMR · Change results: processed studies only</div>
    <section className="forest-explorer" aria-label="Global forest context and NISAR observations">
      <div className="forest-map-column"><div className="forest-map-title"><strong>Forest context and observation map</strong><span>Blank areas have no processed result available</span></div>
        <div className="forest-map-frame"><ForestMap globalView focus={focus} treeCover={tree} imagery={imagery} mosaicDate={mosaicDate} coverage={footprints ? coverage : null} candidates={changes ? candidates : null} bbox={study?.bbox} studyPublished={Boolean(study)}/></div>
        <div className="forest-legend"><span><i style={{ background: "#006400" }}/>Tree cover in 2021</span><span><i style={{ border: "1px solid #dfab45" }}/>Acquired scene footprint</span><span><i style={{ background: "#ffb646" }}/>Unverified radar-change candidate</span></div>
      </div>
      <aside className="forest-controls">
        <label>Saved study<select aria-label="Saved study" value={selected} onChange={e => selectStudy(e.target.value)}><option value="">Global exploration</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {!studies.length && <p>No published forest results available yet. <Link href="/forest/rondonia">View the study method.</Link></p>}
        {catalogError && <p role="alert">{catalogError}</p>}
        {study && <label>Processed observation date<select aria-label="Processed observation date" value={frameDate} onChange={e => { setCandidates(null); setFrameDate(e.target.value); }}>{study.frames.map(f => <option key={f.date}>{f.date}</option>)}</select></label>}
        <form onSubmit={e => { e.preventDefault(); searchPlaces(); }}><label htmlFor="forest-place">Find a place</label><div className="forest-input-row"><input id="forest-place" value={query} onChange={e => setQuery(e.target.value)} placeholder="Town, forest, or country"/><button disabled={loading || query.trim().length < 3}>Search</button></div></form>
        {places.length > 0 && <ul className="forest-places">{places.map(p => <li key={`${p.latitude},${p.longitude}`}><button onClick={() => { move(p.latitude, p.longitude); setPlaces([]); }}>{p.name}</button></li>)}</ul>}
        <form onSubmit={e => { e.preventDefault(); searchCoordinates(); }}><div className="forest-two-fields"><label>Latitude<input value={lat} onChange={e => { clearLookup(); setLat(e.target.value); }} placeholder="−10.30"/></label><label>Longitude<input value={lon} onChange={e => { clearLookup(); setLon(e.target.value); }} placeholder="−62.65"/></label></div><button>Go to coordinates</button><small>Decimal degrees · latitude first, longitude second</small></form>
        <fieldset><legend>Map layers</legend>{[[tree, setTree, "WorldCover land cover · 2021"], [imagery, setImagery, "NISAR radar imagery"], [footprints, setFootprints, "Acquired-scene footprints"], [changes, setChanges, "Published change candidates"]].map(([value, setter, label]) => <label className="forest-check" key={label as string}><input type="checkbox" checked={value as boolean} onChange={e => (setter as (v: boolean) => void)(e.target.checked)}/>{label as string}</label>)}</fieldset>
        <label>Mosaic date (UTC)<input type="date" value={mosaicDate} onChange={e => setMosaicDate(e.target.value)}/></label><small>Blank uses NASA’s latest mosaic. Imagery colors do not classify forest loss.</small>
        <form onSubmit={e => { e.preventDefault(); searchCoverage(); }}><strong>Check observations near these coordinates</strong><div className="forest-two-fields"><label>Start date<input type="date" value={start} onChange={e => { clearLookup(); setStart(e.target.value); }}/></label><label>End date<input type="date" value={end} onChange={e => { clearLookup(); setEnd(e.target.value); }}/></label></div><button disabled={loading || !start || !end || start > end}>{loading ? "Searching…" : "Check NISAR coverage"}</button></form>
        {message && <p className="forest-message" role="status">{message}</p>}
        <button className="forest-secondary" onClick={() => move((RONDONIA_BBOX[1] + RONDONIA_BBOX[3]) / 2, (RONDONIA_BBOX[0] + RONDONIA_BBOX[2]) / 2)}>Go to Rondônia</button>
      </aside>
    </section>
    <section className="forest-explain"><article><h2>Historical tree cover</h2><p>The WorldCover map describes land cover in 2021. Green is tree cover; other colors represent other land-cover classes. It is not a current forest inventory.</p></article><article><h2>What radar observes</h2><p>NISAR measures radar backscatter. Changes can reflect vegetation structure, moisture, seasons, and land management. A scene footprint records an acquisition, not a clearing.</p></article><article><h2>Evidence before interpretation</h2><p>The Rondônia study screens persistent decreases in HV backscatter, then compares optical observations. Candidates remain unverified until independent evidence is reviewed.</p></article></section>
    <footer className="forest-footer"><a href="https://esa-worldcover.org/en/data-access">ESA WorldCover source</a><a href="https://nisar-docs.asf.alaska.edu/products-overview/">NISAR products</a><a href="/docs/forest-operator-guide.md" download>Download operator guide</a><span>No worldwide forest-loss classification</span></footer>
  </main>;
}
