import { notFound } from "next/navigation";
import PhenomenonBriefing from "@/components/phenomena/PhenomenonBriefing";
import { getPhenomenon } from "@/phenomena/registry";

export const metadata = { title: "Forests — GeoNexSAR" };

export default function ForestPage() {
  const phenomenon = getPhenomenon("forest");
  if (!phenomenon || phenomenon.status !== "PLANNED") notFound();
  return <PhenomenonBriefing phenomenon={phenomenon} />;
}
