"use client";

const cases = [
  { name: "Rondônia · forest", clear: 0.9745399766, dates: "8 Jul → 28 Sep 2026", candidateEvidence: "29 Sep candidate: 71.1% had exploratory index-decrease support.", note: "Most of the study area had common-clear HLS coverage. The optical index supported some candidates, but it is not a forest-loss reference." },
  { name: "Chókwè · flood", clear: 0.0125549429, dates: "7 → 22 Jan 2026", candidateEvidence: "17 Jan candidates: 0% of candidate area was assessed by this HLS pair.", note: "HLS had too little common-clear area to assess any radar candidate. Later UNOSAT Sentinel-1 water gives positive spatial support, not accuracy." },
];

export default function OpticalCoverageComparison() {
  return <section className="optical-coverage" aria-labelledby="optical-coverage-title">
    <header><div><h3 id="optical-coverage-title">Optical visibility depends on the case</h3><p>Fixed NASA HLS reference pairs · common-clear coverage after cloud and quality masks</p></div><span>Published reference coverage</span></header>
    <div className="optical-coverage__cases">{cases.map(item => <article key={item.name}>
      <div><strong>{item.name}</strong><small>{item.dates}</small></div>
      <div className="optical-coverage__bar" role="img" aria-label={`${(item.clear * 100).toFixed(1)} percent common-clear HLS coverage`}><i style={{ width: `${item.clear * 100}%` }} /></div>
      <b>{(item.clear * 100).toFixed(1)}% clear</b>
      <small>{item.candidateEvidence}</small>
      <p>{item.note}</p>
    </article>)}</div>
    <p className="optical-coverage__caveat">The remainder is not common-clear coverage; cloud, cloud shadow, missing scenes, and other quality masks can contribute. Coverage alone does not show that radar is correct or that the optical sensor missed a specific change.</p>
  </section>;
}
