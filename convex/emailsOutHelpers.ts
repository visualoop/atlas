/**
 * Internal helpers used by `emailsOut.ts` (the "use node" action).
 *
 * Actions can't use ctx.db directly — they call these
 * via ctx.runQuery / ctx.runMutation.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import { getOrgKey } from "./lib/secretsAccess";
import { threadingKeyFrom, normalizeSubject } from "./lib/emailThread";
import type { Doc, Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* prepareSend — resolves workspace, sender, key, attachments          */
/* ------------------------------------------------------------------ */

export const prepareSend = internalQuery({
  args: {
    senderIdentityId: v.optional(v.id("senderIdentities")),
    attachmentFileIds: v.optional(v.array(v.id("files"))),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);

    // Pick sender identity (explicit or default)
    let senderIdentity: Doc<"senderIdentities"> | null = null;
    if (args.senderIdentityId) {
      senderIdentity = await ctx.db.get(args.senderIdentityId);
      if (senderIdentity && senderIdentity.workspaceId !== wsCtx.workspace._id) {
        senderIdentity = null;
      }
    } else {
      const identities = await ctx.db
        .query("senderIdentities")
        .withIndex("by_workspace_channel", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("channel", "email"),
        )
        .collect();
      senderIdentity = identities.find((s) => s.isDefault) ?? identities[0] ?? null;
    }

    // Decrypt Resend key if present
    let resendApiKey: string | undefined;
    try {
      const key = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "resend",
        reason: "email_send",
        actorId: wsCtx.user._id,
      });
      resendApiKey = key.value;
    } catch {
      // Not configured — will persist as queued
    }

    // Resolve attachments — return storage refs
    const attachments = args.attachmentFileIds
      ? await Promise.all(
          args.attachmentFileIds.map(async (fid) => {
            const f = await ctx.db.get(fid);
            if (!f || f.workspaceId !== wsCtx.workspace._id) return null;
            return {
              storageId: f.storageId,
              filename: f.filename,
              contentType: f.contentType,
              sizeBytes: f.sizeBytes,
            };
          }),
        )
      : [];

    return {
      workspaceId: wsCtx.workspace._id,
      workspace: {
        name: wsCtx.workspace.name,
        website: wsCtx.workspace.website,
        emailHeaderHtml: wsCtx.workspace.emailHeaderHtml,
        emailFooterHtml: wsCtx.workspace.emailFooterHtml,
        emailAccentColor: wsCtx.workspace.emailAccentColor,
      },
      senderIdentity,
      resendApiKey,
      attachments: attachments.filter((a): a is NonNullable<typeof a> => a !== null),
    };
  },
});

/* ------------------------------------------------------------------ */
/* prepareReply                                                          */
/* ------------------------------------------------------------------ */

export const prepareReply = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    attachmentFileIds: v.optional(v.array(v.id("files"))),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.workspaceId !== wsCtx.workspace._id) {
      throw new Error("Conversation not found.");
    }

    // Latest inbound message → derive threading headers
    const latestInbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation_time", (q) =>
        q.eq("conversationId", conv._id),
      )
      .order("desc")
      .filter((q) => q.eq(q.field("direction"), "inbound"))
      .first();

    const inReplyTo = latestInbound?.messageId ?? undefined;
    const referencesChain = latestInbound?.referencesChain
      ? [...latestInbound.referencesChain, latestInbound.messageId].filter(Boolean) as string[]
      : latestInbound?.messageId
      ? [latestInbound.messageId]
      : undefined;

    // Reply-to = the last inbound sender (single recipient by default)
    const replyTo = latestInbound?.senderEmail
      ? [latestInbound.senderEmail]
      : conv.participantEmails ?? [];

    // Subject with Re: prefix
    const baseSubject = conv.subject ?? latestInbound?.subject ?? "";
    const subject = /^\s*Re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

    // Sender: conversation's identity if set, else workspace default
    let senderIdentity: Doc<"senderIdentities"> | null = null;
    if (conv.senderIdentityId) {
      senderIdentity = await ctx.db.get(conv.senderIdentityId);
    }
    if (!senderIdentity) {
      const identities = await ctx.db
        .query("senderIdentities")
        .withIndex("by_workspace_channel", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("channel", "email"),
        )
        .collect();
      senderIdentity = identities.find((s) => s.isDefault) ?? identities[0] ?? null;
    }
    if (!senderIdentity) {
      throw new Error("No sender identity configured.");
    }

    let resendApiKey: string | undefined;
    try {
      const key = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "resend",
        reason: "email_reply",
        actorId: wsCtx.user._id,
      });
      resendApiKey = key.value;
    } catch {}

    const attachments = args.attachmentFileIds
      ? await Promise.all(
          args.attachmentFileIds.map(async (fid) => {
            const f = await ctx.db.get(fid);
            if (!f || f.workspaceId !== wsCtx.workspace._id) return null;
            return {
              storageId: f.storageId,
              filename: f.filename,
              contentType: f.contentType,
              sizeBytes: f.sizeBytes,
            };
          }),
        )
      : [];

    return {
      workspaceId: wsCtx.workspace._id,
      senderIdentity,
      resendApiKey,
      replyTo,
      subject,
      inReplyTo,
      referencesChain,
      attachments: attachments.filter((a): a is NonNullable<typeof a> => a !== null),
    };
  },
});

/* ------------------------------------------------------------------ */
/* persistOutbound — writes conversation + message + timeline           */
/* ------------------------------------------------------------------ */

export const persistOutbound = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    senderIdentityId: v.id("senderIdentities"),
    senderEmail: v.string(),
    senderName: v.optional(v.string()),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.string(),
    attachmentFileIds: v.array(v.id("files")),
    resendMessageId: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("queued"), v.literal("failed")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);

    // Find or create conversation by threading key
    const participants = [args.senderEmail, ...args.to, ...(args.cc ?? [])]
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, a) => a.indexOf(e) === i);
    const threadingKey = threadingKeyFrom(args.subject, participants);

    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_threading_key", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("threadingKey", threadingKey),
      )
      .first();

    // Attempt to link the primary recipient as a contact
    const primaryTo = args.to[0]?.trim().toLowerCase();
    let contactId: Id<"contacts"> | undefined;
    let companyId: Id<"companies"> | undefined;
    if (primaryTo) {
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
    }

    const now = Date.now();
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
      recipientCcEmails: args.cc,
      recipientBccEmails: args.bcc,
      subject: args.subject,
      bodyText: args.bodyText,
      bodyHtml: args.bodyHtml,
      status: args.status,
      failureReason: args.failureReason,
      externalId: args.resendMessageId,
      messageId: args.resendMessageId,
      aiDrafted: false,
      sentAt: args.status === "sent" ? now : undefined,
      senderIdentityId: args.senderIdentityId,
    });

    // Attach files
    for (const fid of args.attachmentFileIds) {
      const f = await ctx.db.get(fid);
      if (!f || f.workspaceId !== args.workspaceId) continue;
      await ctx.db.insert("messageAttachments", {
        messageId,
        filename: f.filename,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        storageId: f.storageId,
        inline: false,
      });
    }

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: args.workspaceId,
      actorId: wsCtx.user._id,
      action: "sent_email",
      resourceType: "message",
      resourceId: messageId,
      after: { to: args.to, subject: args.subject, status: args.status },
    });

    await recordTimelineEvent(ctx, {
      workspaceId: args.workspaceId,
      eventType: "email_sent",
      actorId: wsCtx.user._id,
      subjectType: contactId ? "contact" : "conversation",
      subjectId: (contactId as string) ?? conv!._id,
      relatedRefs: { conversationId: conv!._id, messageId },
      payload: {
        to: args.to,
        subject: args.subject,
        preview: args.bodyText.slice(0, 200),
        status: args.status,
      },
    });

    return { conversationId: conv!._id, messageId };
  },
});

/* ------------------------------------------------------------------ */
/* persistReply                                                          */
/* ------------------------------------------------------------------ */

export const persistReply = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    senderIdentityId: v.id("senderIdentities"),
    senderEmail: v.string(),
    senderName: v.optional(v.string()),
    to: v.array(v.string()),
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.string(),
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
    attachmentFileIds: v.array(v.id("files")),
    resendMessageId: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("queued"), v.literal("failed")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.workspaceId !== wsCtx.workspace._id) {
      throw new Error("Conversation not found.");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: conv.workspaceId,
      conversationId: conv._id,
      direction: "outbound",
      senderEmail: args.senderEmail,
      senderName: args.senderName,
      recipientEmails: args.to,
      subject: args.subject,
      bodyText: args.bodyText,
      bodyHtml: args.bodyHtml,
      status: args.status,
      failureReason: args.failureReason,
      externalId: args.resendMessageId,
      messageId: args.resendMessageId,
      inReplyTo: args.inReplyTo,
      referencesChain: args.referencesChain,
      aiDrafted: false,
      sentAt: args.status === "sent" ? now : undefined,
      senderIdentityId: args.senderIdentityId,
    });

    for (const fid of args.attachmentFileIds) {
      const f = await ctx.db.get(fid);
      if (!f || f.workspaceId !== conv.workspaceId) continue;
      await ctx.db.insert("messageAttachments", {
        messageId,
        filename: f.filename,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        storageId: f.storageId,
        inline: false,
      });
    }

    await ctx.db.patch(conv._id, {
      lastMessageAt: now,
      lastOutboundAt: now,
      messageCount: conv.messageCount + 1,
      state: conv.state === "snoozed" || conv.state === "archived" ? "open" : conv.state,
      snoozedUntil: undefined,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: conv.workspaceId,
      actorId: wsCtx.user._id,
      action: "sent_email",
      resourceType: "message",
      resourceId: messageId,
      after: { conversationId: conv._id, subject: args.subject, status: args.status },
    });

    const subjectRef =
      conv.contactIds[0]
        ? { subjectType: "contact" as const, subjectId: conv.contactIds[0] as unknown as string }
        : { subjectType: "conversation" as const, subjectId: conv._id as unknown as string };

    await recordTimelineEvent(ctx, {
      workspaceId: conv.workspaceId,
      eventType: "email_sent",
      actorId: wsCtx.user._id,
      subjectType: subjectRef.subjectType,
      subjectId: subjectRef.subjectId,
      relatedRefs: { conversationId: conv._id, messageId },
      payload: {
        to: args.to,
        subject: args.subject,
        preview: args.bodyText.slice(0, 200),
        status: args.status,
      },
    });

    return { messageId };
  },
});
