/** Public mode is fail-closed on hosted deployments. Credentials stay local. */
export function publicViewer() {
  return process.env.VERCEL === "1" || process.env.BEYONDERS_MODE === "public" || process.env.NEXT_PUBLIC_BEYONDERS_MODE === "public";
}

export const publicClient = process.env.NEXT_PUBLIC_BEYONDERS_MODE === "public";
