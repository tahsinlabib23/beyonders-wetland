import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beyonders — Wetland Pulse | NASA Space Apps 2026",
  description:
    "Track wetland inundation dynamics using real NISAR satellite radar observations. Detect flooded vegetation, monitor wetland pulse, and validate every signal with forensic evidence.",
  keywords: [
    "NISAR",
    "wetland",
    "SAR",
    "radar",
    "inundation",
    "NASA",
    "Space Apps",
    "Beyonders",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
