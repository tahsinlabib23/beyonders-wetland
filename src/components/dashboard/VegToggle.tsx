"use client";

import React from "react";
import { useWetlandStore } from "@/lib/store";
import type { InundationClass } from "@/lib/types";

const VEG_OPTIONS: { value: InundationClass | "ALL"; label: string; icon: string }[] = [
  { value: "ALL", label: "All", icon: "◉" },
  { value: "OPEN_WATER", label: "HH darkening", icon: "↘" },
  { value: "VEGETATED_INUNDATION", label: "Vegetated", icon: "🌿" },
  { value: "UNCERTAIN", label: "Uncertain", icon: "❓" },
];

export default function VegToggle() {
  const { vegFilter, setVegFilter } = useWetlandStore();

  return (
    <div className="toggle-group" role="group" aria-label="Filter regions by class">
      {VEG_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`toggle-btn ${vegFilter === opt.value ? "toggle-btn--active" : ""}`}
          onClick={() => setVegFilter(opt.value)}
          title={opt.label}
          aria-pressed={vegFilter === opt.value}
        >
          {opt.icon} {opt.label}
        </button>
      ))}
    </div>
  );
}
