"use node";

/**
 * Trend intelligence — daily scan via the AI feature registry.
 *
 * Uses the `trend_scan` feature which routes through:
 *   1. Groq compound-beta (built-in web_search + code_interpreter)
 *   2. Perplexity Sonar via OpenRouter (web-search-native)
 *   3. Perplexity Sonar Pro via OpenRouter
 *   4. OpenRouter/auto safety net
 *
 * Cron entry: crons.ts schedules `scanDueBrandWatches` every 6h.
 * Each call scans up to 10 watches; parses model output into
 * trendMentions rows via `internal.trends.insertMention`.
 */

import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MAX_WATCHES_PER_TICK = 10;

interface CompoundMention {
  url: string;
  title: string;
  excerpt: string;
  sentiment?: "positive" | "neutral" | "negative";
  relevance?: number;
  authorName?: string;
  authorHandle?: string;
  topics?: string[];
  publishedAt?: number;
}

export const scanDueBrandWatches = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; found: number }> => {
    const watches = await ctx.runQuery(internal.trends.listWatchesDueForScan, {
      minAgeHours: 24,
    });
    const capped = watches.slice(0, MAX_WATCHES_PER_TICK);

    let totalFound = 0;
    for (const w of capped) {
      const actor = await ctx.runQuery(
        internal.trendsActionsHelpers.getOwnerActor,
        { workspaceId: w.workspaceId },
      );
      if (!actor) {
        // No owner resolved — mark scanned so we don't loop
        await ctx.runMutation(internal.trends.markWatchScanned, { id: w._id });
        continue;
      }

      const mentions = await scanOneWatch(ctx, {
        workspaceId: w.workspaceId,
        organizationId: actor.organizationId as Id<"organizations">,
        actorId: actor.userId as Id<"users">,
        label: w.label,
        queries: w.queries,
        kind: w.kind,
        regionHint: w.regionHint,
        watchId: w._id,
      });

      for (const m of mentions.slice(0, 25)) {
        await ctx.runMutation(internal.trends.insertMention, {
          workspaceId: w.workspaceId,
          watchId: w._id,
          sourceType: "web",
          url: m.url,
          title: m.title.slice(0, 200),
          excerpt: m.excerpt.slice(0, 500),
          authorName: m.authorName,
          authorHandle: m.authorHandle,
          sentiment: m.sentiment,
          relevanceScore: typeof m.relevance === "number" ? Math.round(m.relevance) : undefined,
          topics: m.topics?.slice(0, 5),
          publishedAt: m.publishedAt,
        });
      }
      totalFound += mentions.length;

      await ctx.runMutation(internal.trends.markWatchScanned, { id: w._id });
    }

    return { scanned: capped.length, found: totalFound };
  },
});

/* ------------------------------------------------------------------ */

async function scanOneWatch(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
    actorId: Id<"users">;
    label: string;
    queries: string[];
    kind: string;
    regionHint?: string;
    watchId: Id<"brandWatches">;
  },
): Promise<CompoundMention[]> {
  const region = args.regionHint ?? "global";
  const queryStr = args.queries.map((q) => `"${q}"`).join(" OR ");

  const systemPrompt = `You are a brand intelligence agent. Use web_search (or your equivalent) to find recent public mentions of the target brand/topic.

Return ONLY a valid JSON array (no prose, no code fence, no commentary) with objects of shape:
{
  "url": "https://…",
  "title": "…",
  "excerpt": "1-3 sentence summary of what the source says",
  "sentiment": "positive" | "neutral" | "negative",
  "relevance": 0-100,
  "authorName": "optional",
  "authorHandle": "optional",
  "topics": ["optional", "keyword", "tags"],
  "publishedAt": optional ms epoch
}

If nothing new is found, return [].`;

  const userPrompt = `Search for recent (last 7 days) mentions of ${args.kind} "${args.label}" using these queries: ${queryStr}. Region hint: ${region}. Skip anything published by ${args.label}'s own site. Return up to 15 highest-relevance items.`;

  try {
    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      actorId: args.actorId,
      featureId: "trend_scan",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "brand_watch",
      resourceId: args.watchId,
    });
    return parseJsonArray(result.text);
  } catch {
    return [];
  }
}

function parseJsonArray(text: string): CompoundMention[] {
  const trimmed = text.trim();
  // Strip optional ```json fences
  const jsonStr = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (x): x is CompoundMention =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as { url?: unknown }).url === "string" &&
          typeof (x as { title?: unknown }).title === "string",
      );
    }
  } catch {
    // Try to salvage — find first [ … ] segment
    const start = jsonStr.indexOf("[");
    const end = jsonStr.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const salvaged = JSON.parse(jsonStr.slice(start, end + 1)) as unknown;
        if (Array.isArray(salvaged)) return salvaged as CompoundMention[];
      } catch {
        // give up
      }
    }
  }
  return [];
}
