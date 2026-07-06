/**
 * Resolve the Convex HTTP-actions site URL at runtime.
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_CONVEX_SITE_URL if explicitly set (production
 *      should always set this — e.g. https://actions.atlas.blyss.co.ke)
 *   2. Derive from NEXT_PUBLIC_CONVEX_URL by swapping ".convex.cloud"
 *      → ".convex.site" (works for hosted Convex Cloud)
 *   3. Empty string — caller should render a "not configured" state
 *      rather than a wrong URL. Never fall back to a dev proxy.
 */
export function resolveConvexSiteUrl(): string {
  if (typeof process === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const wsUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (wsUrl && wsUrl.includes(".convex.cloud")) {
    return wsUrl.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
  }
  return "";
}
