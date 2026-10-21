"use client";

import { useState } from "react";
import type { PlaceCandidate } from "@/lib/place-search";
import { coverageVerdict, stackLabel, suggestStudyBox, windowAround, type Bbox, type CoverageStack } from "@/lib/forest-coverage";
import ForestCoverageCalendar from "./ForestCoverageCalendar";
import ForestJobStatus from "./ForestJobStatus";
import { requestCancel, useForestJob } from "./useForestJob";

interface CoverageResult {
  status: "OK" | "INSUFFICIENT_OBSERVATIONS" | "EMPTY";
  scope: { bbox: Bbox; startDate: string; endDate: string; product: string; catalogHits: number; truncated: boolean; searchedAt: string; source: string };
  rejectedGranules: number;
  stacks: CoverageStack[];
  stackCount: number;
  usableStackCount: number;
  message: string;
}

const shortName = (name: string) => name.split(",").slice(0, 2).join(",").trim();

/** The geocode route already returns normalised candidates; accept only well-formed ones and never guess coordinates. */
function readCandidates(payload: unknown): PlaceCandidate[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item): item is PlaceCandidate => {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    return typeof r.display_name === "string" && r.display_name.length > 0 && typeof r.latitude === "number" && typeof r.longitude === "number"
      && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180;
  });
}

/**
 * "Find an area NISAR has observed": pick a place, search NASA's PUBLIC catalog around it, see which compatible stacks have
 * enough acquisition dates, then use one as the study area. Catalog metadata only: no login, no downloads, no analysis.
 */
export default function ForestCoverageExplorer({ startDate, endDate, studyBounds, onUseArea }: {
  startDate: string;
  endDate: string;
  studyBounds: Bbox | null;
  onUseArea: (box: Bbox, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceCandidate[]>([]);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [searchWindow, setSearchWindow] = useState<Bbox | null>(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { job, error: pollError } = useForestJob(jobId);

  const searchPlaces = async () => {
    if (query.trim().length < 3) { setPlacesError("Type at least 3 characters, for example a forest, park or region name."); return; }
    setPlacesBusy(true); setPlacesError(null); setPlaces([]);
    try {
      const response = await fetch(`/api/wetland/geocode?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const body = await response.json() as { results?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || "Place search failed.");
      const results = readCandidates(body.results);
      setPlaces(results);
      if (!results.length) setPlacesError("No place matched that name. Try a broader name, or draw an area on the map instead.");
    } catch (error) {
      setPlacesError(error instanceof Error ? error.message : "Place search failed.");
    } finally { setPlacesBusy(false); }
  };

  const choosePlace = (place: PlaceCandidate) => {
    setSearchWindow(windowAround(place.latitude, place.longitude));
    setPlaceLabel(shortName(place.display_name));
    setPlaces([]); setJobId(null); setNote(null); setStartError(null);
  };

  const aroundStudyBox = () => {
    if (!studyBounds) return;
    setSearchWindow(windowAround((studyBounds[1] + studyBounds[3]) / 2, (studyBounds[0] + studyBounds[2]) / 2));
    setPlaceLabel("your study box"); setJobId(null); setNote(null); setStartError(null);
  };

  const scan = async () => {
    if (!searchWindow) { setStartError("Choose a place first so the search knows where to look."); return; }
    if (!startDate || !endDate || startDate > endDate) { setStartError("Set an ordered date range in the form below first."); return; }
    setStarting(true); setStartError(null); setJobId(null); setNote(null);
    try {
      const response = await fetch("/api/forest/workflow", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "coverage", request: { bbox: searchWindow, startDate, endDate } }) });
      const body = await response.json() as { jobId?: string; error?: string; repair?: string[] };
      if (!response.ok || !body.jobId) throw new Error(body.error || `Could not start the catalog search (${response.status}).`);
      setJobId(body.jobId);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the catalog search.");
    } finally { setStarting(false); }
  };

  const cancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    const problem = await requestCancel(jobId);
    if (problem) setStartError(problem);
    setCancelling(false);
  };

  const result = job?.status === "COMPLETE" && job.action === "coverage" ? job.result as CoverageResult | undefined : undefined;
  const verdict = result ? coverageVerdict({ catalogHits: result.scope.catalogHits, usableStacks: result.usableStackCount, bestCount: result.stacks[0]?.count ?? 0, rejected: result.rejectedGranules, truncated: result.scope.truncated }) : null;
  const busy = starting || (!!job && (job.status === "QUEUED" || job.status === "RUNNING"));

  const useStack = (stack: CoverageStack) => {
    if (!result) return;
    const box = suggestStudyBox(stack.bbox, result.scope.bbox);
    if (!box) { setNote("That stack has no usable footprint in the catalog record, so no study box was suggested."); return; }
    setNote(`Study area set to a ${((box[2] - box[0])).toFixed(2)}° box inside this stack. Adjust it on the map if you like, then check the exact scenes below.`);
    onUseArea(box, `${placeLabel || "NISAR-observed area"} · ${stackLabel(stack)}`);
  };

  return (
    <section className="forest-coverage" aria-labelledby="forest-coverage-title">
      <div className="forest-panel-head"><div><p className="forest-kicker">Step 1 · Find an area NISAR has observed</p><h3 id="forest-coverage-title">Where can I analyse?</h3></div><span className="forest-data-label">NASA CMR · public · catalog records only</span></div>
      <p className="forest-muted">Search for a place, and the app asks NASA&apos;s public catalog which NISAR observations exist around it, for the dates chosen below. This needs no login and downloads nothing.</p>

      <form className="forest-place-search" onSubmit={(event) => { event.preventDefault(); void searchPlaces(); }} role="search" aria-label="Find a place">
        <label className="forest-input-field"><span>Place name</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Sundarbans, Borneo, Mato Grosso" maxLength={120} /></label>
        <button type="submit" className="forest-button-secondary" disabled={placesBusy}>{placesBusy ? "Searching…" : "Find place"}</button>
        {studyBounds && <button type="button" className="forest-button-secondary" onClick={aroundStudyBox}>Search around my study box</button>}
      </form>
      {placesError && <p className="forest-workflow-error" role="alert">{placesError}</p>}
      {places.length > 0 && (
        <ul className="forest-place-results" aria-label="Matching places">
          {places.map((place) => <li key={`${place.latitude},${place.longitude},${place.display_name}`}><button type="button" onClick={() => choosePlace(place)}><strong>{shortName(place.display_name)}</strong><span className="forest-micro">{place.latitude.toFixed(3)}°, {place.longitude.toFixed(3)}° · OpenStreetMap place search (names only, not satellite data)</span></button></li>)}
        </ul>
      )}

      {searchWindow && (
        <div className="forest-coverage__scope">
          <p><strong>Search area:</strong> around {placeLabel || "the chosen point"} · longitude {searchWindow[0].toFixed(2)}° to {searchWindow[2].toFixed(2)}°, latitude {searchWindow[1].toFixed(2)}° to {searchWindow[3].toFixed(2)}° · {startDate} to {endDate}</p>
          <button type="button" className="forest-button-primary" onClick={() => void scan()} disabled={busy}>{busy ? "Searching NASA's catalog…" : "Search NASA's catalog here"}</button>
        </div>
      )}
      {startError && <p className="forest-workflow-error" role="alert">{startError}</p>}
      <ForestJobStatus job={job} pollError={pollError} onCancel={() => void cancel()} onRetry={() => void scan()} cancelling={cancelling} />

      {result && verdict && (
        <div className={`forest-verdict forest-verdict--${verdict.tone}`} role="region" aria-label="Coverage answer">
          <p className="forest-kicker">Answer</p>
          <h4>{verdict.headline}</h4>
          <p>{verdict.detail}</p>
          {verdict.actions.length > 0 && <ul>{verdict.actions.map((action) => <li key={action}>{action}</li>)}</ul>}
          <p className="forest-micro">Scope: {result.scope.product} · {result.scope.catalogHits} catalog scene{result.scope.catalogHits === 1 ? "" : "s"} listed in this window and date range · {result.rejectedGranules} unreadable record{result.rejectedGranules === 1 ? "" : "s"} · searched {new Date(result.scope.searchedAt).toLocaleString()} · this is not a statement about anywhere else.</p>
        </div>
      )}
      {result && result.stacks.length > 0 && <ForestCoverageCalendar stacks={result.stacks} windowStart={result.scope.startDate} windowEnd={result.scope.endDate} onUse={useStack} />}
      {result && result.stackCount > result.stacks.length && <p className="forest-micro">Showing {result.stacks.length} of {result.stackCount} stacks, longest first.</p>}
      {note && <p className="forest-earthdata__message" role="status">{note}</p>}
    </section>
  );
}
