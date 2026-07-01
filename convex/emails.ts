/**
 * Emails / conversations module — Phase 2.
 *
 * Read: listInbox, getConversation (with messages), listMessagesFor
 * Write: markRead, snooze, unsnooze, archive, restore, pin, unpin,
 *        deleteConversation (soft), ingestInbound (called from
 *        the /inbound/resend httpAction — see convex/http.ts)
 *
 * Outbound sending lives in `convex/emailsOut.ts` (it's an action
 * that calls Resend and needs `"use node"` for the HTTP client).
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import {
  findConversationForInbound,
  threadingKeyFrom,
  htmlToPlain,
  domainOf,
} from "./lib/emailThread";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Inbox list                                                    */
/* ============================================================ */

export const listInbox = query({
  args: {
    channel: v.optional(
      v.union(
        v.literal("email"),
        v.literal("whatsapp"),
        v.literal("all"),
      ),
    ),
    state: v.optional(
      v.union(
        v.literal("open"),
        v.literal("snoozed"),
        v.literal("archived"),
        v.literal("pinned"),
        v.literal("spam"),
      ),
    ),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const state = args.state ?? "open";
    const limit = Math.min(args.limit ?? 100, 500);

    // Handle snoozed with time comparison
    if (args.search && args.search.trim().length > 0) {
      const q = args.search.trim();
      let convs = await ctx.db
        .query("conversations")
        .withSearchIndex("search_subject", (b) =>
          b.search("subject", q).eq("workspaceId", wsId).eq("state", state),
        )
        .take(limit);
      if (args.channel && args.channel !== "all") {
        convs = convs.filter((c) => c.channel === args.channel);
      }
      return convs;
    }

    // Channel-scoped OR state-scoped index
    if (args.channel && args.channel !== "all") {
      const channel = args.channel;
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_workspace_channel_time", (q) =>
          q.eq("workspaceId", wsId).eq("channel", channel),
        )
        .order("desc")
        .take(limit * 2);
      return convs.filter((c) => c.state === state).slice(0, limit);
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_workspace_state_time", (q) =>
        q.eq("workspaceId", wsId).eq("state", state),
      )
      .order("desc")
      .take(limit);
  },
});

/* ============================================================ */
/* Get one conversation with its messages + contact + company    */
/* ============================================================ */

export const getConversation = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const conv = await ctx.db.get(id);
    if (!conv || conv.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Conversation not found." });
    }

    const [messages, company, contacts] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q) => q.eq("conversationId", id))
        .order("asc")
        .take(200),
      conv.companyId ? ctx.db.get(conv.companyId) : Promise.resolve(null),
      Promise.all(conv.contactIds.map((cid) => ctx.db.get(cid))),
    ]);

    // Attach attachments to each message
    const messagesWithAttachments = await Promise.all(
      messages.map(async (m) => {
        const atts = await ctx.db
          .query("messageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", m._id))
          .collect();
        return { ...m, attachments: atts };
      }),
    );

    return {
      conversation: conv,
      messages: messagesWithAttachments,
      company,
      contacts: contacts.filter((c): c is Doc<"contacts"> => c !== null),
    };
  },
});

/* ============================================================ */
/* State mutations                                               */
/* ============================================================ */

async function assertMineOrThrow(
  ctx: MutationCtx,
  id: Id<"conversations">,
) {
  const wsCtx = await requireWorkspaceContext(ctx);
  const conv = await ctx.db.get(id);
  if (!conv || conv.workspaceId !== wsCtx.workspace._id) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Conversation not found." });
  }
  return { wsCtx, conv };
}

export const markRead = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { conv } = await assertMineOrThrow(ctx, id);
    if (conv.unreadCount > 0) {
      await ctx.db.patch(id, { unreadCount: 0 });
    }
  },
});

export const snooze = mutation({
  args: { id: v.id("conversations"), until: v.number() },
  handler: async (ctx, args) => {
    const { wsCtx, conv } = await assertMineOrThrow(ctx, args.id);
    await ctx.db.patch(args.id, { state: "snoozed", snoozedUntil: args.until });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "conversation",
      resourceId: args.id,
      after: { state: "snoozed", until: args.until },
    });
  },
});

export const unsnooze = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "open", snoozedUntil: undefined });
  },
});

export const archive = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { wsCtx, conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "archived", archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "conversation",
      resourceId: id,
    });
  },
});

export const restore = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "open", archivedAt: undefined });
  },
});

export const pin = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "pinned" });
  },
});

export const unpin = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "open" });
  },
});

export const markSpam = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { wsCtx, conv } = await assertMineOrThrow(ctx, id);
    await ctx.db.patch(id, { state: "spam" });

    // Add sender emails to the suppression list
    for (const email of conv.participantEmails ?? []) {
      const existing = await ctx.db
        .query("emailSuppressions")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("email", email),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("emailSuppressions", {
          workspaceId: wsCtx.workspace._id,
          email,
          reason: "manual",
          source: "operator",
          addedBy: wsCtx.user._id,
        });
      }
    }
  },
});

/* ============================================================ */
/* Inbound ingest — called from convex/http.ts /inbound/resend    */
/* ============================================================ */

export const unwindSnoozed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Iterate workspaces implicitly via a scan on snoozed state.
    // Since there's no dedicated index for snoozedUntil, we page
    // through all conversations with state='snoozed' and check.
    // For scale we'd add an index; for Atlas single-op scale this
    // is fine (<10k snoozed at once is unlikely).
    const snoozed = await ctx.db
      .query("conversations")
      .filter((q) => q.eq(q.field("state"), "snoozed"))
      .take(500);
    let count = 0;
    for (const conv of snoozed) {
      if (typeof conv.snoozedUntil === "number" && conv.snoozedUntil <= now) {
        await ctx.db.patch(conv._id, { state: "open", snoozedUntil: undefined });
        count++;
      }
    }
    return { unwound: count };
  },
});

export const ingestInbound = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmails: v.array(v.string()),
    ccEmails: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
    receivedAt: v.number(),
    providerPayload: v.optional(v.any()),
    attachments: v.optional(
      v.array(v.object({
        storageId: v.id("_storage"),
        filename: v.string(),
        contentType: v.string(),
        sizeBytes: v.number(),
        inline: v.optional(v.boolean()),
        contentId: v.optional(v.string()),
      })),
    ),
  },
  handler: async (ctx, args) => {
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const participantEmails = [fromEmail, ...args.toEmails, ...(args.ccEmails ?? [])]
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, arr) => arr.indexOf(e) === i);

    // Suppression check
    const suppressed = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_workspace_email", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("email", fromEmail),
      )
      .first();
    if (suppressed) {
      // Drop silently — bounces don't need a conversation entry
      return { status: "suppressed" as const };
    }

    // Find or create contact
    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_email", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("email", fromEmail),
      )
      .first();

    // Find or create company (by domain)
    let companyId: Id<"companies"> | undefined = contact?.companyId ?? undefined;
    const domain = domainOf(fromEmail);
    if (!companyId && domain && !isPersonalDomain(domain)) {
      let company = await ctx.db
        .query("companies")
        .withIndex("by_workspace_domain", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("domain", domain),
        )
        .first();
      if (!company) {
        const newId = await ctx.db.insert("companies", {
          workspaceId: args.workspaceId,
          name: capitalizeDomain(domain),
          domain,
          country: "KE",
          source: "inbound_email",
          lifecycleStage: "cold",
          tags: [],
        });
        companyId = newId;
      } else {
        companyId = company._id;
      }
    }

    if (!contact) {
      const [firstName, ...rest] = (args.fromName ?? fromEmail.split("@")[0]).split(/\s+/);
      const newId = await ctx.db.insert("contacts", {
        workspaceId: args.workspaceId,
        companyId,
        firstName: firstName || fromEmail.split("@")[0],
        lastName: rest.join(" ") || undefined,
        email: fromEmail,
        source: "inbound_email",
        lifecycleStage: "cold",
        tags: [],
      });
      contact = await ctx.db.get(newId);
    }

    // Find or create conversation
    let conv = await findConversationForInbound(ctx, {
      workspaceId: args.workspaceId,
      inReplyTo: args.inReplyTo,
      references: args.referencesChain,
      subject: args.subject,
      participantEmails,
    });

    if (!conv) {
      const key = threadingKeyFrom(args.subject, participantEmails);
      const convId = await ctx.db.insert("conversations", {
        workspaceId: args.workspaceId,
        channel: "email",
        externalId: args.messageId,
        subject: args.subject,
        participantEmails,
        companyId,
        contactIds: contact ? [contact._id] : [],
        state: "open",
        lastMessageAt: args.receivedAt,
        lastInboundAt: args.receivedAt,
        unreadCount: 1,
        messageCount: 1,
        threadingKey: key,
      });
      conv = await ctx.db.get(convId);
    } else {
      // Merge new contact into existing conversation if not already present
      const contactIds = [...conv.contactIds];
      if (contact && !contactIds.includes(contact._id)) contactIds.push(contact._id);
      await ctx.db.patch(conv._id, {
        contactIds,
        companyId: conv.companyId ?? companyId,
        lastMessageAt: args.receivedAt,
        lastInboundAt: args.receivedAt,
        unreadCount: conv.unreadCount + 1,
        messageCount: conv.messageCount + 1,
        state: conv.state === "archived" || conv.state === "snoozed" ? "open" : conv.state,
        snoozedUntil: conv.state === "snoozed" ? undefined : conv.snoozedUntil,
      });
    }

    // Insert the message
    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: conv!._id,
      direction: "inbound",
      senderEmail: fromEmail,
      senderName: args.fromName,
      recipientEmails: args.toEmails,
      recipientCcEmails: args.ccEmails,
      subject: args.subject,
      bodyText: args.bodyText || (args.bodyHtml ? htmlToPlain(args.bodyHtml) : ""),
      bodyHtml: args.bodyHtml,
      providerPayload: args.providerPayload,
      status: "received",
      messageId: args.messageId,
      inReplyTo: args.inReplyTo,
      referencesChain: args.referencesChain,
      aiDrafted: false,
      receivedAt: args.receivedAt,
    });

    // Attachments
    for (const att of args.attachments ?? []) {
      await ctx.db.insert("messageAttachments", {
        messageId,
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        storageId: att.storageId,
        inline: att.inline ?? false,
        contentId: att.contentId,
      });
    }

    await recordTimelineEvent(ctx, {
      workspaceId: args.workspaceId,
      eventType: "email_received",
      subjectType: contact ? "contact" : "company",
      subjectId: (contact?._id as string) ?? (companyId as string) ?? conv!._id,
      relatedRefs: { conversationId: conv!._id, messageId },
      payload: {
        from: fromEmail,
        subject: args.subject,
        preview: (args.bodyText || "").slice(0, 200),
      },
    });

    return { status: "ingested" as const, conversationId: conv!._id, messageId };
  },
});

/* ============================================================ */
/* Sender identities                                             */
/* ============================================================ */

export const listSenderIdentities = query({
  args: { channel: v.optional(v.union(v.literal("email"), v.literal("whatsapp"))) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    let all = await ctx.db
      .query("senderIdentities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    if (args.channel) all = all.filter((s) => s.channel === args.channel);
    return all.filter((s) => s.archivedAt === undefined);
  },
});

export const addSenderIdentity = mutation({
  args: {
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    address: v.string(),
    displayName: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    const address = args.address.trim().toLowerCase();
    const existing = await ctx.db
      .query("senderIdentities")
      .withIndex("by_workspace_address", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("address", address),
      )
      .first();
    if (existing) {
      throw new ConvexError({ code: "EXISTS", message: "This sender identity already exists." });
    }

    // If setting as default, clear other defaults in the same channel
    if (args.isDefault) {
      const others = await ctx.db
        .query("senderIdentities")
        .withIndex("by_workspace_channel", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("channel", args.channel),
        )
        .collect();
      for (const o of others) {
        if (o.isDefault) await ctx.db.patch(o._id, { isDefault: false });
      }
    }

    const id = await ctx.db.insert("senderIdentities", {
      workspaceId: wsCtx.workspace._id,
      channel: args.channel,
      address,
      displayName: args.displayName,
      isDefault: args.isDefault ?? false,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "sender_identity",
      resourceId: id,
      after: { channel: args.channel, address },
    });
    return id;
  },
});

/* ============================================================ */
/* Helpers                                                       */
/* ============================================================ */

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "yandex.com",
]);

function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain);
}

function capitalizeDomain(domain: string): string {
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}
