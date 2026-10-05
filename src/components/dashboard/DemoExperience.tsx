"use client";

import { useEffect, useState } from "react";
import { useWetlandStore, type MapMode } from "@/lib/store";
import { DEMO_NOTICE, DEMO_VERSION, demoPatches } from "@/lib/demo-engine";
import { downloadFile, patchesCSV, patchesGeoJSON } from "@/lib/demo-export";
import type { InundationClass } from "@/lib/types";

const STEPS = [
  { title: "1 · Establish a baseline", date: 0, threshold: 2, mode: "AFTER", patch: "wetland_patch_001", text: "Start with a small simulated footprint. Select a region to inspect its HH and HV signal changes. All dates and measurements in this story are fictional." },
  { title: "2 · Watch the pulse rise", date: 3, threshold: 2, mode: "SPLIT", patch: "wetland_patch_005", text: "Compare the first fictional date with the peak. The chart, map boundaries and region table all use the same detector output. Move the divider with the arrow keys or drag it." },
  { title: "3 · Challenge the result", date: 3, threshold: 4, mode: "DIFFERENCE", patch: "wetland_patch_002", text: "A stricter threshold removes weak response bands. Compare area at 2 and 4 dB in the Counterfactual Lab. Disappearing candidates are cleared from the evidence card." },
  { title: "4 · Explain the uncertainty", date: 5, threshold: 1, mode: "AFTER", patch: "wetland_patch_004", text: "This ambiguous region has partial evidence. Its verdict is a simulated rule result. Export a snapshot with settings and source labels; satellite observations and field validation are still needed." },
] as const;

export default function DemoExperience() {
  const state = useWetlandStore();
  const [step, setStep] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [shareURL, setShareURL] = useState("");
  const [exportType, setExportType] = useState("snapshot");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "raster") {
      void useWetlandStore.getState().fetchAllData();
      return;
    }
    if (params.get("demo") !== "1") return;
    const store = useWetlandStore.getState();
    const date = params.get("date");
    const threshold = params.get("threshold");
    if (date !== null && date.trim()) store.setSelectedDateIndex(Number(date));
    if (threshold !== null && threshold.trim()) store.setThreshold(Number(threshold));
    const filter = params.get("filter");
    if (["ALL", "OPEN_WATER", "VEGETATED_INUNDATION", "UNCERTAIN"].includes(filter || "")) store.setVegFilter(filter as InundationClass | "ALL");
    const mode = params.get("mode");
    if (["BEFORE", "AFTER", "DIFFERENCE", "SPLIT"].includes(mode || "")) store.setMapMode(mode as MapMode);
    const selected = useWetlandStore.getState().patches.find((p) => p.id === params.get("patch"));
    if (selected && (filter === "ALL" || !filter || selected.classification === filter)) store.setSelectedPatch(selected);
  }, []);

  function applyStep(index: number) {
    const item = STEPS[index];
    state.setIsPlaying(false);
    state.setSelectedPatch(null);
    state.setVegFilter("ALL");
    state.setThreshold(item.threshold);
    state.setSelectedDateIndex(item.date);
    state.setMapMode(item.mode);
    state.setSelectedPatch(useWetlandStore.getState().patches.find((p) => p.id === item.patch) ?? null);
    setStep(index);
    setMessage("");
  }

  async function share() {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ demo: "1", date: String(state.selectedDateIndex), threshold: String(state.threshold), filter: state.vegFilter,
      mode: state.mapMode, ...(state.selectedPatch ? { patch: state.selectedPatch.id } : {}) }).toString();
    window.history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url.toString()); setShareURL(""); setMessage("Link copied. It restores the current demo settings on this hosted app."); }
    catch { setShareURL(url.toString()); setMessage("Copy this link to restore the current demo settings. Localhost links work only on this computer."); }
  }

  async function showRasterRun() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("source", "raster");
    window.history.replaceState(null, "", url);
    await state.fetchAllData();
  }

  function showInteractiveDemo() {
    const url = new URL(window.location.href);
    url.searchParams.delete("source");
    window.history.replaceState(null, "", url);
    state.resetDemo();
    setStep(null);
    setMessage("Interactive demo restored.");
  }

  function exportResults() {
    const visible = state.patches.filter((p) => state.vegFilter === "ALL" || p.classification === state.vegFilter);
    const date = state.pulseData?.dates[state.selectedDateIndex]?.date;
    const dataSource = state.pulseData?.data_source || (state.demoMode ? "SIMULATED_DEMO" : "UNVERIFIED");
    const isNisar = dataSource === "NISAR";
    const prefix = state.demoMode ? "beyonders-browser-simulation" : isNisar ? "beyonders-nisar-provisional" : "beyonders-raster-simulation";
    const name = `${prefix}-${date}-${state.threshold}dB`;
    if (exportType === "csv") downloadFile(`${name}.csv`, patchesCSV(visible, state.threshold, dataSource), "text/csv;charset=utf-8");
    else if (exportType === "geojson") {
      const geojson = state.demoMode ? patchesGeoJSON(visible, state.threshold) : {
        type: "FeatureCollection", run_id: state.pipelineRunId, threshold_db: state.threshold,
        data_source: dataSource, product: state.pulseData?.product,
        product_maturity: state.pulseData?.product_maturity, reference_validated: state.pulseData?.reference_validated,
        site_bounds: state.pulseData?.site_bounds, wetland_boundary_source: state.pulseData?.wetland_boundary_source,
        features: visible.map(({ geometry, ...properties }) => ({
          type: "Feature", geometry: geometry ?? null, properties,
        })),
      };
      downloadFile(`${name}.geojson`, JSON.stringify(geojson, null, 2), "application/geo+json");
    } else downloadFile(`${name}.json`, JSON.stringify({ ...(state.demoMode ? { demo_version: DEMO_VERSION } : {}),
      notice: state.demoMode ? DEMO_NOTICE : isNisar
        ? "Real NISAR L2 GCOV provisional observations. Wetland detections are algorithmic candidates and have not been independently reference-validated."
        : "Pipeline source is unverified.",
      settings: { date, threshold_db: state.threshold, filter: state.vegFilter, map_mode: state.mapMode },
      regions: visible, selected_evidence: state.selectedPatch, pulse: state.pulseData, sensitivity: state.sensitivityData,
      run_id: state.pipelineRunId,
      baseline_regions: state.demoMode ? demoPatches(0, state.threshold).filter((p) => state.vegFilter === "ALL" || p.classification === state.vegFilter) : [],
      export_scope: state.demoMode ? "Current browser simulation date and selected class filter; baseline regions included separately." : "Current pipeline observation date and selected class filter. No baseline classification is included.",
      limitations: state.demoMode
        ? ["No accuracy estimate or ground truth is available.", "Map geometry and quality inputs are illustrative.", "Vegetated inundation is a hypothesis requiring validation."]
        : isNisar
          ? ["NISAR product maturity is provisional.", "The detector output has no independent reference validation or accuracy estimate.", "The haor boundary is a reference study mask; its extent is approximate.", "Vegetated inundation is a hypothesis requiring field or reference validation."]
          : ["Pipeline source is unverified.", "No independent accuracy estimate or ground truth is available."] }, null, 2), "application/json");
    setMessage(`Prepared ${exportType.toUpperCase()} for ${visible.length} visible regions. Check your browser downloads.${exportType === "snapshot" ? " The snapshot includes the full pulse and selected-region sensitivity." : ""}`);
  }

  const observation = state.pulseData?.dates[state.selectedDateIndex];
  const visible = state.patches.filter((p) => state.vegFilter === "ALL" || p.classification === state.vegFilter);
  const area = visible.reduce((sum, p) => sum + p.area_km2, 0);
  return (
    <section className="demo-experience" aria-label="Wetland data workspace" aria-busy={state.isLoadingData}>
      <div className="demo-toolbar">
        <div className="demo-source-summary">
          <strong className="demo-label">{state.demoMode ? "BROWSER SIMULATION" : state.pulseData?.data_source === "NISAR" ? "REAL NISAR DATA · PROVISIONAL" : "RASTER PIPELINE · SIMULATED"}</strong>
          <p>{state.demoMode
          ? "Explore a sample wetland story. Its measurements are fictional. Load the latest pipeline results to see the generated raster output."
            : state.pulseData?.data_source === "NISAR"
              ? `HH/HV change candidates from ${state.pulseData.product || "NISAR GCOV"}. The product is provisional, and detections are not independently validated. ${state.pulseData.wetland_boundary_source ? `Study boundary: ${state.pulseData.wetland_boundary_source}.` : ""}`
              : "This run uses generated HH/HV raster inputs. Its mapped regions and measurements are simulated."}</p>
          {!state.demoMode && <small>Run {state.pipelineRunId?.slice(0, 8)} · {state.pulseData?.dates.length ?? 0} observations · baseline {state.pulseData?.baseline_date || "unknown"}</small>}
        </div>
        <div className="demo-actions">
          <button onClick={() => void showRasterRun()} disabled={state.isLoadingData} aria-pressed={!state.demoMode}>
            {state.isLoadingData ? "Loading results…" : state.pipelineRunId ? "Refresh results" : "Load latest results"}
          </button>
          <button onClick={showInteractiveDemo} disabled={state.demoMode}>
            Try sample demo
          </button>
          {state.demoMode && <>
            <button onClick={() => step === null ? applyStep(0) : setStep(null)} aria-expanded={step !== null}>{step === null ? "Guided tour" : "Close tour"}</button>
          <button onClick={() => { showInteractiveDemo(); setMessage("Demo reset to peak at 2 dB."); }}>Reset</button>
          <button onClick={share}>Share this view</button>
          </>}
          <select aria-label="Choose an export format" value={exportType} onChange={(e) => setExportType(e.target.value)}><option value="snapshot">Summary snapshot · JSON</option><option value="csv">Region table · CSV</option><option value="geojson">Region map · GeoJSON</option></select>
          <button onClick={exportResults}>Export file</button>
        </div>
      </div>
      <div className="demo-stats" aria-label="Current wetland results" aria-live="polite">
        <span><strong>{area.toFixed(2)} km²</strong> candidate area shown</span>
        <span><strong>{visible.length}</strong> regions shown</span>
        <span><strong>{state.threshold.toFixed(1)} dB</strong> change threshold</span>
        <span><strong>{observation?.date}</strong> {state.demoMode ? "simulated date" : "observation date"}</span>
      </div>
      {step !== null && <div className="demo-tour">
        <div><strong>{STEPS[step].title}</strong><p>{STEPS[step].text}</p><small>Tour presets can be explored freely. Reapply a step to restore its settings.</small></div>
        <div className="demo-actions"><button disabled={step === 0} onClick={() => applyStep(step - 1)}>Previous</button><button onClick={() => applyStep(step)}>Reapply step</button><button disabled={step === STEPS.length - 1} onClick={() => applyStep(step + 1)}>Next</button></div>
      </div>}
      <p role="status" className={`demo-feedback${state.dataError ? " demo-feedback--error" : ""}`}>
        {state.dataError || (state.isLoadingData ? "Loading pulse, regions and sensitivity from the completed raster run…" : message)}
      </p>
      {shareURL && <input aria-label="Shareable demo view link" readOnly value={shareURL} onFocus={(e) => e.target.select()} className="demo-share" />}
    </section>
  );
}
