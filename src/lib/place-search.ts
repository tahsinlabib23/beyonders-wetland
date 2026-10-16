export interface PlaceCandidate {
  display_name: string;
  latitude: number;
  longitude: number;
  type: string | null;
  category: string | null;
  importance: number | null;
}

/** Normalize results from a real geocoding provider. Invalid entries are ignored, never guessed. */
export function parsePlaceCandidates(payload: unknown): PlaceCandidate[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): PlaceCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const latitude = typeof raw.lat === "string" || typeof raw.lat === "number" ? Number(raw.lat) : NaN;
    const longitude = typeof raw.lon === "string" || typeof raw.lon === "number" ? Number(raw.lon) : NaN;
    const display_name = typeof raw.display_name === "string" ? raw.display_name.trim().slice(0, 400) : "";
    if (!display_name || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
    return [{
      display_name,
      latitude,
      longitude,
      type: typeof raw.type === "string" ? raw.type.slice(0, 80) : null,
      category: typeof raw.class === "string" ? raw.class.slice(0, 80) : null,
      importance: typeof raw.importance === "number" && Number.isFinite(raw.importance) ? raw.importance : null,
    }];
  });
}

export function normalizePlaceQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}
