/**
 * Composio integration — query/mutation module (no Node runtime).
 * Actions live in composioActions.ts.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";

export const getConfig = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    return await ctx.db
      .query("composioConfig")
      .withIndex("by_org", (q) => q.eq("organizationId", wsCtx.workspace.organizationId))
      .first();
  },
});

export const setConfig = mutation({
  args: {
    composioProjectId: v.string(),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const existing = await ctx.db
      .query("composioConfig")
      .withIndex("by_org", (q) => q.eq("organizationId", wsCtx.workspace.organizationId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { composioProjectId: args.composioProjectId });
    } else {
      await ctx.db.insert("composioConfig", {
        organizationId: wsCtx.workspace.organizationId,
        composioProjectId: args.composioProjectId,
      });
    }
  },
});

export const recordConnection = mutation({
  args: {
    appSlug: v.string(),
    composioConnectionId: v.string(),
    accountLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    await ctx.db.insert("composioConnections", {
      workspaceId: wsCtx.workspace._id,
      userId: wsCtx.user._id,
      appSlug: args.appSlug,
      composioConnectionId: args.composioConnectionId,
      accountLabel: args.accountLabel,
      status: "active",
      connectedAt: Date.now(),
    });
  },
});

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    return await ctx.db
      .query("composioConnections")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("userId", wsCtx.user._id),
      )
      .collect();
  },
});

export const disconnect = mutation({
  args: { id: v.id("composioConnections") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(args.id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, { status: "disconnected" });
  },
});
