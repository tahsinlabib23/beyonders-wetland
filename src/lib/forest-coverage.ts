/**
 * Pure logic for the forest coverage experience: calendar geometry, plain-language verdicts and study-box suggestions.
 * Everything here describes CATALOG RECORDS returned by NASA CMR. Nothing implies a scene was downloaded, validated or
 * analysed; those states come only from job and run records.
 */

export interface CoverageStack {
  id: string;
  track: string;
  direction: string;
  frame: string;
  bandwidth: string;
  polarizationMode: string;
  pairedPolarizationMode?: string;
  release: string;
  dates: string[];
  count: number;
  longestGapDays: number;
  bbox: [number, number, number, number] | null;
  sufficient: boolean;
}

export type Bbox = [number, number, number, number];
export const MIN_OBSERVATIONS = 3;
export const STUDY_BOX_DEGREES = 0.1;
export const MAX_STUDY_SIDE_DEGREES = 0.2;

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export const stackLabel = (s: Pick<CoverageStack, "track" | "direction" | "frame">) =>
  `Track ${s.track} · ${s.direction === "A" ? "ascending" : s.direction === "D" ? "descending" : s.direction} · frame ${s.frame}`;

export interface CalendarModel {
  ticks: { label: string; position: number }[];
  marks: { date: string; position: number }[];
  gaps: { from: string; to: string; days: number; start: number; end: number }[];
}

/**
 * Positions are proportional to real calendar time. A gap is labelled only where two real acquisitions are more than
 * `gapThresholdDays` apart; nothing is drawn or interpolated between them.
 */
export function calendarModel(dates: string[], windowStart: string, windowEnd: string, gapThresholdDays = 14): CalendarModel {
  const start = toMs(windowStart);
  const end = Math.max(toMs(windowEnd), start + DAY);
  const span = end - start;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const sorted = [...new Set(dates)].filter((d) => Number.isFinite(toMs(d))).sort();
  const marks = sorted.map((date) => ({ date, position: clamp((toMs(date) - start) / span) }));
  const gaps = sorted.slice(1).flatMap((to, index) => {
    const from = sorted[index];
    const days = Math.round((toMs(to) - toMs(from)) / DAY);
    return days > gapThresholdDays ? [{ from, to, days, start: clamp((toMs(from) - start) / span), end: clamp((toMs(to) - start) / span) }] : [];
  });
  const ticks: CalendarModel["ticks"] = [];
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  if (cursor.getTime() < start) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= end) {
    ticks.push({ label: cursor.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), position: clamp((cursor.getTime() - start) / span) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { ticks, marks, gaps };
}

export interface Verdict {
  tone: "ready" | "insufficient" | "none" | "unknown";
  headline: string;
  detail: string;
  actions: string[];
}

/** One plain answer to "can I analyse this area?". Never says ready unless a compatible stack has enough dates. */
export function coverageVerdict(input: { catalogHits: number; usableStacks: number; bestCount: number; rejected?: number; truncated?: boolean } | null): Verdict {
  if (!input) return { tone: "unknown", headline: "Not checked yet", detail: "Search the NASA catalog to see whether NISAR has observed this area.", actions: ["Choose an area, then press the search button."] };
  if (input.catalogHits === 0) {
    return { tone: "none", headline: "No NISAR scenes are listed here", detail: "NASA's catalog has no NISAR L2 GCOV provisional scenes for this area and date range. This says nothing about other places or dates.",
      actions: ["Widen the date range.", "Pick a nearby area and search again.", "Remember NISAR's public provisional archive only covers part of the globe so far."] };
  }
  if (input.usableStacks === 0) {
    return { tone: "insufficient", headline: `Scenes exist, but none is enough on its own (best: ${input.bestCount} of ${MIN_OBSERVATIONS} needed)`,
      detail: `The analysis compares the same view repeatedly, so it needs at least ${MIN_OBSERVATIONS} dates from one compatible stack (same track, direction, frame and modes). Scenes from different stacks cannot be mixed.`,
      actions: ["Extend the end date; NISAR keeps acquiring.", "Try a neighbouring area covered by a longer stack."] };
  }
  const caveat = input.truncated ? " The catalog reply hit its size limit, so the list may be incomplete." : "";
  return { tone: "ready", headline: `${input.usableStacks} compatible stack${input.usableStacks === 1 ? "" : "s"} can support an analysis (best: ${input.bestCount} dates)`,
    detail: `These are catalog records. Nothing has been downloaded or analysed yet, and downloading needs a NASA Earthdata login.${caveat}`,
    actions: ["Connect Earthdata, then start the analysis."] };
}

/**
 * A study box small enough for the pipeline, centred on the part of the stack that lies inside the searched window.
 * Returns null when the stack has no usable footprint (we never invent coordinates).
 */
export function suggestStudyBox(stackBbox: Bbox | null, windowBbox: Bbox, side = STUDY_BOX_DEGREES): Bbox | null {
  if (!stackBbox) return null;
  const west = Math.max(stackBbox[0], windowBbox[0]);
  const south = Math.max(stackBbox[1], windowBbox[1]);
  const east = Math.min(stackBbox[2], windowBbox[2]);
  const north = Math.min(stackBbox[3], windowBbox[3]);
  if (!(west < east && south < north)) return null;
  const half = Math.min(side, MAX_STUDY_SIDE_DEGREES) / 2;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const round = (v: number) => Number(v.toFixed(5));
  const box: Bbox = [round(Math.max(-180, cx - half)), round(Math.max(-90, cy - half)), round(Math.min(180, cx + half)), round(Math.min(90, cy + half))];
  return box[0] < box[2] && box[1] < box[3] ? box : null;
}

/** Search window around a point (the place the user picked), clamped to valid WGS84 and the 6-degree scan limit. */
export function windowAround(lat: number, lon: number, halfSpanDegrees = 1.5): Bbox {
  const half = Math.min(halfSpanDegrees, 3);
  return [Math.max(-180, lon - half), Math.max(-90, lat - half), Math.min(180, lon + half), Math.min(90, lat + half)].map((v) => Number(v.toFixed(4))) as Bbox;
}

export function bboxSides(b: Bbox): { width: number; height: number; area: number } {
  const width = b[2] - b[0];
  const height = b[3] - b[1];
  return { width, height, area: width * height };
}

/** Same limits the worker enforces, so the form can warn before a job is created. */
export function studyAreaProblem(b: Bbox | null): string | null {
  if (!b) return "Pick an area on the map or from the suggestions.";
  const { width, height, area } = bboxSides(b);
  if (!(width > 0 && height > 0)) return "The area must have a positive width and height.";
  if (width > MAX_STUDY_SIDE_DEGREES || height > MAX_STUDY_SIDE_DEGREES || area > 0.025) return "This area is too large for an analysis (maximum 0.20° per side and 0.025 square degrees). Shrink it, or use the suggested box.";
  return null;
}
