export type VolcanoRegionStats = {
  name: string; valid_fraction: number; pixels: number;
  p05_cm: number | null; median_cm: number | null; p95_cm: number | null;
};

export type VolcanoPair = {
  id: string; sensor: "NISAR" | "Sentinel-1"; start: string; end: string; label: string;
  granule_id: string; cmr_concept_id: string | null; collection: string; maturity: string;
  polarization: string; direction: string; look_direction: string; track: string;
  wavelength_m: number; native_crs: string; native_spacing: number[];
  original_dates_verified: boolean; data_url: string | null; phase_sign: string;
  grid: string; los_image: string; coherence_image: string; assessed_image: string; los_download: string;
  statistics: {
    valid_fraction: number; valid_pixels: number; total_pixels: number; median_coherence: number;
    assessed_area_km2: number; analysis_area_km2: number;
    p05_cm: number; p95_cm: number; reference_mad_cm: number; reference_component: number;
    reference_pixels: number; regions: VolcanoRegionStats[]; uncertainty_note: string;
  };
};

export type VolcanoComparison = {
  nisar_id: string; sentinel_id: string; status: string; common_valid_fraction: number;
  common_valid_pixels: number; start_offset_days: number; end_offset_days: number; interpretation: string;
};

export type VolcanoStudy = {
  schema_version: number; id: string; title: string; publication_version: string; method_version: string;
  run_completion: string; scientific_interpretation: string; event_date: string;
  reference_availability?: string;
  bbox: number[]; reference_bbox: number[]; boundary_source: string; reference_note: string;
  coherence_floor: number; display_limit_cm: number; display_scale_note?: string; default_pair_id: string;
  regions: {name: string; lat: number; lon: number; radius_km: number}[];
  pairs: VolcanoPair[]; comparisons: VolcanoComparison[]; limitations: string[];
};

export type VolcanoGrid = {
  schema_version: number; width: number; height: number; bbox: number[]; sampling: string;
  los_cm: (number | null)[]; coherence: (number | null)[];
  phase_radians: (number | null)[]; component: (number | null)[];
};

export function probeVolcano(grid: VolcanoGrid | null, lat: number, lon: number) {
  if (!grid || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [west, south, east, north] = grid.bbox;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const column = Math.min(grid.width - 1, Math.floor((lon - west) / (east - west) * grid.width));
  const row = Math.min(grid.height - 1, Math.floor((north - lat) / (north - south) * grid.height));
  const index = row * grid.width + column;
  return { row, column, los: grid.los_cm[index], coherence: grid.coherence[index],
    phase: grid.phase_radians[index], component: grid.component[index],
    centerLat: north - (row + .5) * (north - south) / grid.height,
    centerLon: west + (column + .5) * (east - west) / grid.width };
}

export function validVolcanoGrid(grid: VolcanoGrid) {
  return grid?.schema_version === 1 && Number.isInteger(grid.width) && Number.isInteger(grid.height) &&
    grid.width > 0 && grid.height > 0 && Array.isArray(grid.bbox) && grid.bbox.length === 4 &&
    grid.bbox.every(Number.isFinite) && grid.bbox[0] < grid.bbox[2] && grid.bbox[1] < grid.bbox[3] &&
    [grid.los_cm, grid.coherence, grid.phase_radians, grid.component].every(values =>
      Array.isArray(values) && values.length === grid.width * grid.height &&
      values.every(value => value === null || typeof value === "number" && Number.isFinite(value)));
}
