/**
 * Trend & Brand Intelligence (Phase 8c).
 *
 * Read:   listWatches, listMentions
 * Write:  createWatch, updateWatch, archiveWatch,
 *         updateMentionStatus, dismissMention
 * Internal (cron-driven):
 *         listWatchesDueForScan (called by daily cron)
 *         insertMention (idempotent by url; auto-dedupes)
 *         markWatchScanned
 *
 * The actual scanning happens in a Node action (Groq Compound web
 * search) — this file just holds the state.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Doc, Id } from "./_generated/dataModel";

const WATCH_KIND = v.union(
  v.literal("brand"),
  v.literal("competitor"),
  v.literal("topic"),
);

const MENTION_STATUS = v.union(
  v.literal("new"),
  v.literal("triaged"),
  v.literal("responded"),
  v.literal("posted"),
  v.literal("dismissed"),
);

/* ============================================================ */
/* Watches                                                       */
/* ============================================================ */

export const listWatches = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("brandWatches")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const createWatch = mutation({
  args: {
    label: v.string(),
    kind: WATCH_KIND,
    queries: v.array(v.string()),
    languageHint: v.optional(v.string()),
    regionHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const cleanQueries = args.queries.map((q) => q.trim()).filter(Boolean);
    if (cleanQueries.length === 0) {
      throw new ConvexError({ code: "INVALID", message: "Add at least one query." });
    }
    const id = await ctx.db.insert("brandWatches", {
      workspaceId: wsCtx.workspace._id,
      label: args.label.trim(),
      kind: args.kind,
      queries: cleanQueries,
      languageHint: args.languageHint,
      regionHint: args.regionHint,
      active: true,
      mentionCount: 0,
    });
    return id;
  },
});

export const updateWatch = mutation({
  args: {
    id: v.id("brandWatches"),
    patch: v.object({
      label: v.optional(v.string()),
      queries: v.optional(v.array(v.string())),
      active: v.optional(v.boolean()),
      regionHint: v.optional(v.string()),
      languageHint: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const w = await ctx.db.get(args.id);
    if (!w || w.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, args.patch);
  },
});

export const archiveWatch = mutation({
  args: { id: v.id("brandWatches") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const w = await ctx.db.get(id);
    if (!w || w.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { active: false, archivedAt: Date.now() });
  },
});

/* ============================================================ */
/* Mentions                                                      */
/* ============================================================ */

export const listMentions = query({
  args: {
    status: v.optional(MENTION_STATUS),
    watchId: v.optional(v.id("brandWatches")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"trendMentions">[];
    if (args.watchId) {
      rows = await ctx.db
        .query("trendMentions")
        .withIndex("by_workspace_watch_time", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("watchId", args.watchId!),
        )
        .order("desc")
        .take(limit);
    } else if (args.status) {
      rows = await ctx.db
        .query("trendMentions")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("trendMentions")
        .withIndex("by_workspace_time", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

/** Top-N most-relevant new mentions — used by Today view. */
export const topNewMentions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("trendMentions")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("status", "new"),
      )
      .collect();
    return rows
      .filter((r) => r.archivedAt === undefined)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, args.limit ?? 5);
  },
});

export const updateMentionStatus = mutation({
  args: {
    id: v.id("trendMentions"),
    status: MENTION_STATUS,
    linkedConversationId: v.optional(v.id("conversations")),
    linkedSocialPostId: v.optional(v.id("socialPosts")),
    linkedSeoIdeaId: v.optional(v.id("seoIdeas")),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const m = await ctx.db.get(args.id);
    if (!m || m.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, {
      status: args.status,
      linkedConversationId: args.linkedConversationId ?? m.linkedConversationId,
      linkedSocialPostId: args.linkedSocialPostId ?? m.linkedSocialPostId,
      linkedSeoIdeaId: args.linkedSeoIdeaId ?? m.linkedSeoIdeaId,
    });
  },
});

/* ============================================================ */
/* Internal — cron helpers                                       */
/* ============================================================ */

export const listWatchesDueForScan = internalQuery({
  args: { minAgeHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.minAgeHours ?? 24) * 60 * 60 * 1000;
    // Get every active watch across all workspaces
    const active = await ctx.db
      .query("brandWatches")
      .filter((q) => q.eq(q.field("active"), true))
      .take(500);
    return active.filter(
      (w) =>
        w.archivedAt === undefined &&
        (w.lastScanAt === undefined || w.lastScanAt < cutoff),
    );
  },
});

export const insertMention = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    watchId: v.id("brandWatches"),
    sourceType: v.string(),
    url: v.string(),
    title: v.string(),
    excerpt: v.string(),
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    sentiment: v.optional(v.string()),
    relevanceScore: v.optional(v.number()),
    topics: v.optional(v.array(v.string())),
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Dedupe by (workspaceId, url)
    const existing = await ctx.db
      .query("trendMentions")
      .withIndex("by_workspace_url", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("url", args.url),
      )
      .first();
    if (existing) return { deduped: true, id: existing._id };

    const id = await ctx.db.insert("trendMentions", {
      workspaceId: args.workspaceId,
      watchId: args.watchId,
      sourceType: args.sourceType,
      url: args.url,
      title: args.title,
      excerpt: args.excerpt,
      authorName: args.authorName,
      authorHandle: args.authorHandle,
      sentiment: args.sentiment,
      relevanceScore: args.relevanceScore,
      topics: args.topics,
      status: "new",
      publishedAt: args.publishedAt,
      discoveredAt: Date.now(),
    });
    // Bump watch counter
    const watch = await ctx.db.get(args.watchId);
    if (watch) {
      await ctx.db.patch(args.watchId, { mentionCount: watch.mentionCount + 1 });
    }
    return { deduped: false, id };
  },
});

export const markWatchScanned = internalMutation({
  args: { id: v.id("brandWatches") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastScanAt: Date.now() });
  },
});
