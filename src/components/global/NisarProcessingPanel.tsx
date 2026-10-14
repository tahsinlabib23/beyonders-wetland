"use client";
import { publicClient } from "@/lib/app-mode";
import LocalProcessingPanel from "./NisarProcessingPanelLocal";
export { validArea, boundaryBounds } from "./NisarProcessingPanelLocal";
export type { AreaBounds } from "./NisarProcessingPanelLocal";
import type { ComponentProps } from "react";
export default function NisarProcessingPanel(props: ComponentProps<typeof LocalProcessingPanel>) {
  if (!publicClient) return <LocalProcessingPanel {...props} />;
  return <section className="nisar-tools-section" id="nisar-process" aria-labelledby="nisar-process-title">
    <p className="global-eyebrow">PUBLIC VIEWER</p><h2 id="nisar-process-title">Explore published studies</h2>
    <p>Use the saved study and date selectors to explore measured radar change and independent evidence. New studies are prepared by local operators and published after review.</p>
    <p>Earthdata authentication, processing, evidence retries, and exact raster pixel probing are available in the local application. No credentials are required to view published results.</p>
    <p>Unprocessed areas have no detector result available. Candidate polygons do not establish confirmed flooding.</p>
    <a className="global-data-link" href="/operator-guide">How operators publish another study</a>
  </section>;
}
