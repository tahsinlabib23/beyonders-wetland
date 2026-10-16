import HazardNavigation from "@/components/layout/HazardNavigation";

export default function VolcanoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><HazardNavigation />{children}</>;
}
