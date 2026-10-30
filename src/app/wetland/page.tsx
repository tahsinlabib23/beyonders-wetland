"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import WetlandExperience from "@/components/wetland/WetlandExperience";

function Inner() {
  const params = useSearchParams();
  const caseId = params.get("case");
  return <WetlandExperience preferLocalRun={params.get("source") === "raster"} initialCaseId={caseId} />;
}

export default function WetlandPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
