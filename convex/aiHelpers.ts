/**
 * Internal helpers used by ai.ts (the "use node" gateway action).
 *
 *   resolveChain — look up workspace override in aiFeatureBindings,
 *     otherwise return the hard-coded default from registry.ts.
 *   getProviderKey — decrypt the org's key for a provider.
 *   logCall — append to aiCallLog.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import { getDefaultChain, type ChainStep } from "./ai/registry";
import type { Id } from "./_generated/dataModel";

const CHAIN_STEP = v.object({
  provider: v.string(),
  model: v.string(),
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  tools: v.optional(v.array(v.string())),
});

export const resolveChain = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    featureId: v.string(),
  },
  returns: v.array(CHAIN_STEP),
  handler: async (ctx, args): Promise<ChainStep[]> => {
    const override = await ctx.db
      .query("aiFeatureBindings")
      .withIndex("by_workspace_feature", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("featureId", args.featureId),
      )
      .first();
    if (override && override.chain.length > 0) {
      return override.chain as ChainStep[];
    }
    return getDefaultChain(args.featureId);
  },
});

export const getProviderKey = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    provider: v.string(),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<string> => {
    const { value } = await getOrgKey(ctx, {
      organizationId: args.organizationId,
      // Provider literal narrowing — safe here because ai/registry.ts
      // only emits known providers into chains.
      provider: args.provider as Parameters<typeof getOrgKey>[1]["provider"],
      reason: "ai_call",
      actorId: args.actorId,
    });
    return value;
  },
});

export const logCall = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    actorId: v.optional(v.id("users")),
    featureId: v.string(),
    provider: v.string(),
    model: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("fallback"),
      v.literal("failed"),
    ),
    latencyMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    promptPreview: v.optional(v.string()),
    responsePreview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiCallLog", {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      actorId: args.actorId,
      featureId: args.featureId,
      provider: args.provider,
      model: args.model,
      status: args.status,
      latencyMs: args.latencyMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      error: args.error,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      promptPreview: args.promptPreview,
      responsePreview: args.responsePreview,
    });
  },
});
