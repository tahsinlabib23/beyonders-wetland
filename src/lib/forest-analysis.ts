export type ForestReadinessStatus = "READY" | "LIMITED" | "BLOCKED";
export type ForestCheckStatus = "PASS" | "PARTIAL" | "FAIL" | "INFO";

export interface ForestCheck {
  id: string;
  label: string;
  status: ForestCheckStatus;
  message: string;
}

export interface ForestObservation {
  date: string;
  sceneId: string;
  validCoverageFraction: number;
  medianHhDb: number | null;
  medianHvDb: number | null;
  used: boolean;
  reason: string | null;
}

export interface ForestSceneStat {
  date: string;
  medianHhChangeDb: number | null;
  medianHvChangeDb: number | null;
  candidatePixelCount: number;
  validCoverageFraction: number;
}

export interface ForestAlternative {
  name: string;
  status: "UNASSESSED" | "SCREENED" | "SUPPORTED" | "CONFLICTING";
  note: string;
}

export interface ForestCandidate {
  id: string;
  date: string;
  sceneId: string;
  areaKm2: number;
  pixelCount: number;
  geometry: unknown;
  detectedDates: string[];
  persistence: "SINGLE_OBSERVATION" | "RECURRING" | "PERSISTENT";
  evidence: {
    medianHhChangeDb: number;
    medianHvChangeDb: number;
    medianAbsoluteHhChangeDb: number;
    medianAbsoluteHvChangeDb: number;
    validCoverageFraction: number;
    thresholdDb: number;
    stricterThresholdRetainedFraction: number;
  };
  assessment: {
    state: "POTENTIAL_STRUCTURAL_DISTURBANCE";
    reasons: string[];
    alternatives: ForestAlternative[];
    opticalEvidence: { status: string; summary: string };
    cause: "UNKNOWN";
  };
}

export interface ForestProvenanceScene {
  date: string;
  granuleId: string;
}

export interface ForestAnalysisProvenance {
  workflowVersion?: string;
  createdAt?: string;
  siteName?: string;
  bboxWgs84WestSouthEastNorth?: [number, number, number, number];
  dateRange?: { start?: string; end?: string };
  catalog?: {
    source?: string;
    product?: string;
    maturity?: string;
    catalogHits?: number;
    selectedScenes?: ForestProvenanceScene[];
  };
  forestMask?: {
    dataset?: string;
    sourceUrl?: string;
    attribution?: string;
    classes?: number[];
    forestPixelCount?: number;
    forestPixelFractionOfGrid?: number;
    tileSources?: Array<{ tile?: string; sourceUrl?: string; accessMode?: string }>;
    limitations?: string;
  };
  detectorSettings?: {
    thresholdDb?: number;
    robustMultiplier?: number;
    minimumRegionPixels?: number;
    minimumValidFraction?: number;
  };
  independentOpticalContext?: {
    source?: string;
    sourceUrl?: string;
    status?: string;
    referenceValidated?: boolean;
    dates?: Array<Record<string, unknown>>;
  };
  radarQuicklooks?: {
    status?: string;
    source?: string;
    count?: number;
    requestedCount?: number;
    dates?: string[];
    channels?: string[];
    message?: string;
  };
  cautions?: string[];
}

export interface ForestAnalysisDocument {
  schemaVersion: 1;
  methodVersion: string;
  dataSource: "NISAR";
  resultType: "potential forest structural disturbance candidates";
  createdAt: string;
  runId: string;
  site: { name: string; bounds: [number, number, number, number] | null };
  product: string | null;
  productMaturity: string | null;
  compatibility?: Record<string, unknown>;
  readiness: { status: ForestReadinessStatus; summary: string; checks: ForestCheck[] };
  method: {
    name?: string;
    version?: string;
    thresholdDb: number | null;
    robustMultiplier?: number | null;
    minimumRegionPixels: number | null;
    minimumValidFraction?: number | null;
    inputsAreDb?: boolean;
    maskSource?: string;
    description?: string;
  };
  observations: ForestObservation[];
  sceneStats?: ForestSceneStat[];
  candidates: ForestCandidate[];
  limitations: string[];
  provenance?: ForestAnalysisProvenance;
  opticalEvidenceSummary?: Record<string, unknown>;
}

export type ForestApiPayload =
  | { status: "READY"; analysis: ForestAnalysisDocument; message: string | null }
  | { status: "NOT_RUN"; analysis: null; message: string }
  | { status: "INVALID"; analysis: null; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFraction(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isForestPolygonGeometry(value: unknown): value is { type: "Polygon" | "MultiPolygon"; coordinates: unknown } {
  if (!isRecord(value) || (value.type !== "Polygon" && value.type !== "MultiPolygon") || !Array.isArray(value.coordinates)) return false;
  const isPosition = (node: unknown): node is number[] => Array.isArray(node) && node.length >= 2 && node.every(isFiniteNumber);
  const isRing = (node: unknown): boolean => Array.isArray(node) && node.length >= 4 &&
    node.every(isPosition) && JSON.stringify(node[0]) === JSON.stringify(node[node.length - 1]);
  const isPolygon = (node: unknown): boolean => Array.isArray(node) && node.length > 0 && node.every(isRing);
  return value.type === "Polygon" ? isPolygon(value.coordinates) :
    value.coordinates.length > 0 && value.coordinates.every(isPolygon);
}

function isAlternative(value: unknown): value is ForestAlternative {
  return isRecord(value) && typeof value.name === "string" && typeof value.note === "string" &&
    ["UNASSESSED", "SCREENED", "SUPPORTED", "CONFLICTING"].includes(String(value.status));
}

function isCandidateEvidence(value: unknown): value is ForestCandidate["evidence"] {
  return isRecord(value) && isFiniteNumber(value.medianHhChangeDb) && isFiniteNumber(value.medianHvChangeDb) &&
    isFiniteNumber(value.medianAbsoluteHhChangeDb) && isFiniteNumber(value.medianAbsoluteHvChangeDb) &&
    isFraction(value.validCoverageFraction) && isFiniteNumber(value.thresholdDb) && value.thresholdDb > 0 &&
    isFraction(value.stricterThresholdRetainedFraction);
}

function isCandidateAssessment(value: unknown): value is ForestCandidate["assessment"] {
  return isRecord(value) && value.state === "POTENTIAL_STRUCTURAL_DISTURBANCE" && value.cause === "UNKNOWN" &&
    isStringArray(value.reasons) && Array.isArray(value.alternatives) && value.alternatives.every(isAlternative) &&
    isRecord(value.opticalEvidence) && typeof value.opticalEvidence.status === "string" &&
    typeof value.opticalEvidence.summary === "string";
}

function isCheckStatus(value: unknown): value is ForestCheckStatus {
  return value === "PASS" || value === "PARTIAL" || value === "FAIL" || value === "INFO";
}

export function parseForestAnalysis(value: unknown): ForestAnalysisDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.dataSource !== "NISAR" ||
      value.resultType !== "potential forest structural disturbance candidates" ||
      typeof value.methodVersion !== "string" || typeof value.runId !== "string" ||
      !isRecord(value.site) || typeof value.site.name !== "string" ||
      !isRecord(value.readiness) || !["READY", "LIMITED", "BLOCKED"].includes(String(value.readiness.status)) ||
      typeof value.readiness.summary !== "string" || !Array.isArray(value.readiness.checks) ||
      !Array.isArray(value.observations) || !Array.isArray(value.candidates) || !Array.isArray(value.limitations)) {
    return null;
  }

  const checks = value.readiness.checks;
  if (!checks.every((check) => isRecord(check) && typeof check.id === "string" &&
    typeof check.label === "string" && isCheckStatus(check.status) && typeof check.message === "string")) return null;

  const observations = value.observations;
  if (!observations.every((item) => isRecord(item) && isIsoDate(item.date) && typeof item.sceneId === "string" &&
    isFraction(item.validCoverageFraction) && typeof item.used === "boolean" &&
    (item.reason === null || typeof item.reason === "string") &&
    (item.medianHhDb === null || isFiniteNumber(item.medianHhDb)) &&
    (item.medianHvDb === null || isFiniteNumber(item.medianHvDb)))) return null;

  const candidates = value.candidates;
  if (!candidates.every((candidate) => isRecord(candidate) && typeof candidate.id === "string" &&
    isIsoDate(candidate.date) && typeof candidate.sceneId === "string" &&
    typeof candidate.areaKm2 === "number" && Number.isFinite(candidate.areaKm2) && candidate.areaKm2 >= 0 &&
    typeof candidate.pixelCount === "number" && Number.isInteger(candidate.pixelCount) && candidate.pixelCount >= 0 &&
    Array.isArray(candidate.detectedDates) && candidate.detectedDates.every(isIsoDate) &&
    ["SINGLE_OBSERVATION", "RECURRING", "PERSISTENT"].includes(String(candidate.persistence)) &&
    isCandidateEvidence(candidate.evidence) && isCandidateAssessment(candidate.assessment) &&
    (candidate.geometry === null || isForestPolygonGeometry(candidate.geometry)))) return null;

  const bounds = value.site.bounds;
  const validBounds = bounds === null || (Array.isArray(bounds) && bounds.length === 4 &&
    bounds.every((part) => typeof part === "number" && Number.isFinite(part)) &&
    bounds[0] >= -180 && bounds[2] <= 180 && bounds[1] >= -90 && bounds[3] <= 90 &&
    bounds[0] <= bounds[2] && bounds[1] <= bounds[3]);
  if (!validBounds || typeof value.createdAt !== "string" || !value.method || !isRecord(value.method) ||
      !value.methodVersion || !value.limitations.every((item) => typeof item === "string")) return null;

  return value as unknown as ForestAnalysisDocument;
}

export function forestReadinessLabel(status: ForestReadinessStatus): string {
  if (status === "READY") return "Ready to inspect";
  if (status === "LIMITED") return "Limited evidence";
  return "Analysis blocked";
}

export function forestReadinessTone(status: ForestReadinessStatus): "good" | "warning" | "bad" {
  if (status === "READY") return "good";
  if (status === "LIMITED") return "warning";
  return "bad";
}

export function forestCandidateGeoJson(analysis: ForestAnalysisDocument, activeDate?: string | null) {
  const candidates = activeDate ? analysis.candidates.filter((candidate) => candidate.date === activeDate) : analysis.candidates;
  return {
    type: "FeatureCollection" as const,
    metadata: {
      runId: analysis.runId,
      siteName: analysis.site.name,
      dataSource: analysis.dataSource,
      product: analysis.product,
      productMaturity: analysis.productMaturity,
      methodVersion: analysis.methodVersion,
      readinessStatus: analysis.readiness.status,
      forestMaskSource: analysis.provenance?.forestMask?.sourceUrl ?? analysis.method.maskSource ?? null,
      independentOpticalStatus: analysis.provenance?.independentOpticalContext?.status ?? "NOT_RECORDED",
      referenceValidated: analysis.provenance?.independentOpticalContext?.referenceValidated ?? false,
      interpretation: "Potential structural backscatter anomalies, not confirmed forest loss.",
      limitations: analysis.limitations,
    },
    features: candidates.flatMap((candidate) => {
      if (!isForestPolygonGeometry(candidate.geometry)) return [];
      return [{
        type: "Feature" as const,
        geometry: candidate.geometry,
        properties: {
          id: candidate.id,
          date: candidate.date,
          persistence: candidate.persistence,
          areaKm2: candidate.areaKm2,
          cause: "UNKNOWN",
          interpretation: "Potential structural disturbance; not confirmed forest loss.",
        },
      }];
    }),
  };
}

function csvCell(value: unknown): string {
  const content = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${content.replaceAll('"', '""')}"`;
}

export function forestCandidateCsv(analysis: ForestAnalysisDocument): string {
  const fields = ["id", "date", "scene_id", "source_run_id", "site_name", "data_source", "product", "product_maturity",
    "area_km2", "pixel_count", "persistence", "detected_dates", "median_hh_change_db", "median_hv_change_db",
    "valid_coverage_fraction", "threshold_db", "optical_evidence", "cause"];
  const rows = analysis.candidates.map((candidate) => [candidate.id, candidate.date, candidate.sceneId, analysis.runId,
    analysis.site.name, analysis.dataSource, analysis.product, analysis.productMaturity, candidate.areaKm2,
    candidate.pixelCount, candidate.persistence, candidate.detectedDates.join(";"), candidate.evidence.medianHhChangeDb,
    candidate.evidence.medianHvChangeDb, candidate.evidence.validCoverageFraction, candidate.evidence.thresholdDb,
    candidate.assessment.opticalEvidence.status, "UNKNOWN"].map(csvCell).join(","));
  return [fields.map(csvCell).join(","), ...rows].join("\r\n");
}
