import test from "node:test";
import assert from "node:assert/strict";
import { calendarModel, coverageVerdict, stackLabel, studyAreaProblem, suggestStudyBox, windowAround } from "./forest-coverage.ts";

test("calendar positions are proportional to real dates and gaps are only labelled between real acquisitions", () => {
  const m = calendarModel(["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17"], "2026-06-17", "2026-10-12");
  assert.equal(m.marks.length, 4);
  assert.ok(m.marks[0].position < m.marks[1].position && m.marks[2].position < m.marks[3].position);
  assert.deepEqual(m.gaps.map((g) => g.days), [24]);          // Jul 24 -> Aug 17 only; 12-day steps are not gaps
  assert.equal(m.gaps[0].from, "2026-07-24");
  assert.ok(m.ticks.some((t) => t.label === "Aug"));
});

test("calendar ignores duplicates and invalid dates and never extrapolates", () => {
  const m = calendarModel(["2026-07-12", "2026-07-12", "not-a-date"], "2026-06-17", "2026-10-12");
  assert.equal(m.marks.length, 1);
  assert.equal(m.gaps.length, 0);
});

test("verdict says ready only when a compatible stack has enough dates", () => {
  assert.equal(coverageVerdict(null).tone, "unknown");
  assert.equal(coverageVerdict({ catalogHits: 0, usableStacks: 0, bestCount: 0 }).tone, "none");
  assert.match(coverageVerdict({ catalogHits: 0, usableStacks: 0, bestCount: 0 }).detail, /nothing about other places/);
  const few = coverageVerdict({ catalogHits: 5, usableStacks: 0, bestCount: 2 });
  assert.equal(few.tone, "insufficient");
  assert.match(few.headline, /2 of 3/);
  const ok = coverageVerdict({ catalogHits: 9, usableStacks: 2, bestCount: 5 });
  assert.equal(ok.tone, "ready");
  assert.match(ok.detail, /Nothing has been downloaded or analysed/);
  assert.match(coverageVerdict({ catalogHits: 9, usableStacks: 1, bestCount: 4, truncated: true }).detail, /may be incomplete/);
});

test("suggested study box is inside the searched window, small enough, and null without a footprint", () => {
  const win: [number, number, number, number] = [10, 20, 11.5, 21.5];
  const box = suggestStudyBox([9, 19, 10.6, 20.8], win);
  assert.ok(box);
  assert.equal(studyAreaProblem(box), null);
  assert.ok(box![0] >= 9.99 && box![2] <= 10.7);
  assert.equal(suggestStudyBox(null, win), null);
  assert.equal(suggestStudyBox([30, 30, 31, 31], win), null);   // stack lies outside the window: no invented coordinates
});

test("study-area limits match the worker and give a useful message", () => {
  assert.match(studyAreaProblem([0, 0, 1, 1]) ?? "", /too large/);
  assert.equal(studyAreaProblem([0, 0, 0.1, 0.1]), null);
  assert.match(studyAreaProblem(null) ?? "", /Pick an area/);
  assert.match(studyAreaProblem([1, 1, 1, 2]) ?? "", /positive/);
});

test("search window is clamped to valid coordinates and the scan limit", () => {
  const w = windowAround(89.5, 179.5, 5);
  assert.ok(w[3] <= 90 && w[2] <= 180);
  assert.ok(w[2] - w[0] <= 6.0001);
});

test("stack labels are human readable", () => {
  assert.equal(stackLabel({ track: "043", direction: "A", frame: "034" }), "Track 043 · ascending · frame 034");
});
