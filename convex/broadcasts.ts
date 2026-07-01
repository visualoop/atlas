/**
 * Broadcast dispatch helpers — internal queries + mutations used by
 * `broadcastsDispatch.ts` (the Node-runtime action).
 *
 * User-facing CRUD lives in `content.ts`. This module is only the
 * dispatcher's tight coupling.
 */

import { v, ConvexError } from "convex/values";
import {
  internalQuery,
  internalMutation,
  mutation,
} from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const BATCH_SIZE = 50;

/* ============================================================ */
/* Public — user-triggered send                                  */
/* ============================================================ */

export const sendNow = mutation({
  args: { broadcastId: v.id("broadcasts") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const b = await ctx.db.get(args.broadcastId);
    if (!b || b.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Broadcast not found." });
    }
    if (b.status !== "draft" && b.status !== "scheduled" && b.status !== "failed") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: `Cannot send from status '${b.status}'.`,
      });
    }
    if (!b.subject.trim()) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Subject is required." });
    }
    if (!b.bodyHtml || !b.bodyHtml.trim()) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Body is empty." });
    }

    await ctx.db.patch(args.broadcastId, {
      status: "sending",
      sentAt: undefined,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "sent_email",
      resourceType: "broadcast",
      resourceId: args.broadcastId,
      after: { subject: b.subject, name: b.name },
    });

    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "broadcast_sent",
      actorId: wsCtx.user._id,
      subjectType: "broadcast",
      subjectId: args.broadcastId,
      payload: { name: b.name, subject: b.subject },
    });

    await ctx.scheduler.runAfter(0, internal.broadcastsDispatch.dispatchBroadcast, {
      broadcastId: args.broadcastId,
    });

    return { queued: true };
  },
});

/* ============================================================ */
/* Internal — dispatcher tight coupling                          */
/* ============================================================ */

export const prepareDispatch = internalQuery({
  args: { broadcastId: v.id("broadcasts") },
  handler: async (ctx, args): Promise<{
    broadcast: Doc<"broadcasts">;
    organizationId: Id<"organizations">;
    members: Array<{
      _id: Id<"audienceMembers">;
      email: string;
      firstName?: string;
      lastName?: string;
      contactId?: Id<"contacts">;
    }>;
  } | null> => {
    const b = await ctx.db.get(args.broadcastId);
    if (!b) return null;
    const workspace = await ctx.db.get(b.workspaceId);
    if (!workspace) return null;

    // Find members who haven't been sent yet (no campaignEvent row for
    // this broadcast + member). We use a simple offset: pull all
    // subscribed members, skip ones with an existing campaignEvent
    // row keyed by broadcast+member.
    const allMembers = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audience", (q) => q.eq("audienceId", b.audienceId))
      .collect();

    const active = allMembers.filter(
      (m) => m.unsubscribedAt === undefined && m.confirmedAt !== undefined,
    );

    // Find members already processed by looking at broadcastEvents.
    const processedIds = new Set<string>();
    const existingEvents = await ctx.db
      .query("broadcastEvents")
      .withIndex("by_broadcast_time", (q) => q.eq("broadcastId", args.broadcastId))
      .collect();
    for (const e of existingEvents) {
      processedIds.add(e.audienceMemberId as unknown as string);
    }

    const next = active
      .filter((m) => !processedIds.has(m._id as unknown as string))
      .slice(0, BATCH_SIZE)
      .map((m) => ({
        _id: m._id,
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        contactId: m.contactId,
      }));

    return {
      broadcast: b,
      organizationId: workspace.organizationId,
      members: next,
    };
  },
});

export const recordMemberSend = internalMutation({
  args: {
    broadcastId: v.id("broadcasts"),
    audienceMemberId: v.id("audienceMembers"),
    status: v.union(v.literal("sent"), v.literal("queued"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.broadcastId);
    if (!b) return;

    await ctx.db.insert("broadcastEvents", {
      workspaceId: b.workspaceId,
      broadcastId: args.broadcastId,
      audienceMemberId: args.audienceMemberId,
      eventType: args.status === "sent" ? "sent" : "failed",
      occurredAt: Date.now(),
      payload: args.error ? { error: args.error } : undefined,
    });

    if (args.status === "sent") {
      await ctx.db.patch(args.broadcastId, {
        sentCount: b.sentCount + 1,
      });
    }
  },
});

export const finalizeBroadcast = internalMutation({
  args: { broadcastId: v.id("broadcasts"), done: v.boolean() },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.broadcastId);
    if (!b) return;
    if (args.done) {
      await ctx.db.patch(args.broadcastId, {
        status: b.sentCount >= b.recipientCount * 0.5 ? "sent" : "failed",
        sentAt: Date.now(),
      });
    }
  },
});

export const listDueScheduled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Cross-workspace scan of scheduled broadcasts whose time is up.
    const scheduled = await ctx.db
      .query("broadcasts")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "scheduled"),
          q.lte(q.field("scheduledFor"), now),
        ),
      )
      .take(50);
    return scheduled.map((b) => ({ _id: b._id }));
  },
});

export const markSending = internalMutation({
  args: { broadcastId: v.id("broadcasts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, { status: "sending" });
  },
});
