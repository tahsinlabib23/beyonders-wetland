import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Redirect build artifacts when OneDrive or another synced folder blocks writes to .next.
  distDir: process.env.BEYONDERS_NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "assets.science.nasa.gov", pathname: "/dynamicimage/assets/science/esd/eo/images/iotd/2025/**" }],
  },
  env: { NEXT_PUBLIC_BEYONDERS_MODE: process.env.VERCEL === "1" || process.env.BEYONDERS_MODE === "public" || process.env.NEXT_PUBLIC_BEYONDERS_MODE === "public" ? "public" : "local" },
  outputFileTracingExcludes: { "/*": ["./pipeline/**/*", "./artifacts/**/*", "./**/*.mp4"] },
  // The project is opened at 127.0.0.1 in the in-app browser during development.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
