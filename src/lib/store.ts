/* ──────────────────────────────────────────────────────
   Beyonders Wetland Module — Zustand Store
   ────────────────────────────────────────────────────── */

import { create } from "zustand";
import { buildDemo, normalizeDateIndex, normalizeThreshold } from "./demo-engine";
import type {
  InundationClass,
  ProbeResult,
  SensitivityData,
  SiteBoundary,
  WetlandPatch,
  WetlandPulseData,
} from "./types";

export type MapMode = "BEFORE" | "AFTER" | "DIFFERENCE" | "SPLIT";

interface WetlandStore {
  demoMode: boolean;
  pipelineRunId: string | null;
  satelliteBasemap: boolean;
  setSatelliteBasemap: (active: boolean) => void;
  resetDemo: () => void;
  /* ── Date / Time ──────────────────────────────────── */
  selectedDateIndex: number;
  setSelectedDateIndex: (i: number) => void;

  /* ── Patch selection ──────────────────────────────── */
  selectedPatch: WetlandPatch | null;
  setSelectedPatch: (p: WetlandPatch | null) => void;

  /* ── Map mode ─────────────────────────────────────── */
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;

  /* ── Veg filter ───────────────────────────────────── */
  vegFilter: InundationClass | "ALL";
  setVegFilter: (v: InundationClass | "ALL") => void;

  /* ── Threshold ────────────────────────────────────── */
  threshold: number;
  setThreshold: (t: number) => void;

  /* ── SAR Probe ────────────────────────────────────── */
  probeActive: boolean;
  setProbeActive: (a: boolean) => void;
  probeResult: ProbeResult | null;
  setProbeResult: (r: ProbeResult | null) => void;

  /* ── Animation ────────────────────────────────────── */
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;
  /* ── Dynamic Data ─────────────────────────────────── */
  patches: WetlandPatch[];
  pulseData: WetlandPulseData | null;
  sensitivityData: SensitivityData | null;
  siteBoundary: SiteBoundary | null;
  isLoadingData: boolean;
  dataError: string | null;
  fetchAllData: () => Promise<void>;
}

let pipelineRequestSequence = 0;

async function loadPatches(date: string, expectedRunId: string): Promise<WetlandPatch[]> {
  const response = await fetch(`/api/wetland/patches?date=${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error("Pipeline regions could not be loaded for this date.");
  if (response.headers.get("x-pipeline-run-id") !== expectedRunId) {
    throw new Error("The pipeline run changed while loading dates. Reload the raster run.");
  }
  const patches = await response.json() as WetlandPatch[];
  if (!Array.isArray(patches) || patches.some((patch) => patch.run_id !== expectedRunId || patch.date !== date)) {
    throw new Error("Pipeline regions do not match the selected run and date.");
  }
  return patches;
}

export const useWetlandStore = create<WetlandStore>((set, get) => ({
  demoMode: true,
  pipelineRunId: null,
  satelliteBasemap: false,
  setSatelliteBasemap: (satelliteBasemap) => set({ satelliteBasemap }),
  resetDemo: () => {
    pipelineRequestSequence++;
    set({ ...buildDemo(), demoMode: true, pipelineRunId: null, selectedDateIndex: 3, threshold: 2,
      selectedPatch: null, vegFilter: "ALL", mapMode: "DIFFERENCE", probeResult: null, probeActive: false,
      isPlaying: false, satelliteBasemap: false, siteBoundary: null, dataError: null, isLoadingData: false });
  },
  selectedDateIndex: 3, // start at peak
  setSelectedDateIndex: (i) => {
    const state = get();
    if (!state.demoMode) {
      const dates = state.pulseData?.dates ?? [];
      const selectedDateIndex = Math.max(0, Math.min(dates.length - 1, Math.trunc(Number.isFinite(i) ? i : 0)));
      const date = dates[selectedDateIndex]?.date;
      if (!date || !state.pipelineRunId) return;
      const requestId = ++pipelineRequestSequence;
      const runId = state.pipelineRunId;
      set({ selectedDateIndex, selectedPatch: null, probeResult: null, isLoadingData: true, dataError: null });
      void loadPatches(date, runId).then((patches) => {
        if (requestId !== pipelineRequestSequence || useWetlandStore.getState().pipelineRunId !== runId) return;
        set({ patches, isLoadingData: false });
      }).catch((error: unknown) => {
        if (requestId !== pipelineRequestSequence) return;
        set({ isLoadingData: false, dataError: error instanceof Error ? error.message : "Could not load date regions." });
      });
      return;
    }
    const selectedDateIndex = normalizeDateIndex(i);
    const data = buildDemo(selectedDateIndex, state.threshold, state.selectedPatch?.id);
    const selectedPatch = data.patches.find((p) => p.id === state.selectedPatch?.id) ?? null;
    set({ ...data, selectedDateIndex, selectedPatch, probeResult: null,
      sensitivityData: selectedPatch ? data.sensitivityData : buildDemo(selectedDateIndex, state.threshold).sensitivityData });
  },

  selectedPatch: null,
  setSelectedPatch: (p) => set({ selectedPatch: p,
    ...(get().demoMode ? { sensitivityData: buildDemo(get().selectedDateIndex, get().threshold, p?.id).sensitivityData } : {}) }),

  mapMode: "DIFFERENCE",
  setMapMode: (m) => set({ mapMode: m, probeResult: null }),

  vegFilter: "ALL",
  setVegFilter: (v) => {
    const selected = get().selectedPatch;
    if (selected && v !== "ALL" && selected.classification !== v) get().setSelectedPatch(null);
    set({ vegFilter: v });
  },

  threshold: 2.0,
  setThreshold: (t) => {
    const state = get();
    const threshold = normalizeThreshold(t);
    if (!state.demoMode) return;
    const data = buildDemo(state.selectedDateIndex, threshold, state.selectedPatch?.id);
    const selectedPatch = data.patches.find((p) => p.id === state.selectedPatch?.id) ?? null;
    set({ ...data, threshold, selectedPatch, probeResult: null,
      sensitivityData: selectedPatch ? data.sensitivityData : buildDemo(state.selectedDateIndex, threshold).sensitivityData });
  },

  probeActive: false,
  setProbeActive: (a) => set({ probeActive: a }),
  probeResult: null,
  setProbeResult: (r) => set({ probeResult: r }),

  isPlaying: false,
  setIsPlaying: (p) => set({ isPlaying: p }),

  ...buildDemo(),
  siteBoundary: null,
  isLoadingData: false,
  dataError: null,
  fetchAllData: async () => {
    const requestId = ++pipelineRequestSequence;
    set({ isLoadingData: true, dataError: null });
    try {
      const [patchesRes, pulseRes, sensRes] = await Promise.all([
        fetch("/api/wetland/patches"),
        fetch("/api/wetland/pulse"),
        fetch("/api/wetland/sensitivity")
      ]);
      
      if (![patchesRes, pulseRes, sensRes].every((response) => response.ok)) {
        throw new Error("Pipeline outputs are unavailable. The existing demo remains available.");
      }
      const patches = await patchesRes.json();
      const pulseData = await pulseRes.json();
      const sensitivityData = await sensRes.json();
      if (requestId !== pipelineRequestSequence) return;
      const runId = pulseData.run_id as string | undefined;
      let siteBoundary: SiteBoundary | null = null;
      if (pulseData.data_source === "NISAR") {
        const boundaryResponse = await fetch("/api/wetland/boundary");
        if (!boundaryResponse.ok) throw new Error("The real-data run is missing its wetland boundary file.");
        if (!runId || boundaryResponse.headers.get("x-pipeline-run-id") !== runId) {
          throw new Error("The pipeline run changed while loading its wetland boundary. Retry the request.");
        }
        siteBoundary = await boundaryResponse.json() as SiteBoundary;
        if (siteBoundary.type !== "FeatureCollection" || !Array.isArray(siteBoundary.features) || !siteBoundary.features.length ||
            siteBoundary.features.some((feature) => !feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type))) {
          throw new Error("The real-data wetland boundary is invalid.");
        }
      }
      if (requestId !== pipelineRequestSequence) return;
      if (!Array.isArray(patches) || !Array.isArray(pulseData.dates) || !pulseData.dates.length ||
          !Array.isArray(sensitivityData.thresholds) || !runId || pulseData.run_id !== sensitivityData.run_id ||
          patchesRes.headers.get("x-pipeline-run-id") !== runId ||
          patches.some((p) => p.run_id !== pulseData.run_id || p.date !== pulseData.peak.date)) {
        throw new Error("Pipeline outputs are inconsistent or changed during loading. Retry the request.");
      }
      if (!patches.every((patch: WetlandPatch) => patch.geometry && ["Polygon", "MultiPolygon"].includes(patch.geometry.type))) {
        throw new Error("The pipeline run does not include mapped region geometry. Regenerate the selected pipeline run.");
      }
      set({ patches, pulseData, sensitivityData, siteBoundary, demoMode: false, pipelineRunId: runId, selectedPatch: null, probeResult: null, isPlaying: false, isLoadingData: false,
        selectedDateIndex: Math.max(0, pulseData.dates.findIndex((d: { date: string }) => d.date === pulseData.peak.date)),
        threshold: normalizeThreshold(Number(sensitivityData.base_threshold_db)),
        mapMode: get().mapMode === "BEFORE" || get().mapMode === "SPLIT" ? "AFTER" : get().mapMode });
    } catch (e) {
      if (requestId !== pipelineRequestSequence) return;
      console.error(e);
      set({ isLoadingData: false, dataError: e instanceof Error ? e.message : "Pipeline loading failed." });
    }
  },
}));
