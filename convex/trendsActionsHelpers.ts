/**
 * Session-less helper: given a workspaceId, fetch the org's decrypted
 * Groq API key using the org owner as the audit actor.
 *
 * Used by trendsActions (cron) since crons have no user session.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";

export const getGroqKey = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<string | null> => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: ws.organizationId,
        provider: "groq",
        reason: "trend_scan",
        actorId: owner.userId,
      });
      return k.value;
    } catch {
      return null;
    }
  },
});


/**
 * Resolve the org owner for a workspace so cron-driven actions can
 * call runFeature with a valid actorId (needed for audit + org-key
 * decryption).
 */
export const getOwnerActor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    return {
      organizationId: ws.organizationId,
      userId: owner.userId,
    };
  },
});
