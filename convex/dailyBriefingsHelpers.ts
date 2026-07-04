/**
 * V8 helpers for dailyBriefings.ts (Node action).
 *
 * Queries + mutation split out so the Node file can stay thin. All
 * cross-workspace reads happen through internalQuery here.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const listActiveWorkspaces = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ _id: Id<"workspaces"> }>> => {
    const rows = await ctx.db.query("workspaces").collect();
    return rows.map((w) => ({ _id: w._id }));
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

export const gatherBriefingContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    unreadConversations: number;
    tasksDueToday: number;
    meetingsToday: number;
    rottingDeals: number;
    uncontactedProspects: number;
    topOpenDeal: { name: string; amount: string | null } | null;
    recentInboundSubjects: string[];
    stalestDealName: string | null;
    stalestDealDaysStale: number | null;
  }> => {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startTs = startOfDay.getTime();
    const endTs = startTs + DAY_MS;

    // Unread conversations
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_state_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(500);
    const unreadConversations = conversations.filter(
      (c) => (c.unreadCount ?? 0) > 0 && !c.archivedAt,
    ).length;

    // Tasks due today
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "open"),
      )
      .take(200);
    const tasksDueToday = tasks.filter(
      (t) => t.dueAt && t.dueAt >= startTs && t.dueAt < endTs,
    ).length;

    // Meetings today
    let meetingsToday = 0;
    try {
      const meetings = await ctx.db
        .query("calendarEvents")
        .withIndex("by_workspace_start", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(200);
      meetingsToday = meetings.filter(
        (m) => m.startAt >= startTs && m.startAt < endTs,
      ).length;
    } catch {
      // calendarEvents may not exist yet
    }

    // Rotting deals
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(500);
    const openDeals = deals.filter((d) => !d.wonAt && !d.lostAt && !d.archivedAt);
    const rottingDeals = openDeals.filter(
      (d) => d.lastActivityAt < now - 7 * DAY_MS,
    ).length;

    // Top open deal by amount
    const topOpen = openDeals.sort((a, b) => {
      const av = a.amountCents ? Number(a.amountCents) : 0;
      const bv = b.amountCents ? Number(b.amountCents) : 0;
      return bv - av;
    })[0];
    const topOpenDeal = topOpen
      ? {
          name: topOpen.name,
          amount: topOpen.amountCents
            ? `${topOpen.currency} ${(Number(topOpen.amountCents) / 100).toLocaleString()}`
            : null,
        }
      : null;

    // Stalest deal
    const stalest = openDeals
      .slice()
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
    const stalestDealName = stalest ? stalest.name : null;
    const stalestDealDaysStale = stalest
      ? Math.floor((now - stalest.lastActivityAt) / DAY_MS)
      : null;

    // Uncontacted prospects (companies without any outbound email yet)
    let uncontactedProspects = 0;
    try {
      const companies = await ctx.db
        .query("companies")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(500);
      // Proxy: companies not marked as active customers
      uncontactedProspects = companies.filter(
        (c) => !c.archivedAt && c.lifecycleStage !== "customer",
      ).length;
    } catch {
      // no-op
    }

    // Recent inbound subjects (last 24h)
    const recentInbound = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(50);
    const recentInboundSubjects = recentInbound
      .filter(
        (m) => m.direction === "inbound" && m._creationTime > now - DAY_MS,
      )
      .map((m) => m.subject ?? "(no subject)")
      .slice(0, 5);

    return {
      unreadConversations,
      tasksDueToday,
      meetingsToday,
      rottingDeals,
      uncontactedProspects,
      topOpenDeal,
      recentInboundSubjects,
      stalestDealName,
      stalestDealDaysStale,
    };
  },
});

export const saveBriefing = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    briefing: v.string(),
    modelUsed: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Delete older briefings (keep last 3 for history)
    const older = await ctx.db
      .query("dailyBriefings")
      .withIndex("by_workspace_generated", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .collect();
    for (const row of older.slice(2)) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.insert("dailyBriefings", {
      workspaceId: args.workspaceId,
      briefing: args.briefing,
      generatedAt: Date.now(),
      modelUsed: args.modelUsed,
    });
  },
});

/**
 * Public query for the Today page to read the latest briefing.
 */
import { query } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";

export const latestForWorkspace = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    briefing: string;
    generatedAt: number;
    modelUsed?: string;
  } | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return null;
    const latest = await ctx.db
      .query("dailyBriefings")
      .withIndex("by_workspace_generated", (q) =>
        q.eq("workspaceId", profile.lastActiveWorkspaceId!),
      )
      .order("desc")
      .first();
    if (!latest) return null;
    return {
      briefing: latest.briefing,
      generatedAt: latest.generatedAt,
      modelUsed: latest.modelUsed,
    };
  },
});

/**
 * Public action wrapper — Today page's Refresh button calls this.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export const refreshMine = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) return { ok: false, reason: "no_workspace" };
    await ctx.runAction(internal.dailyBriefings.generateOne, {
      workspaceId: setup.workspaceId,
    });
    return { ok: true };
  },
});
