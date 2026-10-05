"use client";

import React from "react";
import dynamic from "next/dynamic";
import DemoExperience from "@/components/dashboard/DemoExperience";
import MethodGuide from "@/components/dashboard/MethodGuide";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import DateScrubber from "@/components/dashboard/DateScrubber";
import WetlandPulse from "@/components/dashboard/WetlandPulse";
import EvidenceCard from "@/components/dashboard/EvidenceCard";
import CounterfactualLab from "@/components/dashboard/CounterfactualLab";
import VegToggle from "@/components/dashboard/VegToggle";
import PatchTable from "@/components/dashboard/PatchTable";
import MapControls from "@/components/map/MapControls";

// Dynamically import the map (Leaflet requires window)
const WetlandMap = dynamic(
  () => import("@/components/map/WetlandMap"),
  { ssr: false, loading: () => <MapPlaceholder /> }
);

function MapPlaceholder() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-primary)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: "0.85rem",
      }}
    >
      Loading simulated map…
    </div>
  );
}

export default function WetlandDashboard() {
  return (
    <div className="app-layout">
      <Header />

      <div className="dashboard-shell">
        <Sidebar />

        <main className="dashboard-workspace">
          <DemoExperience />
          <div className="dashboard-grid" style={{ flex: 1 }}>
            {/* ═══ Map Area ═══ */}
            <div className="map-area">
              <WetlandMap />
              <MapControls />

              {/* Veg toggle — bottom left overlay */}
              <div className="map-overlay map-overlay--bottom-left">
                <VegToggle />
              </div>
            </div>

            {/* ═══ Side Panel ═══ */}
            <div className="panel-area">
              <WetlandPulse />
              <PatchTable />
              <EvidenceCard />
              <CounterfactualLab />
              <MethodGuide />
            </div>
          </div>

          {/* ═══ Date Scrubber — Bottom Bar ═══ */}
          <DateScrubber />
        </main>
      </div>
    </div>
  );
}
