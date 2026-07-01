/**
 * Internal helpers for prospectorActions.ts (the "use node" file).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { getOrgKey } from "./lib/secretsAccess";

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
