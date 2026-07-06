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
