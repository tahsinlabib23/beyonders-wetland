export type AreaBounds = [number, number, number, number];

export type PinCoordinates = { latitude: number; longitude: number };

/** Validate a coordinate that can be represented by the Leaflet global map. */
export function validPinCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -85.05112878 && latitude <= 85.05112878 &&
    longitude >= -180 && longitude <= 180;
}

/**
 * Create a small, editable analysis box around a user-selected pin.
 * This returns only study geometry; it never produces or implies detections.
 */
export function quickStartBounds(
  latitude: number,
  longitude: number,
  halfSpan = 0.025,
): AreaBounds | null {
  if (!validPinCoordinates(latitude, longitude) || !Number.isFinite(halfSpan) || halfSpan <= 0 || halfSpan > 1) return null;
  const west = longitude - halfSpan;
  const south = latitude - halfSpan;
  const east = longitude + halfSpan;
  const north = latitude + halfSpan;
  // The local pipeline accepts WGS84 boxes no more than 2° across and within ±85° latitude.
  if (west < -180 || east > 180 || south < -85 || north > 85 || east - west > 2 || north - south > 2) return null;
  return [west, south, east, north].map((v) => Number(v.toFixed(6))) as AreaBounds;
}
