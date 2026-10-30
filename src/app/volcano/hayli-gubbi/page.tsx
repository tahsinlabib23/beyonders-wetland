import Image from "next/image";
import DeformationExplorer from "@/components/volcano/DeformationExplorer";
import caseStudy from "../../../../public/volcanoes/hayli-gubbi-2025.json";

export const metadata = {
  title: "Hayli Gubbi · NISAR deformation evidence | Beyonders",
  description: "Explore official NISAR interferograms, Sentinel-1 comparisons, pixel quality and satellite imagery for the Hayli Gubbi volcanic area.",
};

export default function HayliGubbiCasePage() {
  return (
    <>
      <DeformationExplorer />

      <main className="volcano-page volcano-case-page">

      <section className="volcano-case-grid">
        <article className="volcano-case-panel volcano-case-map-panel">
          <div className="volcano-case-panel__heading"><span>01 · Place and event</span><h2>Hayli Gubbi, near Erta Ale</h2></div>
          <div className="volcano-locator" role="img" aria-label="Schematic location map of Hayli Gubbi and Erta Ale in Ethiopia">
            <div className="volcano-locator__grid" />
            <div className="volcano-locator__rift" />
            <span className="volcano-locator__point volcano-locator__point--hayli"><i />Hayli Gubbi</span>
            <span className="volcano-locator__point volcano-locator__point--erta"><i />Erta Ale</span>
            <span className="volcano-locator__caption">Afar Rift · Ethiopia</span>
          </div>
          <p className="volcano-map-caption">Schematic locator only. It is not a radar image or deformation map.</p>
          <div className="volcano-event-date"><span>ERUPTION REPORTED</span><strong>23 November 2025</strong><p>The Smithsonian/USGS report documents the event and satellite-observed ash and gas.</p><a href={caseStudy.event_context.url} target="_blank" rel="noreferrer">Open the independent event report ↗</a></div>
        </article>

        <article className="volcano-case-panel volcano-input-panel">
          <div className="volcano-case-panel__heading"><span>Published context</span><h2>The research paper’s inputs and method</h2></div>
          <dl className="volcano-case-metadata">
            <div><dt>NISAR product</dt><dd>{caseStudy.product}</dd></div>
            <div><dt>Orbit / viewing geometry</dt><dd>{caseStudy.orbit}</dd></div>
            <div><dt>Dates visible in the public NISAR archive</dt><dd>22 Nov 2025 → 4 Dec 2025</dd></div>
            <div><dt>Archived radar files</dt><dd>20251122.vv.slc · 20251204.vv.slc</dd></div>
          </dl>
          <div className="volcano-date-warning" role="note"><strong>Research archive metadata</strong><p>{caseStudy.input_date_integrity}</p><a href={caseStudy.source_data.nisar_archive_download_url} target="_blank" rel="noreferrer">Download the publication’s 1.3 GB SLC archive ↗</a></div>
          <p className="volcano-method-copy">{caseStudy.processing_method}</p>
          <p className="volcano-maturity-note">The explorer above uses official NASA HH GUNW phase products and their own provenance. This paragraph describes the publication’s GAMMA workflow; the app does not claim to reproduce that workflow or its 3D inversion.</p>
        </article>
      </section>

      <section className="volcano-real-observations" aria-labelledby="volcano-observations-title">
        <div className="volcano-section-heading"><div><span>REAL SATELLITE OBSERVATIONS · EVENT CONTEXT</span><h2 id="volcano-observations-title">Before, during, and after the eruption</h2></div><p>NASA Earth Observatory imagery shows the ash plume and changed summit landscape. These are optical observations, not NISAR deformation products.</p></div>
        <div className="volcano-image-grid">
          <figure><a href="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/" target="_blank" rel="noreferrer"><Image src="/volcanoes/imagery/hayli-gubbi-modis-before-2025-11-15.jpg" alt="NASA Aqua MODIS view of the Afar region before the Hayli Gubbi eruption, November 15, 2025" width={1440} height={960} unoptimized loading="lazy" /></a><figcaption><strong>Before · 15 November 2025</strong><span>Aqua MODIS · NASA Earth Observatory</span></figcaption></figure>
          <figure><a href="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/" target="_blank" rel="noreferrer"><Image src="/volcanoes/imagery/hayli-gubbi-modis-eruption-2025-11-23.jpg" alt="NASA Aqua MODIS image of the ash plume during the Hayli Gubbi eruption, November 23, 2025" width={1440} height={960} unoptimized loading="lazy" /></a><figcaption><strong>During · 23 November 2025</strong><span>Aqua MODIS · ash plume and gas context</span></figcaption></figure>
          <figure><a href="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/" target="_blank" rel="noreferrer"><Image src="/volcanoes/imagery/hayli-gubbi-landsat-2025-11-24.jpg" alt="NASA Landsat 9 OLI-2 close view of Hayli Gubbi and Erta Ale after the eruption, November 24, 2025" width={2631} height={2142} unoptimized loading="lazy" /></a><figcaption><strong>After · 24 November 2025</strong><span>Landsat 9 OLI-2 · summit and ash deposits</span></figcaption></figure>
        </div>
        <p className="volcano-image-credit">Images: NASA Earth Observatory; Aqua MODIS on Nov 15 and 23, Landsat 9 OLI-2 on Nov 24. Select an image to open NASA’s source and full caption.</p>
      </section>

      <section className="volcano-published-results">
        <div className="volcano-section-heading"><div><span>03 · Values reported in the paper</span><h2>Strongest measured motion was at Erta Ale</h2></div><p>Published line-of-sight values are shown for context, not as Beyonders detector output.</p></div>
        <div className="volcano-result-bars" aria-label="Published line-of-sight displacement values">
          <div className="volcano-result-row"><div><strong>Erta Ale · north caldera</strong><span>Peak line-of-sight displacement</span></div><div className="volcano-result-track"><i style={{ width: "100%" }} /></div><b>up to 60 cm</b></div>
          <div className="volcano-result-row"><div><strong>Erta Ale · south caldera</strong><span>Peak line-of-sight displacement</span></div><div className="volcano-result-track"><i style={{ width: "25%" }} /></div><b>about 15 cm</b></div>
        </div>
        <p className="volcano-result-caveat">The paper did not resolve fringes at the Hayli Gubbi crater, likely because eruptive deposits reduced radar coherence. Missing fringes do not establish that no deformation occurred there.</p>
      </section>

      <section className="volcano-case-grid volcano-case-grid--bottom">
        <article className="volcano-case-panel">
          <div className="volcano-case-panel__heading"><span>04 · Cross-sensor evidence</span><h2>Complementary radar views</h2></div>
          <p>The paper combines left-looking NISAR L-band with ascending and descending right-looking Sentinel-1 C-band measurements to estimate three-dimensional motion.</p>
          <div className="volcano-evidence-status"><strong>Publication comparison</strong><span>Three-dimensional decomposition reported by the paper; the explorer above compares separate official LOS products without reproducing this inversion.</span></div>
          <div className="volcano-evidence-status"><strong>Model fit</strong><span>1.5 cm RMS residual reported; this is not an independent accuracy or uncertainty estimate.</span></div>
          <div className="volcano-evidence-status"><strong>Event reference</strong><span>Smithsonian/USGS verifies the eruption context, not the measured deformation field.</span></div>
        </article>
        <article className="volcano-case-panel">
          <div className="volcano-case-panel__heading"><span>05 · Reproduction status</span><h2>Source data and next check</h2></div>
          <p>The public source archive contains a 1.3 GB NISAR SLC ZIP, with two 865.9 MB VV files listed in its preview, plus Sentinel-1, optical, and DEM inputs.</p>
          <a className="volcano-download-link" href={caseStudy.source_data.nisar_archive_download_url} target="_blank" rel="noreferrer">Download the NISAR SLC inputs ↗</a>
          <a className="volcano-download-link" href={caseStudy.source_data.url} target="_blank" rel="noreferrer">Browse all source data and checksums ↗</a>
          <p className="volcano-reproduction-state"><strong>Two documented workflows.</strong> The explorer post-processes official geocoded phase products. Reproducing the publication from raw SLCs still requires resolving its archive polarization and running the documented interferometric chain. The evidence export above contains the app’s cropped inputs and method.</p>
        </article>
      </section>

      <footer className="volcano-case-sources">
        <span>Sources</span>
        {caseStudy.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}
        <a href="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/" target="_blank" rel="noreferrer">NASA Earth Observatory satellite imagery ↗</a>
      </footer>
      </main>
    </>
  );
}
