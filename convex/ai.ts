"use node";

/**
 * AI gateway — feature-based runtime.
 *
 * Entry: `runFeature(featureId, messages, opts)`.
 *
 * Walks the workspace's chain for that feature (or the default from
 * registry.ts if none configured). For each step:
 *   - Decrypts the provider key from orgIntegrationKeys.
 *   - Calls the provider via `ai/providers.ts`.
 *   - On success: logs aiCallLog(status='success') and returns.
 *   - On failure: logs aiCallLog(status='fallback' or 'failed') and
 *     tries the next step. If every step fails, throws.
 *
 * Only Convex actions call this (never client). Callers pass the
 * organization + workspace ids explicitly (since the caller is
 * already an action that has resolved workspace context).
 */

import { v, ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  callGemini, callGroq, callCerebras, callOpenRouter, callOpenAI,
  callMistral, callTogether, callGithubModels, callAnthropic, callCohere,
  type AIMessage, type CallResult, type CallArgs,
} from "./ai/providers";
import type { ChainStep, ProviderId } from "./ai/registry";

interface RunFeatureArgs {
  workspaceId: Id<"workspaces">;
  organizationId: Id<"organizations">;
  actorId?: Id<"users">;
  featureId: string;
  messages: AIMessage[];
  // Optional record-context for aiCallLog + audit
  resourceType?: string;
  resourceId?: string;
}

interface RunFeatureResult {
  text: string;
  provider: ProviderId;
  model: string;
  fallbacksTried: number;
  inputTokens?: number;
  outputTokens?: number;
}

export const runFeature = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    actorId: v.optional(v.id("users")),
    featureId: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RunFeatureResult> => {
    // Load chain (workspace override or default)
    const chain: ChainStep[] = await ctx.runQuery(internal.aiHelpers.resolveChain, {
      workspaceId: args.workspaceId,
      featureId: args.featureId,
    });

    if (chain.length === 0) {
      throw new ConvexError({
        code: "NO_CHAIN",
        message: `No chain configured for feature ${args.featureId}.`,
      });
    }

    let fallbacksTried = 0;
    let lastError = "";
    for (const step of chain) {
      const start = Date.now();
      let apiKey: string | undefined;
      try {
        apiKey = await ctx.runQuery(internal.aiHelpers.getProviderKey, {
          organizationId: args.organizationId,
          provider: step.provider,
          actorId: args.actorId,
        });
      } catch {
        // No key for this provider — skip to next step
        await ctx.runMutation(internal.aiHelpers.logCall, {
          workspaceId: args.workspaceId,
          organizationId: args.organizationId,
          actorId: args.actorId,
          featureId: args.featureId,
          provider: step.provider,
          model: step.model,
          status: "fallback",
          error: "no_key",
          latencyMs: 0,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
        });
        fallbacksTried++;
        continue;
      }
      if (!apiKey) {
        fallbacksTried++;
        continue;
      }

      try {
        const result = await callProvider(step.provider, {
          apiKey,
          model: step.model,
          messages: args.messages,
          maxTokens: step.maxTokens,
          temperature: step.temperature,
        });
        const latencyMs = Date.now() - start;
        await ctx.runMutation(internal.aiHelpers.logCall, {
          workspaceId: args.workspaceId,
          organizationId: args.organizationId,
          actorId: args.actorId,
          featureId: args.featureId,
          provider: step.provider,
          model: step.model,
          status: "success",
          latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          promptPreview: args.messages.map((m) => m.content).join(" ").slice(0, 200),
          responsePreview: result.text.slice(0, 200),
        });
        return {
          text: result.text,
          provider: step.provider,
          model: step.model,
          fallbacksTried,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const latencyMs = Date.now() - start;
        await ctx.runMutation(internal.aiHelpers.logCall, {
          workspaceId: args.workspaceId,
          organizationId: args.organizationId,
          actorId: args.actorId,
          featureId: args.featureId,
          provider: step.provider,
          model: step.model,
          status: "fallback",
          error: lastError.slice(0, 200),
          latencyMs,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
        });
        fallbacksTried++;
        continue;
      }
    }

    throw new ConvexError({
      code: "ALL_PROVIDERS_FAILED",
      message: `All ${fallbacksTried} providers failed. Last error: ${lastError}`,
    });
  },
});

async function callProvider(provider: ProviderId, args: CallArgs): Promise<CallResult> {
  switch (provider) {
    case "gemini": return callGemini(args);
    case "groq": return callGroq(args);
    case "openrouter": return callOpenRouter(args);
    case "mistral": return callMistral(args);
    case "cohere": return callCohere(args);
    case "cerebras": return callCerebras(args);
    case "github_models": return callGithubModels(args);
    case "openai": return callOpenAI(args);
    case "anthropic": return callAnthropic(args);
    case "together": return callTogether(args);
    default: {
      const _: never = provider;
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
