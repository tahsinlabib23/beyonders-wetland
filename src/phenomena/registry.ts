/* GeoNexSAR phenomena registry — one conceptual backbone, several modules.
   Wetlands and the live-data Forest workspace are available; Forest analyses remain exploratory.
   Volcano remains planned until deformation processing is implemented and evaluated. */
export type PhenomenonStatus = "AVAILABLE" | "PLANNED";
export type PhenomenonId = "wetland" | "forest" | "volcano";
export interface PhenomenonBriefing {
  lede: string;
  radarSees: { title: string; text: string }[];
  needs: string[];
}
export interface Phenomenon {
  id: PhenomenonId;
  name: string;
  tagline: string;
  status: PhenomenonStatus;
  href?: string;
  /** Every module exposes the same five capabilities. */
  contract: readonly ["time", "change", "evidence", "investigation", "uncertainty"];
  /** Science notes and data requirements retained for the module briefing. */
  briefing?: PhenomenonBriefing;
}
const CONTRACT = ["time", "change", "evidence", "investigation", "uncertainty"] as const;
export const PHENOMENA: Phenomenon[] = [
  { id: "wetland", name: "Wetlands", tagline: "Water moves.", status: "AVAILABLE", href: "/wetland", contract: CONTRACT },
  {
    id: "forest", name: "Forests", tagline: "Structure changes. Evidence decides.", status: "AVAILABLE", href: "/forest", contract: CONTRACT,
    briefing: {
      lede: "The forest workspace discovers real NISAR L-band observations, runs a separate backscatter-anomaly screen, and preserves source evidence and uncertainty. It requires compatible real NISAR L2 GCOV observations and a sourced forest-cover mask; no packaged forest detections are invented.",
      radarSees: [
        { title: "Structural anomalies", text: "Changes in calibrated HH/HV backscatter can indicate a change in scattering structure. A candidate is evidence to investigate, not proof of deforestation or its cause." },
        { title: "Repeat-observation context", text: "Comparing one acquisition with the other compatible observations can help separate unusual values from the observed temporal baseline. Short series limit what can be concluded." },
        { title: "Uncertainty, not assumed recovery", text: "Moisture, seasonality, mask errors and processing effects can complicate interpretation. Backscatter returning toward baseline alone does not demonstrate ecological recovery." },
      ],
      needs: [
        "A sourced forest-cover raster; a protected-area outline alone is not a forest mask",
        "At least three chronologically ordered, compatible NISAR L2 GCOV frequencyA observations with HH/HV dB rasters",
        "Matching product maturity, track, direction, frame, bandwidth and release, with aligned raster grids",
        "Independent optical or disturbance-reference data before making validation or performance claims",
      ],
    },
  },
  {
    id: "volcano", name: "Volcanoes", tagline: "The surface transforms.", status: "PLANNED", href: "/volcano", contract: CONTRACT,
    briefing: {
      lede: "NISAR was built for deformation: repeat-pass interferometry (InSAR) measures ground movement using phase differences. The volcano module remains planned until a deformation-appropriate workflow and independent evaluation are in place.",
      radarSees: [
        { title: "Ground deformation", text: "Interferometric phase can reveal surface displacement when suitable coherent observations and corrections are available. Amplitude change alone is not deformation." },
        { title: "Surface change", text: "Fresh lava and deposits can change radar amplitude and roughness, but these signals do not alone establish a specific event or hazard." },
        { title: "Terrain complications", text: "Steep slopes can introduce layover and shadow; atmospheric effects and decorrelation must be considered before interpreting phase." },
      ],
      needs: [
        "An interferometric processing branch (phase and coherence) alongside amplitude analysis",
        "A digital elevation model and appropriate corrections for topographic and atmospheric phase",
        "A suitable independent eruption/deformation reference for validation",
        "Documented terrain, coherence and uncertainty limitations",
      ],
    },
  },
];

export function getPhenomenon(id: PhenomenonId): Phenomenon | undefined {
  return PHENOMENA.find((p) => p.id === id);
}
