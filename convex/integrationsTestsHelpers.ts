/**
 * Internal helper for the integration test action.
 * Fetches the decrypted key for a provider using the caller's active org.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";

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
  v.literal("geoapify"),
  v.literal("paystack"),
  v.literal("docuseal"),
  v.literal("composio"),
);

export const fetchKey = internalQuery({
  args: { provider: PROVIDER },
  handler: async (ctx, args): Promise<string | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return null;
    try {
      const { value } = await getOrgKey(ctx, {
        organizationId: profile.lastActiveOrgId,
        provider: args.provider,
        reason: "integration_test",
        actorId: user._id,
      });
      return value;
    } catch {
      return null;
    }
  },
});
