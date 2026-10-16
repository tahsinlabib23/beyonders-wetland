/** A scientific result is displayable only when its manifest identifies real NASA NISAR inputs. */
export function isRealNisarSource(source: unknown): source is "NISAR" {
  return source === "NISAR";
}

export function assertRealNisarSource(source: unknown): asserts source is "NISAR" {
  if (!isRealNisarSource(source)) {
    throw new Error("This workspace only serves completed real NISAR runs. Synthetic or unverified outputs are rejected.");
  }
}
