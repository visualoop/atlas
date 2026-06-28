"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { type ReactNode } from "react";

/**
 * Convex client URL resolution.
 *
 * `convex dev` rewrites NEXT_PUBLIC_CONVEX_URL to http://127.0.0.1:3220 on
 * every boot. That localhost address only resolves on the VPS — a browser
 * on the user's device can't reach it, so the WebSocket sync connection
 * fails and `useConvexAuth()` never authenticates.
 *
 * To survive the rewrite we prefer NEXT_PUBLIC_CONVEX_PUBLIC_URL (which
 * convex doesn't touch) and only fall back to the convex-managed var.
 * In production both point at the same Convex deployment URL.
 */
const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL!;

const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
