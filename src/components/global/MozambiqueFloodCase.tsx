import Image from "next/image";

const NASA_CASE_URL = "https://svs.gsfc.nasa.gov/5661";
const UNOSAT_REFERENCE_URL = "https://unosat.org/products/4232";
const CIMA_REFERENCE_URL = "https://www.cimafoundation.org/en/news/mozambique-heavy-rainfall-in-the-south-cooperation-and-monitoring-to-manage-flood-risk/";

const images = [
  {
    date: "5 January 2026",
    label: "Before the flood comparison",
    sourceName: "NASA",
    sourcePage: NASA_CASE_URL,
    imagePath: "/evidence/mozambique/Pre_Chokwe.png",
    alt: "NASA NISAR false-color L-band radar image over Chókwè, Mozambique, acquired 5 January 2026",
  },
  {
    date: "17 January 2026",
    label: "During the flood",
    sourceName: "NASA",
    sourcePage: NASA_CASE_URL,
    imagePath: "/evidence/mozambique/Post_Chokwe.png",
    alt: "NASA NISAR false-color L-band radar image over Chókwè, Mozambique, acquired 17 January 2026",
  },
  {
    date: "16 January 2026",
    label: "Independent Sentinel-1/2 flood map · CIMA",
    sourceName: "CIMA",
    sourcePage: CIMA_REFERENCE_URL,
    imagePath: "/evidence/mozambique/cima_flood_2026-01-16.avif",
    alt: "CIMA map of southern Mozambique flooding from Copernicus Sentinel-1 and Sentinel-2, updated 16 January 2026; cyan shows flooded areas, blue permanent water, and black no data",
    reference: true,
  },
];

export default function MozambiqueFloodCase({ onLocate }: { onLocate: () => void }) {
  return (
    <section className="mozambique-case" aria-labelledby="mozambique-case-title">
      <div className="mozambique-case__heading">
        <div>
          <p className="global-eyebrow">SECOND EVENT CASE · CHÓKWÈ, MOZAMBIQUE</p>
          <h2 id="mozambique-case-title">NISAR sees floodwater during a major river flood</h2>
        </div>
        <span className="mozambique-case__verdict"><i aria-hidden="true" /> Event corroboration · not a detector score</span>
      </div>

      <div className="mozambique-case__body">
        <div className="mozambique-case__story">
          <p className="mozambique-case__lead">
            NASA’s published L-band radar comparison shows changing open water around Chókwè as southern Mozambique flooded in January 2026.
          </p>

          <dl className="mozambique-case__facts">
            <div>
              <dt>NISAR · L2 GCOV beta</dt>
            <dd>5 Jan → 17 Jan 2026 · same ascending pass, track 114, frame 165</dd>
            </div>
            <div>
              <dt>Independent · UNOSAT Sentinel-1</dt>
              <dd>23–24 Jan 2026 · satellite-mapped water across Gaza, Maputo and Maputo City provinces</dd>
            </div>
          </dl>

          <p className="mozambique-case__reference-copy">
            UNOSAT reported about 4,800 km² of flood-affected land across its roughly 64,000 km² multi-province analysis region, not just Chókwè. CIMA separately mapped widespread flooding with Sentinel-1/2 on 16 January. Together they support the same regional flood event; neither result is a pixel-by-pixel score of this app’s detector.
          </p>

          <details className="mozambique-case__method">
            <summary>Scene IDs and visualization method</summary>
            <code>NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_20260105T034232_20260105T034253_X05010_N_P_J_001</code>
            <code>NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001</code>
            <p>NASA’s false-color browse view assigns HH to red, HV to green, and the HH/HV ratio to blue. It is a visual comparison from the Beta catalog scenes; this project has not run its detector on these granules.</p>
          </details>

          <button className="mozambique-case__locate" type="button" onClick={onLocate}>
            Locate Chókwè on the world map
          </button>
          <p className="mozambique-case__map-note">The map pin marks the town center for context; it is not a flood boundary.</p>
        </div>

        <div className="mozambique-case__images" role="group" aria-label="NASA before-and-during-flood images and CIMA independent flood map">
          {images.map((image) => (
            <figure className={`mozambique-case__image${image.reference ? " mozambique-case__image--reference" : ""}`} key={image.date}>
              <figcaption><span>{image.label}</span><time>{image.date}</time></figcaption>
              <a className="mozambique-case__image-link" href={image.imagePath} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size ${image.sourceName} image: ${image.label}`}>
                <Image src={image.imagePath} alt={image.alt} width={image.sourceName === "CIMA" ? 1024 : 1920} height={image.sourceName === "CIMA" ? 678 : 1080} sizes="(max-width: 700px) 100vw, 50vw" unoptimized={image.imagePath.endsWith(".avif")} />
              </a>
              <a className="mozambique-case__attribution" href={image.sourcePage} target="_blank" rel="noopener noreferrer">{image.sourceName === "CIMA" ? "CIMA Sentinel-1/2 map ↗" : "NASA NISAR source image ↗"}</a>
            </figure>
          ))}
        </div>
      </div>

      <div className="mozambique-case__evidence">
        <div>
          <strong>What the evidence supports</strong>
          <p>A real flood-related surface-water change was observed by NISAR and independently mapped nearby by Sentinel-1.</p>
        </div>
        <div className="mozambique-case__limits">
          <strong>What it does not establish</strong>
          <p>UNOSAT’s map is later, covers a much larger region, and is preliminary rather than field-validated. NASA’s browse images are source visualizations, not rasters processed by this app. No local detector agreement score is claimed.</p>
        </div>
        <nav className="mozambique-case__sources" aria-label="Sources for the Mozambique case">
          <a href={NASA_CASE_URL} target="_blank" rel="noopener noreferrer">NASA NISAR case ↗</a>
          <a href={UNOSAT_REFERENCE_URL} target="_blank" rel="noopener noreferrer">UNOSAT map and data ↗</a>
          <a href={CIMA_REFERENCE_URL} target="_blank" rel="noopener noreferrer">CIMA Sentinel-1/2 report ↗</a>
        </nav>
      </div>
    </section>
  );
}
