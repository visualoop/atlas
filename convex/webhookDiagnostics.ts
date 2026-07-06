/**
 * Read-only diagnostic — introspects which workspace an id belongs to.
 * Used by the settings UI's "Verify webhook URL" button to confirm
 * that the id embedded in a Resend webhook URL actually resolves.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { Id } from "./_generated/dataModel";

export const identifyId = query({
  args: { rawId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { table: "workspaces"; name: string; hasInboundSecret: boolean }
    | { table: "unknown" }
  > => {
    await requireUser(ctx);
    // Try workspace first
    const ws = await ctx.db
      .get(args.rawId as Id<"workspaces">)
      .catch(() => null);
    if (ws && "name" in ws) {
      return {
        table: "workspaces",
        name: ws.name,
        hasInboundSecret: Boolean(ws.resendInboundSecret),
      };
    }
    return { table: "unknown" };
  },
});

export const mySelfWorkspaceId = query({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    return profile?.lastActiveWorkspaceId ?? null;
  },
});
