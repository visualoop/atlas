/**
 * Helpers for convex/socialActions.ts.
 *
 * Social posts fan out to multiple connections. For MVP we publish to
 * the first connection only — cross-posting to N platforms in one shot
 * comes as a follow-up once each Composio slug is verified working.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const prepareForPublish = internalQuery({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, args): Promise<{
    platform: string;
    body: string;
    mediaUrl?: string;
    composioConnectionId?: Id<"composioConnections">;
  } | null> => {
    const post = await ctx.db.get(args.postId);
    if (!post) return null;

    const connId = post.connectionIds[0];
    if (!connId) return null;

    const conn = await ctx.db.get(connId);
    if (!conn) return null;

    // Find the matching Composio connection for this platform on this workspace
    // We match by appSlug ~ platform family
    const platformFamily = (() => {
      switch (conn.platform) {
        case "facebook_page":
          return "facebook";
        case "instagram_business":
          return "instagram";
        case "linkedin_personal":
        case "linkedin_company":
          return "linkedin";
        default:
          return "linkedin";
      }
    })();
    const composioSlug = platformFamily;

    const composio = await ctx.db
      .query("composioConnections")
      .withIndex("by_workspace_app", (q) =>
        q.eq("workspaceId", post.workspaceId).eq("appSlug", composioSlug),
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    // Grab first media file URL (Convex storage)
    let mediaUrl: string | undefined;
    if (post.mediaFileIds.length > 0) {
      const file = await ctx.db.get(post.mediaFileIds[0]);
      if (file) {
        const url = await ctx.storage.getUrl(file.storageId);
        if (url) mediaUrl = url;
      }
    }

    return {
      platform: composioSlug,
      body: post.caption,
      mediaUrl,
      composioConnectionId: composio?._id,
    };
  },
});

export const markPublishing = internalMutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, {
      status: "publishing",
      scheduledFor: undefined,
    });
  },
});

export const markPublished = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;
    const connId = post.connectionIds[0];
    const publishResults = {
      ...((post.publishResults as Record<string, unknown> | undefined) ?? {}),
      [connId as unknown as string]: {
        status: "published",
        externalPostId: args.externalId,
        publishedAt: Date.now(),
      },
    };
    await ctx.db.patch(args.postId, {
      status: "published",
      publishedAt: Date.now(),
      publishResults,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;
    const connId = post.connectionIds[0];
    const publishResults = {
      ...((post.publishResults as Record<string, unknown> | undefined) ?? {}),
      [connId as unknown as string]: {
        status: "failed",
        error: args.reason,
        publishedAt: Date.now(),
      },
    };
    await ctx.db.patch(args.postId, {
      status: "failed",
      publishResults,
    });
  },
});
