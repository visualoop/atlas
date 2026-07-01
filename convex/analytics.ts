/**
 * Analytics + Attribution + Cash flow (Phase 9).
 *
 * Read:
 *   kpiSummary — hero-grid KPIs computed live (MRR proxy, pipeline
 *     value, deals in flight, cash flow, new contacts, invoices paid)
 *   dealFunnel — count of deals in each pipeline stage
 *   dealSourceAttribution — deals grouped by source with total value
 *   cashFlow — 30/60/90-day rolling: paid invoices - expected
 *     invoices - fixed expenses
 *   listUtmLinks, getUtmByShortCode (internal for /go redirect)
 *   listBusinessExpenses
 *
 * Write:
 *   createUtmLink, updateUtmLink, revokeUtmLink,
 *   createBusinessExpense, updateBusinessExpense, deactivateExpense
 *
 * Internal:
 *   recordUtmClick — called from the /go/<shortCode> httpAction
 *   recordAttributionTouch — generic touch logger
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* KPI summary — live aggregation                                */
/* ============================================================ */

export const kpiSummary = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Deals — walk once, categorize
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .collect();
    const openDeals = deals.filter((d) => d.archivedAt === undefined && !d.wonAt && !d.lostAt);
    const wonThisMonth = deals.filter((d) => d.wonAt && d.wonAt >= thirtyDaysAgo);
    const wonThisMonthCents = wonThisMonth.reduce((s, d) => s + d.amountCents, 0n);
    const pipelineValueCents = openDeals.reduce((s, d) => s + d.amountCents, 0n);
    const wonAll = deals.filter((d) => d.wonAt);
    const totalWonCents = wonAll.reduce((s, d) => s + d.amountCents, 0n);
    const winRate =
      wonAll.length + deals.filter((d) => d.lostAt).length === 0
        ? 0
        : wonAll.length / (wonAll.length + deals.filter((d) => d.lostAt).length);

    // Contacts — new in last 30 days
    const newContacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .collect();
    const newContactsCount = newContacts.filter(
      (c) => c._creationTime >= thirtyDaysAgo && c.archivedAt === undefined,
    ).length;

    // Payments — invoices paid in last 30 days
    const paidThisMonth = await ctx.db
      .query("paymentRequests")
      .withIndex("by_workspace_status", (q) => q.eq("workspaceId", wsId).eq("status", "success"))
      .collect();
    const paidCentsThisMonth = paidThisMonth
      .filter((p) => p.paidAt && p.paidAt >= thirtyDaysAgo)
      .reduce((s, p) => s + p.amountCents, 0n);
    const paidCentsAllTime = paidThisMonth.reduce((s, p) => s + p.amountCents, 0n);

    // Invoices due — outstanding
    const invoices = await ctx.db
      .query("documents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", wsId).eq("kind", "invoice"))
      .collect();
    const outstandingInvoices = invoices.filter(
      (i) => i.archivedAt === undefined && i.status !== "paid" && i.status !== "cancelled" && i.status !== "void",
    );
    const outstandingCents = outstandingInvoices.reduce((s, i) => s + i.totalCents, 0n);
    const overdueCents = outstandingInvoices
      .filter((i) => i.dueDate && i.dueDate < now)
      .reduce((s, i) => s + i.totalCents, 0n);

    // Cash runway rough: monthly expenses vs monthly paid (simplistic)
    const expenses = await ctx.db
      .query("businessExpenses")
      .withIndex("by_workspace_active", (q) => q.eq("workspaceId", wsId).eq("active", true))
      .collect();
    let monthlyExpensesCents = 0n;
    for (const e of expenses) {
      let monthly = 0n;
      if (e.cadence === "monthly") monthly = e.amountCents;
      else if (e.cadence === "weekly") monthly = e.amountCents * 4n;
      else if (e.cadence === "quarterly") monthly = e.amountCents / 3n;
      else if (e.cadence === "yearly") monthly = e.amountCents / 12n;
      monthlyExpensesCents += monthly;
    }

    const runwayMonths = monthlyExpensesCents === 0n
      ? null
      : Number(paidCentsAllTime) / Number(monthlyExpensesCents === 0n ? 1n : monthlyExpensesCents);

    return {
      // Deal pipeline
      openDealsCount: openDeals.length,
      pipelineValueCents: pipelineValueCents.toString(),
      wonThisMonthCount: wonThisMonth.length,
      wonThisMonthCents: wonThisMonthCents.toString(),
      totalWonCents: totalWonCents.toString(),
      winRatePercent: Math.round(winRate * 100),
      // Contacts
      newContactsCount,
      totalContacts: newContacts.filter((c) => c.archivedAt === undefined).length,
      // Money
      paidCentsThisMonth: paidCentsThisMonth.toString(),
      outstandingInvoicesCount: outstandingInvoices.length,
      outstandingCents: outstandingCents.toString(),
      overdueCents: overdueCents.toString(),
      monthlyExpensesCents: monthlyExpensesCents.toString(),
      runwayMonths,
      // Default currency — take from any deal or fall back
      currency: deals[0]?.currency ?? "KES",
    };
  },
});

/* ============================================================ */
/* Deal funnel                                                    */
/* ============================================================ */

export const dealFunnel = query({
  args: { pipelineId: v.optional(v.id("pipelines")) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;

    // Load pipelines to scope
    const pipelines = args.pipelineId
      ? [await ctx.db.get(args.pipelineId)].filter(
          (p): p is Doc<"pipelines"> => p !== null && p.workspaceId === wsId,
        )
      : (await ctx.db
          .query("pipelines")
          .withIndex("by_workspace_order", (q) => q.eq("workspaceId", wsId))
          .collect()
        ).filter((p) => p.archivedAt === undefined);

    const results: Array<{
      pipelineId: Id<"pipelines">;
      pipelineName: string;
      stages: Array<{
        stageId: Id<"pipelineStages">;
        name: string;
        count: number;
        valueCents: string;
        isWon: boolean;
        isLost: boolean;
      }>;
    }> = [];

    for (const p of pipelines) {
      const stages = await ctx.db
        .query("pipelineStages")
        .withIndex("by_pipeline_order", (q) => q.eq("pipelineId", p._id))
        .collect();
      const sortedStages = stages.sort((a, b) => a.order - b.order);

      const stageRows = await Promise.all(
        sortedStages.map(async (s) => {
          const dealsInStage = await ctx.db
            .query("deals")
            .withIndex("by_workspace_stage", (q) =>
              q.eq("workspaceId", wsId).eq("stageId", s._id),
            )
            .collect();
          const active = dealsInStage.filter((d) => d.archivedAt === undefined);
          const value = active.reduce((sum, d) => sum + d.amountCents, 0n);
          return {
            stageId: s._id,
            name: s.name,
            count: active.length,
            valueCents: value.toString(),
            isWon: s.isWon,
            isLost: s.isLost,
          };
        }),
      );

      results.push({
        pipelineId: p._id,
        pipelineName: p.name,
        stages: stageRows,
      });
    }
    return results;
  },
});

/* ============================================================ */
/* Deal source attribution                                        */
/* ============================================================ */

export const dealSourceAttribution = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    const active = deals.filter((d) => d.archivedAt === undefined);
    const bySource = new Map<string, { count: number; wonCount: number; valueCents: bigint; wonValueCents: bigint }>();
    for (const d of active) {
      const src = d.source ?? "manual";
      const cur = bySource.get(src) ?? { count: 0, wonCount: 0, valueCents: 0n, wonValueCents: 0n };
      cur.count++;
      cur.valueCents += d.amountCents;
      if (d.wonAt) {
        cur.wonCount++;
        cur.wonValueCents += d.amountCents;
      }
      bySource.set(src, cur);
    }
    return Array.from(bySource.entries())
      .map(([source, stats]) => ({
        source,
        count: stats.count,
        wonCount: stats.wonCount,
        valueCents: stats.valueCents.toString(),
        wonValueCents: stats.wonValueCents.toString(),
      }))
      .sort((a, b) => b.count - a.count);
  },
});

/* ============================================================ */
/* Cash flow — 30/60/90 outlook                                   */
/* ============================================================ */

export const cashFlowOutlook = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Expected inflows — outstanding invoices grouped by due date
    const invoices = await ctx.db
      .query("documents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", wsId).eq("kind", "invoice"))
      .collect();
    const outstanding = invoices.filter(
      (i) => i.archivedAt === undefined && i.status !== "paid" && i.status !== "cancelled" && i.status !== "void",
    );
    let expected30 = 0n;
    let expected60 = 0n;
    let expected90 = 0n;
    let overdue = 0n;
    for (const inv of outstanding) {
      const due = inv.dueDate ?? inv.issueDate;
      if (!due) continue;
      const delta = due - now;
      if (delta < 0) overdue += inv.totalCents;
      else if (delta <= 30 * day) expected30 += inv.totalCents;
      else if (delta <= 60 * day) expected60 += inv.totalCents;
      else if (delta <= 90 * day) expected90 += inv.totalCents;
    }

    // Fixed outflows — monthly equivalent × 1/2/3 months
    const expenses = await ctx.db
      .query("businessExpenses")
      .withIndex("by_workspace_active", (q) => q.eq("workspaceId", wsId).eq("active", true))
      .collect();
    let monthlyOut = 0n;
    for (const e of expenses) {
      let m = 0n;
      if (e.cadence === "monthly") m = e.amountCents;
      else if (e.cadence === "weekly") m = e.amountCents * 4n;
      else if (e.cadence === "quarterly") m = e.amountCents / 3n;
      else if (e.cadence === "yearly") m = e.amountCents / 12n;
      monthlyOut += m;
    }

    const currency = invoices[0]?.currency ?? "KES";
    return {
      currency,
      overdueCents: overdue.toString(),
      expected30dCents: expected30.toString(),
      expected60dCents: expected60.toString(),
      expected90dCents: expected90.toString(),
      monthlyExpensesCents: monthlyOut.toString(),
      net30dCents: (expected30 + overdue - monthlyOut).toString(),
      net60dCents: (expected30 + expected60 + overdue - monthlyOut * 2n).toString(),
      net90dCents: (expected30 + expected60 + expected90 + overdue - monthlyOut * 3n).toString(),
    };
  },
});

/* ============================================================ */
/* UTM links                                                     */
/* ============================================================ */

export const listUtmLinks = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("utmLinks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const createUtmLink = mutation({
  args: {
    destination: v.string(),
    label: v.string(),
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
    utmContent: v.optional(v.string()),
    utmTerm: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    broadcastId: v.optional(v.id("broadcasts")),
    socialPostId: v.optional(v.id("socialPosts")),
    customShortCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (!/^https?:\/\//.test(args.destination)) {
      throw new ConvexError({ code: "INVALID_URL", message: "Destination must be an absolute URL." });
    }

    const shortCode = args.customShortCode?.trim() || randomShortCode();
    // Uniqueness across all workspaces
    const dup = await ctx.db
      .query("utmLinks")
      .withIndex("by_short_code", (q) => q.eq("shortCode", shortCode))
      .first();
    if (dup) {
      throw new ConvexError({ code: "TAKEN", message: "Short code already in use." });
    }

    const id = await ctx.db.insert("utmLinks", {
      workspaceId: wsCtx.workspace._id,
      shortCode,
      destination: args.destination,
      label: args.label,
      utmSource: args.utmSource,
      utmMedium: args.utmMedium,
      utmCampaign: args.utmCampaign,
      utmContent: args.utmContent,
      utmTerm: args.utmTerm,
      campaignId: args.campaignId,
      broadcastId: args.broadcastId,
      socialPostId: args.socialPostId,
      clickCount: 0,
      createdBy: wsCtx.user._id,
    });
    return { id, shortCode };
  },
});

export const revokeUtmLink = mutation({
  args: { id: v.id("utmLinks") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const u = await ctx.db.get(id);
    if (!u || u.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { archivedAt: Date.now() });
  },
});

/* ============================================================ */
/* Business expenses                                             */
/* ============================================================ */

export const listBusinessExpenses = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    return await ctx.db
      .query("businessExpenses")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
  },
});

export const createBusinessExpense = mutation({
  args: {
    label: v.string(),
    amountCents: v.int64(),
    currency: v.optional(v.string()),
    cadence: v.union(
      v.literal("one_time"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    category: v.optional(v.string()),
    nextDueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    return await ctx.db.insert("businessExpenses", {
      workspaceId: wsCtx.workspace._id,
      label: args.label,
      amountCents: args.amountCents,
      currency: args.currency ?? "KES",
      cadence: args.cadence,
      category: args.category,
      nextDueDate: args.nextDueDate,
      active: true,
      createdBy: wsCtx.user._id,
    });
  },
});

export const deactivateExpense = mutation({
  args: { id: v.id("businessExpenses") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const e = await ctx.db.get(id);
    if (!e || e.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { active: false });
  },
});

/* ============================================================ */
/* Internal — UTM redirect + touch logging                        */
/* ============================================================ */

export const getUtmByShortCode = internalQuery({
  args: { shortCode: v.string() },
  handler: async (ctx, { shortCode }) => {
    return await ctx.db
      .query("utmLinks")
      .withIndex("by_short_code", (q) => q.eq("shortCode", shortCode))
      .first();
  },
});

export const recordUtmClick = internalMutation({
  args: {
    utmLinkId: v.id("utmLinks"),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    ip: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.utmLinkId);
    if (!link) return;
    await ctx.db.patch(args.utmLinkId, {
      clickCount: link.clickCount + 1,
      lastClickAt: Date.now(),
    });
    await ctx.db.insert("attributionTouches", {
      workspaceId: link.workspaceId,
      sessionId: args.sessionId,
      touchType: "utm_click",
      source: link.utmSource,
      medium: link.utmMedium,
      campaign: link.utmCampaign,
      utmLinkId: args.utmLinkId,
      campaignId: link.campaignId,
      broadcastId: link.broadcastId,
      socialPostId: link.socialPostId,
      referrer: args.referrer,
      userAgent: args.userAgent,
      ip: args.ip,
      occurredAt: Date.now(),
    });
  },
});

/* ============================================================ */
/* Helpers                                                       */
/* ============================================================ */

function randomShortCode(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 7; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
