"use client";

import { useEffect, useMemo, useState } from "react";
import type { DetectionCollection, DetectionProperties } from "./GlobalNisarDetectionMap";

type CandidateReferenceContext = {
  id: string;
  area_km2: number;
  total_pixels: number;
  compared_pixels: number;
  clear_fraction: number;
  matching_new_water_pixels: number;
  water_on_both_optical_dates_pixels: number;
};

type DateCheck = {
  available: boolean;
  date?: string;
  status?: string;
  reason?: string | null;
  comparison?: { baseline?: { hls_date?: string }; event?: { hls_date?: string }; mndwi_threshold?: number } | null;
  coverage?: { common_clear_fraction?: number; common_clear_area_km2?: number; minimum_clear_fraction_for_check?: number } | null;
  candidate_coverage?: { total_pixels: number; compared_pixels: number; unassessed_pixels: number; compared_fraction: number | null } | null;
  patch_context?: CandidateReferenceContext[] | null;
};

type Method = { threshold_db?: number; minimum_valid_fraction?: number; open_water_rule?: string; vegetated_inundation_rule?: string };

const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Not available" : `${(value * 100).toFixed(1)}%`;
const db = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Not available" : `${value > 0 ? "+" : ""}${value.toFixed(2)} dB`;
const labelFor = (properties: DetectionProperties) => properties.classification === "OPEN_WATER" ? "HH darkening candidate"
  : properties.classification === "VEGETATED_INUNDATION" ? "HH increase / HV stability candidate" : "Uncertain radar-change candidate";

export default function CandidateEvidencePanel({
  candidates,
  selectedCandidateId,
  onCandidateSelect,
  runId,
  selectedDate,
  polarizations,
  method,
}: {
  candidates: DetectionCollection["features"];
  selectedCandidateId: string | null;
  onCandidateSelect: (candidateId: string) => void;
  runId: string;
  selectedDate: string;
  polarizations: string[];
  method?: Method;
}) {
  const [referenceState, setReferenceState] = useState<{ key: string; value: DateCheck } | null>(null);
  const [referenceErrorState, setReferenceErrorState] = useState<{ key: string; error: string } | null>(null);
  const candidate = useMemo(() => candidates.find((feature) => feature.properties.id === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId]);
  const properties = candidate?.properties;
  const requestKey = `${runId}:${selectedDate}`;
  const reference = referenceState?.key === requestKey ? referenceState.value : null;
  const referenceError = referenceErrorState?.key === requestKey ? referenceErrorState.error : "";

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wetland/date-check?run=${encodeURIComponent(runId)}&date=${encodeURIComponent(selectedDate)}`, { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json() as DateCheck & { error?: string };
        if (!response.ok) throw new Error(value.error || "The independent reference check could not be loaded.");
        return value;
      })
      .then((value) => setReferenceState({ key: requestKey, value }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setReferenceErrorState({ key: requestKey, error: error instanceof Error ? error.message : "The reference check could not be loaded." });
      });
    return () => controller.abort();
  }, [runId, selectedDate, requestKey]);

  const context = properties?.classification === "OPEN_WATER"
    ? reference?.patch_context?.find((item) => item.id === properties.id)
    : undefined;
  const rule = properties?.classification === "OPEN_WATER" ? method?.open_water_rule : method?.vegetated_inundation_rule;
  const hlsBeforeDate = reference?.comparison?.baseline?.hls_date;
  const hlsAfterDate = reference?.comparison?.event?.hls_date;
  const radarAssessment = properties?.quality_status === "PASS"
    ? `Pass · run validity floor${method?.minimum_valid_fraction == null ? " not recorded" : ` ${percent(method.minimum_valid_fraction)}`}`
    : properties?.quality_status === "PARTIAL" ? "Partial · some pixels in the candidate extent are unassessed"
      : "Unassessed · radar quality status not recorded";
  const referenceAssessment = properties?.classification !== "OPEN_WATER"
    ? "Unassessed · HLS water-change check covers open-water candidates only"
    : !reference ? (referenceError ? "Unavailable · could not load HLS check" : "Loading HLS coverage…")
      : !reference.available ? "Unassessed · no HLS comparison for this date"
        : !context ? "Unassessed · per-candidate HLS coverage not saved"
          : context.compared_pixels === 0 ? "Unassessed · no common clear HLS pixels"
            : `${context.clear_fraction < 1 ? "Partial" : "Covered"} · ${percent(context.clear_fraction)} of candidate pixels have common clear coverage${reference.status === "INCONCLUSIVE" ? "; study check is inconclusive" : ""}`;

  return (
    <section className="candidate-evidence" aria-labelledby="candidate-evidence-title">
      <div className="candidate-evidence__heading">
        <div><p className="global-eyebrow">SELECTED RADAR CANDIDATE</p><h3 id="candidate-evidence-title">Evidence at a glance</h3></div>
        <span>{candidates.length} available</span>
      </div>
      {candidates.length > 0 ? <label className="candidate-evidence__select-label" htmlFor="candidate-evidence-select">
        Choose a candidate or click its outline on the map
        <select id="candidate-evidence-select" value={selectedCandidateId ?? ""} onChange={(event) => onCandidateSelect(event.target.value)}>
          <option value="">Select a candidate…</option>
          {candidates.map((feature, index) => {
            const item = feature.properties;
            return <option key={item.id ?? index} value={item.id ?? ""}>{String(index + 1).padStart(2, "0")} · {labelFor(item)} · {item.area_km2?.toFixed(3) ?? "?"} km²</option>;
          })}
        </select>
      </label> : <p className="candidate-evidence__empty">No candidate polygons were recorded for {selectedDate}. This does not establish that no surface change occurred.</p>}

      {properties && <>
        <div className="candidate-evidence__identity"><strong>{labelFor(properties)}</strong><span>{properties.area_km2?.toFixed(4) ?? "—"} km² · {properties.pixel_count?.toLocaleString() ?? "—"} radar pixels</span><small>{properties.id}</small></div>
        <div className="candidate-evidence__assessment-status" aria-label="Assessment coverage status">
          <div><span>Radar assessment</span><strong>{radarAssessment}</strong></div>
          <div><span>Independent reference</span><strong>{referenceAssessment}</strong></div>
        </div>
        <dl className="candidate-evidence__facts">
          <div><dt>Selected observation</dt><dd>{properties.date ?? selectedDate}</dd></div>
          <div><dt>Radar layers</dt><dd>{polarizations.join(" · ") || "HHHH / HVHV"}</dd></div>
          <div><dt>Threshold rule</dt><dd>{method?.threshold_db == null ? "Not recorded" : `${method.threshold_db.toFixed(1)} dB base threshold`}{rule ? ` · ${rule}` : ""}</dd></div>
          <div><dt>HH before → after · change</dt><dd>{db(properties.hh_before)} → {db(properties.hh_after)} · {db(properties.delta_hh)}</dd></div>
          <div><dt>HV before → after · change</dt><dd>{db(properties.hv_before)} → {db(properties.hv_after)} · {db(properties.delta_hv)}</dd></div>
          <div><dt>Radar valid coverage</dt><dd>{percent(properties.valid_fraction)} · {properties.quality_status ?? "status not recorded"}{method?.minimum_valid_fraction == null ? "" : ` · ${percent(method.minimum_valid_fraction)} minimum`}</dd></div>
          <div><dt>Independent reference</dt><dd>{referenceError ? "Unavailable" : reference?.available ? (reference.status ?? "Check available").replaceAll("_", " ") : reference ? "Not available for this date" : "Loading…"}</dd></div>
          <div><dt>HLS comparison dates</dt><dd>{hlsBeforeDate && hlsAfterDate ? `${hlsBeforeDate} → ${hlsAfterDate}` : "Not available"}</dd></div>
          <div><dt>Study-wide clear reference coverage</dt><dd>{percent(reference?.coverage?.common_clear_fraction)}{reference?.date ? ` · ${reference.date}` : ""}</dd></div>
          {reference?.coverage?.minimum_clear_fraction_for_check != null && <div><dt>Minimum clear-area floor</dt><dd>{percent(reference.coverage.minimum_clear_fraction_for_check)}</dd></div>}
          <div><dt>Candidate clear-reference coverage</dt><dd>{context ? `${percent(context.clear_fraction)} · ${context.compared_pixels.toLocaleString()} / ${context.total_pixels.toLocaleString()} pixels` : properties.classification !== "OPEN_WATER" ? "Not assessed · the HLS water-change check applies to open-water candidates" : reference?.available ? "Not included in this saved date check" : "Not available"}</dd></div>
          {context && <>
            <div><dt>HLS new-water overlap</dt><dd>{context.matching_new_water_pixels.toLocaleString()} candidate pixels</dd></div>
            <div><dt>Water on both HLS dates</dt><dd>{context.water_on_both_optical_dates_pixels.toLocaleString()} candidate pixels</dd></div>
          </>}
        </dl>

        <div className="candidate-evidence__assessment">
          <strong>Why this area is assessed or unassessed</strong>
          <p>{properties.valid_fraction == null
            ? "The candidate record has no valid-data fraction, so radar coverage completeness cannot be summarized."
            : `The detector created this candidate from pixels passing its radar validity mask. ${percent(properties.valid_fraction)} of its rectangular bounding extent had valid values across the comparison layers (${properties.valid_fraction_scope ?? "scope not recorded"}); the candidate polygon itself contains classified pixels only.`}</p>
          <p>{properties.quality_status === "PASS"
            ? "Radar screen: the candidate bounding extent passed this run’s recorded valid-data quality rule."
            : properties.quality_status === "PARTIAL"
              ? "Radar screen: the bounding extent has incomplete valid coverage. The candidate polygon contains classified valid pixels; gaps and excluded pixels remain unassessed."
              : "Radar quality status was not recorded, so its assessment cutoff cannot be confirmed."}</p>
          <p>{method?.minimum_valid_fraction == null
            ? `The saved quality label is ${properties.quality_status ?? "not recorded"}; this case file does not record the numeric valid-coverage cutoff.`
            : `The run required at least ${percent(method.minimum_valid_fraction)} valid coverage for a PASS label. Pixels excluded by the radar validity mask remain unassessed, not unchanged.`}</p>
          <p>Quality: {properties.quality_status ?? "not recorded"} · spatial extent: {properties.spatial_status ?? "not recorded"} · temporal check: {properties.temporal_status ?? "not recorded"}{properties.temporal_overlap_fraction == null ? "" : ` (${percent(properties.temporal_overlap_fraction)} overlap)`} · threshold stability: {properties.threshold_stability ?? "not recorded"}.</p>
          {properties.classification === "OPEN_WATER" && context && <p>{context.compared_pixels === 0
            ? "No candidate pixels had common valid radar and clear HLS coverage, so this candidate is unassessed by the optical comparison."
            : `${percent(context.clear_fraction)} of the rasterized candidate overlapped common valid radar and clear HLS coverage. Any remaining candidate pixels are unassessed by that reference; water on both dates is not evidence of new flooding.`}</p>}
          {referenceError && <p role="status">{referenceError}</p>}
          {reference?.reason && <p>{reference.reason}</p>}
        </div>
        <p className="candidate-evidence__caveat">This panel describes a rule-based radar-change candidate and the available cross-sensor coverage. It is not a confirmed flood finding or a per-candidate accuracy score.</p>
      </>}
      {!properties && candidates.length > 0 && <p className="candidate-evidence__empty">Choose a candidate above or click its outline on the map to inspect the date, signal, validity, and reference coverage.</p>}
    </section>
  );
}
