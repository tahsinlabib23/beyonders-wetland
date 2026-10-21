import { notFound } from "next/navigation";
import ForestWorkbench from "@/components/forest/ForestWorkbench";
import { getPhenomenon } from "@/phenomena/registry";

export const metadata = { title: "Forests — GeoNexSAR" };

export default function ForestPage() {
  const phenomenon = getPhenomenon("forest");
  if (!phenomenon || phenomenon.status !== "AVAILABLE") notFound();
  return <ForestWorkbench />;
}
