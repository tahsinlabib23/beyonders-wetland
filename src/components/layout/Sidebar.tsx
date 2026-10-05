import React from "react";
import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="sidebar" style={{ width: "240px", borderRight: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", padding: "var(--space-md)" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.85rem", padding: "8px 12px", borderRadius: "var(--radius-sm)", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background = "var(--surface-glass)"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
          Overview
        </Link>
        <Link href="/wetland" style={{ color: "var(--accent-primary)", textDecoration: "none", fontSize: "0.85rem", padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-glass)", border: "1px solid var(--border-accent)" }}>
          Wetland Dashboard
        </Link>
        <Link href="/wetland/global" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.85rem", padding: "8px 12px", borderRadius: "var(--radius-sm)", transition: "all 0.2s" }}>
          Worldwide wetlands &amp; floods
        </Link>
      </nav>
    </aside>
  );
}
