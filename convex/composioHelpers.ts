/**
 * Session-less helpers for the composio module (Node runtime action).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";
import type { Id } from "./_generated/dataModel";

export const prepare = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    apiKey: string | null;
    userId: Id<"users"> | null;
    workspaceId: Id<"workspaces"> | null;
  }> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return { apiKey: null, userId: user._id, workspaceId: profile?.lastActiveWorkspaceId ?? null };

    // Composio key is stored per-org in orgIntegrationKeys under provider='composio'
    let apiKey: string | null = null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: profile.lastActiveOrgId,
        provider: "composio",
        reason: "composio_connect",
        actorId: user._id,
      });
      apiKey = k.value;
    } catch {}

    return {
      apiKey,
      userId: user._id,
      workspaceId: profile.lastActiveWorkspaceId ?? null,
    };
  },
});

export const prepareExecute = internalQuery({
  args: { connectionId: v.id("composioConnections") },
  handler: async (ctx, args): Promise<{
    apiKey: string | null;
    connectionRef: string | null;
  }> => {
    const c = await ctx.db.get(args.connectionId);
    if (!c || c.status !== "active") return { apiKey: null, connectionRef: null };

    const ws = await ctx.db.get(c.workspaceId);
    if (!ws) return { apiKey: null, connectionRef: null };

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return { apiKey: null, connectionRef: null };

    let apiKey: string | null = null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: ws.organizationId,
        provider: "composio",
        reason: "composio_execute",
        actorId: owner.userId,
      });
      apiKey = k.value;
    } catch {}

    return {
      apiKey,
      connectionRef: c.composioConnectionId,
    };
  },
});
