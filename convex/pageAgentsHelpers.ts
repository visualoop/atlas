/**
 * V8 helper queries for the page-agent actions in pageAgents.ts.
 *
 * These queries load the shortlist of candidate records from the
 * database. The Node-side action then hands them to the LLM for
 * ranking.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const contactsForRanking = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"contacts">;
      firstName: string;
      lastName?: string;
      title?: string;
      companyName?: string;
      companyIndustry?: string;
      fitScore?: number;
      lifecycleStage?: string;
    }>
  > => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(args.limit * 4);

    // Filter: not archived, not customer yet, has some contact channel
    const filtered = rows.filter(
      (c) =>
        !c.archivedAt &&
        c.lifecycleStage !== "customer" &&
        c.lifecycleStage !== "lost" &&
        (c.email || c.phone || c.whatsapp),
    );

    // Prefer higher fit score, then more recent
    filtered.sort((a, b) => {
      const af = a.fitScore ?? 0;
      const bf = b.fitScore ?? 0;
      if (af !== bf) return bf - af;
      return b._creationTime - a._creationTime;
    });

    const trimmed = filtered.slice(0, args.limit);

    // Resolve company info for each contact
    const results = await Promise.all(
      trimmed.map(async (c) => {
        let companyName: string | undefined;
        let companyIndustry: string | undefined;
        if (c.companyId) {
          const co = await ctx.db.get(c.companyId);
          if (co) {
            companyName = co.name;
            companyIndustry = co.industry;
          }
        }
        return {
          _id: c._id,
          firstName: c.firstName,
          lastName: c.lastName,
          title: c.title,
          companyName,
          companyIndustry,
          fitScore: c.fitScore,
          lifecycleStage: c.lifecycleStage,
        };
      }),
    );
    return results;
  },
});

export const companiesForRanking = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"companies">;
      name: string;
      industry?: string;
      city?: string;
      fitScore?: number;
      lifecycleStage?: string;
    }>
  > => {
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(args.limit * 4);

    const filtered = rows.filter(
      (c) =>
        !c.archivedAt &&
        c.lifecycleStage !== "customer" &&
        c.lifecycleStage !== "lost",
    );

    filtered.sort((a, b) => {
      const af = a.fitScore ?? 0;
      const bf = b.fitScore ?? 0;
      if (af !== bf) return bf - af;
      return b._creationTime - a._creationTime;
    });

    return filtered.slice(0, args.limit).map((c) => ({
      _id: c._id,
      name: c.name,
      industry: c.industry,
      city: c.city,
      fitScore: c.fitScore,
      lifecycleStage: c.lifecycleStage,
    }));
  },
});


export const dealsForRanking = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"deals">;
      name: string;
      stage?: string;
      healthScore?: number;
      healthNotes?: string;
      aiNextAction?: string;
      daysStale?: number;
    }>
  > => {
    const now = Date.now();
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(args.limit * 4);
    const open = rows.filter(
      (d) => !d.wonAt && !d.lostAt && !d.archivedAt,
    );

    // Look up stage names
    const stageIds = Array.from(new Set(open.map((d) => d.stageId)));
    const stagesById = new Map<string, string>();
    for (const id of stageIds) {
      const s = await ctx.db.get(id);
      if (s) stagesById.set(id, s.name);
    }

    // Prefer worst health + longest idle
    open.sort((a, b) => {
      const ah = a.healthScore ?? 100;
      const bh = b.healthScore ?? 100;
      if (ah !== bh) return ah - bh;
      return a.lastActivityAt - b.lastActivityAt;
    });

    return open.slice(0, args.limit).map((d) => ({
      _id: d._id,
      name: d.name,
      stage: stagesById.get(d.stageId),
      healthScore: d.healthScore,
      healthNotes: d.healthNotes,
      aiNextAction: d.aiNextAction,
      daysStale: Math.floor((now - d.lastActivityAt) / (24 * 60 * 60 * 1000)),
    }));
  },
});


const DAY_MS = 24 * 60 * 60 * 1000;

export const rottingDealsWithIds = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"deals">;
      name: string;
      daysStale: number;
      aiNextAction?: string;
    }>
  > => {
    const now = Date.now();
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(300);
    return rows
      .filter(
        (d) =>
          !d.wonAt &&
          !d.lostAt &&
          !d.archivedAt &&
          d.lastActivityAt < now - 7 * DAY_MS,
      )
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
      .slice(0, args.limit)
      .map((d) => ({
        _id: d._id,
        name: d.name,
        daysStale: Math.floor((now - d.lastActivityAt) / DAY_MS),
        aiNextAction: d.aiNextAction,
      }));
  },
});

export const uncontactedCompaniesWithIds = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"companies">;
      name: string;
      industry?: string;
      fitScore?: number;
    }>
  > => {
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(300);
    return rows
      .filter(
        (c) =>
          !c.archivedAt &&
          c.lifecycleStage !== "customer" &&
          c.lifecycleStage !== "lost",
      )
      .sort((a, b) => {
        const af = a.fitScore ?? 0;
        const bf = b.fitScore ?? 0;
        if (af !== bf) return bf - af;
        return b._creationTime - a._creationTime;
      })
      .slice(0, args.limit)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        industry: c.industry,
        fitScore: c.fitScore,
      }));
  },
});

export const unreadConversationsWithIds = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"conversations">;
      subject?: string;
      senderEmail?: string;
      senderName?: string;
    }>
  > => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_state_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(200);

    const unread = rows.filter((c) => (c.unreadCount ?? 0) > 0 && !c.archivedAt);
    const results: Array<{
      _id: Id<"conversations">;
      subject?: string;
      senderEmail?: string;
      senderName?: string;
    }> = [];
    for (const c of unread.slice(0, args.limit)) {
      // Grab the latest inbound message for a sender hint
      const lastInbound = await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q) =>
          q.eq("conversationId", c._id),
        )
        .order("desc")
        .take(10);
      const inbound = lastInbound.find((m) => m.direction === "inbound");
      results.push({
        _id: c._id,
        subject: c.subject,
        senderEmail: inbound?.senderEmail,
        senderName: inbound?.senderName,
      });
    }
    return results;
  },
});


export const prospectorResultsForRanking = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    searchId: v.id("prospectorSearches"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"prospectorResults">;
      name: string;
      category?: string;
      city?: string;
      phone?: string;
      email?: string;
      website?: string;
      fitScore?: number;
      fitReasoning?: string;
    }>
  > => {
    const rows = await ctx.db
      .query("prospectorResults")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .take(args.limit * 4);

    const filtered = rows.filter(
      (r) =>
        !r.importedAt &&
        !r.rejectedAt &&
        (r.phone || r.email || r.website),
    );

    filtered.sort((a, b) => {
      const af = a.fitScore ?? 0;
      const bf = b.fitScore ?? 0;
      if (af !== bf) return bf - af;
      return b._creationTime - a._creationTime;
    });

    return filtered.slice(0, args.limit).map((r) => ({
      _id: r._id,
      name: r.name,
      category: r.types?.[0],
      city: r.city,
      phone: r.phone,
      email: r.email,
      website: r.website,
      fitScore: r.fitScore,
      fitReasoning: r.fitReasoning,
    }));
  },
});

export const outreachQueueForRanking = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"companies">;
      name: string;
      industry?: string;
      fitScore?: number;
      aiDraftSubject?: string;
      aiDraftBody?: string;
    }>
  > => {
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(args.limit * 8);

    const withDrafts: Array<{
      _id: Id<"companies">;
      name: string;
      industry?: string;
      fitScore?: number;
      aiDraftSubject?: string;
      aiDraftBody?: string;
      _creationTime: number;
      lifecycleStage: string;
      archivedAt?: number;
    }> = [];

    for (const c of rows) {
      if (c.archivedAt) continue;
      if (c.lifecycleStage === "customer" || c.lifecycleStage === "lost") continue;
      const enrichment =
        typeof c.enrichmentData === "object" && c.enrichmentData
          ? (c.enrichmentData as Record<string, unknown>)
          : null;
      const draft =
        enrichment && typeof enrichment.aiDraft === "object" && enrichment.aiDraft
          ? (enrichment.aiDraft as Record<string, unknown>)
          : null;
      const email =
        draft && typeof draft.email === "object" && draft.email
          ? (draft.email as { subject?: string; body?: string })
          : null;
      if (!email?.body) continue;
      withDrafts.push({
        _id: c._id,
        name: c.name,
        industry: c.industry,
        fitScore: c.fitScore,
        aiDraftSubject: email.subject,
        aiDraftBody: email.body,
        _creationTime: c._creationTime,
        lifecycleStage: c.lifecycleStage,
        archivedAt: c.archivedAt,
      });
    }

    withDrafts.sort((a, b) => {
      const af = a.fitScore ?? 0;
      const bf = b.fitScore ?? 0;
      if (af !== bf) return bf - af;
      return b._creationTime - a._creationTime;
    });

    return withDrafts.slice(0, args.limit).map((c) => ({
      _id: c._id,
      name: c.name,
      industry: c.industry,
      fitScore: c.fitScore,
      aiDraftSubject: c.aiDraftSubject,
      aiDraftBody: c.aiDraftBody,
    }));
  },
});
