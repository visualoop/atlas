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

/**
 * Load prospectorResults missing all contact info (phone, website).
 * Used by prospectorPlaceDetails.fillPlaceDetails to gap-fill from
 * the Places API /v1/places/{id} endpoint.
 */
export const loadResultsMissingContact = internalQuery({
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
          q.eq(q.field("phone"), undefined),
          q.eq(q.field("website"), undefined),
          q.neq(q.field("enrichmentStatus"), "no_website"),
          q.neq(q.field("enrichmentStatus"), "done"),
        ),
      )
      .take(args.limit);
    return rows;
  },
});

/**
 * Return the org's Google Places key without a session. Uses org
 * owner as actor for decryption + audit.
 */
export const getPlacesKeyForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ apiKey: string } | null> => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: ws.organizationId,
        provider: "google_maps_places",
        reason: "place_details",
        actorId: owner.userId,
      });
      return { apiKey: k.value };
    } catch {
      return null;
    }
  },
});

/**
 * Patch a result with newly-discovered contact info from
 * /v1/places/{id}.
 */
export const patchResultContact = internalMutation({
  args: {
    resultId: v.id("prospectorResults"),
    patch: v.object({
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      hoursText: v.optional(v.string()),
      enrichmentStatus: v.optional(v.literal("no_website")),
    }),
  },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.resultId);
    if (!r) return;
    const patch: Record<string, unknown> = {};
    if (args.patch.phone && !r.phone) patch.phone = args.patch.phone;
    if (args.patch.website && !r.website) patch.website = args.patch.website;
    if (args.patch.hoursText) {
      const raw =
        typeof r.rawPlaceData === "object" && r.rawPlaceData
          ? (r.rawPlaceData as Record<string, unknown>)
          : {};
      patch.rawPlaceData = { ...raw, hoursText: args.patch.hoursText };
    }
    if (args.patch.enrichmentStatus) {
      patch.enrichmentStatus = args.patch.enrichmentStatus;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.resultId, patch);
    }
  },
});
