import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestigationReport, investigationReportCsv, investigationReportGeoJson, investigationReportHtml, buildInvestigationShareUrl } from "./investigation-report.ts";

const base = () => buildInvestigationReport({
  title: "Tanguar investigation", siteName: "Tanguar Haor", source: "NISAR_SHOWCASE", product: "NISAR_L2_GCOV_PROVISIONAL_V1", productMaturity: "PROVISIONAL",
  observationDates: ["2026-08-17", "2026-08-29"], selectedDate: "2026-08-29", regions: [{ id: "patch_1", date: "2026-08-29", classification: "OPEN_WATER", area_km2: 2.5, geometry: { type: "Polygon", coordinates: [] } }],
  limitations: ["Candidate change is not confirmed flooding."], generatedAt: "2026-10-11T00:00:00.000Z",
});

test("report summary derives metrics only from supplied real candidate records", () => {
  const report = base();
  assert.equal(report.dataSource, "NISAR");
  assert.equal(report.regionCount, 1);
  assert.equal(report.candidateAreaKm2, 2.5);
  assert.match(report.disclaimer, /not confirmed flooding/);
});

test("CSV has proper quoting and preserves scientific provenance columns", () => {
  const report = base();
  const csv = investigationReportCsv(report);
  assert.match(csv, /"run_id"/);
  assert.match(csv, /"NISAR_SHOWCASE"/);
  assert.match(csv, /"patch_1","2026-08-29","OPEN_WATER","2.5"/);
});

test("GeoJSON report retains geometry and metadata without inventing geometries", () => {
  const geo = investigationReportGeoJson(base());
  assert.equal(geo.type, "FeatureCollection");
  assert.equal(geo.features.length, 1);
  assert.equal(geo.features[0].properties.id, "patch_1");
  assert.equal(geo.metadata.dataSource, "NISAR");
});

test("printable report escapes untrusted names and includes PDF print action", () => {
  const report = buildInvestigationReport({ ...base(), siteName: "<script>alert(1)</script>" });
  const html = investigationReportHtml(report);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /window\.print\(\)/);
});

test("share URLs replace stale query state instead of merging old run settings", () => {
  const url = buildInvestigationShareUrl("https://example.test/wetland/global?old=1&run=stale", { run: "current", date: "2026-08-29", blank: "" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("run"), "current");
  assert.equal(parsed.searchParams.get("date"), "2026-08-29");
  assert.equal(parsed.searchParams.has("old"), false);
});
