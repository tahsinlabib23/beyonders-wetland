import { NextRequest, NextResponse } from "next/server";
import { normalizePlaceQuery, parsePlaceCandidates } from "@/lib/place-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public Nominatim is a discovery aid, not a source of scientific observations. Requests are user-submitted,
// not autocomplete, and the attribution is returned to the UI. Keep a modest in-process throttle.
let lastLookupAt = 0;

export async function GET(request: NextRequest) {
  const q = normalizePlaceQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 3) return NextResponse.json({ error: "Enter at least 3 characters to search for a place." }, { status: 400 });
  if (q.length > 120) return NextResponse.json({ error: "Place searches must be 120 characters or fewer." }, { status: 400 });

  const elapsed = Date.now() - lastLookupAt;
  if (elapsed < 1100) return NextResponse.json({ error: "Please wait a moment before searching for another place." }, { status: 429, headers: { "Retry-After": "1" } });
  lastLookupAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "en");
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "GeoNexSAR/1.0 (NASA Space Apps research prototype)" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap place search returned HTTP ${response.status}.`);
    const results = parsePlaceCandidates(await response.json());
    return NextResponse.json({
      source: "OpenStreetMap Nominatim",
      attribution: "© OpenStreetMap contributors",
      query: q,
      count: results.length,
      results,
    }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("GeoNexSAR place search failed:", error);
    return NextResponse.json({ error: "The place-name service is unavailable right now. You can still select a location by map click or enter coordinates." }, { status: 502 });
  }
}
