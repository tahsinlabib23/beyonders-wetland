import { NextResponse } from "next/server";
import { completedNisarRuns } from "@/lib/pipeline-output";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ runs: completedNisarRuns() }, { headers: { "Cache-Control": "no-store" } });
}
