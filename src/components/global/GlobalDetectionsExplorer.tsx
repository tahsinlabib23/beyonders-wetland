"use client";

// @refresh reset
// Leaflet's map instance must remount when development refresh reruns effects.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import NisarProcessingPanel, { type AreaBounds } from "./NisarProcessingPanel";
import type { ProcessingProgress } from "@/lib/processing-progress";
import RadarComparison from "./RadarComparison";
import ReferenceEvidence from "./ReferenceEvidence";
import SavedDateCheck from "./SavedDateCheck";
import MozambiqueFloodCase from "./MozambiqueFloodCase";
import { assertShowcaseCandidateCount, listShowcaseCases, loadShowcaseBundle, loadShowcasePatches, type ShowcaseBundle, type ShowcaseCaseSummary } from "@/lib/showcase";
import { quickStartBounds } from "@/lib/location-handoff";
import { buildInvestigationReport, investigationReportCsv, investigationReportGeoJson, investigationReportHtml, buildInvestigationShareUrl, type ReportFormat } from "@/lib/investigation-report";
import type { PlaceCandidate } from "@/lib/place-search";
import "./atlas-global.css";
import type { BoundaryCollection, CoverageCollection, DetectionCollection } from "./GlobalNisarDetectionMap";

const GlobalNisarDetectionMap = dynamic(() => import("./GlobalNisarDetectionMap"), {
  ssr: false,
  loading: () => <div className="global-map-loading">Loading NISAR map…</div>,
});

interface DetectionResponse {
  run_id: string;
  site_name?: string;
  site_bounds?: AreaBounds;
  boundary_source?: string | null;
  data_source: "NISAR" | "UNVERIFIED";
  status: "ready" | "no-real-nisar-run";
  product: string | null;
  product_maturity: string | null;
  reference_validated: boolean;
  cross_sensor_check_completed: boolean;
  reference_check_status: string;
  baseline_date: string | null;
  baseline_scene: string | null;
  selected_baseline?: { baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[] } | null;
  baseline_observation_dates?: string[] | null;
  selected_date: string | null;
  selected_scene: string | null;
  polarizations: string[];
  dates: string[];
  stats: { date: string; area_km2: number; patches: number } | null;
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  case_study: CaseStudy | null;
  reference_validation: ReferenceValidation | null;
}

type ReferenceValidation = {
  status?: string;
  reason?: string | null;
  reference_product?: string;
  source_url?: string;
  comparison?: {
    baseline?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    event?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    hls_tile?: string;
    spatial_resolution_m?: number;
    mndwi_threshold?: number;
  };
  coverage?: { common_clear_fraction?: number; common_clear_area_km2?: number; minimum_clear_fraction_for_check?: number };
  metrics?: { precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  optical_support?: { support?: string; common_clear_fraction?: number; common_clear_area_km2?: number;
    candidate_assessed_fraction?: number | null;
    true_positive_area_km2?: number; false_positive_area_km2?: number; false_negative_area_km2?: number;
    precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  limitations?: string[];
  selection?: { evaluated_pairs?: number; available_pairs?: number; method?: string; date_tolerance_days?: number;
    catalog_searches?: { collection: string; records?: number; status: string }[] };
};

type CaseStudy = {
  title?: string;
  site?: string;
  baseline_date?: string;
  event_date?: string;
  baseline_scene?: string | null;
  baseline_scenes?: string[];
  event_scene?: string | null;
  input_origin?: string;
  source_run_id?: string | null;
  date_pair_selection?: { method?: string; screened_scenes?: number; candidate_pairs?: number } | null;
  polarizations?: string[];
  candidate_patches?: number;
  candidate_area_km2?: number;
  classes?: Record<string, { patches: number; area_km2: number; mean_delta_hh_db?: number | null; mean_delta_hv_db?: number | null }>;
  method?: { open_water_rule?: string; vegetated_inundation_rule?: string; threshold_db?: number; minimum_region_pixels?: number; validity_rule?: string;
    baseline_method?: { baseline_method?: string; baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_hh_temporal_mad_db?: number | null };
    gcov_quality?: { scenes?: { scene?: string; number_of_looks_median?: number | null }[]; number_of_looks_rule?: string; mask_rule?: string } };
  uncertainty?: { threshold_sensitivity?: { stability_verdict?: string; stable_range?: number[]; sensitivity_note?: string }; interpretation?: string };
  reference_validation?: ReferenceValidation;
  impact_context?: string;
  spatial_scope?: string;
};

interface CoverageResponse {
  date: string;
  product: string;
  totalHits: number;
  loadedFeatures: number;
  truncated: boolean;
  snapshotFallback?: boolean;
  features: CoverageCollection["features"];
  error?: string;
}

function emptyCollection(): DetectionCollection {
  return { type: "FeatureCollection", features: [] };
}

type CoordinateAxis = "latitude" | "longitude";

function parseCoordinate(value: string, axis: CoordinateAxis): number | null {
  const input = value.trim().toUpperCase();
  if (!input) return null;

  const hemisphere = input.match(/[NSEW]$/)?.[0];
  if (hemisphere && (axis === "latitude" ? !["N", "S"].includes(hemisphere) : !["E", "W"].includes(hemisphere))) return null;
  const magnitudeText = hemisphere ? input.slice(0, -1).trim() : input;
  const decimal = magnitudeText.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:[°º])?$/);
  if (decimal) {
    const number = Number(decimal[1]);
    if (!Number.isFinite(number)) return null;
    return hemisphere ? (hemisphere === "S" || hemisphere === "W" ? -1 : 1) * Math.abs(number) : number;
  }

  const parts = magnitudeText
    .replace(/[°º˚dD]/g, " ")
    .replace(/[′'’mM]/g, " ")
    .replace(/[″\"”sS]/g, " ")
    .replace(/:/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;

  const degrees = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length === 3 ? Number(parts[2]) : 0;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

  const sign = hemisphere
    ? hemisphere === "S" || hemisphere === "W" ? -1 : 1
    : degrees < 0 ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

const DEFAULT_COVERAGE_DATE = new Date().toISOString().slice(0, 10);

export default function GlobalDetectionsExplorer() {
  const [selectedRun, setSelectedRun] = useState("");
  const [savedRuns, setSavedRuns] = useState<{ run_id: string; site_name: string; baseline_date: string; selected_date: string; completed_at: string }[]>([]);
  const pendingAreaRunId = useRef("");
  const [runsError, setRunsError] = useState("");
  const [areaBounds, setAreaBounds] = useState<AreaBounds | null>(null);
  const [areaBoundary, setAreaBoundary] = useState<BoundaryCollection | null>(null);
  const [areaDrawing, setAreaDrawing] = useState(false);
  const [quickStartBox, setQuickStartBox] = useState(false);
  const [quickStartSiteName, setQuickStartSiteName] = useState("");
  const [pickingLocation, setPickingLocation] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceCandidate[]>([]);
  const [placeSearchBusy, setPlaceSearchBusy] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState("");
  const [selectedPlaceName, setSelectedPlaceName] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [processProgress, setProcessProgress] = useState<ProcessingProgress>({ areaReady: false, searchComplete: false, processingStarted: false, processingComplete: false, resultsLoaded: false, failed: false, activeStep: 1, completedCount: 0 });
  const [coordinateLatitude, setCoordinateLatitude] = useState("");
  const [coordinateLongitude, setCoordinateLongitude] = useState("");
  const [coordinateError, setCoordinateError] = useState("");
  const [coordinateTarget, setCoordinateTarget] = useState<{ latitude: number; longitude: number } | null>(null);
  const [candidateDate, setCandidateDate] = useState("");
  const [mosaicDate, setMosaicDate] = useState("");
  const [coverageDate, setCoverageDate] = useState(DEFAULT_COVERAGE_DATE);
  const [mosaicStatus, setMosaicStatus] = useState<"loading" | "ready" | "error">("loading");
  const [focusStudyArea, setFocusStudyArea] = useState(false);
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [coverageData, setCoverageData] = useState<CoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  // The packaged real case needs no local server, Python or Earthdata login, so the page works on a static deployment.
  const [showcase, setShowcase] = useState<ShowcaseBundle | null>(null);
  const [cases, setCases] = useState<ShowcaseCaseSummary[]>([]);
  const [showcaseDetections, setShowcaseDetections] = useState<DetectionCollection | null>(null);
  const [showcaseLoadError, setShowcaseLoadError] = useState("");
  useEffect(() => {
    let live = true;
    void listShowcaseCases().then(setCases).catch(() => undefined);
    void loadShowcaseBundle().then(async (bundle) => {
      if (!live) return;
      if (!bundle) {
        setShowcaseLoadError("The packaged NISAR case could not be loaded. No substitute or simulated results will be shown.");
        return;
      }
      setShowcase(bundle);
      setShowcaseLoadError("");
      if (!bundle.pulse) {
        setShowcaseLoadError("This packaged case has no usable pulse series. Candidate maps are not available for this case.");
        return;
      }
      try {
        const peak = bundle.pulse.peak.date;
        const patches = await loadShowcasePatches(bundle, peak);
        const expectedCount = bundle.pulse.dates.find((item) => item.date === peak)?.patches;
        assertShowcaseCandidateCount(peak, patches, expectedCount);
        if (live) {
          setShowcaseDetections({ type: "FeatureCollection", features: patches.map((patch) => {
            const { geometry, ...properties } = patch;
            return { type: "Feature" as const, geometry: geometry as never, properties: { ...properties, id: patch.id, date: patch.date } };
          }) });
          setShowcaseLoadError("");
        }
      } catch (reason) {
        if (live) {
          setShowcaseDetections(null);
          setShowcaseLoadError(reason instanceof Error ? reason.message : "Could not load the packaged candidate regions.");
        }
      }
    }).catch((reason: unknown) => {
      if (live) setShowcaseLoadError(reason instanceof Error ? reason.message : "Could not load the packaged NISAR case.");
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const urlHandoffTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedRun = params.get("run");
    const requestedDate = params.get("date");
    if (requestedRun) setSelectedRun(requestedRun);
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setCandidateDate(requestedDate);
    const latitude = Number(params.get("latitude"));
    const longitude = Number(params.get("longitude"));
    if (!params.has("latitude") || !params.has("longitude") || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -85.05112878 || latitude > 85.05112878 || longitude < -180 || longitude > 180) return;
    setCoordinateLatitude(latitude.toFixed(5));
    setCoordinateLongitude(longitude.toFixed(5));
    setCoordinateTarget({ latitude, longitude });
    setCoordinateError("");
    if (params.get("analyze") === "1") {
      // User-defined geometry around a globe pin; this does not create detections.
      const initialBounds = quickStartBounds(latitude, longitude);
      if (initialBounds) {
        setAreaBounds(initialBounds);
        setAreaBoundary(null);
        setQuickStartBox(true);
        setQuickStartSiteName(params.get("site")?.trim().slice(0, 80) || `Study area near ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
      } else {
        setCoordinateError("This location is too close to the map edge for the default study box. Draw an area or upload a boundary instead.");
      }
      window.setTimeout(() => document.getElementById("nisar-process")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      }), 180);
    }
    }, 0);
    return () => window.clearTimeout(urlHandoffTimer);
  }, []);

  const loadFinishedRun = useCallback((runId: string) => {
    setSelectedRun(runId); setCandidateDate(""); setError(""); setLoading(true);
    setFocusStudyArea(true);
    setCoordinateTarget(null);
    setRefreshKey((key) => key+1);
  }, []);
  const loadSavedAreaForProcessing = useCallback((runId: string) => {
    setAreaBounds(null); setAreaBoundary(null); setAreaDrawing(false);
    pendingAreaRunId.current = runId;
    loadFinishedRun(runId);
  }, [loadFinishedRun]);
  const applyArea = useCallback((bounds: AreaBounds, boundary: BoundaryCollection | null) => {
    setAreaBounds(bounds); setAreaBoundary(boundary); setAreaDrawing(false); setQuickStartBox(false); setQuickStartSiteName("");
    setPickingLocation(false); setCoordinateTarget(null); setSelectedPlaceName("");
  }, []);
  const updateProcessProgress = useCallback((next: ProcessingProgress) => {
    setProcessProgress((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);
  const searchCoordinates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = parseCoordinate(coordinateLatitude, "latitude");
    const longitude = parseCoordinate(coordinateLongitude, "longitude");
    if (latitude == null || longitude == null) {
      setCoordinateError("Enter decimal degrees or degrees and minutes (for example, 25°09′ N and 91°04′ E). Minutes and seconds must be below 60.");
      return;
    }
    if (latitude < -85.05112878 || latitude > 85.05112878 || longitude < -180 || longitude > 180) {
      setCoordinateError("Latitude must be within the map range (−85.0511 to 85.0511); longitude must be between −180 and 180.");
      return;
    }
    setCoordinateError("");
    setSelectedPlaceName("");
    setCoordinateTarget({ latitude, longitude });
    setFocusStudyArea(false);
  };

  const chooseMapLocation = useCallback((point: { latitude: number; longitude: number }) => {
    setCoordinateLatitude(point.latitude.toFixed(5));
    setCoordinateLongitude(point.longitude.toFixed(5));
    setCoordinateTarget(point);
    setCoordinateError("");
    setSelectedPlaceName("");
    setPickingLocation(false);
    setFocusStudyArea(false);
  }, []);

  async function searchPlaceName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = placeQuery.trim();
    if (q.length < 3) { setPlaceSearchError("Enter at least 3 characters to search."); return; }
    setPlaceSearchBusy(true); setPlaceSearchError(""); setPlaceResults([]);
    try {
      const response = await fetch(`/api/wetland/geocode?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const result = await response.json() as { results?: PlaceCandidate[]; error?: string; attribution?: string };
      if (!response.ok) throw new Error(result.error || "Place search failed.");
      setPlaceResults(Array.isArray(result.results) ? result.results : []);
      if (!result.results?.length) setPlaceSearchError("No place matched that search. Try a nearby town, region, or coordinates instead.");
    } catch (reason) {
      setPlaceSearchError(reason instanceof Error ? reason.message : "Place search is unavailable. You can still use the map or coordinates.");
    } finally { setPlaceSearchBusy(false); }
  }

  function selectPlace(place: PlaceCandidate) {
    setCoordinateLatitude(place.latitude.toFixed(5));
    setCoordinateLongitude(place.longitude.toFixed(5));
    setCoordinateTarget({ latitude: place.latitude, longitude: place.longitude });
    setSelectedPlaceName(place.display_name);
    setPlaceQuery(place.display_name);
    setPlaceResults([]);
    setPlaceSearchError("");
    setCoordinateError("");
    setFocusStudyArea(false);
  }

  const useCoordinatesForAnalysis = () => {
    if (!coordinateTarget) return;
    const bounds = quickStartBounds(coordinateTarget.latitude, coordinateTarget.longitude);
    if (!bounds) {
      setCoordinateError("This point is too close to the map boundary for the default study box. Choose a point farther from the edge or draw/upload a boundary manually.");
      return;
    }
    setAreaBounds(bounds);
    setAreaBoundary(null);
    setAreaDrawing(false);
    setPickingLocation(false);
    setQuickStartBox(true);
    setQuickStartSiteName(selectedPlaceName ? `${selectedPlaceName.split(",")[0]} study area` : `Study area near ${coordinateTarget.latitude.toFixed(3)}, ${coordinateTarget.longitude.toFixed(3)}`);
    setFocusStudyArea(true);
    setCoordinateError("");
    window.history.replaceState(null, "", buildInvestigationShareUrl(window.location.href, { latitude: String(coordinateTarget.latitude), longitude: String(coordinateTarget.longitude), analyze: "1", site: selectedPlaceName ? `${selectedPlaceName.split(",")[0]} study area` : `Study area near ${coordinateTarget.latitude.toFixed(3)}, ${coordinateTarget.longitude.toFixed(3)}` }));
    window.setTimeout(() => document.getElementById("nisar-process")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }), 100);
  };

  function makeCurrentInvestigationReport() {
    const collection = isNisar ? detections : usingShowcase ? showcaseDetections ?? emptyCollection() : emptyCollection();
    const regions = collection.features.map((feature, index) => ({
      id: String(feature.properties?.id || `candidate-${index + 1}`),
      date: feature.properties?.date ?? (isNisar ? data?.selected_date : showcase?.pulse?.peak.date) ?? null,
      classification: feature.properties?.classification ?? null,
      area_km2: typeof feature.properties?.area_km2 === "number" ? feature.properties.area_km2 : null,
      evidence_state: typeof (feature.properties as unknown as Record<string, unknown> | undefined)?.evidence_state === "string"
        ? String((feature.properties as unknown as Record<string, unknown>).evidence_state) : null,
      geometry: feature.geometry,
    }));
    const refStatus = isNisar ? data?.reference_check_status : showcase?.manifest.reference_check_status;
    const commonClear = isNisar
      ? data?.reference_validation?.optical_support?.common_clear_fraction ?? data?.reference_validation?.coverage?.common_clear_fraction
      : (showcase?.reference.evidence?.coverage as { common_clear_fraction?: number } | undefined)?.common_clear_fraction;
    const report = buildInvestigationReport({
      title: `${isNisar ? "Local NISAR investigation" : "Featured NISAR investigation"} · ${isNisar ? data?.site_name ?? "Study area" : featured?.name ?? "Tanguar Haor"}`,
      siteName: isNisar ? data?.site_name ?? "Study area" : featured?.name ?? "Tanguar Haor",
      source: isNisar ? "NISAR_LOCAL_RUN" : "NISAR_SHOWCASE",
      runId: isNisar ? data?.run_id : showcase?.manifest.run_id,
      product: isNisar ? data?.product : showcase?.manifest.product,
      productMaturity: isNisar ? data?.product_maturity : showcase?.manifest.product_maturity,
      baselineDate: isNisar ? data?.baseline_date : showcase?.manifest.baseline_date,
      selectedDate: isNisar ? data?.selected_date : showcase?.pulse?.peak.date,
      observationDates: isNisar ? data?.dates : showcase?.manifest.observation_dates,
      siteBounds: isNisar ? data?.site_bounds ?? null : showcase?.manifest.site_bounds ?? null,
      boundarySource: isNisar ? data?.boundary_source : showcase?.manifest.wetland_boundary_source ?? null,
      referenceStatus: refStatus ?? "NOT_RECORDED",
      referenceSummary: commonClear == null
        ? "Shared clear optical-reference coverage was not recorded in this export."
        : `${(commonClear * 100).toFixed(1)}% of the study area had common clear coverage for the recorded optical check. This is satellite comparison context, not field truth.`,
      uncertaintySummary: isNisar
        ? data?.case_study?.uncertainty?.threshold_sensitivity?.sensitivity_note ?? data?.case_study?.uncertainty?.interpretation ?? "See the case-study uncertainty section for the recorded limits."
        : showcase?.manifest.limitations.join(" ") ?? "The packaged case limitations were not available.",
      regions,
      limitations: isNisar
        ? data?.reference_validation?.limitations ?? ["NISAR product maturity is provisional.", "Radar-change candidates are not confirmed environmental events.", "Independent reference agreement, when available, is not field truth."]
        : showcase?.manifest.limitations ?? ["Packaged showcase results are precomputed from real NISAR observations.", "Radar-change candidates are not confirmed environmental events."],
    });
    return report;
  }

  function downloadInvestigation(format: ReportFormat) {
    if (usingShowcase && !showcaseDetections) { setReportMessage("Wait for the packaged candidate regions to finish loading. No file was exported."); return; }
    if (!isNisar && !usingShowcase) { setReportMessage("No real NISAR case is loaded. Nothing was exported."); return; }
    const report = makeCurrentInvestigationReport();
    const base = `geonexsar-${report.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${(report.selectedDate || "case")}`;
    const content = format === "csv" ? investigationReportCsv(report)
      : format === "geojson" ? JSON.stringify(investigationReportGeoJson(report), null, 2)
        : format === "html" ? investigationReportHtml(report) : JSON.stringify(report, null, 2);
    const mime = format === "csv" ? "text/csv;charset=utf-8" : format === "geojson" ? "application/geo+json" : format === "html" ? "text/html;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl; anchor.download = `${base}.${format}`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    setReportMessage(`Exported ${report.regionCount} candidate regions as ${format.toUpperCase()}. Source and limitations are included.`);
  }

  async function shareCurrentInvestigation() {
    let target: string;
    if (isNisar && data?.run_id) {
      target = buildInvestigationShareUrl(`${window.location.origin}/wetland/global`, { run: data.run_id, date: data.selected_date });
    } else if (usingShowcase) {
      target = `${window.location.origin}/wetland?case=${encodeURIComponent(showcase?.manifest.case_id || "featured")}`;
    } else {
      setReportMessage("Load a real NISAR case before sharing an investigation."); return;
    }
    setShareUrl(target);
    try { await navigator.clipboard.writeText(target); setReportMessage(isNisar ? "Investigation link copied. Local-run links work on computers that have this exact saved run; packaged-case links are portable." : "Investigation link copied. It opens the packaged real NISAR case."); }
    catch { setReportMessage("The link is ready below. Copy it manually; clipboard access was unavailable."); }
  }

  const locateMozambiqueCase = () => {
    setCoordinateTarget({ latitude: -24.533333, longitude: 32.983333 });
    setFocusStudyArea(false);
    document.getElementById("global-nisar-map")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wetland/runs", { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load saved results.");
      return result;
    }).then((result) => { setSavedRuns(result.runs); setRunsError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setRunsError(reason.message); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (candidateDate) params.set("date", candidateDate);
    if (selectedRun) params.set("run", selectedRun);
    const query = params.size ? `?${params}` : "";

    fetch(`/api/wetland/nisar-detections${query}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as DetectionResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load NISAR detections.");
        return result;
      })
      .then((result) => {
        if (pendingAreaRunId.current === result.run_id) {
          if (result.site_bounds) {
            setAreaBounds(result.site_bounds);
            setAreaBoundary(result.boundary);
            setAreaDrawing(false);
          }
          pendingAreaRunId.current = "";
        }
        setData(result);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (pendingAreaRunId.current === selectedRun) pendingAreaRunId.current = "";
        setData(null);
        setError(reason instanceof Error ? reason.message : "Could not load NISAR detections.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [candidateDate, selectedRun, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/wetland/global-coverage?date=${encodeURIComponent(coverageDate)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as CoverageResponse;
        if (!response.ok) throw new Error(result.error || "Could not load worldwide NISAR footprints.");
        return result;
      })
      .then(setCoverageData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCoverageData(null);
        setCoverageError(reason instanceof Error ? reason.message : "Could not load worldwide NISAR footprints.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCoverageLoading(false);
      });

    return () => controller.abort();
  }, [coverageDate, refreshKey]);

  const detections = data?.detections ?? emptyCollection();
  const coverage: CoverageCollection = { type: "FeatureCollection", features: coverageData?.features ?? [] };
  const isNisar = data?.data_source === "NISAR";
  const today = new Date().toISOString().slice(0, 10);
  const usingShowcase = !isNisar && !!showcase?.pulse;
  const featured = showcase?.pulse ? {
    name: (showcase.manifest.site_display_name ?? showcase.manifest.site_name).replace(/\s*·.*$/, "").replace(/\s+mapped boundary$/i, ""),
    date: showcase.pulse.peak.date, area: showcase.pulse.peak.area_km2, regions: showcase.pulse.dates.find((d) => d.date === showcase.pulse!.peak.date)?.patches ?? 0,
    dates: showcase.manifest.observation_dates, status: showcase.manifest.reference_check_status ?? "NOT_RUN",
    coverage: (showcase.reference.evidence?.coverage as { common_clear_fraction?: number } | undefined)?.common_clear_fraction } : null;
  const locateFeatured = () => {
    const b = showcase?.manifest.site_bounds; if (!b) return;
    setCoordinateTarget({ latitude: (b[1] + b[3]) / 2, longitude: (b[0] + b[2]) / 2 }); setFocusStudyArea(false);
    document.getElementById("global-nisar-map")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };
  const statusText = loading ? "Loading pipeline output…"
    : error ? (showcase ? "Local run not loaded · real showcase available" : "No local run loaded")
      : isNisar ? "NISAR · provisional candidates"
        : usingShowcase ? "Featured NISAR case · packaged"
          : "NISAR run required";
  const statusClass = loading ? "global-source-pill--loading" : error ? "global-source-pill--snapshot"
    : isNisar ? "global-source-pill--live" : "global-source-pill--snapshot";

  return (
    <main className="global-coverage-page detection-page">
      <header className="global-header">
        <div className="global-brand">
          <Link href="/" className="atlas-wordmark" aria-label="GeoNexSAR home">GeoNexSAR</Link>
          <span className="global-header__divider" aria-hidden="true" />
          <span className="global-header__section">Mission control</span>
        </div>
        <nav className="detection-header-actions" aria-label="GeoNexSAR">
          {featured && <Link className="global-back-link" href="/wetland">Processed case: {featured.name}</Link>}
          <Link className="global-back-link" href="/wetland/global/scenes">Search NISAR scenes</Link>
          <Link className="global-back-link" href="/">Home</Link>
        </nav>
      </header>

      <section className="global-intro detection-intro" aria-labelledby="global-detections-title">
        <div>
          <p className="atlas-micro">Mission control · worldwide NISAR</p>
          <h1 id="global-detections-title">Global Change Investigator</h1>
          <p className="global-description">Start anywhere on Earth. Find a place, check the real NISAR observations available for it, compare compatible dates, and investigate the resulting evidence. Global imagery is context — detections appear only after a real run has been processed.</p>
        </div>
        <nav className="atlas-goals" aria-label="What would you like to do?">
          <a href="#observe"><span className="atlas-micro">A · Browse</span><strong>Find a place to investigate</strong><small>Search a location, inspect real coverage, then choose observations to analyse.</small></a>
          <a href="#cases"><span className="atlas-micro">B · Open</span><strong>Explore processed cases</strong><small>Results we have already computed and checked.</small></a>
          <a href="#process"><span className="atlas-micro">C · Advanced</span><strong>Process another place</strong><small>Runs change detection on this computer.</small></a>
        </nav>
      </section>

      {featured && (
        <section className="atlas-featured" aria-labelledby="featured-case-title">
          <div>
            <p className="atlas-micro">Processed {cases.length > 1 ? "cases" : "case"} · real NISAR data</p>
            <h2 id="featured-case-title">{featured.name}</h2>
            <p>{featured.dates.length} NISAR observations from {featured.dates[0]} to {featured.dates[featured.dates.length - 1]}. At the peak ({featured.date}) the radar-change rules flagged <b>{featured.area.toFixed(2)} km²</b> in <b>{featured.regions}</b> regions.</p>
            <p className="atlas-check"><i aria-hidden="true" /><span>Independent optical check: <b>{featured.status === "INCONCLUSIVE" ? "inconclusive" : featured.status === "CROSS_SENSOR_CHECK" ? "completed" : "not run"}</b>{featured.coverage != null ? ` (${(featured.coverage * 100).toFixed(1)}% of the area could be compared)` : ""}. Candidates are not confirmed flooding.</span></p>
          </div>
          <div className="atlas-featured__actions">
            <Link href="/wetland" className="atlas-primary">Open the case</Link>
            <button type="button" className="atlas-secondary" onClick={locateFeatured}>Show on the world map</button>
            <span className="atlas-micro">Boundary: mapped site polygon. Source: NASA NISAR L2 GCOV (provisional).</span>
          </div>
          {cases.length > 1 && (
            <ul className="atlas-case-list" aria-label="All processed cases">
              {cases.map((c) => (
                <li key={c.id} aria-current={c.id === showcase?.manifest.case_id ? "true" : undefined}>
                  <Link href={c.id === showcase?.manifest.case_id ? "/wetland" : `/wetland?case=${encodeURIComponent(c.id)}`}>
                    <strong>{(c.site_display_name || c.site_name).replace(/\s*mapped boundary$/i, "")}</strong>
                    <span>{c.observation_count != null ? `${c.observation_count} observations` : "real NISAR case"} · open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="global-status-row detection-status" aria-live="polite">
        <div className="global-count">
          <strong>{loading ? "…" : isNisar ? (data?.stats?.patches ?? detections.features.length).toLocaleString() : usingShowcase ? (featured?.regions ?? 0).toLocaleString() : "—"}</strong>
          <span>{usingShowcase ? "radar-change candidates in the featured case (peak date)" : "radar-change candidates in processed areas only"}</span>
        </div>
        <div className="global-status-meta">
          <span className={`global-source-pill ${mosaicStatus === "loading" ? "global-source-pill--loading" : mosaicStatus === "error" ? "global-source-pill--error" : "global-source-pill--live"}`}><i aria-hidden="true" />{mosaicStatus === "loading" ? "Loading global NISAR mosaic…" : mosaicStatus === "error" ? "NISAR mosaic unavailable" : "NASA GIBS · daily"}</span>
          {isNisar && data?.stats && <span className="nisar-area-stat"><strong>{data.stats.area_km2.toFixed(2)} km²</strong> mapped candidate area</span>}
          <span className={`global-source-pill ${statusClass}`}><i aria-hidden="true" />{statusText}</span>
          <span className={`global-source-pill ${coverageLoading ? "global-source-pill--loading" : coverageError ? "global-source-pill--error" : coverageData?.snapshotFallback ? "global-source-pill--snapshot" : "global-source-pill--live"}`}><i aria-hidden="true" />{coverageLoading ? "Loading worldwide footprints…" : coverageError ? "Footprints unavailable" : coverageData?.snapshotFallback ? `NASA CMR snapshot · ${coverageData.loadedFeatures.toLocaleString()} footprints` : `${coverageData?.loadedFeatures.toLocaleString() ?? 0} NISAR footprints · ${coverageDate}`}</span>
          <button className="global-refresh" type="button" onClick={() => { setLoading(true); setError(""); setCoverageLoading(true); setCoverageError(""); setRefreshKey((value) => value + 1); }} disabled={loading}>Refresh results</button>
        </div>
      </div>

      <section id="observe" className="global-workspace detection-workspace" aria-label="A. Worldwide NISAR observations">
        <div className="global-map-panel">
          <div className="global-map-topline">
            <span>A · Worldwide observations: radar mosaic and acquisition footprints</span>
            <span>Daily acquisition mosaic{mosaicDate ? ` · ${mosaicDate}` : " · latest available"} · {coverage.features.length.toLocaleString()} catalog footprints</span>
          </div>
          <div id="global-nisar-map" className="global-map-wrap" role="region" aria-label="Worldwide NISAR backscatter mosaic with processed candidate overlay">
            <GlobalNisarDetectionMap
              detections={isNisar ? detections : usingShowcase ? showcaseDetections ?? emptyCollection() : emptyCollection()}
              boundary={isNisar ? data?.boundary ?? null : usingShowcase ? (showcase?.boundary as unknown as BoundaryCollection | null) ?? null : null}
              coverage={coverage}
              date={mosaicDate || null}
              focusStudyArea={focusStudyArea}
              coordinateTarget={coordinateTarget}
              onLayerReady={() => setMosaicStatus("ready")}
              onLayerError={() => setMosaicStatus((current) => current === "ready" ? current : "error")}
              resultKey={`${data?.run_id}-${data?.selected_date}`}
              areaBounds={areaBounds}
              areaDrawing={areaDrawing}
              pickingLocation={pickingLocation}
              onLocationSelected={chooseMapLocation}
              onAreaSelected={(bounds) => { setAreaBounds(bounds); setAreaBoundary(null); setAreaDrawing(false); setPickingLocation(false); setCoordinateTarget(null); setSelectedPlaceName(""); }}
            />
            {areaDrawing && <div className="nisar-drawing-notice" role="status">Click two opposite corners to select your study area. <button type="button" onClick={() => setAreaDrawing(false)}>Cancel</button></div>}
            {!loading && !isNisar && !usingShowcase && <div className="detection-map-badge" role="status">No local detector result loaded · blank map areas are not classified</div>}
            {usingShowcase && !showcaseDetections && <div className="detection-map-badge detection-map-badge--error" role="alert">{showcaseLoadError || "Loading the packaged NISAR candidate regions…"}</div>}
            {!loading && isNisar && detections.features.length === 0 && <div className="detection-map-badge" role="status">No candidates inside the processed boundary for {data?.selected_date} · elsewhere: no result</div>}
            {error && !usingShowcase && <div className="detection-map-badge" role="status">No processed run is loaded on this computer, so only worldwide observations are shown.</div>}
            {mosaicStatus === "error" && <div className="detection-map-badge detection-map-badge--error" role="alert">NASA has no mosaic tiles for this date, or the tile service is unreachable. Choose another date or open NASA Worldview.</div>}
          </div>
          <div className="global-map-legend detection-legend" aria-label="Map legend">
            <span><i className="detection-legend-swatch detection-legend-swatch--backscatter" />NISAR GCOV false-color backscatter · global mosaic</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--coverage" />Scene footprints · {coverageDate} · cyan ascending / amber descending</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--open-water" />HH-darkening candidate · exploratory</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--vegetated" />HH-increase / HV-stability candidate · exploratory</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--uncertain" />Uncertain candidate</span>
            <span><i className="detection-legend-swatch detection-legend-swatch--unprocessed" />No detector result · blank is not no change</span>
            <span className="global-legend-note">Dashed outline · study boundary</span>
          </div>
        </div>

        <aside className="global-scene-panel detection-info-panel" aria-label="Global mosaic and local detection controls">
          <div className="global-scene-panel__heading">
            <div><p className="global-eyebrow">GLOBAL SATELLITE OBSERVATIONS</p><h2>Worldwide NISAR mosaic</h2></div>
            <span className="global-live-mark"><i />NASA GIBS</span>
          </div>
          <p className="detection-panel-copy">The global layer is NASA’s false-color NISAR GCOV backscatter mosaic. It shows radar observations around the world; the colors are not flood or wetland classifications.</p>

          <form className="place-search-form" onSubmit={searchPlaceName}>
            <label className="detection-field-label" htmlFor="map-place-search">Find a place by name</label>
            <div className="place-search-row">
              <input id="map-place-search" className="map-coordinate-input" type="search" maxLength={120} minLength={3} value={placeQuery} onChange={(event) => { setPlaceQuery(event.target.value); setPlaceSearchError(""); setPlaceResults([]); }} placeholder="e.g. Okavango Delta, Botswana" disabled={placeSearchBusy} />
              <button className="map-coordinate-search-button" type="submit" disabled={placeSearchBusy || placeQuery.trim().length < 3}>{placeSearchBusy ? "Searching…" : "Find"}</button>
            </div>
            <p className="detection-helper">Place results are geocoded by OpenStreetMap Nominatim. They are locations, not satellite observations.</p>
            {placeSearchError && <p className="map-coordinate-error" role="status">{placeSearchError}</p>}
            {placeResults.length > 0 && <div className="place-search-results" role="listbox" aria-label="Place search results">
              {placeResults.map((place, index) => <button type="button" role="option" aria-selected={selectedPlaceName === place.display_name} key={`${place.latitude}-${place.longitude}-${index}`} onClick={() => selectPlace(place)}>
                <strong>{place.display_name}</strong><span>{place.category || "place"}{place.type ? ` · ${place.type}` : ""} · {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span>
              </button>)}
              <small>© OpenStreetMap contributors</small>
            </div>}
          </form>

          <form className="map-coordinate-form" onSubmit={searchCoordinates} noValidate>
            <div className="map-pick-row">
              <span className="detection-field-label">Choose directly on the map</span>
              <button className={`global-refresh map-pick-button${pickingLocation ? " is-active" : ""}`} type="button" aria-pressed={pickingLocation} onClick={() => { setPickingLocation((active) => !active); setAreaDrawing(false); setCoordinateError(""); }}>
                {pickingLocation ? "Click map to place pin… (Cancel)" : "Pick a point on map"}
              </button>
            </div>
            <label className="detection-field-label" htmlFor="map-coordinate-latitude">Or go to coordinates</label>
            <div className="map-coordinate-fields">
              <div>
                <label htmlFor="map-coordinate-latitude">Latitude</label>
                <input id="map-coordinate-latitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="25.1500 or 25°09′ N" value={coordinateLatitude} onChange={(event) => { setCoordinateLatitude(event.target.value); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
              <div>
                <label htmlFor="map-coordinate-longitude">Longitude</label>
                <input id="map-coordinate-longitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="91.0667 or 91°04′ E" value={coordinateLongitude} onChange={(event) => { setCoordinateLongitude(event.target.value); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
            </div>
            <p className="map-coordinate-help" id="map-coordinate-help">Decimal or degrees/minutes/seconds · map latitude −85.0511 to 85.0511 · longitude −180 to 180</p>
            {coordinateError && <p className="map-coordinate-error" id="map-coordinate-error" role="alert">{coordinateError}</p>}
            <button className="map-coordinate-search-button" type="submit">Search map</button>
            {pickingLocation && <p className="map-coordinate-result" role="status">Click the map once to select a location. The pin will be used only as a location, not as a detection.</p>}
            {coordinateTarget && <>
              <p className="map-coordinate-result" role="status">Selected location: {selectedPlaceName || `${coordinateTarget.latitude.toFixed(5)}°, ${coordinateTarget.longitude.toFixed(5)}°`}.</p>
              <button className="global-refresh map-coordinate-handoff" type="button" onClick={useCoordinatesForAnalysis}>Use this location for analysis →</button>
              <p className="detection-helper">Creates a small, editable study box only. No detections are created until real observations are processed.</p>
            </>}
          </form>

          <p className="detection-field-label">Global observation mosaic</p>
          <p className="detection-panel-copy">NASA GIBS daily NISAR L2 GCOV false-color tiles.</p>

          <label className="detection-field-label" htmlFor="nisar-mosaic-date">Mosaic date (UTC)</label>
          <div className="detection-date-row">
            <input id="nisar-mosaic-date" className="detection-date-input" type="date" max={today} value={mosaicDate} onChange={(event) => { setMosaicStatus("loading"); setMosaicDate(event.target.value); }} />
            {mosaicDate && <button className="global-refresh" type="button" onClick={() => { setMosaicStatus("loading"); setMosaicDate(""); }}>Latest</button>}
          </div>
          <p className="detection-helper">Choose a date with available tiles, or leave blank to use the latest date published by NASA GIBS.</p>

          <label className="detection-field-label" htmlFor="nisar-coverage-date">Worldwide scene footprints (UTC)</label>
          <input id="nisar-coverage-date" className="detection-date-input" type="date" min="2026-06-17" max={today} value={coverageDate} onChange={(event) => { setCoverageLoading(true); setCoverageError(""); setCoverageDate(event.target.value); }} />
          <p className="detection-helper">{coverageLoading ? "Checking NASA’s global catalog…" : coverageError ? coverageError : `${coverageData?.totalHits.toLocaleString() ?? 0} catalog records · ${coverageData?.loadedFeatures.toLocaleString() ?? 0} footprints shown.`} Each outline marks an acquired scene, not a flood detection.</p>

          {showcaseLoadError && !isNisar && <div className="detection-note detection-note--error" role="alert"><strong>Packaged case unavailable</strong><span>{showcaseLoadError} Reload the page or load another real local run. The app will not substitute generated detections.</span></div>}

          <div className="detection-note detection-note--static">
            <strong>Backscatter is not a detection</strong>
            <span>Global false-color imagery provides SAR context. Flood or inundation candidates require a temporal classifier and can only be overlaid where this project has processed NISAR scenes.</span>
          </div>

          <details className="detection-note detection-note--radar-guide">
            <summary>How radar reveals different kinds of flooding</summary>
            <div className="detection-radar-guide__content">
              <p>NISAR sends microwave signals and measures what returns from the ground. It can observe through clouds and at night, and its L-band signal can help reveal water beneath vegetation.</p>
              <ul>
                <li><strong>Open water:</strong> often has a low, dark return in radar imagery.</li>
                <li><strong>Flooded vegetation:</strong> water among trees or marsh plants can create a different, sometimes stronger return than dry vegetation.</li>
              </ul>
              <p className="detection-radar-guide__caveat">These are common patterns, not a universal color key. The signal also depends on land cover, polarization, viewing geometry, and image processing. The global mosaic colors alone are not a flood classification.</p>
              <p><strong>Read this run:</strong> dates and radar layers appear under <em>Radar-change candidates</em>; its change rules show the detector method. The case study below reports the independent check and threshold sensitivity when they are available.</p>
              <a className="detection-radar-guide__case-link" href="#nisar-case-story-title">Go to this run’s reference and uncertainty details ↓</a>
              <div className="detection-radar-guide__sources" aria-label="Radar flood mapping sources">
                <a href="https://www.youtube.com/watch?v=2ZMW051InVY" target="_blank" rel="noopener noreferrer">JPL talk · NISAR for Flood Mapping ↗</a>
                <a href="https://svs.gsfc.nasa.gov/5661" target="_blank" rel="noopener noreferrer">NASA example · NISAR flood observations in Mozambique ↗</a>
                <p>The talk’s Hurricane Matthew example is from 2016, before NISAR’s <a href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noopener noreferrer">2025 launch</a>; it illustrates radar mapping, not a NISAR observation.</p>
              </div>
            </div>
          </details>

          <a className="global-data-link" href="#nisar-process">Process another place <span>Select an area, find a NISAR pair and follow its progress ↓</span></a>

          <div className="detection-local-results">
            <div className="global-scene-panel__heading">
              <div><p className="global-eyebrow">DERIVED LAYER · LOCAL RUN</p><h2>{isNisar ? "Radar-change candidates" : "No real candidates loaded"}</h2></div>
              <span className={`global-live-mark ${isNisar ? "" : "detection-static-mark"}`}><i />{isNisar ? "NISAR run" : "No real run"}</span>
            </div>
              <label className="detection-field-label" htmlFor="nisar-saved-run">Saved study areas and runs</label>
              <select id="nisar-saved-run" className="detection-select" value={selectedRun} onChange={(event) => { setSelectedRun(event.target.value); setCandidateDate(""); setLoading(true); setError(""); setFocusStudyArea(true); setAreaBounds(null); setAreaBoundary(null); setCoordinateTarget(null); }}>
                <option value="">Latest completed result</option>
                {savedRuns.map((run) => <option key={run.run_id} value={run.run_id}>{run.site_name} · {run.baseline_date} → {run.selected_date} · {run.run_id.slice(0, 6)}</option>)}
              </select>
              {runsError && <p className="nisar-tool-error">{runsError}</p>}
            {isNisar ? <>
              <p className="detection-panel-copy">{detections.features.length} candidate regions · {data?.stats?.area_km2.toFixed(2) ?? "0.00"} km² · {data?.selected_date}. Results cover the processed study area only.</p>
              <label className="detection-field-label" htmlFor="nisar-candidate-date">Processed observation</label>
              <select id="nisar-candidate-date" className="detection-select" value={candidateDate || data?.selected_date || ""} onChange={(event) => { setLoading(true); setError(""); setCandidateDate(event.target.value); }}>
                {data?.dates.map((observationDate) => <option key={observationDate} value={observationDate}>{observationDate}</option>)}
              </select>
              <dl className="nisar-run-details">
                <div><dt>Product</dt><dd>{data?.product ?? "NISAR L2 GCOV"}</dd></div>
                <div><dt>{(data?.selected_baseline?.baseline_observation_count ?? 1) > 1 ? "Radar baseline dates" : "Date pair"}</dt><dd>{data?.selected_baseline?.baseline_observation_dates?.join(", ") ?? data?.baseline_date ?? "?"} → {data?.selected_date ?? "?"}</dd></div>
                <div><dt>Radar layers</dt><dd>{data?.polarizations.join(" · ") || "Not recorded"}</dd></div>
                <div><dt>Input scenes</dt><dd title={`${data?.selected_baseline?.baseline_scene_names?.join("\n") ?? data?.baseline_scene ?? ""}\n${data?.selected_scene ?? ""}`}>{data?.selected_baseline?.baseline_scene_names?.length ?? (data?.baseline_scene ? 1 : 0)} baseline scene(s) / {data?.selected_scene ? `${data.selected_scene.slice(0, 24)}…` : "Not recorded"}</dd></div>
                <div><dt>Optical cross-check</dt><dd>{data?.case_study?.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "Complete · no area overlap" : "Comparison complete" : data?.case_study?.reference_validation?.status?.replaceAll("_", " ").toLowerCase() ?? "Not available"}</dd></div>
              </dl>
              {data?.case_study?.method && <div className="detection-method-summary">
                <strong>Change rules · {data.case_study.method.threshold_db?.toFixed(1) ?? "—"} dB base cutoff</strong>
                <span>HH darkening rule · {data.case_study.method.open_water_rule}</span>
                <span>{data.case_study.method.vegetated_inundation_rule}</span>
              </div>}
              <div className="detection-scope-actions">
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(true)} disabled={!data?.boundary}>Zoom to processed area</button>
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(false)}>World view</button>
              </div>
              <p className="detection-helper">NISAR backscatter mosaic is global; derived candidate polygons are from run {data?.run_id.slice(0, 8)} only.</p>
              {data?.boundary_source && <p className="detection-helper">Study mask: {data.boundary_source}.</p>}
            </> : <>
              <p className="detection-panel-copy">No completed real NISAR detection run is available for this selection. The footprints and backscatter mosaic show observations only; no change result is loaded for the rest of the world.</p>
              <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Load or run the local study-area pipeline ↗</span></Link>
            </>}
          </div>

          {(isNisar || usingShowcase) && <section className="atlas-report-tools" aria-labelledby="atlas-report-title">
            <div><p className="atlas-micro">REPRODUCIBLE OUTPUT</p><h3 id="atlas-report-title">Export this investigation</h3>
              <p>Download the currently visible real NISAR candidate set with dates, source provenance and scientific limitations. A zero-region export is allowed only after the selected candidate file has loaded; it is not interpreted as proof of no change.</p>
              {usingShowcase && !showcaseDetections && <p className="atlas-report-message" role="status">Candidate regions are loading. Export controls will work when the packaged source file is verified.</p>}
            </div>
            <div className="atlas-report-actions">
              <button type="button" className="atlas-secondary" onClick={() => downloadInvestigation("csv")} disabled={usingShowcase && !showcaseDetections}>Region table · CSV</button>
              <button type="button" className="atlas-secondary" onClick={() => downloadInvestigation("geojson")} disabled={usingShowcase && !showcaseDetections}>Candidate map · GeoJSON</button>
              <button type="button" className="atlas-secondary" onClick={() => downloadInvestigation("json")} disabled={usingShowcase && !showcaseDetections}>Evidence snapshot · JSON</button>
              <button type="button" className="atlas-primary" onClick={() => downloadInvestigation("html")} disabled={usingShowcase && !showcaseDetections}>Report · HTML / Save PDF</button>
              <button type="button" className="atlas-secondary" onClick={() => void shareCurrentInvestigation()}>Share this case</button>
            </div>
            {reportMessage && <p className="atlas-report-message" role="status">{reportMessage}</p>}
            {shareUrl && <label className="atlas-share-field">Share URL <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Shareable investigation URL" /></label>}
          </section>}

          <div className="detection-note">
            <strong>Map coverage</strong>
            <span>Scene footprints show acquisitions. The dashed outline shows the detector’s processed study mask. Blank land elsewhere means no detector result is available; it does not mean no change occurred.</span>
          </div>
          <Link className="global-data-link" href="/wetland/global/scenes">Inspect worldwide acquisition footprints <span>NASA CMR scene catalog ↗</span></Link>
          <a className="detection-worldview-link" href="https://worldview.earthdata.nasa.gov/?l=NISAR_L2_Geocoded_Polarimetric_Covariance" target="_blank" rel="noreferrer">Open this NISAR layer in NASA Worldview ↗</a>
        </aside>
      </section>

      <div id="cases" className="atlas-cases-anchor"><p className="atlas-micro">B · Processed cases</p><h2>Results from processed observations</h2><p>These sections describe the case loaded from a saved local run. The featured case above is available without any local setup.</p></div>
      {isNisar && data?.selected_date && !loading && <RadarComparison runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}
      {isNisar && data?.selected_date && !loading && <SavedDateCheck runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}

      {isNisar && data?.case_study ? <section className="nisar-case-story" aria-labelledby="nisar-case-story-title">
        <div className="nisar-case-story__heading">
          <div><p className="global-eyebrow">FEATURED CASE · {data.case_study.site ?? "LOCAL STUDY AREA"}</p>
            <h2 id="nisar-case-story-title">{data.case_study.title ?? "NISAR change case"}</h2></div>
        <span className={`global-source-pill ${data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" && (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) !== 0 ? "global-source-pill--live" : "global-source-pill--snapshot"}`}>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "HLS check complete · no change overlap" : "HLS cross-sensor check complete"
              : data.case_study.reference_validation?.status === "UNAVAILABLE" ? "HLS data unavailable"
                : data.case_study.reference_validation?.status === "NOT_RUN" ? "HLS check not run" : "HLS check inconclusive"}
          </span>
        </div>
        <p className="nisar-case-story__lead">
          {data.case_study.candidate_patches
            ? `From ${data.case_study.baseline_date} to ${data.case_study.event_date}, the NISAR change rules flagged ${data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² across ${data.case_study.candidate_patches} candidate region${data.case_study.candidate_patches === 1 ? "" : "s"} inside the ${data.case_study.site ?? "study area"} mask. These are places to investigate, not confirmed flood detections.`
            : `For the ${data.case_study.baseline_date} → ${data.case_study.event_date} pair, the detector produced no candidate regions inside its processed study mask. This does not establish that no flooding or surface change occurred.`}
        </p>
        <div className="nisar-case-story__grid">
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">01 · OBSERVATIONS</span>
            <h3>Matched radar dates</h3>
            <p><strong>{data.case_study.method?.baseline_method?.baseline_observation_count && data.case_study.method.baseline_method.baseline_observation_count > 1 ? `Median baseline · ${data.case_study.method.baseline_method.baseline_observation_dates?.join(", ")}` : data.case_study.baseline_date}</strong> baseline<br /><strong>{data.case_study.event_date}</strong> comparison</p>
            <p className="nisar-case-step__detail">NISAR L2 GCOV provisional · {(data.case_study.polarizations ?? ["HHHH", "HVHV"]).join(" / ")}</p>
            {data.case_study.input_origin === "SAVED_NISAR_DB_SUBSETS" && <p className="nisar-case-step__detail">Measured radar subsets reused from saved run {data.case_study.source_run_id?.slice(0, 8)}. The original case remains in Saved analyses.</p>}
            {data.case_study.date_pair_selection && <p className="nisar-case-step__detail">Date selection screened {data.case_study.date_pair_selection.screened_scenes} optical scenes across {data.case_study.date_pair_selection.candidate_pairs} radar pairs. {data.case_study.date_pair_selection.method}</p>}
            <code title={`${(data.case_study.baseline_scenes ?? [data.case_study.baseline_scene]).filter(Boolean).join("\n")}\n${data.case_study.event_scene ?? ""}`}>{data.case_study.baseline_scenes?.length ? `${data.case_study.baseline_scenes.length} baseline scenes · ${data.case_study.baseline_scenes[0]}${data.case_study.baseline_scenes.length > 1 ? " …" : ""}` : data.case_study.baseline_scene ?? "Baseline scene not recorded"}<br />{data.case_study.event_scene ?? "Comparison scene not recorded"}</code>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">02 · DETECTOR RESULT</span>
            <h3>{data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² flagged by rules</h3>
            {Object.entries(data.case_study.classes ?? {}).length ? Object.entries(data.case_study.classes ?? {}).map(([name, summary]) => <p key={name}><strong>{name === "OPEN_WATER" ? "HH darkening candidate" : name === "VEGETATED_INUNDATION" ? "HH increase / HV stability candidate" : name.replaceAll("_", " ").toLowerCase()}</strong> · {summary.patches} regions · {summary.area_km2.toFixed(2)} km² · ΔHH {summary.mean_delta_hh_db?.toFixed(2) ?? "—"} dB</p>) : <p>No algorithmic candidate polygons were produced for this pair.</p>}
            <p className="nisar-case-step__detail">Rules run only within the configured study boundary, after HH/HV alignment and validity masking. HH darkening does not establish a dry-to-water transition or a flood.</p>
            {data.case_study.method?.baseline_method && <p className="nisar-case-step__detail">Baseline: {data.case_study.method.baseline_method.baseline_observation_count ?? 1} preceding observation(s) · {(data.case_study.method.baseline_method.baseline_observation_dates ?? []).join(", ")}. {data.case_study.method.baseline_method.baseline_hh_temporal_mad_db != null ? `Median HH temporal MAD ${data.case_study.method.baseline_method.baseline_hh_temporal_mad_db.toFixed(2)} dB.` : "Single-observation spread is not estimated."}</p>}
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">03 · INDEPENDENT SENSOR</span>
            <h3>{data.case_study.reference_validation?.reference_product ?? "HLS optical reference unavailable"}</h3>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? <>
              <p>Clear overlap: <strong>{((data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}%</strong> of the study mask</p>
              <p className="nisar-case-step__detail">{(data.case_study.reference_validation.optical_support?.common_clear_area_km2 ?? data.case_study.reference_validation.coverage?.common_clear_area_km2)?.toFixed(2) ?? "—"} km² could be compared. The remaining {(100 - (data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}% is unassessed by this reference.</p>
              <p>{data.case_study.reference_validation.optical_support ? "Area-weighted precision" : "Legacy grid precision"} <strong>{(data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision ?? 0) * 100).toFixed(1)}%`}</strong> · Recall <strong>{(data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall ?? 0) * 100).toFixed(1)}%`}</strong> · F1 <strong>{(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1 ?? 0) * 100).toFixed(1)}%`}</strong></p>
              {data.case_study.reference_validation.optical_support?.precision != null
                ? <p className="nisar-case-step__detail">Area-weighted on native HLS cells, {(data.case_study.reference_validation.optical_support.precision * 100).toFixed(1)}% of the assessed HH-darkening candidate area overlaps newly wet HLS support. This is satellite agreement, not confirmed flood accuracy.</p>
                : data.case_study.reference_validation.metrics?.precision != null && <p className="nisar-case-step__detail">Legacy radar-grid comparison: {(data.case_study.reference_validation.metrics.precision * 100).toFixed(1)}% of assessed radar candidate pixels overlap newly wet HLS pixels. This is satellite agreement, not confirmed flood accuracy.</p>}
              {(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 && <p><strong>No overlapping change support.</strong> This comparison does not corroborate the candidates. Different acquisition dates, shoreline mixtures and radar effects require further investigation.</p>}
              <p className="nisar-case-step__detail">MNDWI &gt; {data.case_study.reference_validation.comparison?.mndwi_threshold?.toFixed(2) ?? "0.00"} on cloud-screened {data.case_study.reference_validation.comparison?.spatial_resolution_m ?? 30} m HLS cells. The separate score area-averages valid and candidate radar support to that native grid. Dates: {data.case_study.reference_validation.comparison?.baseline?.hls_date ?? "—"} → {data.case_study.reference_validation.comparison?.event?.hls_date ?? "—"}.</p>
            </> : <p>{data.case_study.reference_validation?.reason ?? "No independent reference result is available for this case."}</p>}
            {data.case_study.reference_validation?.selection && <p className="nisar-case-step__detail">{data.case_study.reference_validation.selection.evaluated_pairs} of {data.case_study.reference_validation.selection.available_pairs} date-matched pairs evaluated. {data.case_study.reference_validation.selection.method}</p>}
            {data.case_study.reference_validation?.selection?.catalog_searches && <p className="nisar-case-step__detail">Collections searched: {data.case_study.reference_validation.selection.catalog_searches.map((item) => `${item.collection}: ${item.status === "SEARCHED" ? `${item.records} records` : "unavailable"}`).join(" · ")}</p>}
            {data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Before reference: {data.case_study.reference_validation.comparison.baseline?.product || "S30"}, {data.case_study.reference_validation.comparison.baseline?.offset_days ?? "—"} days from radar. After reference: {data.case_study.reference_validation.comparison.event?.product || "S30"}, {data.case_study.reference_validation.comparison.event?.offset_days ?? "—"} days from radar.</p>}
            {data.case_study.reference_validation?.status !== "CROSS_SENSOR_CHECK" && data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Reference dates: {data.case_study.reference_validation.comparison.baseline?.hls_date} → {data.case_study.reference_validation.comparison.event?.hls_date}. Common clear coverage: {((data.case_study.reference_validation.coverage?.common_clear_fraction || 0)*100).toFixed(1)}%.</p>}
            <a href="#nisar-process">Retry the independent reference check ↑</a>
            <p><a href="#nisar-reference-evidence">Inspect optical images and the disagreement ↓</a></p>
            <p className="nisar-case-step__detail">Cross-sensor agreement is not field truth or a formal accuracy estimate; vegetated inundation is not checked.</p>
            <a className="detection-worldview-link" href={data.case_study.reference_validation?.source_url || "https://hls.gsfc.nasa.gov/data-products/"} target="_blank" rel="noreferrer">NASA HLS reference source ↗</a>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">04 · UNCERTAINTY</span>
            <h3>{data.case_study.uncertainty?.threshold_sensitivity?.stability_verdict ?? "Threshold stability unavailable"}</h3>
            <p>{data.case_study.uncertainty?.threshold_sensitivity?.stable_range?.length ? `Candidate area was swept across ${data.case_study.uncertainty.threshold_sensitivity.stable_range[0].toFixed(1)}–${data.case_study.uncertainty.threshold_sensitivity.stable_range.at(-1)?.toFixed(1)} dB.` : data.case_study.uncertainty?.threshold_sensitivity?.sensitivity_note ?? "Threshold sensitivity was not computed."}</p>
            <p className="nisar-case-step__detail">{data.case_study.method?.validity_rule} GCOV is provisional; thresholds are exploratory and not field-calibrated.</p>
            {data.case_study.method?.gcov_quality && <>
              <p className="nisar-case-step__detail">numberOfLooks rule: {data.case_study.method.gcov_quality.number_of_looks_rule}. Averaging mask: {data.case_study.method.gcov_quality.mask_rule}.</p>
              {!!data.case_study.method.gcov_quality.scenes?.length && <p className="nisar-case-step__detail">Per-scene median numberOfLooks: {data.case_study.method.gcov_quality.scenes.map((item) => `${item.scene?.slice(-20) ?? "scene"} ${item.number_of_looks_median?.toFixed(1) ?? "—"}`).join(" · ")}.</p>}
            </>}
          </article>
        </div>
        <div className="nisar-case-story__impact"><strong>Why this matters</strong><p>{data.case_study.impact_context}</p></div>
        <p className="nisar-case-story__scope">{data.case_study.spatial_scope}</p>
      </section> : <section className="nisar-case-story nisar-case-story--empty" aria-labelledby="nisar-case-story-title">
        <div><p className="global-eyebrow">CASE STUDY · AWAITING REAL PIPELINE OUTPUT</p><h2 id="nisar-case-story-title">No real NISAR change case is loaded</h2>
          <p>Worldwide footprints mark acquisitions only. Run the real NISAR pipeline for the configured study boundary to create a before-and-after result and attempt the independent HLS Sentinel-2/Landsat cross-check. Until then, blank areas mean no detector result is available.</p>
          <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Run a real NISAR analysis ↗</span></Link></div>
      </section>}

      <MozambiqueFloodCase onLocate={locateMozambiqueCase} />

      {isNisar && data?.case_study && !loading && <ReferenceEvidence runId={data.run_id} refreshKey={refreshKey} />}

      <section id="process" className="atlas-process" aria-labelledby="process-title">
        <div className="atlas-process__head">
          <p className="atlas-micro">C · Advanced</p><h2 id="process-title">Process another place</h2>
          <p>Searching the global catalogue only lists observations. <b>Change detection runs only when you launch processing</b> in step 3, on this computer. If you only want to explore, you can skip this section.</p>
          <ol className="atlas-steps" aria-label="Local NISAR workflow progress">
            {[
              { title: "Choose or draw", text: "a study area on the map.", done: processProgress.areaReady },
              { title: "Search", text: "for compatible NISAR observations.", done: processProgress.searchComplete },
              { title: "Select & launch", text: "the local processing workflow.", done: processProgress.processingStarted },
              { title: "Follow", text: "the actual processing job to completion.", done: processProgress.processingComplete },
              { title: "Inspect", text: "the loaded results and evidence.", done: processProgress.resultsLoaded },
            ].map((item, index) => {
              const step = index + 1;
              const current = !processProgress.failed && step === processProgress.activeStep;
              const failedStep = processProgress.failed && step === processProgress.activeStep;
              const status = item.done ? "is-complete" : failedStep ? "is-failed" : current ? "is-current" : "";
              return <li key={item.title} className={status} aria-current={current || failedStep ? "step" : undefined}>
                <span className="atlas-step-status" aria-hidden="true">{item.done ? "✓" : failedStep ? "!" : step}</span>
                <b>{item.title}</b> {item.text}
              </li>;
            })}
          </ol>
          <div className="atlas-progress-meta" aria-live="polite">
            <span>{processProgress.failed ? "Processing failed — inspect the error below and retry." : processProgress.completedCount === 5 ? "Workflow complete · results loaded" : `Step ${processProgress.activeStep} of 5 · ${processProgress.completedCount} completed`}</span>
            <span>{Math.round(processProgress.completedCount / 5 * 100)}%</span>
            <div className="atlas-progress-track" role="progressbar" aria-label="Processing workflow completion" aria-valuemin={0} aria-valuemax={5} aria-valuenow={processProgress.completedCount}>
              <i className={processProgress.failed ? "is-failed" : ""} style={{ width: `${processProgress.completedCount / 5 * 100}%` }} />
            </div>
          </div>
        </div>
      <NisarProcessingPanel bounds={areaBounds} boundary={areaBoundary} drawing={areaDrawing}
        onDraw={(drawing) => { setAreaDrawing(drawing); if (drawing) setPickingLocation(false); }} onAreaChange={applyArea} quickStartBox={quickStartBox} quickStartSiteName={quickStartSiteName}
        savedAreas={savedRuns} onLoadSavedArea={loadSavedAreaForProcessing}
        loadedArea={isNisar && data?.boundary && data.baseline_date && data.case_study?.event_date ? {
          runId: data.run_id, name: data.site_name || data.case_study.site || "Study area", boundary: data.boundary,
          baselineDate: data.baseline_date, eventDate: data.case_study.event_date } : null}
        onRunReady={loadFinishedRun} onProgress={updateProcessProgress} />
      </section>

      <footer className="global-footer detection-footer">
        <span>Global observation source: NASA GIBS daily NISAR L2 GCOV mosaic.</span>
        <span>{isNisar ? `Local candidate overlay: run ${data?.run_id.slice(0, 8)} · see case study for scope and cross-sensor check.` : "The global mosaic and footprints are observations, not worldwide classifications."}</span>
      </footer>
    </main>
  );
}
