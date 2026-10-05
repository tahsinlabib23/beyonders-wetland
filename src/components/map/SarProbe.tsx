"use client";

import React from "react";
import { useMapEvents, CircleMarker, Popup } from "react-leaflet";
import { useWetlandStore } from "@/lib/store";
import { demoPatches, DEMO_DATES, probeDemo } from "@/lib/demo-engine";

export function ProbeHandler() {
  const { probeActive, setProbeResult } = useWetlandStore();

  useMapEvents({
    async click(e) {
      if (!probeActive) return;
      const { lat, lng } = e.latlng;
      const state = useWetlandStore.getState();
      if (state.demoMode) {
        const index = state.mapMode === "BEFORE" ? 0 : state.selectedDateIndex;
        setProbeResult(probeDemo(lat, lng, demoPatches(index, state.threshold), DEMO_DATES[index]));
        return;
      }

      try {
        const date = state.pulseData?.dates[state.selectedDateIndex]?.date;
        const res = await fetch(`/api/wetland/probe?lat=${lat}&lng=${lng}${date ? `&date=${encodeURIComponent(date)}` : ""}`);
        if (res.ok) {
          const data = await res.json();
          if (data.run_id !== useWetlandStore.getState().pipelineRunId || data.acquisition_date !== date) return;
          setProbeResult(data);
        } else {
          console.error("Failed to probe pixel");
        }
      } catch (err) {
        console.error("Error probing pixel", err);
      }
    },
  });

  return null;
}

export function ProbePopup() {
  const { probeResult } = useWetlandStore();
  if (!probeResult) return null;

  return (
    <div className="probe-popup" style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.75rem", color: "#00d4ff", marginBottom: 4 }}>
        {probeResult.data_source === "SIMULATED" ? "Simulated raster pixel probe" : probeResult.data_source === "NISAR" ? "NISAR provisional pixel probe" : "Raster pixel probe"}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "#64748b", marginBottom: 8 }}>
        {probeResult.lat.toFixed(4)}°N, {probeResult.lng.toFixed(4)}°E
        <br />{probeResult.acquisition_date}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", fontSize: "0.68rem" }}>
        <span style={{ color: "#64748b" }}>HH before</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "#f1f5f9" }}>{probeResult.hh_before?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>HH after</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "#f1f5f9" }}>{probeResult.hh_after?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>ΔHH</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#00d4ff" }}>{probeResult.delta_hh?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>HV before</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "#f1f5f9" }}>{probeResult.hv_before?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>HV after</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "#f1f5f9" }}>{probeResult.hv_after?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>ΔHV</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#00d4ff" }}>{probeResult.delta_hv?.toFixed(1) ?? "N/A"} dB</span>
        <span style={{ color: "#64748b" }}>Valid</span>
        <span style={{ color: probeResult.valid ? "#10b981" : "#ef4444", fontWeight: 600 }}>{probeResult.valid ? "YES" : "NO"}</span>
        <span style={{ color: "#64748b" }}>Land cover</span>
        <span style={{ fontSize: "0.65rem", color: "#94a3b8" }}>{probeResult.land_cover}</span>
        <span style={{ color: "#64748b" }}>Source</span>
        <span style={{ fontSize: "0.65rem", color: probeResult.data_source === "NISAR" ? "#10b981" : "#f59e0b" }}>
          {probeResult.data_source === "NISAR" ? "NISAR · PROVISIONAL" : probeResult.data_source || "UNVERIFIED"}
        </span>
      </div>
    </div>
  );
}

export default function SarProbe() {
  const { probeActive, probeResult } = useWetlandStore();

  return (
    <>
      <ProbeHandler />
      {probeActive && probeResult && (
        <CircleMarker
          center={[probeResult.lat, probeResult.lng]}
          radius={6}
          pathOptions={{
            color: "#00d4ff",
            fillColor: "#00d4ff",
            fillOpacity: 0.3,
            weight: 2,
          }}
        >
          <Popup>
            <ProbePopup />
          </Popup>
        </CircleMarker>
      )}
    </>
  );
}
