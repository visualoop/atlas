/**
 * Webhook delivery helpers — gather pending events + record delivery
 * outcome per subscription.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const gatherPending = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    // Get all active subscriptions
    const subs = await ctx.db
      .query("webhookSubscriptions")
      .filter((q) =>
        q.and(
          q.eq(q.field("active"), true),
          q.eq(q.field("archivedAt"), undefined),
        ),
      )
      .take(200);

    const jobs: Array<{
      subscriptionId: Id<"webhookSubscriptions">;
      url: string;
      signingSecret: string;
      event: {
        _id: Id<"timelineEvents">;
        eventType: string;
        occurredAt: number;
        payload?: unknown;
        subjectType: string;
        subjectId: string;
      };
    }> = [];

    for (const sub of subs) {
      if (jobs.length >= args.limit) break;
      const watermark = sub.lastDeliveredEventOccurredAt ?? sub._creationTime;

      // Query timeline events in this workspace newer than watermark
      const events = await ctx.db
        .query("timelineEvents")
        .withIndex("by_workspace_occurred", (q) =>
          q.eq("workspaceId", sub.workspaceId).gt("occurredAt", watermark),
        )
        .order("asc")
        .take(20);

      for (const e of events) {
        if (jobs.length >= args.limit) break;
        // Match by explicit event or the wildcard 'all'
        if (!sub.events.includes(e.eventType) && !sub.events.includes("all")) continue;
        jobs.push({
          subscriptionId: sub._id,
          url: sub.targetUrl,
          signingSecret: sub.signingSecret,
          event: {
            _id: e._id,
            eventType: e.eventType,
            occurredAt: e.occurredAt,
            payload: e.payload,
            subjectType: e.subjectType,
            subjectId: e.subjectId,
          },
        });
      }
    }

    return jobs;
  },
});

export const recordDelivery = internalMutation({
  args: {
    subscriptionId: v.id("webhookSubscriptions"),
    eventOccurredAt: v.number(),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return;
    const patch: Partial<typeof sub> = {
      lastDeliveredEventOccurredAt: args.eventOccurredAt,
    };
    if (args.success) {
      patch.lastSuccessAt = Date.now();
      patch.consecutiveFailures = 0;
    } else {
      patch.lastFailureAt = Date.now();
      patch.consecutiveFailures = sub.consecutiveFailures + 1;
      if (sub.consecutiveFailures + 1 >= 10) {
        patch.active = false;
      }
    }
    await ctx.db.patch(args.subscriptionId, patch);
  },
});
