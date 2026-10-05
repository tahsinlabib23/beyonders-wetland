/* ──────────────────────────────────────────────────────
   Beyonders Wetland Module — Core Type Definitions
   ────────────────────────────────────────────────────── */

/** Status verdicts used throughout the forensics engine */
export type EvidenceState = "SUPPORTED" | "MODERATE" | "UNCERTAIN" | "REJECTED";
export type QualityStatus = "PASS" | "FAIL" | "PARTIAL";
export type StabilityVerdict = "STABLE" | "SENSITIVE";
export type InundationClass = "OPEN_WATER" | "VEGETATED_INUNDATION" | "UNCERTAIN";
export type WetlandGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** Data-provenance labels (§29 of handoff) */
export type DataLabel = "OBSERVED" | "DERIVED" | "CONTEXTUAL" | "POTENTIAL";

/* ── Wetland Pulse ─────────────────────────────────── */

export interface PulseObservation {
  date: string;
  area_km2: number;
  fraction: number;
  mean_delta_db: number;
  patches: number;
}

export interface WetlandPulseData {
  site: string;
  wetland_area_km2: number;
  data_source?: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
  product?: string;
  product_maturity?: "PROVISIONAL" | "SIMULATED" | string;
  /** Cross-sensor agreement check only; not field/ground-truth validation. */
  cross_sensor_check_completed?: boolean;
  reference_check_status?: string;
  reference_validated?: boolean;
  baseline_date?: string;
  quality_mask_method?: string | null;
  /** [west, south, east, north] in WGS84 */
  site_bounds?: [number, number, number, number] | null;
  wetland_boundary_source?: string | null;
  dates: PulseObservation[];
  onset: string | null;
  peak: { date: string; area_km2: number };
  recession_start: string | null;
}

export interface SiteBoundary {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: WetlandGeometry;
    properties: Record<string, unknown>;
  }>;
}

/* ── Wetland Patch / Region ────────────────────────── */

export interface WetlandPatch {
  id: string;
  date: string;
  area_km2: number;
  mean_delta_db: number;
  median_delta_db: number;
  valid_fraction: number;
  vegetated_fraction: number;
  classification: InundationClass;
  interpretation_label?: string;
  quality_status: QualityStatus;
  spatial_status: QualityStatus;
  temporal_status: QualityStatus;
  threshold_stability: StabilityVerdict;
  evidence_state: EvidenceState;
  hh_before: number;
  hh_after: number;
  hv_before: number;
  hv_after: number;
  delta_hh: number;
  delta_hv: number;
  centroid: [number, number]; // [lat, lng]
  geometry?: WetlandGeometry;
  run_id?: string;
  data_source?: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
}

/* ── Threshold Sensitivity (Counterfactual Lab) ───── */

export interface ThresholdPoint {
  delta_db: number;
  area_km2: number;
  patches: number;
}

export interface SensitivityData {
  patch_id: string;
  thresholds: ThresholdPoint[];
  stability_verdict: StabilityVerdict;
  stable_range: [number, number];
  sensitivity_note: string;
  data_source?: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
}

/* ── SAR Probe ─────────────────────────────────────── */

export interface ProbeResult {
  lat: number;
  lng: number;
  hh_before: number | null;
  hh_after: number | null;
  hv_before: number | null;
  hv_after: number | null;
  delta_hh: number | null;
  delta_hv: number | null;
  valid: boolean;
  acquisition_date: string;
  land_cover: string;
  classification: InundationClass;
  data_source?: "SIMULATED" | "NISAR" | "UNVERIFIED";
  run_id?: string;
}

/* ── Evidence Card ─────────────────────────────────── */

export interface EvidenceCardData {
  region_id: string;
  region_name: string;
  date: string;
  candidate_area_km2: number;
  valid_fraction: number;
  quality: QualityStatus;
  spatial_consistency: QualityStatus;
  temporal_evidence: QualityStatus;
  threshold_stability: StabilityVerdict;
  vegetated_signal: "POTENTIAL" | "NONE" | "STRONG";
  evidence_strength: EvidenceState;
  data_source?: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
  provenance: {
    observed: string[];
    derived: string[];
    contextual: string[];
    potential: string[];
  };
}

/* ── Scene Inventory ───────────────────────────────── */

export interface SceneInfo {
  filename: string;
  date: string;
  orbit_direction: "ascending" | "descending";
  track: number;
  frequency: string;
  polarizations: string[];
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

/* ── App State ─────────────────────────────────────── */

export interface AppState {
  /** Currently selected observation date index */
  selectedDateIndex: number;
  /** Currently selected patch (or null) */
  selectedPatch: WetlandPatch | null;
  /** Active map mode */
  mapMode: "BEFORE" | "AFTER" | "DIFFERENCE";
  /** Active vegetation filter */
  vegFilter: InundationClass | "ALL";
  /** Counterfactual threshold (dB) */
  threshold: number;
  /** Whether the SAR probe is active */
  probeActive: boolean;
  /** Latest probe result */
  probeResult: ProbeResult | null;
  /** Whether animation is playing */
  isPlaying: boolean;
}
