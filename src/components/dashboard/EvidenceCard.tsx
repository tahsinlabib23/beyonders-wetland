"use client";

import { useWetlandStore } from "@/lib/store";
import { STATUS_COLORS } from "@/lib/constants";
import type { EvidenceCardData, DataLabel } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function LabelBadge({ label }: { label: DataLabel }) {
  return (
    <span className={`data-label data-label--${label.toLowerCase()}`}>
      {label}
    </span>
  );
}

export default function EvidenceCard() {
  const { selectedPatch, demoMode } = useWetlandStore();

  if (!selectedPatch) {
    return (
      <CardContent>
        <CardHeader>
          <CardTitle accent>Evidence Card</CardTitle>
        </CardHeader>
        <div style={{ padding: "30px 10px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Select a candidate region from the map or table to view forensic evidence.
        </div>
      </CardContent>
    );
  }

  const data: EvidenceCardData = {
    region_id: selectedPatch.id,
    region_name: "Patch " + selectedPatch.id.split("_").pop(),
    date: selectedPatch.date,
    candidate_area_km2: selectedPatch.area_km2,
    valid_fraction: selectedPatch.valid_fraction,
    quality: selectedPatch.quality_status,
    spatial_consistency: selectedPatch.spatial_status,
    temporal_evidence: selectedPatch.temporal_status,
    threshold_stability: selectedPatch.threshold_stability,
    vegetated_signal: selectedPatch.classification === "VEGETATED_INUNDATION" ? "POTENTIAL" : "NONE",
    evidence_strength: selectedPatch.evidence_state,
    data_source: selectedPatch.data_source || "UNVERIFIED",
    provenance: {
      observed: selectedPatch.data_source === "SIMULATED_DEMO"
        ? demoMode ? ["Synthetic browser HH / HV responses", "Fictional date and response bands"] : ["Generated HH / HV raster pixels", "Generated date and binary quality masks"]
        : selectedPatch.data_source === "NISAR"
          ? ["NISAR L2 GCOV frequency A HHHH / HVHV observations", `Acquisition date ${selectedPatch.date}`]
          : ["HH / HV inputs — verify original product provenance", "Reported acquisition date"],
      derived: [`ΔHH = ${selectedPatch.delta_hh?.toFixed(1) || "N/A"} dB`, `ΔHV = ${selectedPatch.delta_hv?.toFixed(1) || "N/A"} dB`, `Candidate area = ${selectedPatch.area_km2.toFixed(2)} km²`],
      contextual: selectedPatch.data_source === "SIMULATED_DEMO"
        ? demoMode ? ["Illustrative browser polygon", "Fictional land-cover class"] : ["Polygonized generated raster pixels", "Land-cover reference not supplied"]
        : selectedPatch.data_source === "NISAR"
          ? ["Polygonized NISAR detector candidates", "Approximate haor boundary mask; no land-cover reference supplied"]
          : ["Boundary and land-cover references require verification"],
      potential: selectedPatch.classification === "VEGETATED_INUNDATION" ? ["Vegetated inundation signal", "Double-bounce scattering hypothesis"] : []
    }
  };

  const strengthColor = STATUS_COLORS[data.evidence_strength] || "#6366f1";

  return (
        <CardContent>
      <CardHeader>
        <CardTitle accent>Evidence Card</CardTitle>
      </CardHeader>

      <Card className="animate-fade-in" style={{ padding: 0, overflow: "hidden" }}>
        <div className="evidence-card__header">
          <div className="evidence-card__title">Wetland Evidence Card</div>
          <div className="evidence-card__subtitle">
            {data.region_name} — {data.date}
          </div>
        </div>

        <div className="evidence-card__body">
          {data.data_source === "SIMULATED_DEMO" && <p className="evidence-notice">All signals, quality inputs and verdicts below are simulated. No satellite observation supports this card.</p>}
          {data.data_source === "NISAR" && <p className="evidence-notice">NISAR provisional input. This detector rule verdict is not an independently validated inundation finding or accuracy estimate.</p>}
          <div className="evidence-card__row"><span className="evidence-card__label">HH before → after</span><span className="evidence-card__value">{selectedPatch.hh_before.toFixed(1)} → {selectedPatch.hh_after.toFixed(1)} dB</span></div>
          <div className="evidence-card__row"><span className="evidence-card__label">HV before → after</span><span className="evidence-card__value">{selectedPatch.hv_before.toFixed(1)} → {selectedPatch.hv_after.toFixed(1)} dB</span></div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Candidate Inundation</span>
            <span className="evidence-card__value">{data.candidate_area_km2.toFixed(2)} km²</span>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Valid Data</span>
            <span className="evidence-card__value">
              {(data.valid_fraction * 100).toFixed(0)}%
            </span>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Data Source</span>
            <span className="evidence-card__value">{data.data_source}</span>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Quality</span>
            <Badge icon>{data.quality}</Badge>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Spatial Consistency</span>
            <Badge icon>{data.spatial_consistency}</Badge>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Temporal Evidence</span>
            <Badge icon>{data.temporal_evidence}</Badge>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Threshold Stability</span>
            <Badge icon>{data.threshold_stability}</Badge>
          </div>
          <div className="evidence-card__row">
            <span className="evidence-card__label">Vegetated Signal</span>
            <Badge icon>{data.vegetated_signal}</Badge>
          </div>
        </div>

        <div className="evidence-card__strength">
          <div className="evidence-card__strength-label">{data.data_source === "SIMULATED_DEMO" ? "Simulated evidence verdict" : data.data_source === "NISAR" ? "Rule consistency · not validation" : "Evidence Strength"}</div>
          <div
            className="evidence-card__strength-value"
            style={{ color: strengthColor }}
          >
            {data.evidence_strength}
          </div>
        </div>
      </Card>

      {/* Provenance */}
      <div style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Data Provenance</CardTitle>
        </CardHeader>
        {(["observed", "derived", "contextual", "potential"] as const).map((cat) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            {cat === "observed" && data.data_source === "SIMULATED_DEMO" ? <span className="data-label data-label--contextual">SIMULATED INPUT</span> : <LabelBadge label={cat.toUpperCase() as DataLabel} />}
            <ul className="provenance-list" style={{ marginTop: 4 }}>
              {data.provenance[cat].map((item) => (
                <li key={item}>
                  <span style={{ color: "var(--text-dim)" }}>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CardContent>
  );
}
