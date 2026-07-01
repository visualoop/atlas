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
