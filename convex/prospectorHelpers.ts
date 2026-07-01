/**
 * Internal helpers for prospectorActions.ts (the "use node" file).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { getOrgKey } from "./lib/secretsAccess";
import type { Id } from "./_generated/dataModel";

export const prepareSearch = internalQuery({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const search = await ctx.db.get(args.searchId);
    if (!search || search.workspaceId !== wsCtx.workspace._id) {
      throw new Error("Search not found.");
    }

    let apiKey: string | undefined;
    try {
      const key = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "google_maps_places",
        reason: "prospector_search",
        actorId: wsCtx.user._id,
      });
      apiKey = key.value;
    } catch {
      // Handled by the calling action
    }

    return { search, apiKey };
  },
});


/**
 * Session-scoped: fetch just the Google Places API key for the active
 * workspace. Used by the map browse mode (no persistent search row).
 */
export const prepareForNearby = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    apiKey: string | null;
    workspaceId: Id<"workspaces"> | null;
  }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    let apiKey: string | null = null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "google_maps_places",
        reason: "prospector_nearby",
        actorId: wsCtx.user._id,
      });
      apiKey = k.value;
    } catch {}
    return { apiKey, workspaceId: wsCtx.workspace._id };
  },
});
