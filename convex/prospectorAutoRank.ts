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
    // 1. Load all unranked results for the search
    const unranked = await ctx.runQuery(
      internal.prospectorHelpers.loadUnrankedResults,
      { searchId: args.searchId },
    );
    if (unranked.length === 0) return { ranked: 0, skipped: 0 };

    // 2. Batch rank via existing ranker (same one used by Map browse)
    const ranked = await ctx.runAction(
      api.prospectorRanking.rankProspects,
      {
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
      },
    );

    // 3. Map scores back to result IDs by googlePlaceId
    const byPlaceId = new Map(
      unranked.map((r) => [r.googlePlaceId, r._id as Id<"prospectorResults">]),
    );
    let applied = 0;
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
      applied++;
    }
    return { ranked: applied, skipped: unranked.length - applied };
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
