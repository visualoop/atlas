/**
 * Cross-cutting notifications system.
 *
 * Any part of Atlas can call `notify(workspaceId, kind, title, ...)`
 * to drop a row into the notifications table. The layout wrapper
 * subscribes to `recent` and toasts fresh entries in real-time.
 *
 * Notification kinds:
 *  - inbound_arrived — new inbound email/WhatsApp with auto-draft ready
 *  - rotting_deal — daily health check flagged a deal as rotting
 *  - hot_lead — new company scored ≥90 fit
 *  - enrichment_complete — batch enrichment finished
 *  - ai_scored — batch fit-scoring finished
 *  - custom — anything else
 *
 * All notifications are workspace-scoped. Optional userId for
 * targeting a specific member.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { Id } from "./_generated/dataModel";

const RECENT_LIMIT = 30;

export const notify = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.id("users")),
    kind: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    actionLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      workspaceId: args.workspaceId,
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      actionLink: args.actionLink,
    });
  },
});

export const recent = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Array<{
      _id: Id<"notifications">;
      _creationTime: number;
      kind: string;
      title: string;
      body?: string;
      actionLink?: string;
      readAt?: number;
    }>
  > => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_created", (q) =>
        q.eq("workspaceId", profile.lastActiveWorkspaceId!),
      )
      .order("desc")
      .take(RECENT_LIMIT);
    return rows
      .filter(
        (r) => !r.archivedAt && (!r.userId || r.userId === user._id),
      )
      .map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        kind: r.kind,
        title: r.title,
        body: r.body,
        actionLink: r.actionLink,
        readAt: r.readAt,
      }));
  },
});

export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    for (const id of args.ids) {
      const n = await ctx.db.get(id);
      if (!n) continue;
      if (n.userId && n.userId !== user._id) continue;
      await ctx.db.patch(id, { readAt: now });
    }
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_unread", (q) =>
        q.eq("workspaceId", profile.lastActiveWorkspaceId!).eq("readAt", undefined),
      )
      .take(100);
    const now = Date.now();
    for (const r of rows) {
      if (r.userId && r.userId !== user._id) continue;
      await ctx.db.patch(r._id, { readAt: now });
    }
  },
});

/**
 * Trim notifications older than 30 days. Run daily via cron.
 */
export const trimOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("notifications").take(1000);
    let deleted = 0;
    for (const r of rows) {
      if (r._creationTime < cutoff) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
