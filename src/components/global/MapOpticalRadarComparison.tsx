"use client";

import type { OpticalRadarMapLayer } from "./useMapOpticalRadarComparison";

export default function MapOpticalRadarComparison({ layer, status, message, position, onPositionChange }: {
  layer: OpticalRadarMapLayer | null;
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  position: number;
  onPositionChange: (position: number) => void;
}) {
  const channel = layer?.channel.toUpperCase() ?? "HH/HV";
  return <section id="map-optical-radar-comparison" className="global-map-swipe-control" aria-label="Optical versus radar swipe" title={layer ? undefined : message} role="group">
    <label className="global-map-swipe-control__slider">
      <span>Reveal radar from the right <output>{100 - position}%</output></span>
      <input type="range" min="0" max="100" step="1" value={100 - position} disabled={!layer}
        onChange={(event) => onPositionChange(100 - Number(event.target.value))}
        aria-label={`Reveal NISAR ${channel} over optical imagery`} />
    </label>
    {status !== "ready" && <span className="global-map-swipe-control__sr-only" role={status === "error" ? "alert" : "status"}>{message}</span>}
  </section>;
}
