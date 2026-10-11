"use client";

import { FormEvent, useEffect, useState } from "react";

type NameResponse = { siteName?: string; configuredSiteName?: string; error?: string };

export default function NextRunSiteName() {
  const [siteName, setSiteName] = useState("Hakaluki Haor");
  const [savedName, setSavedName] = useState("Hakaluki Haor");
  const [configuredSiteName, setConfiguredSiteName] = useState("Hakaluki Haor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wetland/site-name", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as NameResponse;
        if (!response.ok) throw new Error(result.error || "Could not load the saved run name.");
        return result;
      })
      .then((result) => {
        if (result.configuredSiteName) setConfiguredSiteName(result.configuredSiteName);
        if (result.siteName) {
          setSiteName(result.siteName);
          setSavedName(result.siteName);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not load the saved run name.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/wetland/site-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName: siteName.trim() }),
      });
      const result = await response.json() as NameResponse;
      if (!response.ok || !result.siteName) throw new Error(result.error || "Could not save the run name.");
      setSiteName(result.siteName);
      setSavedName(result.siteName);
      setMessage(`Saved “${result.siteName}” as the label for real pipeline runs.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the run name.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="next-run-site-name" aria-labelledby="next-run-site-name-title">
      <div className="next-run-site-name__heading">
        <div>
          <p className="global-eyebrow">NEXT PIPELINE RUN</p>
          <h3 id="next-run-site-name-title">Study-area label</h3>
        </div>
      </div>
      <form onSubmit={saveName}>
        <label className="detection-field-label" htmlFor="next-run-site-name">Name shown in the run</label>
        <div className="next-run-site-name__row">
          <input
            id="next-run-site-name"
            className="detection-date-input"
            type="text"
            autoComplete="off"
            maxLength={80}
            minLength={2}
            required
            value={siteName}
            onChange={(event) => { setSiteName(event.target.value); setMessage(""); }}
            disabled={loading || saving}
          />
          <button className="global-refresh" type="submit" disabled={loading || saving || siteName.trim().length < 2 || siteName.trim() === savedName}>
            {saving ? "Saving…" : savedName === siteName.trim() ? "Saved" : "Save name"}
          </button>
        </div>
      </form>
      <p className="next-run-site-name__command">From the code folder, run in PowerShell for a different wetland: <code>.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode real --site-name &quot;YOUR PLACE&quot; --boundary-geojson &quot;C:\path\to\boundary.geojson&quot;</code></p>
      <p className="next-run-site-name__helper">Use a WGS84 GeoJSON Polygon or MultiPolygon for the wetland boundary; the pipeline derives the search bounds from it. The saved name above only labels the run. Without a boundary override, the configured area remains <strong>{configuredSiteName}</strong> from <code>pipeline/config.yaml</code>. Runs use the configured dates unless you pass <code>--start-date YYYY-MM-DD --end-date YYYY-MM-DD</code>.</p>
      <p className="next-run-site-name__helper">For a quick rectangular area, use <code>--bbox WEST SOUTH EAST NORTH</code>; it masks a rectangle, not the wetland shape. Processed outputs are saved under <code>pipeline/output/runs</code>.</p>
      <p className={`next-run-site-name__status${error ? " next-run-site-name__status--error" : ""}`} aria-live="polite">
        {error || message || (loading ? "Loading saved run name…" : `Configured boundary: ${configuredSiteName} · saved run label: ${savedName}`)}
      </p>
    </section>
  );
}
