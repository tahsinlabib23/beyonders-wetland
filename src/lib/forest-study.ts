import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
export type ForestCoverage = FeatureCollection<MultiPolygon, {
    sceneId: string;
    product: string;
    start: string | null;
    end: string | null;
}>;
export type ForestCandidates = FeatureCollection<Polygon | MultiPolygon, {
    date: string;
    area_km2: number;
    interpretation: string;
}>;
export interface ForestCatalogEntry {
    id: string;
    title: string;
    bbox: number[];
    path: string;
    index_url: string;
    publication_version: string;
    method_version: string;
    run_id: string;
    processing_status: string;
    scientific_interpretation: string;
    reference_availability: string;
    available_dates: string[];
}
export interface ForestLayer {
    image: string;
    minimum: number;
    maximum: number;
    unit: string;
}
export interface ForestReference {
    status: string;
    reason?: string;
    source?: string;
    before_scene?: string;
    after_scene?: string;
    before_date?: string;
    after_date?: string;
    before_offset_days?: number;
    after_offset_days?: number;
    common_clear_fraction?: number;
    common_clear_area_km2?: number;
    support_overlap_fraction?: number | null;
    candidate_assessed_area_km2?: number;
    candidate_supported_area_km2?: number;
    candidate_without_optical_support_area_km2?: number;
    candidate_unassessed_area_km2?: number;
    median_ndvi_change?: number | null;
    median_nbr_change?: number | null;
    support_rule?: string;
    metric_note?: string;
}
export interface ForestFrame {
    date: string;
    candidates_geojson: string;
    layers: Record<string, ForestLayer>;
    reference: ForestReference;
    stats: {
        candidate_area_km2: number;
        candidate_pixels: number;
        patch_count: number;
        assessed_area_km2: number;
        eligible_area_km2: number;
        study_area_km2: number;
        valid_area_km2: number;
        median_hh_db: number | null;
        median_hv_db: number | null;
    };
}
export interface ForestStudy {
    hazard_type?: string;
    schema_version: number;
    id: string;
    title: string;
    run_id: string;
    publication_version: string;
    method_version: string;
    bbox: number[];
    boundary_source: string;
    baseline_dates: string[];
    processing_status: string;
    scientific_interpretation: string;
    reference_availability: string;
    native_crs: string;
    native_shape: number[];
    pixel_area_km2: number;
    inputs: {
        date: string;
        granule_id: string;
        maturity: string;
        collection: string;
        compatibility: string[];
    }[];
    layers: Record<string, ForestLayer>;
    frames: ForestFrame[];
    limitations: string[];
    sources: Record<string, string>;
    glad?: {
        image: string;
        details: {
            source_url: string;
            alert_date_range: string[];
            interpretation: string;
        };
    };
}
export interface ForestPublication {
    version: string;
    study_url: string;
    evidence_url: string;
    checksums_url: string;
    archive_sha256: string;
    native_download_url?: string;
}
export function coordinate(value: string, axis: "latitude" | "longitude"): number | null {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed))
        return null;
    const number = Number(trimmed);
    const limit = axis === "latitude" ? 85.05112878 : 180;
    return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}
export const RONDONIA_BBOX = [-62.75, -10.4, -62.55, -10.2];
