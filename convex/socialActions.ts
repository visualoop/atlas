"use node";

/**
 * Social post publisher — routes through Composio when a connection
 * is configured. If no matching Composio connection exists we mark
 * the post as `failed` with a clear reason and surface it in the UI.
 *
 * Composio action slugs (as of 2025):
 *   - facebook.postToPage
 *   - instagram.postFeed
 *   - linkedin.createPost
 *   - twitter.createTweet
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const PLATFORM_TO_ACTION: Record<string, string> = {
  facebook: "facebook.postToPage",
  instagram: "instagram.postFeed",
  linkedin: "linkedin.createPost",
  twitter: "twitter.createTweet",
  x: "twitter.createTweet",
};

export const publishOne = internalAction({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    externalId?: string;
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.socialActionsHelpers.prepareForPublish, {
      postId: args.postId,
    });

    if (!setup) {
      return { ok: false, error: "post_not_found" };
    }

    if (!setup.composioConnectionId) {
      await ctx.runMutation(internal.socialActionsHelpers.markFailed, {
        postId: args.postId,
        reason: "No Composio connection configured for this platform. Add one at Settings → Integrations → Composio.",
      });
      return { ok: false, error: "no_composio_connection" };
    }

    const actionSlug = PLATFORM_TO_ACTION[setup.platform];
    if (!actionSlug) {
      await ctx.runMutation(internal.socialActionsHelpers.markFailed, {
        postId: args.postId,
        reason: `Unsupported platform: ${setup.platform}`,
      });
      return { ok: false, error: "unsupported_platform" };
    }

    // Execute via Composio
    const res = await ctx.runAction(internal.composioActions.executeAction, {
      connectionId: setup.composioConnectionId,
      action: actionSlug,
      params: {
        text: setup.body,
        // Media handling — Composio expects URLs for most connectors.
        // Convex storage URLs work if the file is public-readable.
        ...(setup.mediaUrl ? { image: setup.mediaUrl, media_url: setup.mediaUrl } : {}),
      },
    });

    if (!res.ok) {
      await ctx.runMutation(internal.socialActionsHelpers.markFailed, {
        postId: args.postId,
        reason: res.error ?? "publish_failed",
      });
      return { ok: false, error: res.error };
    }

    // Best-effort external id extraction
    const externalId =
      (res.result as { id?: string; postId?: string; data?: { id?: string } })?.id ??
      (res.result as { data?: { id?: string } })?.data?.id;

    await ctx.runMutation(internal.socialActionsHelpers.markPublished, {
      postId: args.postId,
      externalId,
    });

    return { ok: true, externalId };
  },
});

/**
 * Cron-driven publisher — walks `socialPosts` with status='scheduled'
 * and scheduledFor <= now, flips them to 'publishing', schedules the
 * per-post action.
 */
export const runScheduledPosts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ triggered: number }> => {
    const due = await ctx.runQuery(internal.social.dueScheduledPosts, {});
    for (const p of due) {
      await ctx.runMutation(internal.socialActionsHelpers.markPublishing, {
        postId: p._id as Id<"socialPosts">,
      });
      await ctx.scheduler.runAfter(0, internal.socialActions.publishOne, {
        postId: p._id as Id<"socialPosts">,
      });
    }
    return { triggered: due.length };
  },
});
