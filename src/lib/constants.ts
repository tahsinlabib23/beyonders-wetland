/* ──────────────────────────────────────────────────────
   Beyonders Wetland Module — Constants & Configuration
   ────────────────────────────────────────────────────── */

/* ── Color Tokens ──────────────────────────────────── */

export const COLORS = {
  // Inundation classification
  openWater: "#3b82f6",
  vegetated: "#22c55e",
  uncertain: "#eab308",

  // Evidence / status
  pass: "#10b981",
  partial: "#f59e0b",
  fail: "#ef4444",
  supported: "#10b981",
  moderate: "#f59e0b",
  uncertain_status: "#6366f1",
  rejected: "#ef4444",

  // Stability
  stable: "#10b981",
  sensitive: "#ef4444",

  // Chart
  pulseArea: "#00d4ff",
  pulseLine: "#22d3ee",
  pulseGradientStart: "rgba(0, 212, 255, 0.3)",
  pulseGradientEnd: "rgba(0, 212, 255, 0.0)",

  // Map layers
  beforeLayer: "#6366f1",
  afterLayer: "#f59e0b",
  differencePositive: "#ef4444",
  differenceNegative: "#3b82f6",
} as const;

/* ── Map Config ────────────────────────────────────── */

export const MAP_CONFIG = {
  // Default center: Hakaluki Haor, Bangladesh
  center: [24.64, 92.05] as [number, number],
  zoom: 11,
  minZoom: 5,
  maxZoom: 18,
  tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  tileAttribution: "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA",
} as const;

/* ── Threshold Defaults ────────────────────────────── */

export const THRESHOLD_CONFIG = {
  min: 0.5,
  max: 5.0,
  step: 0.5,
  default: 2.0,
} as const;

/* ── Status Mappings ───────────────────────────────── */

export const STATUS_ICONS: Record<string, string> = {
  PASS: "✓",
  FAIL: "✕",
  PARTIAL: "◐",
  SUPPORTED: "◉",
  MODERATE: "◐",
  UNCERTAIN: "?",
  REJECTED: "✕",
  STABLE: "▬",
  SENSITIVE: "⚡",
};

export const STATUS_COLORS: Record<string, string> = {
  PASS: COLORS.pass,
  FAIL: COLORS.fail,
  PARTIAL: COLORS.partial,
  SUPPORTED: COLORS.supported,
  MODERATE: COLORS.moderate,
  UNCERTAIN: COLORS.uncertain_status,
  REJECTED: COLORS.rejected,
  STABLE: COLORS.stable,
  SENSITIVE: COLORS.sensitive,
};

/* ── Data Provenance Label Colors ──────────────────── */

export const LABEL_COLORS: Record<string, string> = {
  OBSERVED: "#00d4ff",
  DERIVED: "#a78bfa",
  CONTEXTUAL: "#f59e0b",
  POTENTIAL: "#f472b6",
};

/* ── Animation ─────────────────────────────────────── */

export const ANIMATION = {
  playIntervalMs: 1500,
} as const;
