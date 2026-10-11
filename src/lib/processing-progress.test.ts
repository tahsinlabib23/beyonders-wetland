import test from "node:test";
import assert from "node:assert/strict";
import { processingProgress } from "./processing-progress.ts";

const empty = { areaReady: false, searchComplete: false, processingStarted: false, processingComplete: false, resultsLoaded: false, failed: false };

test("workflow starts at area definition, not a hard-coded third step", () => {
  const progress = processingProgress(empty);
  assert.equal(progress.activeStep, 1);
  assert.equal(progress.completedCount, 0);
});

test("successful catalog search advances to launch step", () => {
  const progress = processingProgress({ ...empty, areaReady: true, searchComplete: true });
  assert.equal(progress.activeStep, 3);
  assert.equal(progress.completedCount, 2);
});

test("launch and successful processing are separate steps", () => {
  const launched = processingProgress({ ...empty, areaReady: true, searchComplete: true, processingStarted: true });
  assert.equal(launched.activeStep, 4);
  assert.equal(launched.completedCount, 3);
  const finished = processingProgress({ ...empty, areaReady: true, searchComplete: true, processingStarted: true, processingComplete: true });
  assert.equal(finished.activeStep, 5);
  assert.equal(finished.completedCount, 4);
});

test("inspection completes only after the processed output is loaded", () => {
  const progress = processingProgress({ ...empty, areaReady: true, searchComplete: true, processingStarted: true, processingComplete: true, resultsLoaded: true });
  assert.equal(progress.completedCount, 5);
  assert.equal(progress.activeStep, 5);
});

test("failed jobs do not mark processing complete", () => {
  const progress = processingProgress({ ...empty, areaReady: true, searchComplete: true, processingStarted: true, failed: true });
  assert.equal(progress.processingComplete, false);
  assert.equal(progress.completedCount, 3);
});

test("changing the study area invalidates downstream progress when its search no longer matches", () => {
  const progress = processingProgress({ ...empty, areaReady: true, searchComplete: false, processingStarted: false, processingComplete: false, resultsLoaded: false });
  assert.equal(progress.activeStep, 2);
  assert.equal(progress.completedCount, 1);
});
