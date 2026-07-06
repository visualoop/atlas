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
