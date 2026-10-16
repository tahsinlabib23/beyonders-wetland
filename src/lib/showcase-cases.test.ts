// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { assertShowcaseCandidateCount, listShowcaseCases } from "./showcase.ts";

function stubFetch(handler: (url: string) => { ok: boolean; body: unknown }) {
  (globalThis as Record<string, unknown>).fetch = async (url: string) => {
    const r = handler(String(url));
    return { ok: r.ok, json: async () => r.body };
  };
}

test("listShowcaseCases reads the exported case index", async () => {
  stubFetch((url) => url.endsWith("/showcase/index.json")
    ? { ok: true, body: { version: 1, cases: [{ id: "tanguar", site_display_name: "Tanguar Haor", site_bounds: [91, 25, 91.1, 25.2] }] } }
    : { ok: false, body: null });
  const cases = await listShowcaseCases();
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, "tanguar");
  assert.equal(cases[0].site_display_name, "Tanguar Haor");
});

test("listShowcaseCases falls back to the single featured case without an index", async () => {
  stubFetch((url) => url.endsWith("/showcase/featured/manifest.json")
    ? { ok: true, body: { showcase_version: 1, run_id: "abc", label: "L", site_name: "Tanguar Haor", exported_at: "x" } }
    : { ok: false, body: null });
  const cases = await listShowcaseCases();
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, "featured");
});

test("listShowcaseCases returns [] when nothing was exported", async () => {
  stubFetch(() => ({ ok: false, body: null }));
  assert.deepEqual(await listShowcaseCases(), []);
});

test("candidate file count matches the recorded pulse count", () => {
  assert.doesNotThrow(() => assertShowcaseCandidateCount("2026-08-29", Array.from({ length: 295 }, (_, i) => i), 295));
});

test("candidate file mismatch is an explicit error instead of a zero-detection result", () => {
  assert.throws(() => assertShowcaseCandidateCount("2026-08-29", [], 295), /records 295/);
});
