"use client";

import React from "react";
import { useWetlandStore, MapMode } from "@/lib/store";

const MAP_MODES: { value: MapMode; label: string; help: string }[] = [
  { value: "BEFORE", label: "Baseline", help: "Show the first sample date." },
  { value: "AFTER", label: "Current", help: "Show the selected observation date." },
  { value: "SPLIT", label: "Compare", help: "Compare the first and selected sample dates." },
  { value: "DIFFERENCE", label: "Classes", help: "Show candidate classes. This is not a pixel-by-pixel change image." },
];

export default function MapControls() {
  const { mapMode, setMapMode, probeActive, setProbeActive, setProbeResult, demoMode } =
    useWetlandStore();
  const availableModes = demoMode ? MAP_MODES : MAP_MODES.filter((mode) => mode.value === "AFTER" || mode.value === "DIFFERENCE");

  const handleProbeToggle = () => {
    if (probeActive) {
      setProbeActive(false);
      setProbeResult(null);
    } else {
      setProbeActive(true);
    }
  };

  return (
    <>
      {/* Map mode toggle — top left */}
      <div className="map-overlay map-overlay--top-left map-view-control">
        <span className="map-control-label">Map view</span>
        <div className="toggle-group" role="group" aria-label="Choose map view">
          {availableModes.map((mode) => (
            <button
              key={mode.value}
              className={`toggle-btn ${
                mapMode === mode.value ? "toggle-btn--active" : ""
              }`}
              onClick={() => setMapMode(mode.value)}
              aria-pressed={mapMode === mode.value}
              title={mode.help}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* SAR Probe toggle — top right */}
      <div className="map-overlay map-overlay--top-right">
        <button
          className={`toggle-btn map-probe-toggle ${probeActive ? "toggle-btn--active" : ""}`}
          onClick={handleProbeToggle}
          aria-pressed={probeActive}
          aria-label={probeActive ? "Stop sampling the map" : "Inspect a pixel on the map"}
          title="Turn this on, then select a map location to inspect its radar values."
        >
          {probeActive ? "Stop sampling" : "Inspect a pixel"}
        </button>
      </div>
    </>
  );
}
