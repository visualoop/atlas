/**
 * Tasks — outcome-anchored todos. Per workspace, optionally linked to
 * a related record (contact/company/deal/conversation).
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";

const STATUSES = ["open", "doing", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const listMyOpen = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_assignee_due", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("assigneeId", wsCtx.user._id),
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "done"),
          q.neq(q.field("status"), "cancelled"),
        ),
      )
      .take(Math.min(args.limit ?? 50, 200));
    return tasks.filter((t) => t.archivedAt === undefined);
  },
});

export const listByRelated = query({
  args: {
    relatedToType: v.string(),
    relatedToId: v.string(),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_related", (q) =>
        q.eq("relatedToType", args.relatedToType).eq("relatedToId", args.relatedToId),
      )
      .order("desc")
      .take(100);
    return tasks.filter(
      (t) =>
        t.archivedAt === undefined &&
        (args.includeCompleted ||
          (t.status !== "done" && t.status !== "cancelled")),
    );
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    reminderAt: v.optional(v.number()),
    assigneeId: v.optional(v.id("users")),
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    aiSuggested: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const title = args.title.trim();
    if (!title) throw new ConvexError({ code: "INVALID_TITLE", message: "Title required." });

    const priority = (args.priority ?? "normal") as (typeof PRIORITIES)[number];
    if (!PRIORITIES.includes(priority)) {
      throw new ConvexError({ code: "INVALID_PRIORITY", message: "Invalid priority." });
    }

    const taskId = await ctx.db.insert("tasks", {
      workspaceId: wsCtx.workspace._id,
      title,
      description: args.description,
      priority,
      status: "open",
      dueAt: args.dueAt,
      reminderAt: args.reminderAt,
      assigneeId: args.assigneeId ?? wsCtx.user._id,
      relatedToType: args.relatedToType,
      relatedToId: args.relatedToId,
      aiSuggested: args.aiSuggested ?? false,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "task",
      resourceId: taskId,
      after: { title, priority, dueAt: args.dueAt },
    });

    if (args.relatedToType && args.relatedToId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "task_created",
        actorId: wsCtx.user._id,
        subjectType: args.relatedToType,
        subjectId: args.relatedToId,
        payload: { taskId, title, dueAt: args.dueAt },
      });
    }

    return taskId;
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      priority: v.optional(v.string()),
      status: v.optional(v.string()),
      dueAt: v.optional(v.number()),
      assigneeId: v.optional(v.id("users")),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Task not found." });
    }

    const patch: Record<string, unknown> = { ...args.patch };
    if (patch.status !== undefined && !STATUSES.includes(patch.status as any)) {
      throw new ConvexError({ code: "INVALID_STATUS", message: "Invalid status." });
    }
    if (patch.priority !== undefined && !PRIORITIES.includes(patch.priority as any)) {
      throw new ConvexError({ code: "INVALID_PRIORITY", message: "Invalid priority." });
    }
    if (patch.status === "done" && task.status !== "done") {
      patch.completedAt = Date.now();
      patch.completedBy = wsCtx.user._id;
    } else if (patch.status && patch.status !== "done") {
      patch.completedAt = undefined;
      patch.completedBy = undefined;
    }

    await ctx.db.patch(args.id, patch);

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "task",
      resourceId: args.id,
    });

    if (patch.status === "done" && task.relatedToType && task.relatedToId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "task_completed",
        actorId: wsCtx.user._id,
        subjectType: task.relatedToType,
        subjectId: task.relatedToId,
        payload: { taskId: args.id, title: task.title },
      });
    }
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const task = await ctx.db.get(id);
    if (!task || task.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Task not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "task",
      resourceId: id,
    });
  },
});
