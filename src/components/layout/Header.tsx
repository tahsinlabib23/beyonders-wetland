"use client";

import React from "react";
import Link from "next/link";
import { useWetlandStore } from "@/lib/store";

export default function Header() {
  const { demoMode, pipelineRunId } = useWetlandStore();
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo">
          <span>BEYONDERS</span> — Wetland Pulse
        </div>
        <span className="header-module">NISAR GCOV</span>
      </div>
      <div className="header-meta">
        <div className="header-site">
          Site: <strong>Hakaluki Haor, Bangladesh</strong>
        </div>
        <Link className="header-global-link" href="/wetland/global" aria-label="Open the worldwide NISAR map">
          <span aria-hidden="true">◎</span> NISAR world map
        </Link>
        <span className="header-badge">{demoMode ? "BROWSER DEMO" : `RASTER DEMO · ${pipelineRunId?.slice(0, 8) ?? ""}`}</span>
      </div>
    </header>
  );
}
