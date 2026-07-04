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

import { internalMutation } from "./_generated/server";

/**
 * Load every prospectorResult attached to a search that hasn't been
 * scored yet. Used by prospectorAutoRank.rankSearchResults.
 */
export const loadUnrankedResults = internalQuery({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("prospectorResults")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) => q.eq(q.field("fitScore"), undefined))
      .take(50);
    return rows;
  },
});

/**
 * Patch a single result with the AI's fit score + reasoning.
 */
export const applyResultFitScore = internalMutation({
  args: {
    resultId: v.id("prospectorResults"),
    score: v.number(),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.resultId);
    if (!r) return;
    await ctx.db.patch(args.resultId, {
      fitScore: args.score,
      fitReasoning: args.reasoning,
    });
  },
});

/**
 * Find prospectorResults that HAVE a website but haven't been scraped
 * yet (enrichmentStatus === "pending"). Used by
 * prospectorAutoRank.enrichSearchResults.
 */
export const loadUnEnrichedResults = internalQuery({
  args: {
    searchId: v.id("prospectorSearches"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("prospectorResults")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.and(
          q.neq(q.field("website"), undefined),
          q.eq(q.field("enrichmentStatus"), "pending"),
        ),
      )
      .take(args.limit);
    return rows;
  },
});
