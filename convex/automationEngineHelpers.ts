/**
 * Automation CRUD + engine helpers.
 */

import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit, requireUser } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

/* -------------------- User CRUD -------------------- */

export const listAutomations = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    return await ctx.db
      .query("automations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .order("desc")
      .collect();
  },
});

export const getAutomation = query({
  args: { id: v.id("automations") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(args.id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) return null;
    return a;
  },
});

export const createAutomation = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    triggerType: v.union(
      v.literal("timeline_event"),
      v.literal("scheduler"),
      v.literal("webhook"),
      v.literal("manual"),
    ),
    triggerConfig: v.any(),
    nodes: v.array(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"automations">> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const id = await ctx.db.insert("automations", {
      workspaceId: wsCtx.workspace._id,
      name: args.name.trim(),
      description: args.description,
      triggerType: args.triggerType,
      triggerConfig: args.triggerConfig,
      nodes: args.nodes,
      active: false,
      runCount: 0,
      ownerId: wsCtx.user._id,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "automation",
      resourceId: id,
      after: { name: args.name, triggerType: args.triggerType },
    });
    return id;
  },
});

export const updateAutomation = mutation({
  args: {
    id: v.id("automations"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      triggerConfig: v.optional(v.any()),
      nodes: v.optional(v.array(v.any())),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(args.id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found." });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

export const archiveAutomation = mutation({
  args: { id: v.id("automations") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(args.id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, { archivedAt: Date.now(), active: false });
  },
});

/* -------------------- Engine helpers -------------------- */

export const createRun = internalMutation({
  args: {
    automationId: v.id("automations"),
    triggerPayload: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"automationRuns">> => {
    const a = await ctx.db.get(args.automationId);
    if (!a) throw new Error("automation_not_found");
    return await ctx.db.insert("automationRuns", {
      automationId: args.automationId,
      workspaceId: a.workspaceId,
      triggerPayload: args.triggerPayload,
      status: "pending",
      startedAt: Date.now(),
    });
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("automationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return { automation: null, payload: null };
    const automation = await ctx.db.get(run.automationId);
    if (!automation) return { automation: null, payload: null };
    const ws = await ctx.db.get(automation.workspaceId);
    if (!ws) return { automation: null, payload: null };
    return {
      automation: {
        _id: automation._id,
        workspaceId: automation.workspaceId,
        organizationId: ws.organizationId,
        nodes: (automation.nodes ?? []) as Array<{
          id: string;
          kind: "native" | "composio" | "ai";
          action?: string;
          connectionId?: Id<"composioConnections">;
          args?: Record<string, unknown>;
          prompt?: string;
          model?: string;
          next?: string;
        }>,
      },
      payload: (run.triggerPayload ?? null) as Record<string, unknown> | null,
    };
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("automationRuns"),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("partial"),
    ),
    nodeResults: v.array(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await ctx.db.patch(args.runId, {
      status: args.status,
      nodeResults: args.nodeResults,
      finishedAt: Date.now(),
      error: args.error,
    });
    // Bump automation.runCount
    await ctx.db.patch(run.automationId, {
      lastRunAt: Date.now(),
    });
    const a = await ctx.db.get(run.automationId);
    if (a) {
      await ctx.db.patch(run.automationId, {
        runCount: a.runCount + 1,
      });
    }
  },
});

export const listRuns = query({
  args: { automationId: v.id("automations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireWorkspaceContext(ctx, { minimumRole: "member" });
    return await ctx.db
      .query("automationRuns")
      .withIndex("by_automation_time", (q) => q.eq("automationId", args.automationId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});


export const addTag = internalMutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    tag: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.contactId) {
      const c = await ctx.db.get(args.contactId);
      if (c) {
        const tags = Array.from(new Set([...(c.tags ?? []), args.tag]));
        await ctx.db.patch(args.contactId, { tags });
      }
    }
    if (args.companyId) {
      const c = await ctx.db.get(args.companyId);
      if (c) {
        const tags = Array.from(new Set([...(c.tags ?? []), args.tag]));
        await ctx.db.patch(args.companyId, { tags });
      }
    }
  },
});
