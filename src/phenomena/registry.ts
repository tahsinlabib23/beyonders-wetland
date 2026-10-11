/* GeoNexSAR phenomena registry — one conceptual backbone, several modules.
   Wetlands is built. Forest and volcano are declared with honest briefings, not faked. */
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
  /** Honest briefing shown while the module is PLANNED. */
  briefing?: PhenomenonBriefing;
}
const CONTRACT = ["time", "change", "evidence", "investigation", "uncertainty"] as const;
export const PHENOMENA: Phenomenon[] = [
  { id: "wetland", name: "Wetlands", tagline: "Water moves.", status: "AVAILABLE", href: "/wetland", contract: CONTRACT },
  {
    id: "forest", name: "Forests", tagline: "Vegetation changes.", status: "PLANNED", href: "/forest", contract: CONTRACT,
    briefing: {
      lede: "NISAR's L-band radar penetrates the canopy, so it can watch forests structurally — not just photograph their tops. The forest module will apply the same five-capability backbone the wetland module already uses: a timeline, change candidates, evidence, interrogation, and stated uncertainty.",
      radarSees: [
        { title: "Canopy loss", text: "Cleared or burned forest changes how L-band backscatter returns. A sustained drop in volume scattering between passes is the core deforestation signal." },
        { title: "Degradation, not just clear-cuts", text: "Selective logging and fire damage alter canopy structure before any optical satellite sees a hole. Polarimetry (HH/HV) is sensitive to exactly this structural change." },
        { title: "Regrowth", text: "The same time series run forward shows recovery: backscatter climbing back as secondary forest rebuilds structure, season after season." },
      ],
      needs: [
        "A forest site boundary (protected-area polygon or concession map) to bound the analysis",
        "A completed NISAR L2 GCOV time series over the site, processed through the same pipeline",
        "Reference data for the optical cross-check — HLS or Landsat scenes over the same dates",
        "Documented limitations: L-band sees structure, not species; seasonal leaf phenology must be separated from real loss",
      ],
    },
  },
  {
    id: "volcano", name: "Volcanoes", tagline: "The surface transforms.", status: "PLANNED", href: "/volcano", contract: CONTRACT,
    briefing: {
      lede: "NISAR was built for deformation: repeat-pass interferometry (InSAR) measures ground movement down to centimetres — the classic precursor signal of volcanic unrest. The volcano module will track how a volcano's surface breathes, flows, and reshapes between eruptions.",
      radarSees: [
        { title: "Ground deformation", text: "Magma moving underground inflates or deflates the edifice. InSAR phase differences between passes map that motion across the whole volcano, day and night, through ash and cloud." },
        { title: "New lava and deposits", text: "Fresh lava flows and pyroclastic deposits radically change surface roughness — a strong amplitude-change signal, the same family of detection the wetland module already runs." },
        { title: "Crater and flank change", text: "Dome growth, collapse scars, and flank instability all reshape the surface between observations. Each becomes a dated, mapped change event." },
      ],
      needs: [
        "An interferometric processing branch (phase + coherence) alongside the current amplitude pipeline",
        "A digital elevation model of the edifice for topographic phase removal",
        "Eruption and unrest catalogues (e.g. Smithsonian GVP) to label known events for validation",
        "Documented limitations: steep terrain causes layover and shadow; atmospheric water vapour can mimic deformation and must be corrected",
      ],
    },
  },
];

export function getPhenomenon(id: PhenomenonId): Phenomenon | undefined {
  return PHENOMENA.find((p) => p.id === id);
}
