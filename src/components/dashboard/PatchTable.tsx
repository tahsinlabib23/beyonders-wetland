"use client";

import React, { useState } from "react";
import { useWetlandStore } from "@/lib/store";
import { COLORS, STATUS_COLORS } from "@/lib/constants";
import type { WetlandPatch } from "@/lib/types";

const CLASS_COLORS: Record<string, string> = {
  OPEN_WATER: COLORS.openWater,
  VEGETATED_INUNDATION: COLORS.vegetated,
  UNCERTAIN: COLORS.uncertain,
};

export default function PatchTable() {
  const { selectedPatch, setSelectedPatch, vegFilter, patches } = useWetlandStore();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("area");

  const filteredPatches = patches.filter((p) => (vegFilter === "ALL" || p.classification === vegFilter) &&
    `${p.id} ${p.classification} ${p.evidence_state}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => sort === "signal" ? Math.abs(b.delta_hh) - Math.abs(a.delta_hh) : sort === "quality" ? b.valid_fraction - a.valid_fraction : b.area_km2 - a.area_km2);

  return (
    <div className="panel-section">
      <div className="section-header">
        <h3 className="section-title">
          Candidate Regions{" "}
          <span style={{ color: "var(--text-dim)" }}>({filteredPatches.length})</span>
        </h3>
      </div>

      <div className="region-tools"><input aria-label="Search regions" placeholder="Search ID, type or evidence" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="Sort regions" value={sort} onChange={(e) => setSort(e.target.value)}><option value="area">Largest area</option><option value="signal">Biggest signal change</option><option value="quality">Most valid pixels</option></select></div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        <table className="patch-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>km²</th>
              <th>ΔHH dB</th>
              <th>Type</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {!filteredPatches.length && <tr><td colSpan={5}>No regions match these filters. Try clearing the search or choosing another class.</td></tr>}
            {filteredPatches.map((patch) => (
              <PatchRow
                key={patch.id}
                patch={patch}
                isSelected={selectedPatch?.id === patch.id}
                onClick={() =>
                  setSelectedPatch(
                    selectedPatch?.id === patch.id ? null : patch
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PatchRow({
  patch,
  isSelected,
  onClick,
}: {
  patch: WetlandPatch;
  isSelected: boolean;
  onClick: () => void;
}) {
  const classColor = CLASS_COLORS[patch.classification] || "var(--text-muted)";
  const evidenceColor =
    STATUS_COLORS[patch.evidence_state] || "var(--text-muted)";

  return (
    <tr className={isSelected ? "selected" : ""} onClick={onClick}>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>
        <button className="table-action" aria-label={`View details for region ${patch.id.split("_").pop()}`} aria-pressed={isSelected} onClick={(e) => { e.stopPropagation(); onClick(); }}>{patch.id.replace("wetland_patch_", "#")}</button>
      </td>
      <td style={{ fontFamily: "var(--font-mono)" }}>
        {patch.area_km2.toFixed(2)}
      </td>
      <td style={{ fontFamily: "var(--font-mono)" }}>
        {patch.mean_delta_db.toFixed(1)}
      </td>
      <td>
        <span
          style={{
            color: classColor,
            fontSize: "0.65rem",
            fontWeight: 600,
          }}
        >
          ●{" "}
          {patch.classification === "VEGETATED_INUNDATION"
            ? "VEG"
            : patch.classification === "OPEN_WATER"
            ? "HH DARKENING"
            : "UNC"}
        </span>
      </td>
      <td>
        <span
          style={{
            color: evidenceColor,
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            fontWeight: 600,
          }}
        >
          {patch.evidence_state}
        </span>
      </td>
    </tr>
  );
}
