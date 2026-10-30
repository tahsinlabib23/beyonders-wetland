"use client";

import { useId, useState } from "react";

type Band = "sentinel1" | "nisar" | "alos2";
type Variant = "wetland" | "forest";

const bandInfo: Record<Band, { label: string; wavelength: string; title: string; detail: string }> = {
  sentinel1: {
    label: "Sentinel-1 · C-band",
    wavelength: "about 5.6 cm",
    title: "More response from leaves and fine branches",
    detail: "C-band often responds strongly to leaves and smaller branches. Dense foliage can limit the contribution from the ground below.",
  },
  nisar: {
    label: "NISAR · L-band",
    wavelength: "about 24 cm",
    title: "More chance of interacting with larger structure",
    detail: "L-band can interact with larger branches and trunks and may retain more sensitivity to the ground beneath less dense canopy. It does not guarantee a view through dense forest.",
  },
  alos2: {
    label: "ALOS-2 PALSAR · L-band",
    wavelength: "about 23.6 cm",
    title: "A second L-band example",
    detail: "ALOS-2 also uses L-band. Its longer wavelength can interact with larger vegetation structures, while moisture, forest density, polarization and viewing geometry still shape the signal.",
  },
};

export default function BandPenetrationExplainer({ variant }: { variant: Variant }) {
  const [band, setBand] = useState<Band>("nisar");
  const [peel, setPeel] = useState(24);
  const titleId = useId().replaceAll(":", "");
  const selected = bandInfo[band];
  const isWetland = variant === "wetland";

  return (
    <section className={`band-xray band-xray--${variant}`} aria-labelledby={`${titleId}-title`}>
      <header className="band-xray__heading">
        <div>
          <p className="band-xray__eyebrow">Interactive radar explainer · conceptual</p>
          <h2 id={`${titleId}-title`}>What might different radar wavelengths reveal?</h2>
          <p>Switch bands and peel back the canopy in this cross-section. The drawing explains a physical idea; it is not a measurement from the map.</p>
        </div>
        <span className="band-xray__wavelength">{selected.wavelength}</span>
      </header>

      <div className="band-xray__controls">
        <div>
          <span className="band-xray__label" id={`${titleId}-band-label`}>Choose a radar band</span>
          <div className="band-xray__buttons" role="group" aria-labelledby={`${titleId}-band-label`}>
            {(Object.keys(bandInfo) as Band[]).map((key) => (
              <button key={key} type="button" aria-pressed={band === key} onClick={() => setBand(key)}>{bandInfo[key].label}</button>
            ))}
          </div>
        </div>
        <label className="band-xray__peel">
          <span>Peel canopy back <output>{peel}%</output></span>
          <input type="range" min="0" max="100" step="1" value={peel} onChange={(event) => setPeel(Number(event.target.value))} aria-label="Peel the illustrative canopy back" />
          <small>Changes the illustration only; it does not alter satellite data.</small>
        </label>
      </div>

      <div className="band-xray__body">
        <figure className="band-xray__figure">
          <svg viewBox="0 0 760 340" role="img" aria-label={`${selected.label} interacting with a forest canopy`} aria-describedby={`${titleId}-svg-desc`}>
            <desc id={`${titleId}-svg-desc`}>Conceptual cross-section of a forest. The selected radar wavelength is shown interacting with foliage, trunks and the ground. Canopy opacity changes with the peel control.</desc>
            <defs>
              <linearGradient id={`${titleId}-sky`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#101a21"/><stop offset="1" stopColor="#1c2b2e"/></linearGradient>
              <marker id={`${titleId}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill={band === "sentinel1" ? "#ffb35c" : "#7dd3fc"}/></marker>
            </defs>
            <rect width="760" height="340" fill={`url(#${titleId}-sky)`}/>
            <path d="M0 250 Q140 240 270 258 T520 250 T760 254 V340 H0Z" fill="#473a2f"/>
            <path d="M0 282 Q90 270 178 282 T355 281 T540 282 T760 280 V340 H0Z" fill="#2d4339" opacity=".78"/>
            {isWetland && <>
              <path d="M0 293 Q130 285 245 294 T490 292 T760 294 V340 H0Z" fill="#126078" opacity=".94"/>
              <path d="M0 294 Q130 286 245 295 T490 293 T760 295" fill="none" stroke="#7dd3fc" strokeWidth="3"/>
              <text x="34" y="325" fill="#f4ffff" fontSize="15" fontWeight="700">Possible floodwater below the canopy</text>
            </>}
            {!isWetland && <text x="34" y="322" fill="#f5f1df" fontSize="15" fontWeight="700">Forest floor · not classified as cleared</text>}

            {[110, 275, 460, 635].map((x, index) => {
              const height = [118, 150, 128, 164][index];
              return <g key={x}>
                <path d={`M${x - 10} 265 L${x - 6} ${250 - height / 2} L${x + 7} ${250 - height / 2} L${x + 12} 265Z`} fill="#755137" stroke="#493629" strokeWidth="2"/>
                <g className="band-xray__canopy" style={{ opacity: 1 - peel / 100 }}>
                  <circle cx={x} cy={250 - height} r={height * 0.36} fill={index % 2 ? "#315f3f" : "#3e7147"}/>
                  <circle cx={x - 24} cy={250 - height + 18} r={height * 0.25} fill="#4c8051"/>
                  <circle cx={x + 25} cy={250 - height + 20} r={height * 0.25} fill="#396b45"/>
                </g>
              </g>;
            })}

            <g aria-hidden="true" fill="none" stroke={band === "sentinel1" ? "#ffb35c" : "#7dd3fc"} strokeWidth="4" strokeDasharray={band === "sentinel1" ? "7 6" : "none"} markerEnd={`url(#${titleId}-arrow)`}>
              {band === "sentinel1" ? <>
                <path d="M380 20 L330 84 L286 114"/>
                <path d="M418 22 L472 78 L508 108"/>
                <path d="M373 24 L314 115" opacity=".65"/>
              </> : <>
                <path d="M380 20 L345 108 L356 188 L380 260"/>
                <path d="M380 260 L420 206 L450 183" opacity=".82"/>
                <path d="M380 22 L416 114 L400 201 L380 260" opacity=".55"/>
              </>}
            </g>
            <g fontSize="14" fontWeight="700">
              <text x="24" y="28" fill="#eef1f6">Radar signal path · illustration</text>
              <text x="736" y="30" textAnchor="end" fontSize="12" fill={band === "sentinel1" ? "#ffb35c" : "#7dd3fc"}>{band === "sentinel1" ? "C-band · canopy response" : "L-band · possible lower-canopy response"}</text>
            </g>
            <text x="34" y="277" fill="#fbf9ed" fontSize="13">Soil / surface</text>
          </svg>
          <figcaption>Illustrative cross-section. Signal paths and canopy transparency are not to scale.</figcaption>
        </figure>
        <aside className="band-xray__explanation" aria-live="polite">
          <p className="band-xray__eyebrow">{selected.label}</p>
          <h3>{selected.title}</h3>
          <p>{selected.detail}</p>
          <p>{isWetland
            ? "Open water can appear dark when energy reflects away from the sensor; water among stems can produce a stronger double-bounce. Neither pattern alone confirms flooding."
            : "A persistent backscatter decrease is only a candidate. Rain, soil moisture, geometry, fire and other changes can also alter the radar response."}</p>
          <strong className="band-xray__caveat">Not a literal X-ray · no co-located C/L scene comparison is loaded here.</strong>
          <a href={isWetland ? "#nisar-reference-evidence" : "#forest-comparison"}>{isWetland ? "Open the measured optical–NISAR comparison" : "Open the real Rondônia study maps"}</a>
        </aside>
      </div>
      <footer className="band-xray__sources">
        <span>Wavelengths: Sentinel-1 C-band ≈ 5.6 cm · NISAR L-band ≈ 24 cm · ALOS-2 PALSAR L-band ≈ 23.6 cm.</span>
        <a href="https://nisar.jpl.nasa.gov/mission/quick-facts/" target="_blank" rel="noreferrer">NASA NISAR facts</a>
        <a href="https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1/Facts_and_figures" target="_blank" rel="noreferrer">ESA Sentinel-1 facts</a>
      </footer>
    </section>
  );
}
