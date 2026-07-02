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
        openai?: string;
      };
    } | null = await ctx.runQuery(internal.copilotHelpers.prepare, {});

    if (!setup) return { scores: [], error: "not_in_workspace" };

    // If workspace has zero brand context, we still score — but note
    // the ranking will be less workspace-tuned. Panel shows a nudge
    // separately to fill /settings/workspace.
    const hasContext = Boolean(
      setup.brand?.oneLiner ||
        setup.brand?.offerings ||
        setup.brand?.targetMarket,
    );

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

Return ONLY a JSON object with this exact shape:
{"scores": [{"id": "<googlePlaceId>", "score": 0-100, "reason": "one crisp diagnostic sentence"}, ...]}

Include one entry per candidate. No prose, no code fence, no explanations outside the JSON object.`;

    const chain: Array<{
      provider: "groq" | "gemini" | "cerebras" | "openrouter" | "openai";
      model: string;
    }> = [
      // Fast + free — Groq's Llama variants
      { provider: "groq", model: "llama-3.1-8b-instant" },
      { provider: "groq", model: "llama-3.3-70b-versatile" },
      // Cerebras free tier — Llama 3.3 70B
      { provider: "cerebras", model: "llama-3.3-70b" },
      // Google Gemini free tier — Flash is fast + high daily quota
      { provider: "gemini", model: "gemini-2.0-flash-exp" },
      { provider: "gemini", model: "gemini-1.5-flash" },
      // OpenRouter free auto-routing
      { provider: "openrouter", model: "openrouter/auto" },
      // OpenAI paid fallback (only if configured)
      { provider: "openai", model: "gpt-4o-mini" },
    ];

    const errors: string[] = [];
    let anyKeyPresent = false;
    for (const step of chain) {
      const apiKey = setup.keys[step.provider];
      if (!apiKey) continue;
      anyKeyPresent = true;
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
        errors.push(`${step.provider}/${step.model}: parser returned 0 rows`);
      } catch (err) {
        errors.push(
          `${step.provider}/${step.model}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    // If we get here, either no keys OR every configured provider failed.
    const reason = !anyKeyPresent
      ? "Add a Groq API key at Settings → Integrations (free)"
      : hasContext
        ? `AI ranking failed: ${errors.slice(0, 2).join("; ")}`
        : "Set up workspace brand for real scoring";

    return {
      scores: args.places.map((p) => ({
        googlePlaceId: p.googlePlaceId,
        fitScore: 50,
        fitReason: reason,
      })),
      error: !anyKeyPresent
        ? "no_ai_keys"
        : hasContext
          ? "ai_unavailable"
          : "no_workspace_context",
    };
  },
});

async function callLlm(args: {
  provider: "groq" | "gemini" | "cerebras" | "openrouter" | "openai";
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
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gemini ${res.status} ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  const endpoints: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
  };

  // JSON response mode — works on Groq, OpenAI, OpenRouter.
  // Cerebras doesn't support it yet, so we omit for that provider.
  const supportsJsonMode = args.provider !== "cerebras";

  const body: Record<string, unknown> = {
    model: args.model,
    messages: [
      {
        role: "system",
        content: "You return valid JSON only. No prose. No markdown fences.",
      },
      { role: "user", content: args.prompt },
    ],
    temperature: 0.2,
    max_tokens: 4000,
  };
  if (supportsJsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(endpoints[args.provider], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`${args.provider} ${res.status} ${errBody.slice(0, 200)}`);
  }
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to extract a JSON object or array from the middle of the text
    const objStart = jsonStr.indexOf("{");
    const objEnd = jsonStr.lastIndexOf("}");
    const arrStart = jsonStr.indexOf("[");
    const arrEnd = jsonStr.lastIndexOf("]");
    const useObj = objStart >= 0 && objEnd > objStart && (arrStart < 0 || objStart < arrStart);
    try {
      if (useObj) {
        parsed = JSON.parse(jsonStr.slice(objStart, objEnd + 1));
      } else if (arrStart >= 0 && arrEnd > arrStart) {
        parsed = JSON.parse(jsonStr.slice(arrStart, arrEnd + 1));
      } else {
        return [];
      }
    } catch {
      return [];
    }
  }

  // Unwrap common shapes:
  //   [{...}, {...}]                — bare array
  //   {scores: [...]}, {results: [...]}, {ranked: [...]}, {rankings: [...]}
  //   {data: [...]}
  let arr: unknown = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["scores", "results", "ranked", "rankings", "data", "items", "candidates"]) {
      if (Array.isArray(obj[key])) {
        arr = obj[key];
        break;
      }
    }
    // Some models return {[id]: {score, reason}} — flatten to array
    if (!Array.isArray(arr)) {
      const entries = Object.entries(obj);
      const looksLikeMap = entries.every(
        ([k, v]) =>
          places.some((p) => p.googlePlaceId === k) ||
          (typeof v === "object" && v !== null && ("score" in v || "reason" in v)),
      );
      if (looksLikeMap && entries.length > 0) {
        arr = entries.map(([id, v]) => ({
          id,
          ...(typeof v === "object" && v ? v : {}),
        }));
      }
    }
  }

  if (!Array.isArray(arr)) return [];

  const validIds = new Set(places.map((p) => p.googlePlaceId));
  return arr
    .map((row: unknown): ScoredPlace | null => {
      if (typeof row !== "object" || !row) return null;
      const r = row as {
        id?: string;
        googlePlaceId?: string;
        placeId?: string;
        score?: number;
        fitScore?: number;
        reason?: string;
        fitReason?: string;
        explanation?: string;
      };
      const id = r.id ?? r.googlePlaceId ?? r.placeId;
      if (typeof id !== "string" || !validIds.has(id)) return null;
      const rawScore = r.score ?? r.fitScore;
      const score = typeof rawScore === "number" ? Math.max(0, Math.min(100, rawScore)) : 50;
      const reason = r.reason ?? r.fitReason ?? r.explanation ?? "";
      return {
        googlePlaceId: id,
        fitScore: Math.round(score),
        fitReason: reason.slice(0, 200),
      };
    })
    .filter((x): x is ScoredPlace => x !== null);
}
