"use client";

/* Registry-driven briefing page for a PLANNED phenomenon module.
   Same radar-room design language as the rest of GeoNexSAR: dark, instrument-like,
   honest about what is real and what is still incoming. */

import Link from "next/link";
import type { Phenomenon } from "@/phenomena/registry";
import "./briefing.css";

const CONTRACT_LABELS: Record<string, { name: string; text: string }> = {
  time: { name: "Time", text: "A dated observation timeline — every sweep the satellite makes over the site." },
  change: { name: "Change", text: "Radar-change candidates flagged by transparent, tunable rules — never presented as confirmed events." },
  evidence: { name: "Evidence", text: "An independent cross-check (optical reference where available) with its coverage stated up front." },
  investigation: { name: "Investigation", text: "Interrogate any region: what the rules saw, what the reference said, what stays uncertain." },
  uncertainty: { name: "Uncertainty", text: "Limitations printed next to the results, not buried in a footnote." },
};

export default function PhenomenonBriefing({ phenomenon }: { phenomenon: Phenomenon }) {
  const b = phenomenon.briefing;
  if (!b) return null;
  return (
    <main className="pb">
      <section className="pb-hero" aria-labelledby="pb-title">
        <p className="pb-eyebrow"><span className="pb-pulse" aria-hidden="true" />Signal incoming · planned module</p>
        <h1 id="pb-title">{phenomenon.name}</h1>
        <p className="pb-tagline">{phenomenon.tagline}</p>
        <p className="pb-lede">{b.lede}</p>
        <div className="pb-cta">
          <Link href="/wetland" className="pb-primary">Open the live wetland module →</Link>
          <span className="pb-note">The wetland module already runs this whole playbook on real NISAR data.</span>
        </div>
      </section>

      <section className="pb-section" aria-labelledby="pb-sees">
        <h2 id="pb-sees">What the radar will see</h2>
        <div className="pb-cards">
          {b.radarSees.map((s) => (
            <article key={s.title} className="pb-card">
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pb-section" aria-labelledby="pb-contract">
        <h2 id="pb-contract">The same five capabilities</h2>
        <p className="pb-sub">Every GeoNexSAR module exposes the same contract. When {phenomenon.name.toLowerCase()} goes live, it inherits all five:</p>
        <ol className="pb-contract">
          {phenomenon.contract.map((c) => (
            <li key={c}>
              <strong>{CONTRACT_LABELS[c].name}</strong>
              <span>{CONTRACT_LABELS[c].text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pb-section" aria-labelledby="pb-needs">
        <h2 id="pb-needs">What it takes to activate</h2>
        <ul className="pb-needs">
          {b.needs.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <p className="pb-honest">Nothing here is simulated. This page ships no fake {phenomenon.name.toLowerCase()} data — the module appears when a real processed case exists.</p>
      </section>

      <footer className="pb-foot">
        <p><strong>GeoNexSAR</strong></p>
        <nav aria-label="Footer"><Link href="/">Home</Link><Link href="/wetland">Processed case</Link><Link href="/wetland/global">NISAR worldwide</Link></nav>
      </footer>
    </main>
  );
}
