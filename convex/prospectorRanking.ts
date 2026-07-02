"use node";

/**
 * AI ranking for Prospector results.
 *
 * Takes the raw list of businesses returned from Overpass or Google
 * Places + the workspace brand context, asks the LLM to score each
 * business 0-100 for fit and return a one-line reason.
 *
 * Falls through the same free-tier chain the Copilot uses: Groq
 * llama-3.1-8b-instant → Cerebras → Gemini → OpenRouter free.
 * Kept small on purpose — this fires on every search so cost matters.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

interface PlaceIn {
  googlePlaceId: string;
  name: string;
  address?: string;
  types?: string[];
  rating?: number;
  ratingCount?: number;
}

interface ScoredPlace {
  googlePlaceId: string;
  fitScore: number;
  fitReason: string;
}

export const rankProspects = action({
  args: {
    places: v.array(
      v.object({
        googlePlaceId: v.string(),
        name: v.string(),
        address: v.optional(v.string()),
        types: v.optional(v.array(v.string())),
        rating: v.optional(v.number()),
        ratingCount: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{
    scores: ScoredPlace[];
    provider?: string;
    error?: string;
  }> => {
    if (args.places.length === 0) return { scores: [] };

    const setup: {
      brand: {
        workspaceName?: string;
        oneLiner?: string;
        offerings?: string;
        targetMarket?: string;
      } | null;
      keys: {
        groq?: string;
        gemini?: string;
        cerebras?: string;
        openrouter?: string;
      };
    } | null = await ctx.runQuery(internal.copilotHelpers.prepare, {});

    if (!setup) return { scores: [], error: "not_in_workspace" };

    // If workspace has zero brand context, we skip AI ranking entirely
    // and just return neutral scores. The panel will show a nudge to fill
    // /settings/workspace.
    const hasContext = Boolean(
      setup.brand?.oneLiner || setup.brand?.offerings || setup.brand?.targetMarket,
    );
    if (!hasContext) {
      return {
        scores: args.places.map((p) => ({
          googlePlaceId: p.googlePlaceId,
          fitScore: 50,
          fitReason: "Set up workspace brand for real scoring",
        })),
        error: "no_workspace_context",
      };
    }

    const prompt = `You are helping a founder pick which businesses to prospect via WhatsApp / email.

WORKSPACE:
${setup.brand?.workspaceName ? `Name: ${setup.brand.workspaceName}` : ""}
${setup.brand?.oneLiner ? `One-liner: ${setup.brand.oneLiner}` : ""}
${setup.brand?.offerings ? `Offerings:\n${setup.brand.offerings}` : ""}
${setup.brand?.targetMarket ? `Ideal customer: ${setup.brand.targetMarket}` : ""}

For each candidate below, score 0-100 how likely it is that a cold WhatsApp / email pitch from a solo founder converts.

Score guidance (be strict — most cold outreach fails; scores should skew low):
- 90-100: perfect fit — small independent business matching the ICP exactly, likely no existing system, decision-maker is the owner + reachable via WhatsApp
- 60-89: good fit — likely relevant, worth a try, decision-maker probably owner
- 30-59: maybe — off-target size or unclear buyer, low-probability outreach
- 10-29: bad fit — likely already has a competitor's system, or buyer is a committee, or reaching an unresponsive department
- 0-9: no chance — a mega-brand, franchise, government body, or anything with 20+ locations or hundreds of employees

Automatic 0-9 signals:
- Any national/international chain (Naivas, KFC, Bata, KCB, Safaricom, Shell, Java House, Serena, Goodlife Pharmacy, etc.)
- Any government office / ministry / county
- Any name containing "Group", "Holdings", "Corporation", "Limited PLC", "Inc."
- Any franchise-looking name (name of country + industry + Ltd)
- Multi-branch entities (already tagged "N branches" in types)

Reason field must be crisp and diagnostic. Examples:
- "Independent hardware, likely paper-based inventory, owner-reachable"
- "Bank branch — committee procurement, no cold path"
- "Franchise café — HQ decides POS, local manager can't"
- "Salon, likely 2-4 staff, prime Loyalty prospect"

CANDIDATES:
${args.places
  .map(
    (p, i) =>
      `${i + 1}. ${p.name}${p.types?.length ? ` (${p.types.slice(0, 3).join(", ")})` : ""}${p.address ? ` — ${p.address}` : ""}${typeof p.rating === "number" ? ` — ★${p.rating}` : ""}`,
  )
  .join("\n")}

Return ONLY a JSON array with objects: {"id": "<googlePlaceId>", "score": 0-100, "reason": "one crisp diagnostic sentence"}. No prose, no code fence.`;

    const chain: Array<{ provider: "groq" | "gemini" | "cerebras" | "openrouter"; model: string }> = [
      { provider: "groq", model: "llama-3.1-8b-instant" },
      { provider: "cerebras", model: "llama-3.3-70b" },
      { provider: "gemini", model: "gemini-2.0-flash-exp" },
      { provider: "openrouter", model: "openrouter/auto" },
    ];

    for (const step of chain) {
      const apiKey = setup.keys[step.provider];
      if (!apiKey) continue;
      try {
        const text = await callLlm({
          provider: step.provider,
          model: step.model,
          apiKey,
          prompt,
        });
        const parsed = parseScoreArray(text, args.places);
        if (parsed.length > 0) {
          return { scores: parsed, provider: step.provider };
        }
      } catch {
        continue;
      }
    }

    // All providers failed — return neutral
    return {
      scores: args.places.map((p) => ({
        googlePlaceId: p.googlePlaceId,
        fitScore: 50,
        fitReason: "AI ranking unavailable",
      })),
      error: "ai_unavailable",
    };
  },
});

async function callLlm(args: {
  provider: "groq" | "gemini" | "cerebras" | "openrouter";
  model: string;
  apiKey: string;
  prompt: string;
}): Promise<string> {
  if (args.provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  const endpoints: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
  };
  const res = await fetch(endpoints[args.provider], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: "user", content: args.prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`${args.provider} ${res.status}`);
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return j.choices?.[0]?.message?.content ?? "";
}

function parseScoreArray(text: string, places: PlaceIn[]): ScoredPlace[] {
  const trimmed = text.trim();
  const jsonStr = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let arr: unknown;
  try {
    arr = JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf("[");
    const end = jsonStr.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        arr = JSON.parse(jsonStr.slice(start, end + 1));
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  const validIds = new Set(places.map((p) => p.googlePlaceId));
  return arr
    .map((row: unknown): ScoredPlace | null => {
      if (typeof row !== "object" || !row) return null;
      const r = row as { id?: string; score?: number; reason?: string };
      if (typeof r.id !== "string" || !validIds.has(r.id)) return null;
      const score = typeof r.score === "number" ? Math.max(0, Math.min(100, r.score)) : 50;
      return {
        googlePlaceId: r.id,
        fitScore: Math.round(score),
        fitReason: (r.reason ?? "").slice(0, 200),
      };
    })
    .filter((x): x is ScoredPlace => x !== null);
}
