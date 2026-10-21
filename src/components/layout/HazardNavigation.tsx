"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HazardNavigation() {
  const pathname = usePathname();
  // The live wetland and forest workbenches own their full-screen mastheads.
  // Directory and briefing pages use this shared topic navigation instead.
  if (pathname === "/wetland" || pathname === "/forest") return null;
  const wetlandActive = pathname.startsWith("/wetland") || pathname === "/";
  const volcanoActive = pathname.startsWith("/volcano");
  const forestActive = pathname.startsWith("/forest");

  return (
    <nav className="hazard-nav" aria-label="Earth change topics">
      <Link className="hazard-nav__brand" href="/" aria-label="Beyonders home">Beyonders</Link>
      <div className="hazard-nav__links">
        <Link href="/wetland/global" aria-current={wetlandActive ? "page" : undefined}>
          Wetlands
        </Link>
        <Link href="/volcano/global" aria-current={volcanoActive ? "page" : undefined}>
          Volcanoes
        </Link>
        <Link href="/forest/global" aria-current={forestActive ? "page" : undefined}>
          Forests
        </Link>
      </div>
      <span className="hazard-nav__mission">NISAR · Earth in motion</span>
    </nav>
  );
}
