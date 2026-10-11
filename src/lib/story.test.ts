// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { changeStory, daysBetween, opticalState, challenge } from "./story.ts";

const pulse = { site: "X", wetland_area_km2: 50, data_source: "NISAR" as const, reference_check_status: "INCONCLUSIVE",
  dates: [{ date: "2026-06-23", area_km2: 1, fraction: 0.1, mean_delta_db: 1, patches: 3 }, { date: "2026-08-29", area_km2: 24.48, fraction: 0.4, mean_delta_db: 2, patches: 295 }],
  onset: null, peak: { date: "2026-08-29", area_km2: 24.48 }, recession_start: null };

test("daysBetween counts real days", () => assert.equal(daysBetween("2026-06-23", "2026-08-29"), 67));
test("optical state follows recorded status only", () => {
  assert.equal(opticalState("SHOWCASE", pulse), "INCONCLUSIVE");
  assert.equal(opticalState("SHOWCASE", { ...pulse, reference_check_status: "NOT_RUN" }), "NOT_RUN");
});
test("story uses loaded values and never claims confirmation", () => {
  const text = changeStory(pulse, "SHOWCASE", "INCONCLUSIVE").join(" ");
  assert.match(text, /295 candidate regions covering 24\.48 km²/);
  assert.match(text, /rather than confirmed flooding/);
  assert.match(text, /67 days/);
});
test("challenge always lists missing field truth", () => {
  const p = { hh_before: -15, hh_after: -19, hv_before: -22, hv_after: -22.2, delta_hh: -4, delta_hv: -0.2, temporal_status: "PASS", spatial_status: "PASS",
    quality_status: "PASS", threshold_stability: "STABLE", valid_fraction: 0.9, evidence_state: "SUPPORTED", classification: "OPEN_WATER" } as never;
  const c = challenge(p, "NOT_RUN");
  assert.ok(c.warnings.includes("No field truth")); assert.equal(c.validation, "Incomplete");
});
