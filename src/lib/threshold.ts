/** Normalize a threshold value to the supported stored-sweep interval. This does not run detection. */
export const normalizeThreshold = (value: number): number =>
  Number.isFinite(value) ? Math.round(Math.max(0.5, Math.min(5, value)) * 2) / 2 : 2;
