/**
 * V8 helpers for socialComposio.ts (Node action module).
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Doc, Id } from "./_generated/dataModel";

export const getConnection = internalQuery({
  args: { id: v.id("composioConnections") },
  handler: async (
    ctx,
    args,
  ): Promise<Doc<"composioConnections"> | null> => {
    return await ctx.db.get(args.id);
  },
});

export const recordPending = internalMutation({
  args: {
    appSlug: v.string(),
    composioConnectionId: v.string(),
    accountLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"composioConnections">> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    // Dedupe: if we already have a row for this composio id, return it
    const existing = await ctx.db
      .query("composioConnections")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("userId", wsCtx.user._id),
      )
      .collect();
    const match = existing.find(
      (r) => r.composioConnectionId === args.composioConnectionId,
    );
    if (match) return match._id;

    return await ctx.db.insert("composioConnections", {
      workspaceId: wsCtx.workspace._id,
      userId: wsCtx.user._id,
      appSlug: args.appSlug,
      composioConnectionId: args.composioConnectionId,
      accountLabel: args.accountLabel,
      status: "active",                          // Composio hasn't given us a pending state — we activate optimistically then verify via finalize
      connectedAt: Date.now(),
    });
  },
});

export const activateAndLink = internalMutation({
  args: {
    composioConnectionId: v.id("composioConnections"),
    platform: v.union(
      v.literal("facebook_page"),
      v.literal("instagram_business"),
      v.literal("linkedin_personal"),
      v.literal("linkedin_company"),
    ),
    externalId: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"socialConnections">> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const composio = await ctx.db.get(args.composioConnectionId);
    if (!composio || composio.workspaceId !== wsCtx.workspace._id) {
      throw new Error("composioConnection not found");
    }
    await ctx.db.patch(args.composioConnectionId, {
      status: "active",
      accountLabel: args.displayName,
      lastUsedAt: Date.now(),
    });

    // Dedupe socialConnections by external id
    const existing = await ctx.db
      .query("socialConnections")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .first();
    if (existing && existing.workspaceId === wsCtx.workspace._id) {
      await ctx.db.patch(existing._id, {
        status: "connected",
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        archivedAt: undefined,
        lastSyncAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("socialConnections", {
      workspaceId: wsCtx.workspace._id,
      platform: args.platform,
      externalId: args.externalId,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      status: "connected",
      connectedBy: wsCtx.user._id,
      lastSyncAt: Date.now(),
    });
  },
});


export const getSocialConnection = internalQuery({
  args: { id: v.id("socialConnections") },
  handler: async (
    ctx,
    args,
  ): Promise<Doc<"socialConnections"> | null> => {
    return await ctx.db.get(args.id);
  },
});

export const disconnectLocal = internalMutation({
  args: { composioAccountId: v.string() },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });

    // socialConnections — mark revoked + archive
    const sc = await ctx.db
      .query("socialConnections")
      .withIndex("by_external_id", (q) =>
        q.eq("externalId", args.composioAccountId),
      )
      .first();
    if (sc && sc.workspaceId === wsCtx.workspace._id) {
      await ctx.db.patch(sc._id, {
        status: "revoked",
        archivedAt: Date.now(),
      });
    }

    // composioConnections — mark disconnected
    const rows = await ctx.db
      .query("composioConnections")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("userId", wsCtx.user._id),
      )
      .collect();
    const match = rows.find(
      (r) => r.composioConnectionId === args.composioAccountId,
    );
    if (match) {
      await ctx.db.patch(match._id, { status: "disconnected" });
    }
  },
});
