import { DEMO_NOTICE, DEMO_VERSION, patchPolygon } from "./demo-engine";
import type { WetlandPatch } from "./types";

export function patchesCSV(patches: WetlandPatch[], threshold: number, dataSource = "SIMULATED_DEMO") {
  const keys = ["id", "date", "area_km2", "classification", "delta_hh", "delta_hv", "valid_fraction", "evidence_state", "data_source"] as const;
  const quote = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const includeNotice = dataSource === "SIMULATED_DEMO";
  return [[...keys, "threshold_db", ...(includeNotice ? ["notice"] : [])].join(","),
    ...patches.map((p) => [...keys.map((key) => quote(p[key])), threshold,
      ...(includeNotice ? [quote(DEMO_NOTICE)] : [])].join(","))].join("\r\n");
}

export function patchesGeoJSON(patches: WetlandPatch[], threshold: number) {
  return { type: "FeatureCollection", demo_version: DEMO_VERSION, notice: DEMO_NOTICE, threshold_db: threshold,
    features: patches.map((patch) => {
      const coordinates = patchPolygon(patch).map(([lat, lng]) => [lng, lat]).reverse();
      return { type: "Feature", geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] }, properties: patch };
    }) };
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
