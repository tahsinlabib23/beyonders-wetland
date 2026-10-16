import HazardNavigation from "@/components/layout/HazardNavigation";

export default function ForestLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><HazardNavigation />{children}</>;
}
