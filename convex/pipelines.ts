/**
 * Pipelines + deals module (Phase 6).
 *
 * Read:   listPipelines, getPipeline, listStages, listDealsByPipeline,
 *         getDeal, listDealsForContact/Company
 * Write:  createPipeline, updatePipeline, archivePipeline,
 *         createStage, updateStage, deleteStage,
 *         createDeal, updateDeal, moveDeal (stage + order),
 *         archiveDeal, restoreDeal, wonDeal, lostDeal
 * Seed:   ensureDefaultPipelines — idempotent, seeds Omnix, Studio,
 *         Marketplace pipelines the first time a workspace opens the
 *         page. Safe to call repeatedly.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import { recordAttribution } from "./lib/attribution";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listPipelines = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("pipelines")
      .withIndex("by_workspace_order", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((p) => p.archivedAt === undefined).sort((a, b) => a.order - b.order);
  },
});

export const getPipeline = query({
  args: { id: v.id("pipelines") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return null;
    return p;
  },
});

export const listStages = query({
  args: { pipelineId: v.id("pipelines") },
  handler: async (ctx, { pipelineId }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("pipelineStages")
      .withIndex("by_pipeline_order", (q) => q.eq("pipelineId", pipelineId))
      .collect();
    return rows
      .filter((s) => s.workspaceId === wsCtx.workspace._id)
      .sort((a, b) => a.order - b.order);
  },
});

/**
 * Kanban view — all non-archived deals in a pipeline, grouped by stage.
 * Returns [{ stage, deals }] sorted by stage order.
 */
export const kanbanView = query({
  args: { pipelineId: v.id("pipelines") },
  handler: async (ctx, { pipelineId }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const pipeline = await ctx.db.get(pipelineId);
    if (!pipeline || pipeline.workspaceId !== wsCtx.workspace._id) {
      return { pipeline: null, columns: [] as Array<{ stage: Doc<"pipelineStages">; deals: Doc<"deals">[] }> };
    }
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_pipeline_order", (q) => q.eq("pipelineId", pipelineId))
      .collect();
    const sortedStages = stages.sort((a, b) => a.order - b.order);

    const columns = await Promise.all(
      sortedStages.map(async (stage) => {
        const deals = await ctx.db
          .query("deals")
          .withIndex("by_pipeline_stage_order", (q) =>
            q.eq("pipelineId", pipelineId).eq("stageId", stage._id),
          )
          .collect();
        return {
          stage,
          deals: deals
            .filter((d) => d.archivedAt === undefined)
            .sort((a, b) => a.stageOrder - b.stageOrder),
        };
      }),
    );
    return { pipeline, columns };
  },
});

export const getDeal = query({
  args: { id: v.id("deals") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const deal = await ctx.db.get(id);
    if (!deal || deal.workspaceId !== wsCtx.workspace._id) return null;
    const [stage, pipeline, contact, company] = await Promise.all([
      ctx.db.get(deal.stageId),
      ctx.db.get(deal.pipelineId),
      deal.contactId ? ctx.db.get(deal.contactId) : Promise.resolve(null),
      deal.companyId ? ctx.db.get(deal.companyId) : Promise.resolve(null),
    ]);
    return { deal, stage, pipeline, contact, company };
  },
});

export const listDealsForCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace_company", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("companyId", companyId),
      )
      .collect();
    return rows.filter((d) => d.archivedAt === undefined);
  },
});

export const listDealsForContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, { contactId }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace_contact", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("contactId", contactId),
      )
      .collect();
    return rows.filter((d) => d.archivedAt === undefined);
  },
});

/* ============================================================ */
/* Seed                                                          */
/* ============================================================ */

const DEFAULT_PIPELINES = [
  {
    kind: "omnix_license",
    name: "Omnix Licenses",
    description: "POS/ERP license funnel for East African retailers",
    stages: [
      { name: "Prospect", isWon: false, isLost: false, rotDays: 21 },
      { name: "Demo booked", isWon: false, isLost: false, rotDays: 14 },
      { name: "Demo done", isWon: false, isLost: false, rotDays: 14 },
      { name: "Proposal sent", isWon: false, isLost: false, rotDays: 10 },
      { name: "Negotiation", isWon: false, isLost: false, rotDays: 14 },
      { name: "Won — active", isWon: true, isLost: false },
      { name: "Lost", isWon: false, isLost: true },
    ],
  },
  {
    kind: "studio_project",
    name: "Studio Projects",
    description: "Design + engineering agency projects",
    stages: [
      { name: "Discovery", isWon: false, isLost: false, rotDays: 14 },
      { name: "Scope + estimate", isWon: false, isLost: false, rotDays: 14 },
      { name: "Proposal", isWon: false, isLost: false, rotDays: 10 },
      { name: "Contract signing", isWon: false, isLost: false, rotDays: 7 },
      { name: "In progress", isWon: true, isLost: false },
      { name: "Delivered", isWon: true, isLost: false },
      { name: "Lost", isWon: false, isLost: true },
    ],
  },
  {
    kind: "marketplace_creator",
    name: "Marketplace Creators",
    description: "Creator onboarding funnel",
    stages: [
      { name: "Applied", isWon: false, isLost: false, rotDays: 7 },
      { name: "Reviewing", isWon: false, isLost: false, rotDays: 7 },
      { name: "Interview", isWon: false, isLost: false, rotDays: 7 },
      { name: "Onboarding", isWon: false, isLost: false, rotDays: 14 },
      { name: "Active seller", isWon: true, isLost: false },
      { name: "Rejected", isWon: false, isLost: true },
    ],
  },
] as const;

export const ensureDefaultPipelines = mutation({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    const existing = await ctx.db
      .query("pipelines")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    if (existing.length > 0) {
      return { seeded: 0, alreadyPresent: existing.length };
    }
    let seededPipes = 0;
    for (let i = 0; i < DEFAULT_PIPELINES.length; i++) {
      const p = DEFAULT_PIPELINES[i];
      const pipelineId = await ctx.db.insert("pipelines", {
        workspaceId: wsCtx.workspace._id,
        name: p.name,
        description: p.description,
        kind: p.kind,
        order: i,
        defaultCurrency: "KES",
      });
      for (let j = 0; j < p.stages.length; j++) {
        const s = p.stages[j];
        await ctx.db.insert("pipelineStages", {
          workspaceId: wsCtx.workspace._id,
          pipelineId,
          name: s.name,
          order: j,
          isWon: s.isWon,
          isLost: s.isLost,
          rotDays: "rotDays" in s ? s.rotDays : undefined,
        });
      }
      seededPipes++;
    }
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "pipeline_seed",
      resourceId: wsCtx.workspace._id,
      payload: { seededPipes },
    });
    return { seeded: seededPipes, alreadyPresent: 0 };
  },
});

/* ============================================================ */
/* Deal writes                                                    */
/* ============================================================ */

export const createDeal = mutation({
  args: {
    pipelineId: v.id("pipelines"),
    stageId: v.optional(v.id("pipelineStages")),               // defaults to first stage
    name: v.string(),
    amountCents: v.int64(),
    currency: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    ownerId: v.optional(v.id("users")),
    expectedCloseDate: v.optional(v.number()),
    source: v.optional(v.string()),
    sourceRefType: v.optional(v.string()),
    sourceRefId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const pipeline = await ctx.db.get(args.pipelineId);
    if (!pipeline || pipeline.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Pipeline not found." });
    }
    // Pick stage — explicit or first non-terminal stage
    let stageId = args.stageId;
    if (!stageId) {
      const stages = await ctx.db
        .query("pipelineStages")
        .withIndex("by_pipeline_order", (q) => q.eq("pipelineId", args.pipelineId))
        .collect();
      const sorted = stages.sort((a, b) => a.order - b.order);
      stageId = sorted.find((s) => !s.isWon && !s.isLost)?._id ?? sorted[0]?._id;
    }
    if (!stageId) {
      throw new ConvexError({ code: "NO_STAGES", message: "Pipeline has no stages." });
    }
    // Compute stageOrder = max + 1
    const existingInStage = await ctx.db
      .query("deals")
      .withIndex("by_pipeline_stage_order", (q) =>
        q.eq("pipelineId", args.pipelineId).eq("stageId", stageId),
      )
      .collect();
    const maxOrder = existingInStage.reduce((m, d) => Math.max(m, d.stageOrder), -1);

    const now = Date.now();
    const id = await ctx.db.insert("deals", {
      workspaceId: wsCtx.workspace._id,
      pipelineId: args.pipelineId,
      stageId,
      name: args.name,
      amountCents: args.amountCents,
      currency: args.currency ?? pipeline.defaultCurrency,
      contactId: args.contactId,
      companyId: args.companyId,
      ownerId: args.ownerId ?? wsCtx.user._id,
      expectedCloseDate: args.expectedCloseDate,
      source: args.source ?? "manual",
      sourceRefType: args.sourceRefType,
      sourceRefId: args.sourceRefId,
      tags: args.tags ?? [],
      stageOrder: maxOrder + 1,
      lastActivityAt: now,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "deal",
      resourceId: id,
      after: { name: args.name, amountCents: args.amountCents, pipelineId: args.pipelineId },
    });
    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "deal_created",
      actorId: wsCtx.user._id,
      subjectType: "deal",
      subjectId: id,
      relatedRefs: {
        pipelineId: args.pipelineId,
        stageId,
        contactId: args.contactId,
        companyId: args.companyId,
      },
      payload: { name: args.name, amountCents: args.amountCents.toString(), currency: args.currency },
    });
    await recordAttribution(ctx, {
      workspaceId: wsCtx.workspace._id,
      contactId: args.contactId,
      touchType: "deal_created",
      source: args.source ?? "manual",
    });
    return id;
  },
});

export const updateDeal = mutation({
  args: {
    id: v.id("deals"),
    patch: v.object({
      name: v.optional(v.string()),
      amountCents: v.optional(v.int64()),
      currency: v.optional(v.string()),
      contactId: v.optional(v.id("contacts")),
      companyId: v.optional(v.id("companies")),
      ownerId: v.optional(v.id("users")),
      expectedCloseDate: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      customFields: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const deal = await ctx.db.get(args.id);
    if (!deal || deal.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found." });
    }
    await ctx.db.patch(args.id, { ...args.patch, lastActivityAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "deal",
      resourceId: args.id,
      after: args.patch,
    });
  },
});

/**
 * Move a deal to a new stage and/or reorder within a stage.
 * If moving into a terminal stage, sets wonAt/lostAt.
 */
export const moveDeal = mutation({
  args: {
    id: v.id("deals"),
    toStageId: v.id("pipelineStages"),
    // Position within the destination stage. If omitted, appended at end.
    toIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const deal = await ctx.db.get(args.id);
    if (!deal || deal.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found." });
    }
    const fromStageId = deal.stageId;
    const toStage = await ctx.db.get(args.toStageId);
    if (!toStage || toStage.pipelineId !== deal.pipelineId) {
      throw new ConvexError({ code: "INVALID", message: "Target stage is not in the same pipeline." });
    }

    // Determine new stageOrder
    const others = await ctx.db
      .query("deals")
      .withIndex("by_pipeline_stage_order", (q) =>
        q.eq("pipelineId", deal.pipelineId).eq("stageId", args.toStageId),
      )
      .collect();
    const sortedOthers = others
      .filter((d) => d._id !== deal._id && d.archivedAt === undefined)
      .sort((a, b) => a.stageOrder - b.stageOrder);

    // Insert at toIndex (or end). Rewrite stageOrder for the moved deal
    // and its neighbors — cheap because we cap columns at reasonable
    // sizes.
    const insertIdx = typeof args.toIndex === "number" ? Math.max(0, Math.min(args.toIndex, sortedOthers.length)) : sortedOthers.length;

    // Build new order list
    const newOrder = [...sortedOthers];
    newOrder.splice(insertIdx, 0, deal);

    for (let i = 0; i < newOrder.length; i++) {
      const d = newOrder[i];
      if (d._id === deal._id) {
        const patch: Partial<Doc<"deals">> = {
          stageId: args.toStageId,
          stageOrder: i,
          lastActivityAt: Date.now(),
        };
        if (toStage.isWon && !deal.wonAt) patch.wonAt = Date.now();
        if (toStage.isLost && !deal.lostAt) patch.lostAt = Date.now();
        if (!toStage.isWon && deal.wonAt) patch.wonAt = undefined;
        if (!toStage.isLost && deal.lostAt) patch.lostAt = undefined;
        await ctx.db.patch(d._id, patch);
      } else if (d.stageOrder !== i) {
        await ctx.db.patch(d._id, { stageOrder: i });
      }
    }

    if (fromStageId !== args.toStageId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "deal_stage_changed",
        actorId: wsCtx.user._id,
        subjectType: "deal",
        subjectId: args.id,
        relatedRefs: { fromStageId, toStageId: args.toStageId, pipelineId: deal.pipelineId },
        payload: {
          from: (await ctx.db.get(fromStageId))?.name,
          to: toStage.name,
        },
      });
      await recordAudit(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        workspaceId: wsCtx.workspace._id,
        actorId: wsCtx.user._id,
        action: "updated",
        resourceType: "deal",
        resourceId: args.id,
        after: { stageId: args.toStageId, stageOrder: insertIdx },
        reason: "stage_change",
      });
    }
  },
});

export const archiveDeal = mutation({
  args: { id: v.id("deals"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const deal = await ctx.db.get(args.id);
    if (!deal || deal.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found." });
    }
    await ctx.db.patch(args.id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "deal",
      resourceId: args.id,
      reason: args.reason,
    });
  },
});

/* ============================================================ */
/* Won / lost with reason                                        */
/* ============================================================ */

export const setWinLoss = mutation({
  args: {
    id: v.id("deals"),
    outcome: v.union(v.literal("won"), v.literal("lost")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const deal = await ctx.db.get(args.id);
    if (!deal || deal.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found." });
    }
    // Find the terminal stage for this outcome
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_pipeline_order", (q) => q.eq("pipelineId", deal.pipelineId))
      .collect();
    const terminal = stages.find((s) => (args.outcome === "won" ? s.isWon : s.isLost));
    if (!terminal) {
      throw new ConvexError({
        code: "NO_TERMINAL_STAGE",
        message: `Pipeline has no ${args.outcome} stage.`,
      });
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      stageId: terminal._id,
      lastActivityAt: now,
      actualCloseDate: now,
      ...(args.outcome === "won"
        ? { wonAt: now, winReason: args.reason }
        : { lostAt: now, lossReason: args.reason }),
    });
    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: args.outcome === "won" ? "deal_won" : "deal_lost",
      actorId: wsCtx.user._id,
      subjectType: "deal",
      subjectId: args.id,
      relatedRefs: { pipelineId: deal.pipelineId, stageId: terminal._id },
      payload: { reason: args.reason, amountCents: deal.amountCents.toString(), currency: deal.currency },
    });
    if (args.outcome === "won") {
      await recordAttribution(ctx, {
        workspaceId: wsCtx.workspace._id,
        contactId: deal.contactId,
        touchType: "deal_won",
        source: deal.source ?? "manual",
      });
    }
  },
});


/* ============================================================ */
/* Internal — cron helpers                                        */
/* ============================================================ */

import { internalQuery, internalMutation } from "./_generated/server";

export const listRottingDeals = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    // Scan a bounded set of open, non-archived deals.
    const deals = await ctx.db
      .query("deals")
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("wonAt"), undefined),
          q.eq(q.field("lostAt"), undefined),
        ),
      )
      .take(300);

    const stages = new Map<string, { name: string; rotDays?: number }>();
    for (const s of await ctx.db.query("pipelineStages").take(200)) {
      stages.set(s._id, { name: s.name, rotDays: s.rotDays });
    }

    const rotting = deals
      .map((d) => {
        const stage = stages.get(d.stageId);
        const rotDays = stage?.rotDays ?? 14;
        const daysSinceActivity = Math.floor((now - d.lastActivityAt) / oneDay);
        if (daysSinceActivity < rotDays) return null;
        return {
          _id: d._id,
          workspaceId: d.workspaceId,
          name: d.name,
          stageName: stage?.name ?? "unknown",
          amountCents: d.amountCents.toString(),
          currency: d.currency,
          daysSinceActivity,
          ageDays: Math.floor((now - d._creationTime) / oneDay),
          notes: undefined as string | undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, limit);

    return rotting;
  },
});

export const updateDealHealth = internalMutation({
  args: {
    dealId: v.id("deals"),
    healthScore: v.number(),
    healthNotes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.dealId, {
      healthScore: args.healthScore,
      healthNotes: args.healthNotes,
      healthCheckedAt: Date.now(),
    });
  },
});
