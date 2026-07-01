/**
 * Analytics rollup helpers — pure DB queries + mutation. Called by
 * analyticsActions.ts (Node runtime).
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

export const listActiveWorkspaces = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(500);
    return rows;
  },
});

export const rollupOneWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    day: v.string(),
    startMs: v.number(),
    endMs: v.number(),
  },
  handler: async (ctx, args) => {
    // Query all data windowed to the day
    const contactsInDay = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const newContacts = contactsInDay.filter(
      (c) => c._creationTime >= args.startMs && c._creationTime < args.endMs,
    ).length;

    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const newDeals = deals.filter(
      (d) => d._creationTime >= args.startMs && d._creationTime < args.endMs,
    ).length;
    const wonToday = deals.filter(
      (d) => d.wonAt !== undefined && d.wonAt >= args.startMs && d.wonAt < args.endMs,
    );
    const lostToday = deals.filter(
      (d) => d.lostAt !== undefined && d.lostAt >= args.startMs && d.lostAt < args.endMs,
    );
    const wonRevenueCents = wonToday.reduce((s, d) => s + d.amountCents, 0n);
    const lostRevenueCents = lostToday.reduce((s, d) => s + d.amountCents, 0n);
    const openDeals = deals.filter(
      (d) => d.archivedAt === undefined && d.wonAt === undefined && d.lostAt === undefined,
    );
    const pipelineValueCents = openDeals.reduce((s, d) => s + d.amountCents, 0n);

    const invoices = await ctx.db
      .query("documents")
      .withIndex("by_workspace_kind", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("kind", "invoice"),
      )
      .collect();
    const invIssued = invoices.filter(
      (i) => i._creationTime >= args.startMs && i._creationTime < args.endMs,
    );
    const invPaid = invoices.filter(
      (i) => i.status === "paid" && i._creationTime >= args.startMs && i._creationTime < args.endMs,
    );
    const invoicesIssuedCents = invIssued.reduce((s, i) => s + i.totalCents, 0n);
    const invoicesPaidCents = invPaid.reduce((s, i) => s + i.totalCents, 0n);

    // Messages — email + WA in/out
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) =>
        q.and(q.gte(q.field("_creationTime"), args.startMs), q.lt(q.field("_creationTime"), args.endMs)),
      )
      .collect();
    let emailsSent = 0,
      emailsReceived = 0,
      whatsappSent = 0,
      whatsappReceived = 0;
    for (const m of messages) {
      const conv = await ctx.db.get(m.conversationId);
      if (!conv) continue;
      if (conv.channel === "email") {
        if (m.direction === "outbound") emailsSent++;
        else emailsReceived++;
      } else if (conv.channel === "whatsapp") {
        if (m.direction === "outbound") whatsappSent++;
        else whatsappReceived++;
      }
    }

    // Landing signups + views
    const signups = await ctx.db
      .query("landingSignups")
      .filter((q) =>
        q.and(
          q.eq(q.field("workspaceId"), args.workspaceId),
          q.gte(q.field("_creationTime"), args.startMs),
          q.lt(q.field("_creationTime"), args.endMs),
        ),
      )
      .collect();

    const landingViews = 0; // Tracked via analytics table; skip for MVP
    const utmClicks = 0;

    // Upsert
    const existing = await ctx.db
      .query("analyticsSnapshots")
      .withIndex("by_workspace_day", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("day", args.day),
      )
      .first();

    const payload = {
      workspaceId: args.workspaceId,
      day: args.day,
      newContacts,
      newDeals,
      dealsWon: wonToday.length,
      dealsLost: lostToday.length,
      wonRevenueCents,
      lostRevenueCents,
      pipelineValueCents,
      invoicesIssuedCents,
      invoicesPaidCents,
      emailsSent,
      emailsReceived,
      whatsappSent,
      whatsappReceived,
      landingViews,
      landingSignups: signups.length,
      utmClicks,
      generatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("analyticsSnapshots", payload);
    }
  },
});
