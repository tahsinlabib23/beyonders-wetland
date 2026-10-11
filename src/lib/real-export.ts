import type { WetlandPatch } from "./types";

/** Download a file derived from the currently loaded real-data result. */
export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A CSV export that labels the source explicitly and never assumes a simulated default. */
export function patchesCSV(patches: WetlandPatch[], threshold: number, dataSource = "NISAR") {
  const keys = ["id", "date", "area_km2", "classification", "delta_hh", "delta_hv", "valid_fraction", "evidence_state", "data_source"] as const;
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    [...keys, "threshold_db"].join(","),
    ...patches.map((patch) => [...keys.map((key) => quote({ ...patch, data_source: dataSource }[key])), threshold].join(",")),
  ].join("\r\n");
}
