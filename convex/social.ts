/**
 * Social Publishing (Phase 8a).
 *
 * Read:   listConnections, listPosts, getPost
 * Write:  registerConnection (creates the row after OAuth completes),
 *         disconnectConnection, createPost, updatePost, schedulePost,
 *         publishPostNow (sets status=publishing — the actual API call
 *         happens in an action once implemented), cancelPost
 *
 * Internal: dueScheduledPosts (cron) — returns posts whose
 *   scheduledFor <= now and status='scheduled'
 *
 * Actual API calls to Meta / LinkedIn are deferred (Phase 8a follow-up).
 * This commit ships the schema + CRUD + composer + scheduler so
 * founders can plan a content calendar and see the state machine.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

const PLATFORM = v.union(
  v.literal("facebook_page"),
  v.literal("instagram_business"),
  v.literal("linkedin_personal"),
  v.literal("linkedin_company"),
);

const POST_STATUS = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("publishing"),
  v.literal("published"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("socialConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const listPosts = query({
  args: {
    status: v.optional(POST_STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"socialPosts">[];
    if (args.status) {
      rows = await ctx.db
        .query("socialPosts")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("socialPosts")
        .withIndex("by_workspace_time", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const getPost = query({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return null;
    const [connections, media, comments] = await Promise.all([
      Promise.all(p.connectionIds.map((cid) => ctx.db.get(cid))),
      Promise.all(p.mediaFileIds.map((fid) => ctx.db.get(fid))),
      ctx.db
        .query("socialComments")
        .withIndex("by_post_time", (q) => q.eq("postId", p._id))
        .order("desc")
        .take(100),
    ]);
    return {
      post: p,
      connections: connections.filter((c): c is Doc<"socialConnections"> => c !== null),
      media: media.filter((f): f is Doc<"files"> => f !== null),
      comments,
    };
  },
});

/* ============================================================ */
/* Connection management                                          */
/* ============================================================ */

/**
 * Register a connection after OAuth completes. The token itself is
 * stored via `integrations.setKey` under provider labels like
 * `meta_page_<externalId>` — this row just tracks the display info.
 */
export const registerConnection = mutation({
  args: {
    platform: PLATFORM,
    externalId: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    // Upsert on (workspace, platform, externalId)
    const existing = await ctx.db
      .query("socialConnections")
      .withIndex("by_workspace_platform", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("platform", args.platform),
      )
      .filter((q) => q.eq(q.field("externalId"), args.externalId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        tokenExpiresAt: args.tokenExpiresAt,
        scopes: args.scopes,
        status: "connected",
        lastSyncAt: Date.now(),
      });
      return existing._id;
    }
    const id = await ctx.db.insert("socialConnections", {
      workspaceId: wsCtx.workspace._id,
      platform: args.platform,
      externalId: args.externalId,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      tokenExpiresAt: args.tokenExpiresAt,
      scopes: args.scopes,
      status: "connected",
      connectedBy: wsCtx.user._id,
      lastSyncAt: Date.now(),
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "social_connection",
      resourceId: id,
      after: { platform: args.platform, externalId: args.externalId },
    });
    return id;
  },
});

export const disconnectConnection = mutation({
  args: { id: v.id("socialConnections") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    const c = await ctx.db.get(id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "revoked", archivedAt: Date.now() });
  },
});

/* ============================================================ */
/* Post CRUD                                                      */
/* ============================================================ */

export const createPost = mutation({
  args: {
    connectionIds: v.array(v.id("socialConnections")),
    caption: v.string(),
    mediaFileIds: v.optional(v.array(v.id("files"))),
    scheduledFor: v.optional(v.number()),
    firstLink: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (args.connectionIds.length === 0) {
      throw new ConvexError({
        code: "NO_CONNECTIONS",
        message: "Pick at least one platform to post to.",
      });
    }
    // Validate all connections belong to this workspace
    for (const cid of args.connectionIds) {
      const c = await ctx.db.get(cid);
      if (!c || c.workspaceId !== wsCtx.workspace._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Connection not found." });
      }
    }
    const status = args.scheduledFor && args.scheduledFor > Date.now() ? "scheduled" : "draft";
    const id = await ctx.db.insert("socialPosts", {
      workspaceId: wsCtx.workspace._id,
      connectionIds: args.connectionIds,
      caption: args.caption,
      mediaFileIds: args.mediaFileIds ?? [],
      firstLink: args.firstLink,
      status,
      scheduledFor: args.scheduledFor,
      ownerId: wsCtx.user._id,
      campaignId: args.campaignId,
    });
    return id;
  },
});

export const updatePost = mutation({
  args: {
    id: v.id("socialPosts"),
    patch: v.object({
      caption: v.optional(v.string()),
      connectionIds: v.optional(v.array(v.id("socialConnections"))),
      mediaFileIds: v.optional(v.array(v.id("files"))),
      scheduledFor: v.optional(v.number()),
      firstLink: v.optional(v.string()),
      perPlatformOverrides: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(args.id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (p.status === "published" || p.status === "publishing") {
      throw new ConvexError({
        code: "IMMUTABLE",
        message: "Can't edit a post that's publishing or already live.",
      });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

export const schedulePost = mutation({
  args: { id: v.id("socialPosts"), scheduledFor: v.number() },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(args.id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return;
    if (args.scheduledFor <= Date.now()) {
      throw new ConvexError({ code: "PAST", message: "Schedule time must be in the future." });
    }
    await ctx.db.patch(args.id, {
      status: "scheduled",
      scheduledFor: args.scheduledFor,
    });
  },
});

export const cancelPost = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return;
    if (p.status === "published") return;
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

/**
 * Marks the post as publishing — the actual outbound call happens in
 * an action (deferred). For now this just flips state so the UI can
 * show progress.
 */
export const publishPostNow = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, {
      status: "publishing",
      scheduledFor: undefined,
    });
    // Real API calls go here — deferred to Phase 8a follow-up.
  },
});

/* ============================================================ */
/* Internal — scheduler cron                                     */
/* ============================================================ */

export const dueScheduledPosts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Simple scan — Atlas single-op scale is fine
    const rows = await ctx.db
      .query("socialPosts")
      .filter((q) => q.eq(q.field("status"), "scheduled"))
      .take(200);
    return rows.filter((r) => typeof r.scheduledFor === "number" && r.scheduledFor <= now);
  },
});

export const flipToPublishing = internalMutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p || p.status !== "scheduled") return;
    await ctx.db.patch(id, { status: "publishing" });
  },
});
