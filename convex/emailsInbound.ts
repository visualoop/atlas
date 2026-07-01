/**
 * Internal helpers for the /inbound/email httpAction.
 *
 * Two responsibilities:
 *  - Resolve which workspace an inbound email is destined for by
 *    matching one of the `to` addresses against senderIdentities.
 *  - Track webhookEvents for idempotency + observability.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const resolveWorkspaceByAddress = internalQuery({
  args: { addresses: v.array(v.string()) },
  handler: async (ctx, args): Promise<Id<"workspaces"> | null> => {
    for (const addr of args.addresses) {
      const match = await ctx.db
        .query("senderIdentities")
        .filter((q) =>
          q.and(
            q.eq(q.field("channel"), "email"),
            q.eq(q.field("address"), addr),
          ),
        )
        .first();
      if (match && match.archivedAt === undefined) return match.workspaceId;
    }
    return null;
  },
});

export const findWebhookEvent = internalQuery({
  args: { provider: v.string(), externalId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_external", (q) =>
        q.eq("provider", args.provider).eq("externalId", args.externalId),
      )
      .first();
  },
});

export const recordWebhookEvent = internalMutation({
  args: {
    provider: v.string(),
    externalId: v.string(),
    eventType: v.string(),
    rawPayload: v.any(),
    error: v.optional(v.string()),
    resultStatus: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("webhookEvents", {
      provider: args.provider,
      externalId: args.externalId,
      eventType: args.eventType,
      rawPayload: args.rawPayload,
      receivedAt: now,
      processedAt: args.error ? undefined : now,
      processingError: args.error,
    });
  },
});
