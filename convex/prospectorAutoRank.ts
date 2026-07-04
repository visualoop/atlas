"use node";

/**
 * Auto-rank prospector text-search results.
 *
 * After searchAndPersist lands results, this action scores each one
 * against the workspace brand context in a single AI call (batch),
 * then patches results with fitScore + fitReasoning. Fires as a
 * background scheduler.runAfter from persistSearchResults so search
 * response stays fast (~1s), then ~2-5s later results are ranked.
 *
 * Reuses prospectorRanking.rankProspects for the actual LLM call —
 * that action already handles the provider fallback chain + JSON
 * parsing robustly.
 */

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const rankSearchResults = internalAction({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (ctx, args): Promise<{ ranked: number; skipped: number }> => {
    console.log("[autoRank] start", { searchId: args.searchId });
    // 1. Load all unranked results for the search
    const unranked = await ctx.runQuery(
      internal.prospectorHelpers.loadUnrankedResults,
      { searchId: args.searchId },
    );
    console.log("[autoRank] unranked found", { count: unranked.length });
    if (unranked.length === 0) return { ranked: 0, skipped: 0 };

    // Auto-rank runs from a scheduler (no user session). Load the
    // workspaceId from the first result so rankProspects can use
    // the session-less prepare path.
    const workspaceId = unranked[0].workspaceId;

    // 2. Batch rank via existing ranker (same one used by Map browse)
    let ranked: {
      scores: Array<{ googlePlaceId: string; fitScore: number; fitReason: string }>;
      error?: string;
    };
    try {
      ranked = await ctx.runAction(api.prospectorRanking.rankProspects, {
        workspaceId,
        places: unranked.map((r) => ({
          googlePlaceId: r.googlePlaceId,
          name: r.name,
          address: r.address,
          types: r.types,
          rating: r.rating,
          ratingCount: r.ratingCount,
          hasPhone: Boolean(r.phone?.trim()),
          hasWebsite: Boolean(r.website?.trim()),
        })),
      });
      console.log("[autoRank] ranker returned", {
        scoreCount: ranked.scores.length,
        error: ranked.error,
      });
    } catch (err) {
      console.error("[autoRank] ranker threw", err);
      ranked = { scores: [], error: err instanceof Error ? err.message : "unknown" };
    }

    // 3. Map scores back to result IDs by googlePlaceId
    const byPlaceId = new Map(
      unranked.map((r) => [r.googlePlaceId, r._id as Id<"prospectorResults">]),
    );
    const applied = new Set<string>();
    for (const s of ranked.scores) {
      const resultId = byPlaceId.get(s.googlePlaceId);
      if (!resultId) continue;
      await ctx.runMutation(
        internal.prospectorHelpers.applyResultFitScore,
        {
          resultId,
          score: s.fitScore,
          reasoning: s.fitReason,
        },
      );
      applied.add(resultId as string);
    }

    // Hard fallback: any unranked result that didn't get scored (partial
    // response, provider errors) gets a neutral 50 so the UI unlocks.
    // Better than a spinner rotating forever.
    for (const r of unranked) {
      if (applied.has(r._id as string)) continue;
      await ctx.runMutation(
        internal.prospectorHelpers.applyResultFitScore,
        {
          resultId: r._id as Id<"prospectorResults">,
          score: 50,
          reasoning:
            ranked.error?.slice(0, 200) ??
            "AI scoring returned no data — using neutral score",
        },
      );
    }

    console.log("[autoRank] done", {
      ranked: applied.size,
      fallback: unranked.length - applied.size,
    });
    return { ranked: applied.size, skipped: unranked.length - applied.size };
  },
});

/**
 * Auto-enrich prospector results with website scrapes.
 *
 * For each result that HAS a website but hasn't been scraped yet,
 * fetch the site HTML and extract email/phone/description/socials
 * via the existing aiWorkflows.enrichWebsite action.
 *
 * Throttled: processes up to 5 results per batch, then reschedules
 * itself if more remain. Runs after auto-rank so we score first,
 * then enrich the promising ones.
 */
export const enrichSearchResults = internalAction({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (ctx, args): Promise<{ enriched: number; remaining: boolean }> => {
    const pending = await ctx.runQuery(
      internal.prospectorHelpers.loadUnEnrichedResults,
      { searchId: args.searchId, limit: 5 },
    );
    if (pending.length === 0) return { enriched: 0, remaining: false };

    await Promise.allSettled(
      pending.map((r) =>
        ctx.runAction(api.aiWorkflows.enrichWebsite, {
          resultId: r._id as Id<"prospectorResults">,
          system: true,
        }),
      ),
    );

    // Check if more remain
    const hasMore = await ctx.runQuery(
      internal.prospectorHelpers.loadUnEnrichedResults,
      { searchId: args.searchId, limit: 1 },
    );
    if (hasMore.length > 0) {
      await ctx.scheduler.runAfter(
        1500,
        internal.prospectorAutoRank.enrichSearchResults,
        { searchId: args.searchId },
      );
    }
    return { enriched: pending.length, remaining: hasMore.length > 0 };
  },
});

/**
 * Public wrapper — allows the frontend to manually trigger a re-score
 * of every result in a search. Enforces workspace ownership through
 * the internal action via requireWorkspaceContext.
 */
export const rankSearchResultsPublic = action({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (ctx, args): Promise<{ ranked: number; skipped: number }> => {
    // Verify ownership by reading via prospectorHelpers.prepareSearch
    await ctx.runQuery(internal.prospectorHelpers.prepareSearch, {
      searchId: args.searchId,
    });
    return await ctx.runAction(
      internal.prospectorAutoRank.rankSearchResults,
      { searchId: args.searchId },
    );
  },
});
