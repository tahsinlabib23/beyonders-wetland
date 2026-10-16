export type ReportFormat = "json" | "csv" | "geojson" | "html";
export interface ReportRegion {
  id: string;
  date?: string | null;
  classification?: string | null;
  area_km2?: number | null;
  evidence_state?: string | null;
  geometry?: unknown;
  [key: string]: unknown;
}
export interface InvestigationReportInput {
  title: string;
  siteName: string;
  source: "NISAR_SHOWCASE" | "NISAR_LOCAL_RUN";
  runId?: string | null;
  product?: string | null;
  productMaturity?: string | null;
  baselineDate?: string | null;
  selectedDate?: string | null;
  observationDates?: string[];
  siteBounds?: [number, number, number, number] | null;
  boundarySource?: string | null;
  referenceStatus?: string | null;
  referenceSummary?: string | null;
  uncertaintySummary?: string | null;
  regions: ReportRegion[];
  limitations: string[];
  generatedAt?: string;
}

export interface InvestigationReport extends InvestigationReportInput {
  schemaVersion: 1;
  generatedAt: string;
  dataSource: "NISAR";
  resultType: "radar-change candidates";
  regionCount: number;
  candidateAreaKm2: number;
  disclaimer: string;
}

export function buildInvestigationReport(input: InvestigationReportInput): InvestigationReport {
  const regions = input.regions.map((region) => ({ ...region }));
  const candidateAreaKm2 = regions.reduce((sum, region) => sum + (typeof region.area_km2 === "number" && Number.isFinite(region.area_km2) ? Math.max(0, region.area_km2) : 0), 0);
  return {
    ...input,
    regions,
    observationDates: [...(input.observationDates ?? [])],
    limitations: [...input.limitations],
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schemaVersion: 1,
    dataSource: "NISAR",
    resultType: "radar-change candidates",
    regionCount: regions.length,
    candidateAreaKm2: Number(candidateAreaKm2.toFixed(6)),
    disclaimer: "These are algorithmic radar-change candidates, not confirmed flooding, forest loss, or ground deformation. Validation status and limitations must be read with the results.",
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function investigationReportCsv(report: InvestigationReport): string {
  const fields = ["id", "date", "classification", "area_km2", "evidence_state", "geometry_type"] as const;
  const header = [...fields, "run_id", "source", "product", "product_maturity", "reference_status"].map(csvCell).join(",");
  const rows = report.regions.map((region) => [
    region.id, region.date, region.classification, region.area_km2, region.evidence_state,
    (region.geometry && typeof region.geometry === "object" ? (region.geometry as { type?: unknown }).type : "") ?? "",
    report.runId, report.source, report.product, report.productMaturity, report.referenceStatus,
  ].map(csvCell).join(","));
  return [header, ...rows].join("\r\n");
}

export function investigationReportGeoJson(report: InvestigationReport) {
  return {
    type: "FeatureCollection" as const,
    metadata: {
      schemaVersion: report.schemaVersion,
      title: report.title,
      siteName: report.siteName,
      source: report.source,
      dataSource: report.dataSource,
      runId: report.runId ?? null,
      product: report.product ?? null,
      productMaturity: report.productMaturity ?? null,
      baselineDate: report.baselineDate ?? null,
      selectedDate: report.selectedDate ?? null,
      regionCount: report.regionCount,
      candidateAreaKm2: report.candidateAreaKm2,
      referenceStatus: report.referenceStatus ?? "NOT_RECORDED",
      disclaimer: report.disclaimer,
      limitations: report.limitations,
    },
    features: report.regions.map((region) => ({
      type: "Feature" as const,
      geometry: region.geometry && typeof region.geometry === "object" ? region.geometry : null,
      properties: Object.fromEntries(Object.entries(region).filter(([key]) => key !== "geometry")),
    })),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function investigationReportHtml(report: InvestigationReport): string {
  const rows = report.regions.map((region) => `<tr><td>${escapeHtml(region.id)}</td><td>${escapeHtml(region.date)}</td><td>${escapeHtml(region.classification)}</td><td>${escapeHtml(typeof region.area_km2 === "number" ? region.area_km2.toFixed(4) : "—")}</td><td>${escapeHtml(region.evidence_state ?? "Not recorded")}</td></tr>`).join("");
  const limits = report.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(report.title)}</title><style>
  :root{color-scheme:light}body{font:15px/1.55 Inter,system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 24px;color:#14202a}header{border-bottom:3px solid #d97706;padding-bottom:20px;margin-bottom:24px}h1,h2{line-height:1.2}h1{font-size:32px;margin:8px 0}h2{font-size:18px;margin-top:28px}.eyebrow{font:600 11px ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase;color:#8a4b08}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.metric{padding:14px;border:1px solid #d6d9dc}.metric strong{display:block;font-size:22px}.meta{display:grid;grid-template-columns:160px 1fr;gap:5px 14px}.meta dt{font-weight:600}.meta dd{margin:0;overflow-wrap:anywhere}.notice{background:#fff7e6;border-left:3px solid #d97706;padding:14px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #d6d9dc;padding:9px;vertical-align:top}th{background:#f4f5f6}@media print{body{margin:0;max-width:none}.no-print{display:none}}@media(max-width:620px){.metrics{grid-template-columns:1fr}.meta{grid-template-columns:1fr}}
  </style></head><body><header><div class="eyebrow">GeoNexSAR · Scientific investigation report</div><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.siteName)} · Generated ${escapeHtml(report.generatedAt)}</p></header>
  <div class="notice"><strong>Interpretation:</strong> ${escapeHtml(report.disclaimer)}</div><div class="metrics"><div class="metric"><strong>${report.regionCount}</strong>candidate regions</div><div class="metric"><strong>${report.candidateAreaKm2.toFixed(3)} km²</strong>summed candidate area (may overlap by detector design)</div><div class="metric"><strong>${escapeHtml(report.referenceStatus ?? "Not recorded")}</strong>independent-reference status</div></div>
  <h2>Observation and processing provenance</h2><dl class="meta"><dt>Data source</dt><dd>NASA NISAR (${escapeHtml(report.source)})</dd><dt>Product</dt><dd>${escapeHtml(report.product ?? "Not recorded")}</dd><dt>Product maturity</dt><dd>${escapeHtml(report.productMaturity ?? "Not recorded")}</dd><dt>Run ID</dt><dd>${escapeHtml(report.runId ?? "Packaged showcase")}</dd><dt>Baseline</dt><dd>${escapeHtml(report.baselineDate ?? "Not recorded")}</dd><dt>Selected observation</dt><dd>${escapeHtml(report.selectedDate ?? "Not recorded")}</dd><dt>Observation dates</dt><dd>${escapeHtml((report.observationDates ?? []).join(", ") || "Not recorded")}</dd><dt>Boundary source</dt><dd>${escapeHtml(report.boundarySource ?? "Not recorded")}</dd><dt>Bounds (W,S,E,N)</dt><dd>${escapeHtml(report.siteBounds?.join(", ") ?? "Not recorded")}</dd></dl>
  <h2>Candidate region register</h2><div style="overflow-x:auto"><table><thead><tr><th>Region</th><th>Date</th><th>Classification</th><th>Area km²</th><th>Evidence status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No candidate features are available for this selection. This is not evidence of no environmental change.</td></tr>'}</tbody></table></div>
  <h2>Reference and uncertainty</h2><p><strong>Reference status:</strong> ${escapeHtml(report.referenceStatus ?? "Not recorded")}</p><p>${escapeHtml(report.referenceSummary ?? "No independent comparison summary was recorded for this export.")}</p><p>${escapeHtml(report.uncertaintySummary ?? "No uncertainty summary was recorded for this export.")}</p><h2>Limitations</h2><ul>${limits || "<li>No additional limitation text was recorded.</li>"}</ul><button class="no-print" onclick="window.print()">Print / Save PDF</button></body></html>`;
}

export function buildInvestigationShareUrl(baseUrl: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(baseUrl);
  for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}
