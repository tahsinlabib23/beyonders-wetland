"use client";

import React, { useMemo } from "react";
import { Polygon, CircleMarker, Popup } from "react-leaflet";
import { useWetlandStore } from "@/lib/store";
import { COLORS, STATUS_COLORS } from "@/lib/constants";
import type { WetlandPatch, InundationClass } from "@/lib/types";
import { demoPatches, patchPolygon } from "@/lib/demo-engine";

const CLASS_COLORS: Record<InundationClass, string> = {
  OPEN_WATER: COLORS.openWater,
  VEGETATED_INUNDATION: COLORS.vegetated,
  UNCERTAIN: COLORS.uncertain,
};

type LatLng = [number, number];
type PolygonPositions = LatLng[][] | LatLng[][][];

function polygonPositions(patch: WetlandPatch): LatLng[] | PolygonPositions {
  if (!patch.geometry) return patchPolygon(patch);
  const ringPositions = (ring: number[][]): LatLng[] => ring.map(([lng, lat]) => [lat, lng] as LatLng);
  if (patch.geometry.type === "Polygon") return patch.geometry.coordinates.map(ringPositions);
  return patch.geometry.coordinates.map((polygon) => polygon.map(ringPositions));
}

function PatchPopup({ patch }: { patch: WetlandPatch }) {
  const color = CLASS_COLORS[patch.classification];
  return (
    <div style={{ fontFamily: "var(--font-sans)", minWidth: 200 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.8rem", color: "#00d4ff", marginBottom: 4 }}>
        {patch.id.replace("wetland_patch_", "Patch #")}
      </div>
      <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: 8 }}>
        <span style={{ color }}> ● {patch.interpretation_label ?? (patch.classification === "OPEN_WATER" ? "HH darkening candidate" : patch.classification === "VEGETATED_INUNDATION" ? "HH increase / HV stability candidate" : "Uncertain candidate")}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: "0.7rem" }}>
        <span style={{ color: "#64748b" }}>Area</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#f1f5f9" }}>{patch.area_km2} km²</span>
        <span style={{ color: "#64748b" }}>Δ dB</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#f1f5f9" }}>{patch.mean_delta_db.toFixed(1)}</span>
        <span style={{ color: "#64748b" }}>Valid</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#f1f5f9" }}>{(patch.valid_fraction * 100).toFixed(0)}%</span>
        <span style={{ color: "#64748b" }}>Evidence</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: STATUS_COLORS[patch.evidence_state] || "#f1f5f9" }}>{patch.evidence_state}</span>
        <span style={{ color: "#64748b" }}>Data source</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: patch.data_source === "NISAR" ? "#10b981" : "#f59e0b" }}>
          {patch.data_source === "NISAR" ? "NISAR · PROVISIONAL" : patch.data_source || "UNVERIFIED"}
        </span>
      </div>
    </div>
  );
}

export default function InundationLayer({ baseline = false }: { baseline?: boolean }) {
  const { patches, selectedPatch, setSelectedPatch, vegFilter, mapMode, selectedDateIndex, pulseData, threshold, demoMode, probeActive } = useWetlandStore();

  const filteredPatches = useMemo(() => {
    const source = baseline && demoMode ? demoPatches(0, threshold) : patches;
    if (vegFilter === "ALL") return source;
    return source.filter((p) => p.classification === vegFilter);
  }, [vegFilter, patches, baseline, demoMode, threshold]);

  const dateIntensity = useMemo(() => {
    if (!pulseData) return 0.5;
    const currentDate = pulseData.dates[selectedDateIndex];
    const peakArea = pulseData.peak.area_km2;
    return currentDate && peakArea > 0 ? currentDate.area_km2 / peakArea : 0.5;
  }, [selectedDateIndex, pulseData]);

  return (
    <>
      {(!baseline || demoMode) && filteredPatches.map((patch) => {
        const polygon = polygonPositions(patch);
        const color = baseline ? COLORS.beforeLayer : CLASS_COLORS[patch.classification];
        if (baseline) return <Polygon key={patch.id} positions={polygon} interactive={false} pathOptions={{ color, weight: 2, fillOpacity: 0.4 }} />;
        const isSelected = selectedPatch?.id === patch.id;
        const opacity = (mapMode === "DIFFERENCE" || mapMode === "SPLIT") ? dateIntensity : 0.6;

        return (
          <React.Fragment key={patch.id}>
            <Polygon
              positions={polygon}
              pathOptions={{
                color: isSelected ? "#00d4ff" : color,
                weight: isSelected ? 3 : 1.5,
                fillColor: color,
                fillOpacity: opacity * (mapMode === "BEFORE" ? 0.15 : mapMode === "AFTER" ? 0.5 : mapMode === "SPLIT" ? 0.7 : 0.45),
                dashArray: isSelected ? undefined : "4 2",
              }}
              eventHandlers={{ click: () => { if (!useWetlandStore.getState().probeActive) setSelectedPatch(patch); } }}
            >
              {!probeActive && <Popup>
                <PatchPopup patch={patch} />
              </Popup>}
            </Polygon>

            <CircleMarker
              center={patch.centroid}
              radius={isSelected ? 5 : 3}
              pathOptions={{
                color: isSelected ? "#00d4ff" : color,
                fillColor: color,
                fillOpacity: 0.9,
                weight: isSelected ? 2 : 1,
              }}
              eventHandlers={{ click: () => { if (!useWetlandStore.getState().probeActive) setSelectedPatch(patch); } }}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}
