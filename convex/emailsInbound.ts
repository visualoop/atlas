/**
 * Internal helpers for the /inbound/email httpAction.
 *
 * Two responsibilities:
 *  - Resolve which workspace an inbound email is destined for by
 *    matching one of the `to` addresses against senderIdentities.
 *  - Track webhookEvents for idempotency + observability.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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


/* ============================================================ */
/* Per-workspace Resend inbound signing secret                    */
/* ============================================================ */

import { requireUser } from "./lib/authHelpers";

export const getWorkspaceInboundSecret = internalQuery({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<{
    secret: string | null;
    workspaceId: Id<"workspaces"> | null;
  }> => {
    // Convex ids embed the table name in their prefix. If the string
    // isn't a workspaces id, ctx.db.get returns null instead of throwing.
    const ws = await ctx.db.get(
      args.workspaceId as Id<"workspaces">,
    ).catch(() => null);
    if (!ws || !("resendInboundSecret" in ws)) {
      return { secret: null, workspaceId: null };
    }
    return {
      secret: ws.resendInboundSecret ?? null,
      workspaceId: ws._id,
    };
  },
});

/** UI-facing — save/update the per-workspace webhook signing secret. */
export const saveWorkspaceInboundSecret = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) {
      throw new Error("No active workspace");
    }
    const trimmed = args.secret.trim();
    await ctx.db.patch(profile.lastActiveWorkspaceId, {
      resendInboundSecret: trimmed.length > 0 ? trimmed : undefined,
    });
  },
});

/** UI-facing — report whether the workspace has a secret set (not the value). */
export const workspaceInboundSecretStatus = query({
  args: {},
  handler: async (ctx): Promise<{ hasSecret: boolean }> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return { hasSecret: false };
    const ws = await ctx.db.get(profile.lastActiveWorkspaceId);
    return { hasSecret: Boolean(ws?.resendInboundSecret) };
  },
});
