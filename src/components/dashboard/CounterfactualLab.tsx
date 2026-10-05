"use client";

import React from "react";
import { useWetlandStore } from "@/lib/store";
import { THRESHOLD_CONFIG } from "@/lib/constants";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { Badge } from "@/components/ui/Badge";

export default function CounterfactualLab() {
  const { threshold, setThreshold, sensitivityData, demoMode } = useWetlandStore();

  if (!sensitivityData) {
    return <CardContent><div style={{ padding: 20 }}>Loading sensitivity...</div></CardContent>;
  }

  const data = sensitivityData;

  const isStable = data.stability_verdict === "STABLE";

  return (
    <CardContent>
      <CardHeader>
        <CardTitle accent>
          Counterfactual Lab
        </CardTitle>
        <Badge variant="info">
          {data.data_source === "SIMULATED_DEMO" ? demoMode ? "BROWSER SIMULATION" : "RASTER SIMULATION" : data.data_source === "NISAR" ? "NISAR · PROVISIONAL" : "SOURCE UNVERIFIED"}
        </Badge>
      </CardHeader>
      <p className="evidence-notice">{demoMode
        ? `Scope: ${data.patch_id.replace("wetland_patch_", "Patch #")}. Changing the cutoff updates the browser simulation.`
        : `Scope: all peak-date raster candidates. Map regions stay at the configured ${threshold.toFixed(1)} dB cutoff. The sensitivity sweep is a detector check, not independent validation.`}</p>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: "0.72rem",
              color: "var(--text-secondary)",
            }}
          >
            Change Threshold
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--accent-primary)",
            }}
          >
            {threshold.toFixed(1)} dB
          </span>
        </div>
        
        <Slider 
          min={THRESHOLD_CONFIG.min}
          max={THRESHOLD_CONFIG.max}
          step={THRESHOLD_CONFIG.step}
          value={threshold}
          onChange={setThreshold}
          labels={[`${THRESHOLD_CONFIG.min} dB`, `${THRESHOLD_CONFIG.max} dB`]}
          ariaLabel="Candidate change threshold in decibels"
          disabled={!demoMode}
        />
      </div>

      <table className="counterfactual-lab__table">
        <thead>
          <tr>
            <th>Threshold</th>
            <th>Area</th>
            <th>Patches</th>
          </tr>
        </thead>
        <tbody>
          {data.thresholds.map((row) => {
            const isActive = Math.abs(row.delta_db - threshold) < 0.01;
            return (
              <tr
                key={row.delta_db}
                className={isActive ? "active" : ""}
                style={{ cursor: demoMode ? "pointer" : "default" }}
                onClick={() => { if (demoMode) setThreshold(row.delta_db); }}
              >
                <td><button className="table-action" aria-pressed={isActive} disabled={!demoMode} onClick={(e) => { e.stopPropagation(); setThreshold(row.delta_db); }}>{row.delta_db.toFixed(1)} dB</button></td>
                <td>{row.area_km2.toFixed(2)} km²</td>
                <td>{row.patches}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        className={`counterfactual-lab__verdict ${
          isStable
            ? "counterfactual-lab__verdict--stable"
            : "counterfactual-lab__verdict--sensitive"
        }`}
      >
        <span>{isStable ? "▬" : "⚡"}</span>
        <span>RESULT {data.stability_verdict}</span>
      </div>

      <p
        style={{
          fontSize: "0.68rem",
          color: "var(--text-dim)",
          marginTop: 8,
          fontStyle: "italic",
        }}
      >
        {data.sensitivity_note}
      </p>
    </CardContent>
  );
}
