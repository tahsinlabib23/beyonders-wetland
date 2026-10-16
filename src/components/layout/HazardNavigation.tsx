"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { label: "Wetlands", href: "/wetland", match: "/wetland" },
  { label: "Volcanoes", href: "/volcano/global", match: "/volcano" },
  { label: "Forests", href: "/forest/global", match: "/forest" },
];

export default function HazardNavigation() {
  const pathname = usePathname();
  return (
    <nav className="hazard-nav" aria-label="Earth change sections">
      <Link href="/" className="hazard-nav__brand">GeoNexSAR</Link>
      <div className="hazard-nav__links">
        {sections.map((section) => {
          const active = pathname === section.match || pathname.startsWith(`${section.match}/`);
          return <Link key={section.href} href={section.href} aria-current={active ? "page" : undefined}>{section.label}</Link>;
        })}
      </div>
      <span className="hazard-nav__mission">NISAR · Earth surface change</span>
    </nav>
  );
}
