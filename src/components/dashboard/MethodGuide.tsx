"use client";

import { useWetlandStore } from "@/lib/store";

export default function MethodGuide() {
  const { demoMode, pulseData } = useWetlandStore();
  const isNisar = pulseData?.data_source === "NISAR";
  return <details className="panel-section method-guide">
    <summary>How to read this view</summary>
    <dl><dt>HH / HV</dt><dd>{demoMode ? "Synthetic radar polarization signals used by the browser demo." : isNisar ? "Measured HH/HV backscatter from NISAR L2 GCOV. These are provisional observations; the mapped classes are algorithmic candidates." : "Generated synthetic radar polarization signals."}</dd>
      <dt>Δ dB</dt><dd>{demoMode ? "After minus before in decibels. The demo uses negative HH changes for open-water examples and positive changes for vegetation examples." : "After minus baseline in decibels, computed from the selected dual-polarization observations."}</dd>
      <dt>Threshold</dt><dd>{demoMode ? "A cutoff on absolute HH change across 20 fictional response bands per region. Higher cutoffs retain fewer bands and reduce candidate area." : "The mapped raster run uses its configured cutoff. The sensitivity table shows separate detector runs over the peak-date rasters."}</dd>
      <dt>Evidence</dt><dd>{demoMode ? "Quality fractions and spatial/temporal checks are fictional inputs. Supported means the demo rule passed; it is not a measured accuracy score." : isNisar ? `Quality and change statistics are calculated from NISAR scenes. ${pulseData?.quality_mask_method || "Only finite positive HHHH/HVHV values are used."} Verdicts indicate rule consistency only, with no independent reference validation or accuracy score.` : "Quality and change statistics are calculated from generated rasters. These results remain simulated and are not an accuracy score."}</dd>
      <dt>Stability</dt><dd>At most 20% area change within ±0.5 dB of the configured cutoff. The raster run’s sensitivity table summarizes peak-date regions.</dd>
      <dt>Map comparison</dt><dd>{demoMode ? "Before shows the first fictional date. After and Difference show current candidates. Difference colors indicate candidate classes, not a raster subtraction." : "Polygons follow the selected observation’s classification grid. No baseline classification is supplied; Before and Split are unavailable in this view."}</dd></dl>
    <p>{demoMode ? "All values in the browser scenario are simulated." : isNisar ? `Source: ${pulseData?.product || "NISAR L2 GCOV"} (${pulseData?.product_maturity || "provisional"}). The study boundary is an approximate reference mask. Candidate inundation classes need independent validation.` : "All values in this raster run are simulated."}</p>
  </details>;
}
