import { notFound } from "next/navigation";
import PhenomenonBriefing from "@/components/phenomena/PhenomenonBriefing";
import { getPhenomenon } from "@/phenomena/registry";

export const metadata = { title: "Volcanoes — GeoNexSAR" };

export default function VolcanoPage() {
  const phenomenon = getPhenomenon("volcano");
  if (!phenomenon || phenomenon.status !== "PLANNED") notFound();
  return <PhenomenonBriefing phenomenon={phenomenon} />;
}
