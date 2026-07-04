/**
 * Public query wrappers for Copilot's toolset.
 *
 * The Next.js streaming Route Handler (`app/api/copilot/route.ts`)
 * needs to call each tool from server-side JS with the caller's auth
 * token. That means these need to be `query` (not `internalQuery`)
 * so `fetchQuery({ token })` can hit them.
 *
 * Each wrapper does the same thing:
 *   1. require authenticated user
 *   2. resolve their active workspace
 *   3. delegate to the corresponding logic from copilotHelpers
 *
 * Kept as thin adapters — the actual data-fetching lives in the
 * private internal queries so the semantics stay in one place.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { QueryCtx } from "./_generated/server";

async function requireWs(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first();
  if (!profile?.lastActiveWorkspaceId || !profile?.lastActiveOrgId) {
    throw new Error("no_active_workspace");
  }
  return {
    workspaceId: profile.lastActiveWorkspaceId,
    organizationId: profile.lastActiveOrgId,
    userId: user._id,
  };
}

/* --------------- workspace_snapshot --------------- */

export const snapshotForAgent = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await requireWs(ctx);
    return await snapshotImpl(ctx, workspaceId);
  },
});

async function snapshotImpl(ctx: QueryCtx, workspaceId: string) {
  // Inline the same logic as internal.copilotHelpers.workspaceSnapshot
  // to avoid the internal→public wrap round-trip. Keep in sync.
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = dayStart.getTime();

  const ws = await ctx.db.get(workspaceId as never);
  const brand = ws && "name" in ws ? {
    name: (ws as unknown as { name: string }).name,
    oneLiner: (ws as unknown as { oneLiner?: string }).oneLiner,
    offerings: (ws as unknown as { offerings?: string }).offerings,
    targetMarket: (ws as unknown as { targetMarket?: string }).targetMarket,
  } : null;

  // top 3 open deals by amount
  const openDeals = await ctx.db
    .query("deals")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId as never))
    .filter((q) =>
      q.and(
        q.eq(q.field("archivedAt"), undefined),
        q.eq(q.field("wonAt"), undefined),
        q.eq(q.field("lostAt"), undefined),
      ),
    )
    .collect();
  const topDeals = openDeals
    .sort((a, b) => Number((b.amountCents ?? 0n) - (a.amountCents ?? 0n)))
    .slice(0, 3)
    .map((d) => ({
      id: d._id,
      name: d.name,
      amountCents: d.amountCents?.toString(),
      currency: d.currency,
      stageId: d.stageId,
    }));

  // recent messages (last 3, any direction)
  const recentMsgs = await ctx.db
    .query("messages")
    .withIndex("by_workspace_time", (q) =>
      q.eq("workspaceId", workspaceId as never),
    )
    .order("desc")
    .take(3);
  const messages = recentMsgs.map((m) => ({
    id: m._id,
    conversationId: m.conversationId,
    direction: m.direction,
    subject: m.subject,
    preview: (m.bodyText ?? "").slice(0, 200),
    at: m._creationTime,
  }));

  // Tasks due today
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", workspaceId as never),
    )
    .filter((q) =>
      q.and(
        q.eq(q.field("archivedAt"), undefined),
        q.eq(q.field("completedAt"), undefined),
      ),
    )
    .collect();
  const dueToday = tasks.filter(
    (t) => t.dueAt && t.dueAt >= todayMs && t.dueAt < todayMs + 86400000,
  );

  return {
    brand,
    counts: {
      openDealsTotal: openDeals.length,
      dueToday: dueToday.length,
      recentMessagesShown: messages.length,
    },
    topDeals,
    messages,
    tasksDueToday: dueToday.slice(0, 3).map((t) => ({
      id: t._id,
      title: t.title,
      dueAt: t.dueAt,
    })),
    generatedAt: now,
  };
}

/* --------------- workspace_kpis --------------- */

export const kpisForAgent = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await requireWs(ctx);
    const openDeals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId as never))
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("wonAt"), undefined),
          q.eq(q.field("lostAt"), undefined),
        ),
      )
      .collect();
    const pipelineCents = openDeals.reduce(
      (sum, d) => sum + (d.amountCents ?? 0n),
      0n,
    );

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const wonThisMonth = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId as never))
      .filter((q) => q.gte(q.field("wonAt"), monthStart.getTime()))
      .collect();
    const wonCents = wonThisMonth.reduce(
      (sum, d) => sum + (d.amountCents ?? 0n),
      0n,
    );

    return {
      pipelineTotalCents: pipelineCents.toString(),
      openDealsCount: openDeals.length,
      wonThisMonthCents: wonCents.toString(),
      wonThisMonthCount: wonThisMonth.length,
    };
  },
});

/* --------------- search_contacts --------------- */

export const searchContactsForAgent = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .filter((query) => query.eq(query.field("archivedAt"), undefined))
      .take(200);
    const filtered = contacts
      .filter((c) => {
        const full = `${c.firstName} ${c.lastName ?? ""}`.toLowerCase();
        return full.includes(q) || (c.email?.toLowerCase().includes(q) ?? false);
      })
      .slice(0, args.limit ?? 10);
    return filtered.map((c) => ({
      id: c._id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      companyId: c.companyId,
      lifecycleStage: c.lifecycleStage,
    }));
  },
});

/* --------------- search_companies --------------- */

export const searchCompaniesForAgent = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .filter((query) => query.eq(query.field("archivedAt"), undefined))
      .take(200);
    return rows
      .filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.domain?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, args.limit ?? 10)
      .map((c) => ({
        id: c._id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        size: c.size,
        city: c.city,
        website: c.website,
        phone: c.phone,
        tags: c.tags,
        lifecycleStage: c.lifecycleStage,
      }));
  },
});

/* --------------- search_deals --------------- */

export const searchDealsForAgent = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .filter((query) => query.eq(query.field("archivedAt"), undefined))
      .take(200);
    return rows
      .filter((d) => d.name.toLowerCase().includes(q))
      .slice(0, args.limit ?? 10)
      .map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents?.toString(),
        currency: d.currency,
        stageId: d.stageId,
        state: d.wonAt ? "won" : d.lostAt ? "lost" : "open",
        expectedCloseDate: d.expectedCloseDate,
      }));
  },
});

/* --------------- list_deals --------------- */

export const listDealsForAgent = query({
  args: {
    state: v.optional(v.union(v.literal("open"), v.literal("won"), v.literal("lost"), v.literal("any"))),
    sortBy: v.optional(v.union(v.literal("amount"), v.literal("activity"), v.literal("recent"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const state = args.state ?? "open";
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .filter((query) => query.eq(query.field("archivedAt"), undefined))
      .collect();
    const filtered = rows.filter((d) => {
      if (state === "open") return !d.wonAt && !d.lostAt;
      if (state === "won") return Boolean(d.wonAt);
      if (state === "lost") return Boolean(d.lostAt);
      return true;
    });
    const sortBy = args.sortBy ?? "amount";
    filtered.sort((a, b) => {
      if (sortBy === "amount") {
        return Number((b.amountCents ?? 0n) - (a.amountCents ?? 0n));
      }
      if (sortBy === "activity") {
        return (b.lastActivityAt ?? b._creationTime) - (a.lastActivityAt ?? a._creationTime);
      }
      return b._creationTime - a._creationTime;
    });
    return filtered.slice(0, args.limit ?? 10).map((d) => ({
      id: d._id,
      name: d.name,
      amountCents: d.amountCents?.toString(),
      currency: d.currency,
      stageId: d.stageId,
      state: d.wonAt ? "won" : d.lostAt ? "lost" : "open",
      lastActivityAt: d.lastActivityAt,
      contactId: d.contactId,
      companyId: d.companyId,
    }));
  },
});

/* --------------- list_recent_conversations --------------- */

export const recentConversationsForAgent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_channel_time", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .order("desc")
      .take(args.limit ?? 10);
    return rows.map((c) => ({
      id: c._id,
      channel: c.channel,
      subject: c.subject,
      state: c.state,
      lastMessageAt: c.lastMessageAt,
      messageCount: c.messageCount,
    }));
  },
});

/* --------------- list_recent_messages --------------- */

export const recentMessagesForAgent = query({
  args: {
    limit: v.optional(v.number()),
    sinceHoursAgo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const cutoff = args.sinceHoursAgo
      ? Date.now() - args.sinceHoursAgo * 60 * 60 * 1000
      : undefined;
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .order("desc")
      .take(args.limit ?? 20);
    const filtered = cutoff ? rows.filter((m) => m._creationTime >= cutoff) : rows;
    return filtered.map((m) => ({
      id: m._id,
      conversationId: m.conversationId,
      direction: m.direction,
      subject: m.subject,
      preview: (m.bodyText ?? "").slice(0, 200),
      fromName: m.senderName ?? m.senderEmail ?? m.senderPhone ?? "unknown",
      at: m._creationTime,
    }));
  },
});

/* --------------- list_recent_activity --------------- */

export const recentActivityForAgent = query({
  args: {
    limit: v.optional(v.number()),
    sinceHoursAgo: v.optional(v.number()),
    eventTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const cutoff = args.sinceHoursAgo
      ? Date.now() - args.sinceHoursAgo * 60 * 60 * 1000
      : undefined;
    const rows = await ctx.db
      .query("timelineEvents")
      .withIndex("by_workspace_occurred", (q) =>
        q.eq("workspaceId", workspaceId as never),
      )
      .order("desc")
      .take(args.limit ?? 25);
    const filtered = rows.filter((r) => {
      if (cutoff && r.occurredAt < cutoff) return false;
      if (args.eventTypes && !args.eventTypes.includes(r.eventType)) return false;
      return true;
    });
    return filtered.map((r) => ({
      id: r._id,
      type: r.eventType,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      at: r.occurredAt,
      payload: r.payload,
    }));
  },
});

/* --------------- list_tasks --------------- */

export const listTasksForAgent = query({
  args: {
    filter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("today"),
        v.literal("overdue"),
        v.literal("week"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWs(ctx);
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayMs = dayStart.getTime();
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (query) =>
        query.eq("workspaceId", workspaceId as never),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("archivedAt"), undefined),
          query.eq(query.field("completedAt"), undefined),
        ),
      )
      .take(200);
    const filter = args.filter ?? "all";
    const filtered = rows.filter((t) => {
      if (filter === "all") return true;
      if (!t.dueAt) return false;
      if (filter === "today") return t.dueAt >= todayMs && t.dueAt < todayMs + 86400000;
      if (filter === "overdue") return t.dueAt < now;
      if (filter === "week") return t.dueAt < todayMs + 7 * 86400000;
      return true;
    });
    filtered.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    return filtered.slice(0, args.limit ?? 20).map((t) => ({
      id: t._id,
      title: t.title,
      dueAt: t.dueAt,
      priority: t.priority,
    }));
  },
});

/* --------------- context bundle for the streaming route --------------- */

export const chatSetupForAgent = query({
  args: {},
  handler: async (ctx) => {
    const setup = await requireWs(ctx);
    const ws = await ctx.db.get(setup.workspaceId);
    if (!ws || !("name" in ws)) throw new Error("workspace_not_found");
    return {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      brand: {
        workspaceName: (ws as unknown as { name: string }).name,
        website: (ws as unknown as { website?: string }).website,
        oneLiner: (ws as unknown as { oneLiner?: string }).oneLiner,
        elevatorPitch: (ws as unknown as { elevatorPitch?: string }).elevatorPitch,
        offerings: (ws as unknown as { offerings?: string }).offerings,
        targetMarket: (ws as unknown as { targetMarket?: string }).targetMarket,
        brandVoice: (ws as unknown as { brandVoice?: string }).brandVoice,
        coreValues: (ws as unknown as { coreValues?: string }).coreValues,
        pricingSummary: (ws as unknown as { pricingSummary?: string }).pricingSummary,
      },
    };
  },
});