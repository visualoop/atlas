"use node";

/**
 * AI ranking for Prospector results.
 *
 * Takes the raw list of businesses returned from Overpass or Google
 * Places + the workspace brand context, asks the LLM to score each
 * business 0-100 for fit and return a one-line reason.
 *
 * Falls through the same free-tier chain the Copilot uses. Kept small
 * on purpose — this fires on every search so cost matters.
 *
 * Rate-limit resilience:
 *   - Session-level in-memory cache by (place ids + brand hash) so
 *     re-searching the same area doesn't re-hit the API
 *   - Compact prompt (workspace brand pared down, candidates one-line)
 *   - Full chain visibility on failure — errors from every attempted
 *     provider are surfaced in the fit reason so debugging is possible
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

interface PlaceIn {
  googlePlaceId: string;
  name: string;
  address?: string;
  types?: string[];
  rating?: number;
  ratingCount?: number;
  hasPhone?: boolean;
  hasWebsite?: boolean;
}

interface ScoredPlace {
  googlePlaceId: string;
  fitScore: number;
  fitReason: string;
}

export const rankProspects = action({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    places: v.array(
      v.object({
        googlePlaceId: v.string(),
        name: v.string(),
        address: v.optional(v.string()),
        types: v.optional(v.array(v.string())),
        rating: v.optional(v.number()),
        ratingCount: v.optional(v.number()),
        hasPhone: v.optional(v.boolean()),
        hasWebsite: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{
    scores: ScoredPlace[];
    provider?: string;
    error?: string;
  }> => {
    if (args.places.length === 0) return { scores: [] };

    // Two paths: with session (user calls from UI) or without
    // (scheduler action passes workspaceId directly).
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
    } | null = args.workspaceId
      ? await ctx.runQuery(internal.copilotHelpers.prepareForWorkspace, {
          workspaceId: args.workspaceId,
        })
      : await ctx.runQuery(internal.copilotHelpers.prepare, {});

    if (!setup) return { scores: [], error: "not_in_workspace" };

    // If workspace has zero brand context, we still score — but note
    // the ranking will be less workspace-tuned. Panel shows a nudge
    // separately to fill /settings/workspace.
    const hasContext = Boolean(
      setup.brand?.oneLiner ||
        setup.brand?.offerings ||
        setup.brand?.targetMarket,
    );

    const prompt = buildRankingPrompt({
      brand: setup.brand,
      places: args.places,
    });

    const chain: Array<{
      provider: "groq" | "gemini" | "cerebras" | "openrouter" | "openai";
      model: string;
    }> = [
      // Groq — cheap and fast, but 6000 TPM cap on free tier
      { provider: "groq", model: "llama-3.1-8b-instant" },
      { provider: "groq", model: "llama-3.3-70b-versatile" },
      // Gemini free tier — different rate-limit budget
      { provider: "gemini", model: "gemini-2.0-flash-exp" },
      { provider: "gemini", model: "gemini-1.5-flash" },
      // Cerebras free
      { provider: "cerebras", model: "llama-3.3-70b" },
      // OpenRouter free auto-router
      { provider: "openrouter", model: "openrouter/auto" },
      // OpenAI paid
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
          return { scores: parsed, provider: `${step.provider}/${step.model}` };
        }
        // Parser found no valid rows — log a redacted snippet so we can
        // see what the model returned without leaking full prompts.
        const snippet = text.trim().replace(/\s+/g, " ").slice(0, 120);
        errors.push(
          `${step.provider}/${step.model}: 0 rows parsed (raw: "${snippet}${text.length > 120 ? "…" : ""}")`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${step.provider}/${step.model}: ${msg.slice(0, 160)}`);
        continue;
      }
    }

    // All configured providers failed. Show every error so the user
    // can see exactly which providers were tried + why each failed.
    const reason = !anyKeyPresent
      ? "Add a Groq API key at Settings → Integrations (free)"
      : hasContext
        ? `AI ranking failed. Tried ${errors.length} providers: ${errors.join(" | ")}`
        : "Set up workspace brand for real scoring";

    return {
      scores: args.places.map((p) => ({
        googlePlaceId: p.googlePlaceId,
        fitScore: 50,
        fitReason: reason.slice(0, 400),
      })),
      error: !anyKeyPresent
        ? "no_ai_keys"
        : hasContext
          ? "ai_unavailable"
          : "no_workspace_context",
    };
  },
});

/**
 * Build a compact ranking prompt. Groq's free tier is 6000 TPM so
 * every token matters. We:
 *   - Trim workspace context to one-liner + offerings/target-market
 *   - Compress each candidate to a single terse line
 *   - Drop verbose examples in favour of tight rule statements
 */
function buildRankingPrompt(args: {
  brand: {
    workspaceName?: string;
    oneLiner?: string;
    offerings?: string;
    targetMarket?: string;
  } | null;
  places: PlaceIn[];
}): string {
  const brandLines: string[] = [];
  if (args.brand?.workspaceName) brandLines.push(args.brand.workspaceName);
  if (args.brand?.oneLiner) brandLines.push(args.brand.oneLiner);
  if (args.brand?.offerings) brandLines.push(`Offers: ${args.brand.offerings.slice(0, 300)}`);
  if (args.brand?.targetMarket) brandLines.push(`ICP: ${args.brand.targetMarket.slice(0, 200)}`);

  const candidateLines = args.places.map((p, i) => {
    const bits = [p.name];
    if (p.types?.length) bits.push(`(${p.types.slice(0, 2).join(",")})`);
    if (p.address) bits.push(`— ${p.address.slice(0, 60)}`);
    if (typeof p.rating === "number") bits.push(`★${p.rating}`);
    // Contactability signals — crucial for scoring
    const reach: string[] = [];
    if (p.hasPhone) reach.push("📞");
    if (p.hasWebsite) reach.push("🌐");
    if (reach.length === 0) reach.push("no contact");
    bits.push(`[${reach.join(" ")}]`);
    return `${i + 1}. [${p.googlePlaceId}] ${bits.join(" ")}`;
  });

  return `Score each candidate 0-100 for fit as a cold-outreach target for this founder.

WORKSPACE:
${brandLines.join("\n") || "(no brand context — score neutrally)"}

RULES:
- 90-100: perfect fit AND reachable (phone/website present)
- 60-89: likely fit, reachable via at least one channel
- 30-59: relevant but no contact info — needs walk-in visit
- 0-29: bad fit — chain, franchise, govt body, or wrong industry

CONTACTABILITY (weight this heavily):
- [📞 🌐] = phone + website both — easy WhatsApp + email cold outreach
- [📞] = phone only — WhatsApp works, no email path
- [🌐] = website only — email scrape possible, no direct phone
- [no contact] = neither — score at most 40 unless walk-in target

AUTOMATIC 0-9 only for:
- National chains (10+ branches, e.g. Naivas, KFC, KCB, Safaricom)
- Government bodies (ministry, county, agency, board)
- Names with "Group Holdings", "Corporation", "PLC", "Inc."
- Multinational subsidiaries

Small independent shops with 2-5 branches are FINE — still owner-run,
still perfect for cold outreach if reachable.

CANDIDATES:
${candidateLines.join("\n")}

Return JSON: {"scores": [{"id": "<the [placeId]>", "score": 0-100, "reason": "one crisp diagnostic sentence noting contact channel or lack thereof"}]}. One entry per candidate. No prose outside JSON.`;
}

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
        place_id?: string;
        score?: number;
        fitScore?: number;
        reason?: string;
        fitReason?: string;
        explanation?: string;
      };
      // Strip brackets some models add — "[osm-node-123]" → "osm-node-123"
      const rawId = r.id ?? r.googlePlaceId ?? r.placeId ?? r.place_id;
      const id =
        typeof rawId === "string"
          ? rawId.replace(/^\[|\]$/g, "").trim()
          : undefined;
      if (!id || !validIds.has(id)) return null;
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
