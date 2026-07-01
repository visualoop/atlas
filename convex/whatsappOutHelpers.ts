/**
 * Internal helpers for whatsappOut.ts (Node runtime action).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { getOrgKey } from "./lib/secretsAccess";
import type { Doc, Id } from "./_generated/dataModel";

export const prepareSend = internalQuery({
  args: {
    conversationId: v.optional(v.id("conversations")),
    toPhone: v.string(),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });

    // Determine which connection to use — either the one on the
    // conversation (if any) or the default for the workspace.
    let connection: Doc<"whatsappConnections"> | null = null;
    if (args.conversationId) {
      const conv = await ctx.db.get(args.conversationId);
      if (conv && conv.workspaceId === wsCtx.workspace._id && conv.channel === "whatsapp") {
        // Use the workspace's active whatsapp connection
        connection = await ctx.db
          .query("whatsappConnections")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
          .filter((q) => q.eq(q.field("status"), "connected"))
          .first();
      }
    }
    if (!connection) {
      connection = await ctx.db
        .query("whatsappConnections")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .filter((q) => q.eq(q.field("status"), "connected"))
        .first();
    }

    let accessToken: string | undefined;
    try {
      const key = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "meta_whatsapp",
        reason: "whatsapp_send",
        actorId: wsCtx.user._id,
      });
      accessToken = key.value;
    } catch {
      // Handled by caller
    }

    return {
      workspaceId: wsCtx.workspace._id,
      userId: wsCtx.user._id,
      connection,
      accessToken,
    };
  },
});


export const prepareSystemSend = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args): Promise<{
    connection: Doc<"whatsappConnections"> | null;
    accessToken?: string;
  }> => {
    const connection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("status"), "connected"))
      .first();

    // Fetch access token using the org owner as actor
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return { connection, accessToken: undefined };

    let accessToken: string | undefined;
    try {
      const key = await getOrgKey(ctx, {
        organizationId: args.organizationId,
        provider: "meta_whatsapp",
        reason: "whatsapp_system_send",
        actorId: owner.userId,
      });
      accessToken = key.value;
    } catch {
      // Not configured
    }

    return { connection, accessToken };
  },
});
