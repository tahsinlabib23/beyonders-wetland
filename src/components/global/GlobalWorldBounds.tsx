"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export const WORLD_BOUNDS = L.latLngBounds(
  [-85.05112878, -180],
  [85.05112878, 180],
);

/** Fit every longitude into the available width. A full square Web Mercator
 * world at zoom 0 leaves large, invalid tile columns in wide map panels. */
export function getGlobalWorldZoom(map: L.Map) {
  const longitudeBounds = L.latLngBounds([-0.0001, -180], [0.0001, 180]);
  return Math.max(0, map.getBoundsZoom(longitudeBounds, false, L.point(8, 8)));
}

export default function GlobalWorldBounds() {
  const map = useMap();
  const initialized = useRef(false);
  const lastGlobalZoom = useRef(0);

  // Leaflet is an imperative map instance; configure its bounds and zoom only after mount.
  /* eslint-disable react-hooks/immutability -- Leaflet view changes belong in effects. */
  useEffect(() => {
    const fitWorld = () => {
      const minZoom = getGlobalWorldZoom(map);
      const wasAtGlobalView = !initialized.current || Math.abs(map.getZoom() - lastGlobalZoom.current) < 0.2;
      map.setMaxBounds(WORLD_BOUNDS);
      map.options.maxBoundsViscosity = 1;
      map.setMinZoom(minZoom);

      if (wasAtGlobalView || map.getZoom() < minZoom) {
        map.setView([0, 0], minZoom, { animate: false });
      }
      lastGlobalZoom.current = minZoom;
      initialized.current = true;
    };

    fitWorld();
    map.on("resize", fitWorld);
    return () => { map.off("resize", fitWorld); };
  }, [map]);
  /* eslint-enable react-hooks/immutability */

  return null;
}
