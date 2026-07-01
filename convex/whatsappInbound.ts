/**
 * Internal helpers used by the WhatsApp webhook httpAction
 * (see convex/http.ts /webhook/whatsapp).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const findByVerifyToken = internalQuery({
  args: { verifyToken: v.string() },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("whatsappConnections")
      .filter((q) => q.eq(q.field("webhookVerifyToken"), args.verifyToken))
      .first();
    return conn ? { connectionId: conn._id, workspaceId: conn.workspaceId } : null;
  },
});
