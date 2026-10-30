import KilaueaExplorer from "@/components/volcano/KilaueaExplorer";

export const metadata = {
  title: "Kīlauea · NISAR phase evidence | GeoNexSAR",
  description: "Explore a real NISAR L2 GUNW interferogram spanning Kīlauea episode 36, with phase, coherence, quality screens, provenance, and uncertainty limits.",
};

export default function KilaueaPage() {
  return <KilaueaExplorer />;
}
