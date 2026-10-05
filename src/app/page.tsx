import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <h1 className="landing__title">
        <span>BEYONDERS</span>
        <br />
        Wetland Pulse
      </h1>
      <p className="landing__subtitle">
        Explore NISAR-derived inundation candidates for processed study areas, or
        browse the satellite’s worldwide scene coverage.
      </p>
      <div className="landing__actions">
        <Link href="/wetland/global" className="landing__cta">
          Explore worldwide NISAR →
        </Link>
        <Link href="/wetland?source=raster" className="landing__cta landing__cta--secondary">
          Hakaluki site analysis
        </Link>
      </div>

      <div className="landing__features">
          <div className="glass-card landing__feature animate-fade-in">
          <div className="landing__feature-icon">🛰️</div>
          <div className="landing__feature-title">NISAR GCOV Workflow</div>
          <div className="landing__feature-desc">
            Browse NASA’s worldwide NISAR backscatter mosaic and any local inundation
            candidates computed from processed HH/HV observations. Scene footprints are separate.
          </div>
        </div>

        <div
          className="glass-card landing__feature animate-fade-in"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="landing__feature-icon">🌊</div>
          <div className="landing__feature-title">Wetland Pulse</div>
          <div className="landing__feature-desc">
            Track inundation dynamics through time — onset, expansion, peak,
            recession — including flooded vegetation.
          </div>
        </div>

        <div
          className="glass-card landing__feature animate-fade-in"
          style={{ animationDelay: "0.2s" }}
        >
          <div className="landing__feature-icon">🔬</div>
          <div className="landing__feature-title">Forensic Evidence</div>
          <div className="landing__feature-desc">
            Every detection is tested for quality, spatial consistency, threshold
            stability, and temporal evidence.
          </div>
        </div>

        <div
          className="glass-card landing__feature animate-fade-in"
          style={{ animationDelay: "0.3s" }}
        >
          <div className="landing__feature-icon">🧪</div>
          <div className="landing__feature-title">Counterfactual Lab</div>
          <div className="landing__feature-desc">
            Change any detection assumption and immediately see how the result
            responds. Try to break it.
          </div>
        </div>

        <div
          className="glass-card landing__feature animate-fade-in"
          style={{ animationDelay: "0.4s" }}
        >
          <div className="landing__feature-icon">🌿</div>
          <div className="landing__feature-title">Vegetated Inundation</div>
          <div className="landing__feature-desc">
            Explore potential flooded-vegetation signatures using calibrated,
            site-specific criteria. A radar change alone does not prove inundation.
          </div>
        </div>

        <div
          className="glass-card landing__feature animate-fade-in"
          style={{ animationDelay: "0.5s" }}
        >
          <div className="landing__feature-icon">📋</div>
          <div className="landing__feature-title">Evidence Cards</div>
          <div className="landing__feature-desc">
            Clear distinction between what NISAR observed, what was derived,
            what is contextual, and what is potential.
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 48,
          display: "flex",
          gap: 24,
          alignItems: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--text-dim)",
          }}
        >
          NASA Space Apps Challenge 2026
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--text-dim)",
          }}
        >
          •
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--text-dim)",
          }}
        >
          Dancing with the SARs
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--text-dim)",
          }}
        >
          •
        </span>
        <span className="header-badge" style={{ fontSize: "0.65rem" }}>
          PROVISIONAL DATA
        </span>
      </div>
    </main>
  );
}
