import type { Metadata } from "next";
import "./globals.css";
import HazardNavigation from "@/components/layout/HazardNavigation";

export const metadata: Metadata = {
  title: "Beyonders — Earth in Motion | NASA Space Apps 2026",
  description:
    "Explore NISAR observations of wetlands, volcanic ground deformation and forest change, with clear evidence status and uncertainty.",
  keywords: [
    "NISAR",
    "wetland",
    "volcano",
    "forest",
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
      <body>
        <HazardNavigation />
        {children}
      </body>
    </html>
  );
}
