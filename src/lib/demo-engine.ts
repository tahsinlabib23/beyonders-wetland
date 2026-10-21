import { SAMPLE_PATCHES } from "./mock-data";
import type { ProbeResult, SensitivityData, WetlandPatch, WetlandPulseData } from "./types";

export const DEMO_NOTICE = "SIMULATED DEMO — fictional dates, signals, geometry and evidence verdicts. No satellite observations or field validation are used.";
export const DEMO_VERSION = "wetland-demo-v1";
// Deliberately separate from the archive timeline, including its known data gap.
export const DEMO_DATES = ["2025-06-01", "2025-06-13", "2025-06-25", "2025-07-07", "2025-07-19", "2025-07-31", "2025-08-12", "2025-08-24"];
const HYDROGRAPH = [0.28, 0.45, 0.72, 1, 0.88, 0.58, 0.36, 0.22];
const round = (n: number) => Math.round(n * 10000) / 10000;
export const normalizeDateIndex = (i: number) => Number.isFinite(i) ? Math.max(0, Math.min(DEMO_DATES.length - 1, Math.trunc(i))) : 3;
export const normalizeThreshold = (t: number) => Number.isFinite(t) ? Math.round(Math.max(0.5, Math.min(5, t)) * 2) / 2 : 2;

/** Twenty equal-area response bands per fictional region; a stricter cutoff
 * removes weak bands. This is an illustrative detector, not a NISAR algorithm. */
export function demoPatches(dateIndex: number, threshold: number): WetlandPatch[] {
  const index = normalizeDateIndex(dateIndex);
  const cutoff = normalizeThreshold(threshold);
  const extent = HYDROGRAPH[index];
  return SAMPLE_PATCHES.flatMap((seed, region) => {
    const amplitudes = Array.from({ length: 20 }, (_, band) =>
      Math.abs(seed.delta_hh) * (0.28 + extent * 0.72) * (0.35 + band / 19 * 0.9));
    const detected = amplitudes.filter((value) => value >= cutoff);
    if (!detected.length) return [];
    const direction = Math.sign(seed.delta_hh);
    const mean = direction * detected.reduce((sum, v) => sum + v, 0) / detected.length;
    const middle = detected.length / 2;
    const median = direction * (detected[Math.floor(middle)] + detected[Math.ceil(middle) - 1]) / 2;
    const retained = (t: number) => amplitudes.filter((v) => v >= t).length;
    const low = retained(Math.max(0.5, cutoff - 0.5));
    const high = retained(Math.min(5, cutoff + 0.5));
    const stable = low > 0 && (low - high) / low <= 0.2;
    const uncertain = seed.classification === "UNCERTAIN";
    const deltaHV = round(seed.delta_hv * (0.28 + extent * 0.72));
    return [{ ...seed, date: DEMO_DATES[index], data_source: "SIMULATED_DEMO" as const,
      centroid: [24.64 - Math.floor(region / 4) * 0.045, 91.97 + region % 4 * 0.045] as [number, number],
      area_km2: round(seed.area_km2 * extent * detected.length / 20),
      mean_delta_db: round(mean), median_delta_db: round(median),
      delta_hh: round(mean), hh_after: round(seed.hh_before + mean),
      delta_hv: deltaHV, hv_after: round(seed.hv_before + deltaHV),
      threshold_stability: stable ? "STABLE" as const : "SENSITIVE" as const,
      evidence_state: uncertain ? "UNCERTAIN" as const : stable && seed.valid_fraction >= 0.9 ? "SUPPORTED" as const : "MODERATE" as const,
    }];
  });
}

export function buildDemo(dateIndex = 3, threshold = 2, patchId?: string) {
  const index = normalizeDateIndex(dateIndex);
  const cutoff = normalizeThreshold(threshold);
  const patches = demoPatches(index, cutoff);
  const dates = DEMO_DATES.map((date, i) => {
    const candidates = demoPatches(i, cutoff);
    const area = round(candidates.reduce((sum, p) => sum + p.area_km2, 0));
    return { date, area_km2: area, fraction: round(area / 54), patches: candidates.length,
      mean_delta_db: area ? round(candidates.reduce((sum, p) => sum + p.mean_delta_db * p.area_km2, 0) / area) : 0 };
  });
  const peakIndex = dates.reduce((best, d, i) => d.area_km2 > dates[best].area_km2 ? i : best, 0);
  const pulseData: WetlandPulseData = { site: "Hakaluki Haor · fictional scenario", wetland_area_km2: 54,
    data_source: "SIMULATED_DEMO", dates, onset: dates[0].date,
    peak: { date: dates[peakIndex].date, area_km2: dates[peakIndex].area_km2 },
    recession_start: dates[Math.min(peakIndex + 1, dates.length - 1)].date };
  const thresholds = Array.from({ length: 10 }, (_, i) => {
    const delta = (i + 1) / 2;
    const candidates = demoPatches(index, delta).filter((p) => !patchId || p.id === patchId);
    return { delta_db: delta, area_km2: round(candidates.reduce((sum, p) => sum + p.area_km2, 0)), patches: candidates.length };
  });
  const lower = Math.max(0.5, cutoff - 0.5);
  const upper = Math.min(5, cutoff + 0.5);
  const a = thresholds.find((t) => t.delta_db === lower)!.area_km2;
  const b = thresholds.find((t) => t.delta_db === upper)!.area_km2;
  const stable = a > 0 && (a - b) / a <= 0.2;
  const sensitivityData: SensitivityData = { patch_id: patchId || "All demo regions", thresholds,
    stability_verdict: stable ? "STABLE" : "SENSITIVE", stable_range: [lower, upper], data_source: "SIMULATED_DEMO",
    sensitivity_note: `Simulated area changes by ${a ? ((a - b) / a * 100).toFixed(1) : "0"}% across ${lower}–${upper} dB. Stable means ≤20% change with nonzero area. This is a demonstration rule, not measured accuracy.` };
  return { patches, pulseData, sensitivityData };
}

/** Approximate equal-area octagon in local latitude/longitude coordinates.
 * Shared by the map, synthetic probe and GeoJSON export. */
export function patchPolygon(patch: WetlandPatch): [number, number][] {
  const [lat, lng] = patch.centroid;
  const radiusKm = Math.sqrt(patch.area_km2 / (4 * Math.sin(Math.PI / 4)));
  return Array.from({ length: 8 }, (_, i) => {
    const angle = 2 * Math.PI * i / 8;
    return [lat + radiusKm * Math.cos(angle) / 111.32,
      lng + radiusKm * Math.sin(angle) / (111.32 * Math.cos(lat * Math.PI / 180))];
  });
}

export function probeDemo(lat: number, lng: number, patches: WetlandPatch[], date: string): ProbeResult {
  const patch = patches.find((p) => {
    const polygon = patchPolygon(p);
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [yi, xi] = polygon[i];
      const [yj, xj] = polygon[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
  return { lat, lng, hh_before: patch?.hh_before ?? null, hh_after: patch?.hh_after ?? null,
    hv_before: patch?.hv_before ?? null, hv_after: patch?.hv_after ?? null,
    delta_hh: patch?.delta_hh ?? null, delta_hv: patch?.delta_hv ?? null,
    valid: !!patch, acquisition_date: date, classification: patch?.classification ?? "UNCERTAIN",
    land_cover: patch ? `Fictional region ${patch.id.split("_").pop()} · region-average signals` : "Outside demo regions · no simulated signal",
    data_source: "SIMULATED" };
}
