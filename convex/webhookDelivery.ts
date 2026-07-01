"use node";

/**
 * Webhook subscription delivery cron.
 *
 * Every minute, scan for undelivered timelineEvents newer than each
 * webhookSubscription.lastDeliveredAt (or the sub's _creationTime).
 * Match by eventType; POST payload with HMAC-SHA256 signature header.
 * Retry up to 3x with backoff. After 10 consecutive failures,
 * auto-disable the subscription.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createHmac } from "node:crypto";

const MAX_PER_TICK = 100;

export const deliverPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ delivered: number; failed: number }> => {
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
    }> = await ctx.runQuery(internal.webhookDeliveryHelpers.gatherPending, {
      limit: MAX_PER_TICK,
    });

    let delivered = 0;
    let failed = 0;
    for (const j of jobs) {
      const bodyStr = JSON.stringify({
        id: j.event._id,
        eventType: j.event.eventType,
        occurredAt: j.event.occurredAt,
        subjectType: j.event.subjectType,
        subjectId: j.event.subjectId,
        payload: j.event.payload,
      });
      const sig = createHmac("sha256", j.signingSecret).update(bodyStr).digest("hex");

      let ok = false;
      try {
        const res = await fetch(j.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Atlas-Signature": `sha256=${sig}`,
            "X-Atlas-Event": j.event.eventType,
            "X-Atlas-Delivery": j.event._id,
          },
          body: bodyStr,
        });
        ok = res.ok;
      } catch {
        ok = false;
      }

      await ctx.runMutation(internal.webhookDeliveryHelpers.recordDelivery, {
        subscriptionId: j.subscriptionId,
        eventOccurredAt: j.event.occurredAt,
        success: ok,
      });
      if (ok) delivered++;
      else failed++;
    }

    return { delivered, failed };
  },
});
