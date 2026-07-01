/**
 * Session-less helpers used by `emailsOutSystem.ts`.
 *
 * These accept workspaceId + organizationId explicitly so campaigns,
 * broadcasts, and other automation paths can call from a cron/trigger.
 *
 * All actions attributed to the workspace's org owner
 * (organizationOwnerId) for audit + timeline purposes.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import { threadingKeyFrom } from "./lib/emailThread";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc, Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* prepareSystemSend                                                     */
/* ------------------------------------------------------------------ */

export const prepareSystemSend = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    senderIdentityId: v.optional(v.id("senderIdentities")),
  },
  handler: async (ctx, args): Promise<{
    senderIdentity: Doc<"senderIdentities"> | null;
    resendApiKey?: string;
    organizationOwnerId: Id<"users"> | null;
  }> => {
    // Resolve sender: explicit id or workspace's default email identity
    let senderIdentity: Doc<"senderIdentities"> | null = null;
    if (args.senderIdentityId) {
      const s = await ctx.db.get(args.senderIdentityId);
      if (s && s.workspaceId === args.workspaceId) senderIdentity = s;
    } else {
      const rows = await ctx.db
        .query("senderIdentities")
        .withIndex("by_workspace_channel", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("channel", "email"),
        )
        .collect();
      senderIdentity = rows.find((s) => s.isDefault) ?? rows[0] ?? null;
    }

    // Org owner via members (first with role=owner)
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    const organizationOwnerId = owner?.userId ?? null;

    // Decrypt Resend key
    let resendApiKey: string | undefined;
    if (organizationOwnerId) {
      try {
        const key = await getOrgKey(ctx, {
          organizationId: args.organizationId,
          provider: "resend",
          reason: "org_email_send",
          actorId: organizationOwnerId,
        });
        resendApiKey = key.value;
      } catch {
        // Not configured
      }
    }

    return { senderIdentity, resendApiKey, organizationOwnerId };
  },
});

/* ------------------------------------------------------------------ */
/* persistOrgEmail                                                       */
/*   Same shape as persistOutbound but takes workspaceId directly        */
/* ------------------------------------------------------------------ */

export const persistOrgEmail = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    senderIdentityId: v.id("senderIdentities"),
    senderEmail: v.string(),
    senderName: v.optional(v.string()),
    to: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    html: v.string(),
    status: v.union(v.literal("sent"), v.literal("queued"), v.literal("failed")),
    externalMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
  }> => {
    const participants = [args.senderEmail, ...args.to]
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, a) => a.indexOf(e) === i);
    const threadingKey = threadingKeyFrom(args.subject, participants);

    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_threading_key", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("threadingKey", threadingKey),
      )
      .first();

    const now = Date.now();
    const primaryTo = args.to[0]?.trim().toLowerCase();
    let contactId = args.contactId;
    let companyId: Id<"companies"> | undefined;
    if (!contactId && primaryTo) {
      const c = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("email", primaryTo),
        )
        .first();
      if (c) {
        contactId = c._id;
        companyId = c.companyId ?? undefined;
      }
    } else if (contactId) {
      const c = await ctx.db.get(contactId);
      if (c) companyId = c.companyId ?? undefined;
    }

    if (!conv) {
      const convId = await ctx.db.insert("conversations", {
        workspaceId: args.workspaceId,
        channel: "email",
        subject: args.subject,
        participantEmails: participants,
        companyId,
        contactIds: contactId ? [contactId] : [],
        state: "open",
        lastMessageAt: now,
        lastOutboundAt: now,
        unreadCount: 0,
        messageCount: 1,
        threadingKey,
        senderIdentityId: args.senderIdentityId,
      });
      conv = await ctx.db.get(convId);
    } else {
      await ctx.db.patch(conv._id, {
        lastMessageAt: now,
        lastOutboundAt: now,
        messageCount: conv.messageCount + 1,
      });
    }

    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: conv!._id,
      direction: "outbound",
      senderEmail: args.senderEmail,
      senderName: args.senderName,
      recipientEmails: args.to,
      subject: args.subject,
      bodyText: args.text,
      bodyHtml: args.html,
      status: args.status,
      failureReason: args.failureReason,
      externalId: args.externalMessageId,
      messageId: args.externalMessageId,
      inReplyTo: args.inReplyTo,
      referencesChain: args.referencesChain,
      aiDrafted: false,
      sentAt: args.status === "sent" ? now : undefined,
      senderIdentityId: args.senderIdentityId,
    });

    // Timeline: skip actorId (system-attributed)
    await recordTimelineEvent(ctx, {
      workspaceId: args.workspaceId,
      eventType: "email_sent",
      subjectType: contactId ? "contact" : "conversation",
      subjectId: (contactId as string) ?? conv!._id,
      relatedRefs: { conversationId: conv!._id, messageId },
      payload: {
        to: args.to,
        subject: args.subject,
        preview: args.text.slice(0, 200),
        status: args.status,
        systemSent: true,
      },
    });

    return { conversationId: conv!._id, messageId };
  },
});
