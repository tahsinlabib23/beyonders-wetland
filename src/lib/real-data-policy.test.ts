import test from "node:test";
import assert from "node:assert/strict";
import { assertRealNisarSource, isRealNisarSource } from "./real-data-policy.ts";

test("only a NISAR source is accepted as scientific output", () => {
  assert.equal(isRealNisarSource("NISAR"), true);
  assert.equal(isRealNisarSource("SIMULATED_DEMO"), false);
  assert.equal(isRealNisarSource("UNVERIFIED"), false);
  assert.equal(isRealNisarSource(undefined), false);
});

test("non-NISAR output is rejected with an explicit explanation", () => {
  assert.doesNotThrow(() => assertRealNisarSource("NISAR"));
  assert.throws(() => assertRealNisarSource("SIMULATED_DEMO"), /Synthetic or unverified outputs are rejected/);
});
