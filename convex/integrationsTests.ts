"use node";

/**
 * Per-provider integration tests. Called from
 * /settings/integrations to validate that a saved key actually works.
 *
 * For each provider, do the cheapest possible authenticated GET
 * (list-domains, list-me, etc.) and return { ok, detail }.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const PROVIDER = v.union(
  v.literal("gemini"),
  v.literal("groq"),
  v.literal("openrouter"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("cerebras"),
  v.literal("github_models"),
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("together"),
  v.literal("deepseek"),
  v.literal("xai"),
  v.literal("perplexity"),
  v.literal("google_vertex"),
  v.literal("resend"),
  v.literal("meta_whatsapp"),
  v.literal("cloudflare_email_routing"),
  v.literal("google_maps_places"),
  v.literal("paystack"),
  v.literal("docuseal"),
  v.literal("composio"),
);

export const testProvider = action({
  args: { provider: PROVIDER },
  handler: async (ctx, args): Promise<{ ok: boolean; detail?: string }> => {
    const key = await ctx.runQuery(internal.integrationsTestsHelpers.fetchKey, {
      provider: args.provider,
    });
    if (!key) return { ok: false, detail: "no_key_configured" };

    try {
      switch (args.provider) {
        case "gemini": {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
            { headers: { "Content-Type": "application/json" } },
          );
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          const j = (await res.json()) as { models?: unknown[] };
          return { ok: true, detail: `${j.models?.length ?? 0} models` };
        }
        case "groq":
        case "cerebras":
        case "openai":
        case "openrouter":
        case "mistral":
        case "together":
        case "deepseek":
        case "xai":
        case "perplexity": {
          const endpoints: Record<string, string> = {
            groq: "https://api.groq.com/openai/v1/models",
            cerebras: "https://api.cerebras.ai/v1/models",
            openai: "https://api.openai.com/v1/models",
            openrouter: "https://openrouter.ai/api/v1/models",
            mistral: "https://api.mistral.ai/v1/models",
            together: "https://api.together.xyz/v1/models",
            deepseek: "https://api.deepseek.com/models",
            xai: "https://api.x.ai/v1/models",
            perplexity: "https://api.perplexity.ai/models",
          };
          const res = await fetch(endpoints[args.provider], {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          const j = (await res.json()) as { data?: unknown[] };
          return { ok: true, detail: `${j.data?.length ?? 0} models` };
        }
        case "anthropic": {
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "cohere": {
          const res = await fetch("https://api.cohere.ai/v1/models", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "github_models": {
          const res = await fetch("https://models.inference.ai.azure.com/models", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "resend": {
          const res = await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          const j = (await res.json()) as { data?: Array<{ name: string; status: string }> };
          const verified = j.data?.filter((d) => d.status === "verified").length ?? 0;
          return { ok: true, detail: `${verified} verified domain${verified === 1 ? "" : "s"}` };
        }
        case "paystack": {
          const res = await fetch("https://api.paystack.co/customer?perPage=1", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "google_maps_places": {
          const res = await fetch(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: {
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": "places.id",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ textQuery: "coffee in Nairobi", pageSize: 1 }),
            },
          );
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "meta_whatsapp": {
          // Cheapest verification: hit the debug_token endpoint
          const res = await fetch(
            `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(key)}&access_token=${encodeURIComponent(key)}`,
          );
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "token valid" };
        }
        case "docuseal": {
          const res = await fetch("https://api.docuseal.com/templates?limit=1", {
            headers: { "X-Auth-Token": key },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "cloudflare_email_routing": {
          // Cloudflare API tokens: verify with the /user/tokens/verify endpoint
          const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          const j = (await res.json()) as { success: boolean };
          return { ok: !!j.success, detail: j.success ? "token active" : "invalid" };
        }
        case "google_vertex": {
          // Vertex accepts either OAuth access tokens or (rarely) service
          // account JSON. Bearer token flow: hit the discovery endpoint.
          const res = await fetch(
            "https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models",
            { headers: { Authorization: `Bearer ${key}` } },
          );
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          return { ok: true, detail: "authenticated" };
        }
        case "composio": {
          const res = await fetch("https://backend.composio.dev/api/v1/apps?limit=1", {
            headers: { "x-api-key": key },
          });
          if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
          const j = (await res.json()) as { items?: unknown[]; data?: unknown[] };
          const count = j.items?.length ?? j.data?.length ?? 0;
          return { ok: true, detail: `authenticated, ${count} apps visible` };
        }
        default:
          return { ok: false, detail: "no_test_for_provider" };
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : "network_error",
      };
    }
  },
});
