import test from "node:test";
import assert from "node:assert/strict";
import { quickStartBounds, validPinCoordinates } from "./location-handoff.ts";

test("a selected pin becomes a small editable analysis rectangle", () => {
  assert.deepEqual(quickStartBounds(25.15, 91.0667), [91.0417, 25.125, 91.0917, 25.175]);
});

test("coordinate validation rejects non-finite and out-of-map positions", () => {
  assert.equal(validPinCoordinates(Number.NaN, 0), false);
  assert.equal(validPinCoordinates(0, Infinity), false);
  assert.equal(validPinCoordinates(89, 0), false);
  assert.equal(validPinCoordinates(0, 181), false);
});

test("study-box creation refuses positions too close to analysis-area bounds", () => {
  assert.equal(quickStartBounds(85, 0), null);
  assert.equal(quickStartBounds(0, 180), null);
  assert.equal(quickStartBounds(0, 0, 1.5), null);
});
