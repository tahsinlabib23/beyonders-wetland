import assert from "node:assert/strict";
import test from "node:test";
import {
  forestCandidateCsv,
  forestCandidateGeoJson,
  forestReadinessLabel,
  forestReadinessTone,
  parseForestAnalysis,
  type ForestAnalysisDocument,
} from "./forest-analysis.ts";

function analysisFixture(): ForestAnalysisDocument {
  return {
    schemaVersion: 1,
    methodVersion: "forest-gcov-anomaly-v1",
    dataSource: "NISAR",
    resultType: "potential forest structural disturbance candidates",
    createdAt: "2026-10-12T10:00:00.000Z",
    runId: "run-001",
    site: { name: "Reference forest", bounds: [90, 20, 91, 21] },
    product: "NISAR_L2_GCOV_PROVISIONAL_V1",
    productMaturity: "PROVISIONAL",
    readiness: { status: "READY", summary: "Ready for inspection.", checks: [
      { id: "compatible_series", label: "Compatible series", status: "PASS", message: "Signature matched." },
    ] },
    method: { thresholdDb: 2.5, minimumRegionPixels: 20 },
    observations: [{ date: "2026-07-01", sceneId: "scene-1", validCoverageFraction: 0.95,
      medianHhDb: -10.2, medianHvDb: -16.1, used: true, reason: null }],
    candidates: [{
      id: "F-20260701-0001", date: "2026-07-01", sceneId: "scene-1", areaKm2: 0.32, pixelCount: 800,
      geometry: { type: "Polygon", coordinates: [[[90.1, 20.1], [90.2, 20.1], [90.2, 20.2], [90.1, 20.1]]] },
      detectedDates: ["2026-07-01"], persistence: "SINGLE_OBSERVATION",
      evidence: { medianHhChangeDb: -3.1, medianHvChangeDb: -2.8, medianAbsoluteHhChangeDb: 3.1,
        medianAbsoluteHvChangeDb: 2.8, validCoverageFraction: 0.95, thresholdDb: 2.5, stricterThresholdRetainedFraction: 0.4 },
      assessment: { state: "POTENTIAL_STRUCTURAL_DISTURBANCE", reasons: ["Observed departure."], alternatives: [],
        opticalEvidence: { status: "NOT_PROVIDED", summary: "No independent optical evidence." }, cause: "UNKNOWN" },
    }],
    limitations: ["Exploratory screening only."],
  };
}

test("parses valid NISAR forest analysis payload", () => {
  assert.equal(parseForestAnalysis(analysisFixture())?.runId, "run-001");
});

test("rejects wrong source and malformed observation records", () => {
  const wrongSource = { ...analysisFixture(), dataSource: "SIMULATED" };
  assert.equal(parseForestAnalysis(wrongSource), null);
  const malformed = analysisFixture() as unknown as Record<string, unknown>;
  malformed.observations = [{ date: "not-a-date", sceneId: "x" }];
  assert.equal(parseForestAnalysis(malformed), null);
  const impossibleDate = analysisFixture() as unknown as Record<string, unknown>;
  impossibleDate.observations = [{ ...analysisFixture().observations[0], date: "2026-02-31" }];
  assert.equal(parseForestAnalysis(impossibleDate), null);
  const brokenAudit = analysisFixture() as unknown as Record<string, unknown>;
  brokenAudit.candidates = [{ ...analysisFixture().candidates[0], assessment: { cause: "LOGGING" } }];
  assert.equal(parseForestAnalysis(brokenAudit), null);
  const badGeometry = analysisFixture() as unknown as Record<string, unknown>;
  badGeometry.candidates = [{ ...analysisFixture().candidates[0], geometry: { type: "Polygon", coordinates: "not coordinates" } }];
  assert.equal(parseForestAnalysis(badGeometry), null);
});

test("readiness labels distinguish blocked and limited data", () => {
  assert.equal(forestReadinessLabel("READY"), "Ready to inspect");
  assert.equal(forestReadinessTone("LIMITED"), "warning");
  assert.equal(forestReadinessTone("BLOCKED"), "bad");
});

test("candidate GeoJSON excludes candidates without valid geometry and labels uncertainty", () => {
  const data = analysisFixture();
  data.candidates.push({ ...data.candidates[0], id: "no-geometry", geometry: null });
  data.candidates.push({ ...data.candidates[0], id: "bad-geometry", geometry: { type: "Polygon", coordinates: "invalid" } });
  const geojson = forestCandidateGeoJson(data);
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].properties.cause, "UNKNOWN");
});

test("CSV exports measurements and explicit optical evidence status", () => {
  const csv = forestCandidateCsv(analysisFixture());
  assert.match(csv, /median_hh_change_db/);
  assert.match(csv, /NOT_PROVIDED/);
  assert.match(csv, /UNKNOWN/);
});
