import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlaceQuery, parsePlaceCandidates } from "./place-search.ts";

test("place query trims and collapses whitespace", () => {
  assert.equal(normalizePlaceQuery("  Tanguar   Haor  "), "Tanguar Haor");
  assert.equal(normalizePlaceQuery("a".repeat(200)).length, 120);
});

test("place parser keeps valid real geocoder results and ignores invalid coordinates", () => {
  const results = parsePlaceCandidates([
    { display_name: "Tanguar Haor, Bangladesh", lat: "25.15", lon: "91.07", type: "wetland", class: "natural", importance: 0.5 },
    { display_name: "Bad coordinate", lat: "999", lon: "1" },
    { display_name: "   ", lat: "25", lon: "91" },
    null,
  ]);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { display_name: "Tanguar Haor, Bangladesh", latitude: 25.15, longitude: 91.07, type: "wetland", category: "natural", importance: 0.5 });
});

test("malformed provider payloads do not invent place results", () => {
  assert.deepEqual(parsePlaceCandidates({ results: [] }), []);
  assert.deepEqual(parsePlaceCandidates([{}]), []);
});
