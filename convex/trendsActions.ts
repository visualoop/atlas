"use node";

/**
 * Trend intelligence — daily scan via Groq Compound.
 *
 * Groq Compound (`compound-beta`) has web_search + code_interpreter
 * built into the model. We give it a prompt asking for recent mentions
 * of a brand/topic and it produces JSON with URLs + titles + excerpts.
 *
 * Cron entry: crons.ts schedules `scanDueBrandWatches` every 6h.
 * Each call scans up to 10 watches; parses model output into
 * trendMentions rows via `internal.trends.insertMention`.
 */

import { internalAction } from "./_generated/server";
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
      // Resolve org-level Groq key using workspace's org owner
      const key: string | null = await ctx.runQuery(
        internal.trendsActionsHelpers.getGroqKey,
        { workspaceId: w.workspaceId },
      );
      if (!key) {
        // Mark scanned anyway so we don't spin the loop
        await ctx.runMutation(internal.trends.markWatchScanned, { id: w._id });
        continue;
      }

      const mentions = await scanOneWatch({
        apiKey: key,
        label: w.label,
        queries: w.queries,
        kind: w.kind,
        regionHint: w.regionHint,
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

async function scanOneWatch(args: {
  apiKey: string;
  label: string;
  queries: string[];
  kind: string;
  regionHint?: string;
}): Promise<CompoundMention[]> {
  const region = args.regionHint ?? "global";
  const queryStr = args.queries.map((q) => `"${q}"`).join(" OR ");

  const systemPrompt = `You are a brand intelligence agent. Use web_search to find recent public mentions of the target brand/topic.

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
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "compound-beta",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 3000,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    return parseJsonArray(text);
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
