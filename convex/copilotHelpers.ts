/**
 * Internal queries for the ⌘J Copilot's tool-use.
 *
 * All queries scoped to a workspaceId that's resolved from the caller's
 * userProfile.lastActiveWorkspaceId (via prepare()).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";
import type { Doc, Id } from "./_generated/dataModel";

export const prepare = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
    userId: Id<"users">;
    keys: {
      groq?: string;
      openrouter?: string;
      gemini?: string;
      cerebras?: string;
      openai?: string;
    };
    brand: {
      workspaceName?: string;
      website?: string;
      oneLiner?: string;
      elevatorPitch?: string;
      offerings?: string;
      targetMarket?: string;
      brandVoice?: string;
      coreValues?: string;
      pricingSummary?: string;
    } | null;
  } | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId || !profile?.lastActiveOrgId) return null;

    // Fetch AI keys for every provider in the fallback chain
    const keys: {
      groq?: string;
      openrouter?: string;
      gemini?: string;
      cerebras?: string;
      openai?: string;
    } = {};
    for (const p of ["groq", "openrouter", "gemini", "cerebras", "openai"] as const) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: profile.lastActiveOrgId,
          provider: p,
          reason: "copilot_chat",
          actorId: user._id,
        });
        keys[p] = k.value;
      } catch {
        // Missing key — skipped
      }
    }

    // Workspace brand context
    const ws = await ctx.db.get(profile.lastActiveWorkspaceId);
    const brand = ws
      ? {
          workspaceName: ws.name,
          website: ws.website,
          oneLiner: ws.oneLiner,
          elevatorPitch: ws.elevatorPitch,
          offerings: ws.offerings,
          targetMarket: ws.targetMarket,
          brandVoice: ws.brandVoice,
          coreValues: ws.coreValues,
          pricingSummary: ws.pricingSummary,
        }
      : null;

    return {
      workspaceId: profile.lastActiveWorkspaceId,
      organizationId: profile.lastActiveOrgId,
      userId: user._id,
      keys,
      brand,
    };
  },
});

export const searchContacts = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    if (q.length < 1) return [];
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const matches = rows
      .filter((c) => c.archivedAt === undefined)
      .filter((c) => {
        const hay = `${c.firstName} ${c.lastName ?? ""} ${c.email ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, args.limit)
      .map((c) => ({
        id: c._id,
        name: `${c.firstName}${c.lastName ? " " + c.lastName : ""}`,
        email: c.email,
        phone: c.phone,
        lifecycleStage: c.lifecycleStage,
        companyId: c.companyId,
      }));
    return matches;
  },
});

export const searchCompanies = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    if (q.length < 1) return [];
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    return rows
      .filter((c) => c.archivedAt === undefined)
      .filter((c) => `${c.name} ${c.domain ?? ""}`.toLowerCase().includes(q))
      .slice(0, args.limit)
      .map((c) => ({
        id: c._id,
        name: c.name,
        domain: c.domain,
        lifecycleStage: c.lifecycleStage,
        city: c.city,
      }));
  },
});

export const searchDeals = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stageById = new Map(stages.map((s) => [s._id, s]));
    return rows
      .filter((d) => d.archivedAt === undefined)
      .filter((d) => q.length === 0 || d.name.toLowerCase().includes(q))
      .slice(0, args.limit)
      .map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents.toString(),
        currency: d.currency,
        stage: stageById.get(d.stageId)?.name ?? "unknown",
        won: !!d.wonAt,
        lost: !!d.lostAt,
        contactId: d.contactId,
        companyId: d.companyId,
      }));
  },
});

/**
 * List deals by state — the proper way to answer "top 3 open deals".
 * search_deals is only for name-based lookup.
 */
export const listDeals = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    state: v.string(),           // 'open' | 'won' | 'lost' | 'any'
    sortBy: v.string(),          // 'amount' | 'activity' | 'recent'
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stageById = new Map(stages.map((s) => [s._id, s]));

    const filtered = rows.filter((d) => {
      if (d.archivedAt !== undefined) return false;
      switch (args.state) {
        case "won":
          return !!d.wonAt;
        case "lost":
          return !!d.lostAt;
        case "open":
          return !d.wonAt && !d.lostAt;
        case "any":
        default:
          return true;
      }
    });

    const sorted = filtered.sort((a, b) => {
      switch (args.sortBy) {
        case "activity":
          return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
        case "recent":
          return b._creationTime - a._creationTime;
        case "amount":
        default:
          return Number(b.amountCents - a.amountCents);
      }
    });

    const total = filtered.length;
    return {
      total,
      state: args.state,
      deals: sorted.slice(0, args.limit).map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents.toString(),
        currency: d.currency,
        stage: stageById.get(d.stageId)?.name ?? "unknown",
        won: !!d.wonAt,
        lost: !!d.lostAt,
        wonAt: d.wonAt,
        lostAt: d.lostAt,
        contactId: d.contactId,
        companyId: d.companyId,
        healthScore: d.healthScore,
        lastActivityAt: d.lastActivityAt,
        lastActivityIso: d.lastActivityAt ? new Date(d.lastActivityAt).toISOString() : undefined,
        createdAt: new Date(d._creationTime).toISOString(),
      })),
    };
  },
});

export const recentConversations = internalQuery({
  args: { workspaceId: v.id("workspaces"), limit: v.number() },
  handler: async (ctx, args) => {
    // Return conversations regardless of state — the AI can filter itself.
    // Sort by lastMessageAt desc.
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_channel_time", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(args.limit * 3);
    const rows = all
      .filter((c) => c.archivedAt === undefined)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, args.limit);
    return rows.map((c) => ({
      id: c._id,
      channel: c.channel,
      state: c.state,
      subject: c.subject,
      participants: c.channel === "email" ? c.participantEmails : c.participantPhones,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      lastMessageIso: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : undefined,
      aiSummary: c.aiSummary,
    }));
  },
});

/**
 * Recent messages across every conversation. Used by "who did I speak to
 * yesterday?" — walks the messages table sorted by _creationTime desc,
 * hydrates the conversation subject + contact link if available.
 */
export const recentMessages = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
    sinceHoursAgo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff =
      typeof args.sinceHoursAgo === "number"
        ? now - args.sinceHoursAgo * 60 * 60 * 1000
        : 0;
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(args.limit);
    const filtered = msgs.filter((m) => m._creationTime >= cutoff);

    return await Promise.all(
      filtered.map(async (m) => {
        const conv = await ctx.db.get(m.conversationId);
        return {
          id: m._id,
          direction: m.direction,
          channel: conv?.channel ?? "unknown",
          senderEmail: m.senderEmail,
          senderPhone: m.senderPhone,
          subject: m.subject ?? conv?.subject,
          preview: m.bodyText.slice(0, 200),
          conversationId: m.conversationId,
          at: new Date(m._creationTime).toISOString(),
        };
      }),
    );
  },
});

/**
 * Recent timeline events across every subject — powers broader
 * "what happened yesterday" / "any deals moved last week" queries.
 */
export const recentTimelineEvents = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
    sinceHoursAgo: v.optional(v.number()),
    eventTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff =
      typeof args.sinceHoursAgo === "number"
        ? now - args.sinceHoursAgo * 60 * 60 * 1000
        : 0;
    const rows = await ctx.db
      .query("timelineEvents")
      .withIndex("by_workspace_occurred", (q) =>
        q.eq("workspaceId", args.workspaceId).gt("occurredAt", cutoff),
      )
      .order("desc")
      .take(args.limit);
    return rows
      .filter(
        (r) =>
          !args.eventTypes ||
          args.eventTypes.length === 0 ||
          args.eventTypes.includes(r.eventType),
      )
      .map((r) => ({
        id: r._id,
        eventType: r.eventType,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        at: new Date(r.occurredAt).toISOString(),
        payload: r.payload,
      }));
  },
});

export const kpiSummary = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const open = deals.filter((d) => d.archivedAt === undefined && !d.wonAt && !d.lostAt);
    const wonMonth = deals.filter((d) => d.wonAt && d.wonAt >= thirtyDaysAgo);
    const pipelineCents = open.reduce((s, d) => s + d.amountCents, 0n);
    const wonCents = wonMonth.reduce((s, d) => s + d.amountCents, 0n);

    const invoices = await ctx.db
      .query("documents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "invoice"))
      .collect();
    const outstanding = invoices.filter(
      (i) => i.archivedAt === undefined && i.status !== "paid" && i.status !== "cancelled" && i.status !== "void",
    );
    const outstandingCents = outstanding.reduce((s, i) => s + i.totalCents, 0n);

    return {
      openDeals: open.length,
      pipelineCents: pipelineCents.toString(),
      wonThisMonth: wonMonth.length,
      wonThisMonthCents: wonCents.toString(),
      outstandingInvoices: outstanding.length,
      outstandingCents: outstandingCents.toString(),
      currency: deals[0]?.currency ?? "KES",
    };
  },
});


/* ============================================================ */
/* Public preflight — used by the CopilotPanel                    */
/* ============================================================ */

import { query } from "./_generated/server";

export const canRun = query({
  args: {},
  handler: async (ctx): Promise<{ ready: boolean; reason?: string }> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return { ready: false, reason: "not_in_workspace" };

    // Check for any AI key across the full fallback chain
    for (const provider of ["groq", "gemini", "cerebras", "openai", "openrouter"] as const) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: profile.lastActiveOrgId,
          provider,
          reason: "copilot_preflight",
          actorId: user._id,
        });
        if (k.value) return { ready: true };
      } catch {}
    }
    return { ready: false, reason: "no_ai_key" };
  },
});


/**
 * List tasks. Filter presets: today (due today), overdue (past due),
 * week (due this week), all (any open task). Sorted by dueAt asc.
 */
export const listTasks = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    filter: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(startOfDay);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const all = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("status"), "open"),
        ),
      )
      .take(200);

    const filtered = all.filter((t) => {
      if (!t.dueAt) return args.filter === "all";
      switch (args.filter) {
        case "today":
          return t.dueAt >= startOfDay.getTime() && t.dueAt <= endOfDay.getTime();
        case "overdue":
          return t.dueAt < startOfDay.getTime();
        case "week":
          return t.dueAt >= startOfDay.getTime() && t.dueAt <= endOfWeek.getTime();
        case "all":
        default:
          return true;
      }
    });

    const sorted = filtered.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));

    return {
      filter: args.filter,
      total: sorted.length,
      tasks: sorted.slice(0, args.limit).map((t) => ({
        id: t._id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueAt: t.dueAt,
        dueIso: t.dueAt ? new Date(t.dueAt).toISOString() : undefined,
        overdue: t.dueAt ? t.dueAt < now : false,
        assigneeId: t.assigneeId,
        relatedToType: t.relatedToType,
        relatedToId: t.relatedToId,
      })),
    };
  },
});

/**
 * One-shot orientation snapshot — call this FIRST when the user
 * greets you or asks anything vague. Returns:
 *   - Workspace brand (with a hint if it's empty)
 *   - Today's queue counts
 *   - Top 3 open deals by amount
 *   - 3 rotting deals
 *   - 3 most recent messages
 * Compact response so the AI can decide what to say without more
 * tool calls.
 */
export const workspaceSnapshot = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return { error: "workspace_not_found" };

    // Brand summary
    const brand = {
      workspaceName: ws.name,
      hasContext: Boolean(
        ws.oneLiner || ws.elevatorPitch || ws.offerings || ws.targetMarket,
      ),
      oneLiner: ws.oneLiner ?? null,
      offerings: ws.offerings ?? null,
      targetMarket: ws.targetMarket ?? null,
      website: ws.website ?? null,
    };

    // Open deals — top 3
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("wonAt"), undefined),
          q.eq(q.field("lostAt"), undefined),
        ),
      )
      .take(200);
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const stageMap = new Map(stages.map((s) => [s._id as unknown as string, s]));

    const topOpen = [...deals]
      .sort((a, b) => Number(b.amountCents - a.amountCents))
      .slice(0, 3)
      .map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents.toString(),
        currency: d.currency,
        stage: stageMap.get(d.stageId as unknown as string)?.name ?? "unknown",
        healthScore: d.healthScore,
      }));

    // Rotting deals
    const oneDay = 24 * 60 * 60 * 1000;
    const rotting = deals
      .filter((d) => {
        const rotDays = stageMap.get(d.stageId as unknown as string)?.rotDays ?? 14;
        return (now - d.lastActivityAt) / oneDay >= rotDays;
      })
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
      .slice(0, 3)
      .map((d) => ({
        id: d._id,
        name: d.name,
        daysStale: Math.round((now - d.lastActivityAt) / oneDay),
      }));

    // Today counts
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_state_time", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("state", "open"),
      )
      .filter((q) => q.gt(q.field("unreadCount"), 0))
      .take(20);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("status"), "open"),
          q.lte(q.field("dueAt"), endOfDay.getTime()),
        ),
      )
      .take(20);

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_start", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("startAt", startOfDay.getTime())
          .lte("startAt", endOfDay.getTime()),
      )
      .filter((q) => q.eq(q.field("status"), "scheduled"))
      .take(10);

    // Recent messages
    const recentMsgs = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(3);

    return {
      brand,
      today: {
        unreadConversations: conversations.length,
        openTasks: tasks.length,
        meetingsToday: events.length,
      },
      topOpenDeals: topOpen,
      rottingDeals: rotting,
      recentMessages: recentMsgs.map((m) => ({
        id: m._id,
        direction: m.direction,
        subject: m.subject,
        preview: m.bodyText.slice(0, 120),
        at: new Date(m._creationTime).toISOString(),
      })),
      hint: brand.hasContext
        ? undefined
        : "Workspace brand is empty. When answering ANY question, mention that the founder should fill in Settings → Workspace so you can give more personalized answers.",
    };
  },
});


/**
 * Public query — for the Copilot panel to check whether workspace
 * brand fields have been filled in. If not, we nudge the founder
 * with an inline banner.
 */
export const workspaceBrandInfo = query({
  args: {},
  handler: async (ctx): Promise<{ hasContext: boolean }> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return { hasContext: false };
    const ws = await ctx.db.get(profile.lastActiveWorkspaceId);
    if (!ws) return { hasContext: false };
    return {
      hasContext: Boolean(
        ws.oneLiner || ws.elevatorPitch || ws.offerings || ws.targetMarket,
      ),
    };
  },
});

/**
 * Session-less variant of `prepare`. Used by background scheduler
 * actions (autoRank, calendar reminders, etc.) that don't run under
 * a user session.
 *
 * Resolves org owner from `members` table + uses them as `actorId`
 * for getOrgKey decryption. Same output shape as `prepare` so callers
 * can share downstream code.
 */
export const prepareForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
    userId: Id<"users">;
    keys: {
      groq?: string;
      openrouter?: string;
      gemini?: string;
      cerebras?: string;
      openai?: string;
    };
    brand: {
      workspaceName?: string;
      website?: string;
      oneLiner?: string;
      elevatorPitch?: string;
      offerings?: string;
      targetMarket?: string;
      brandVoice?: string;
      coreValues?: string;
      pricingSummary?: string;
    } | null;
  } | null> => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;

    // Resolve org owner as our actor for decryption + audit.
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner =
      members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;

    const keys: {
      groq?: string;
      openrouter?: string;
      gemini?: string;
      cerebras?: string;
      openai?: string;
    } = {};
    for (const p of ["groq", "openrouter", "gemini", "cerebras", "openai"] as const) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: ws.organizationId,
          provider: p,
          reason: "auto_rank",
          actorId: owner.userId,
        });
        keys[p] = k.value;
      } catch {
        // Missing key — skipped
      }
    }

    const brand = {
      workspaceName: ws.name,
      website: ws.website,
      oneLiner: ws.oneLiner,
      elevatorPitch: ws.elevatorPitch,
      offerings: ws.offerings,
      targetMarket: ws.targetMarket,
      brandVoice: ws.brandVoice,
      coreValues: ws.coreValues,
      pricingSummary: ws.pricingSummary,
    };

    return {
      workspaceId: ws._id,
      organizationId: ws.organizationId,
      userId: owner.userId,
      keys,
      brand,
    };
  },
});
