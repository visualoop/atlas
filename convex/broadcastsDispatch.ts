"use node";

/**
 * Broadcast dispatch — real Resend fanout.
 *
 * A broadcast is a one-off newsletter to an audience. The user hits
 * "Send now" or schedules it, and cron picks it up and:
 *   1. Flips broadcast.status → 'sending'
 *   2. Iterates unsubscribed=false, confirmedAt-present audience members
 *   3. Sends via `internal.emailsOutSystem.sendOrgEmail` with per-member
 *      idempotency (broadcastId + audienceMemberId) so retries are safe
 *   4. Updates aggregated counters (sentCount, failedCount) on the
 *      broadcast row
 *   5. Flips broadcast.status → 'sent' when done
 *
 * Called both from a Convex mutation "sendNow" and from the scheduled
 * cron for `scheduled` broadcasts whose `scheduledFor <= now`.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const BATCH_SIZE = 50; // audience members per action tick

export const dispatchBroadcast = internalAction({
  args: {
    broadcastId: v.id("broadcasts"),
  },
  handler: async (ctx, args): Promise<{
    total: number;
    sent: number;
    failed: number;
    done: boolean;
  }> => {
    // Load broadcast + audience + workspace/org info
    const setup = await ctx.runQuery(internal.broadcasts.prepareDispatch, {
      broadcastId: args.broadcastId,
    });
    if (!setup) return { total: 0, sent: 0, failed: 0, done: true };

    if (setup.broadcast.status === "sent" || setup.broadcast.status === "cancelled") {
      return { total: 0, sent: 0, failed: 0, done: true };
    }

    // Fanout to next batch of members
    let sent = 0;
    let failed = 0;
    for (const member of setup.members) {
      // Personalize body/subject with member first name if placeholders exist
      const subject = personalize(setup.broadcast.subject, member);
      const html = personalize(setup.broadcast.bodyHtml ?? "", member);
      const text = personalize(setup.broadcast.bodyText ?? "", member);

      const res = await ctx.runAction(internal.emailsOutSystem.sendOrgEmail, {
        workspaceId: setup.broadcast.workspaceId,
        organizationId: setup.organizationId,
        senderIdentityId: setup.broadcast.fromIdentityId,
        to: [member.email],
        subject,
        html,
        text,
        broadcastId: args.broadcastId,
        contactId: member.contactId,
        idempotencyKey: `${args.broadcastId}:${member._id}`,
      });

      // Mark this member sent
      await ctx.runMutation(internal.broadcasts.recordMemberSend, {
        broadcastId: args.broadcastId,
        audienceMemberId: member._id,
        status: res.status,
        error: res.error,
      });

      if (res.status === "sent") sent++;
      else if (res.status === "failed") failed++;
    }

    // If we processed less than BATCH_SIZE members, we're done
    const done = setup.members.length < BATCH_SIZE;
    await ctx.runMutation(internal.broadcasts.finalizeBroadcast, {
      broadcastId: args.broadcastId,
      done,
    });

    // Reschedule for next batch if not done
    if (!done) {
      await ctx.scheduler.runAfter(1000, internal.broadcastsDispatch.dispatchBroadcast, {
        broadcastId: args.broadcastId,
      });
    }

    return {
      total: setup.members.length,
      sent,
      failed,
      done,
    };
  },
});

/**
 * Cron entry — picks up any 'scheduled' broadcast whose time is up
 * and enqueues dispatchBroadcast for it.
 */
export const scanScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<{ triggered: number }> => {
    const due: Array<{ _id: Id<"broadcasts"> }> = await ctx.runQuery(
      internal.broadcasts.listDueScheduled,
      {},
    );
    for (const b of due) {
      await ctx.runMutation(internal.broadcasts.markSending, { broadcastId: b._id });
      await ctx.scheduler.runAfter(0, internal.broadcastsDispatch.dispatchBroadcast, {
        broadcastId: b._id,
      });
    }
    return { triggered: due.length };
  },
});

/* ------------------------------------------------------------------ */

interface Member {
  firstName?: string;
  lastName?: string;
  email: string;
}

function personalize(template: string, member: Member): string {
  return template
    .replace(/\{\{\s*firstName\s*\}\}/g, member.firstName ?? "there")
    .replace(/\{\{\s*lastName\s*\}\}/g, member.lastName ?? "")
    .replace(/\{\{\s*email\s*\}\}/g, member.email);
}
