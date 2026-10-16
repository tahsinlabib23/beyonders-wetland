import type { Metadata } from "next";
import "./globals.css";
import "@/styles/atlas.css";
import "@/styles/forest-volcano.css";

export const metadata: Metadata = {
  title: "GeoNexSAR — Watch Earth's surface change with NISAR radar",
  description:
    "GeoNexSAR turns NASA–ISRO NISAR radar into an interactive investigation: open real processed cases, interrogate every detection, and challenge every result.",
  keywords: ["NISAR", "wetland", "SAR", "radar", "inundation", "NASA", "GeoNexSAR"],
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
