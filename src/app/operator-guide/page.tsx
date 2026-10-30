import Link from "next/link";

export default function OperatorGuide() {
  return <main className="operator-guide-page" style={{ maxWidth: 900, margin: "auto", padding: "48px 24px", lineHeight: 1.7 }}>
    <Link href="/wetland/global">Back to the global viewer</Link>
    <h1>How studies reach this website</h1>
    <p>This public viewer serves reviewed packages prepared in the local operator application. It does not download or process satellite scenes on your behalf.</p>
    <ol>
      <li>Select a boundary and compatible NISAR observations in the local application.</li>
      <li>Authenticate privately with Earthdata and process the spatial subsets.</li>
      <li>Inspect input dates, quality masks, radar changes, optical coverage, and disagreements.</li>
      <li>Publish a versioned package, verify its checksums, and deploy the updated viewer.</li>
    </ol>
    <h2>What published results mean</h2>
    <p>Scene footprints show observation coverage. False-colour mosaics show radar backscatter. Candidate polygons show threshold-based change within a processed boundary. None of these alone confirms flooding.</p>
    <p>Unprocessed locations have no detector result available. Grey reference pixels are unassessed. Insufficient optical coverage makes the comparison inconclusive.</p>
    <h2>Operator command</h2>
    <pre className="operator-guide-command">python pipeline/publish_study.py RUN_ID --version RELEASE_VERSION</pre>
    <p>Full installation, authentication, publication, and recovery instructions are maintained in the repository documentation. Source rasters stay local unless an operator publishes an explicit release download.</p>
    <a href="/studies/catalog.json">Published study catalog</a>
    <h2>Forest studies</h2>
    <p>The separate forest workflow uses NISAR HH/HV backscatter, historical WorldCover tree cover, and HLS vegetation-index comparisons. Persistent radar changes remain unverified candidates. Native analysis stays local.</p>
    <pre className="operator-guide-command">{`python pipeline/forest_pipeline.py discover
python pipeline/forest_pipeline.py process
python pipeline/forest_pipeline.py reference --run RUN_ID
python pipeline/forest_pipeline.py publish --run RUN_ID --version RELEASE_VERSION`}</pre>
    <p>See docs/forest-operator-guide.md in the repository for authentication, optional GLAD-S2 exports, native subset release assets and recovery.</p>
    <Link href="/forest/global">Explore forest observations</Link>
  </main>;
}
