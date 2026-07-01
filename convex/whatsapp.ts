/**
 * WhatsApp — Meta Cloud API integration (Phase 4).
 *
 * Read:   listConnections, getConnectionByPhone,
 *         listTemplates, isOptedOut, canReplyFree (24h window)
 * Write:  connect (register a workspace connection),
 *         disconnect, addOptOut, removeOptOut, syncTemplates
 * Internal:
 *         findWorkspaceByPhoneNumberId — routes webhook payloads
 *         ingestInboundMessage — writes conversation + message,
 *           auto-creates contacts, emits timeline events
 *         markStatusUpdate — receives Meta's "sent/delivered/read"
 *           webhook events and patches the corresponding message
 *
 * Outbound send lives in `convex/whatsappOut.ts` (Node runtime).
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Connection CRUD                                                */
/* ============================================================ */

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    return await ctx.db
      .query("whatsappConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
  },
});

export const getConnectionByPhone = query({
  args: { phoneNumberId: v.string() },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", args.phoneNumberId))
      .first();
    return conn;
  },
});

export const connect = mutation({
  args: {
    wabaId: v.string(),
    phoneNumberId: v.string(),
    displayPhoneNumber: v.string(),
    verifiedName: v.optional(v.string()),
    webhookVerifyToken: v.string(),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    // Uniqueness — one workspace per phone_number_id globally
    const dup = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", args.phoneNumberId))
      .first();
    if (dup) {
      throw new ConvexError({
        code: "EXISTS",
        message: "This WhatsApp number is already connected to another workspace.",
      });
    }
    const id = await ctx.db.insert("whatsappConnections", {
      workspaceId: wsCtx.workspace._id,
      wabaId: args.wabaId,
      phoneNumberId: args.phoneNumberId,
      displayPhoneNumber: args.displayPhoneNumber,
      verifiedName: args.verifiedName,
      webhookVerifyToken: args.webhookVerifyToken,
      status: "pending",
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "whatsapp_connection",
      resourceId: id,
      after: { phoneNumberId: args.phoneNumberId, wabaId: args.wabaId },
    });
    return id;
  },
});

export const disconnect = mutation({
  args: { id: v.id("whatsappConnections") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    const conn = await ctx.db.get(id);
    if (!conn || conn.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Connection not found." });
    }
    await ctx.db.patch(id, { status: "disconnected" });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "whatsapp_connection",
      resourceId: id,
    });
  },
});

/* ============================================================ */
/* Templates                                                     */
/* ============================================================ */

export const listTemplates = query({
  args: { onlyApproved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    if (args.onlyApproved) {
      return await ctx.db
        .query("whatsappTemplates")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", "APPROVED"),
        )
        .collect();
    }
    return await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
  },
});

export const upsertTemplate = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    wabaId: v.string(),
    externalTemplateId: v.optional(v.string()),
    name: v.string(),
    language: v.string(),
    category: v.string(),
    status: v.string(),
    components: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_workspace_name", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("name", args.name),
      )
      .filter((q) => q.eq(q.field("language"), args.language))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        category: args.category,
        externalTemplateId: args.externalTemplateId,
        components: args.components,
        lastSyncAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("whatsappTemplates", {
      workspaceId: args.workspaceId,
      wabaId: args.wabaId,
      externalTemplateId: args.externalTemplateId,
      name: args.name,
      language: args.language,
      category: args.category,
      status: args.status,
      components: args.components,
      lastSyncAt: now,
    });
  },
});

/* ============================================================ */
/* Opt-outs                                                      */
/* ============================================================ */

export const isOptedOut = query({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const row = await ctx.db
      .query("whatsappOptOuts")
      .withIndex("by_workspace_phone", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("phone", args.phone),
      )
      .first();
    return !!row;
  },
});

export const addOptOut = mutation({
  args: { phone: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const already = await ctx.db
      .query("whatsappOptOuts")
      .withIndex("by_workspace_phone", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("phone", args.phone),
      )
      .first();
    if (already) return already._id;
    return await ctx.db.insert("whatsappOptOuts", {
      workspaceId: wsCtx.workspace._id,
      phone: args.phone,
      reason: args.reason,
      at: Date.now(),
    });
  },
});

export const removeOptOut = mutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const row = await ctx.db
      .query("whatsappOptOuts")
      .withIndex("by_workspace_phone", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("phone", args.phone),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

/* ============================================================ */
/* 24-hour window check                                          */
/* ============================================================ */

export const canReplyFree = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.workspaceId !== wsCtx.workspace._id) return false;
    if (conv.channel !== "whatsapp") return true;              // n/a
    if (!conv.lastInboundAt) return false;                      // never received a message
    const windowMs = 24 * 60 * 60 * 1000;
    return Date.now() - conv.lastInboundAt < windowMs;
  },
});

/* ============================================================ */
/* Internal — webhook routing                                    */
/* ============================================================ */

export const findWorkspaceByPhoneNumberId = internalQuery({
  args: { phoneNumberId: v.string() },
  handler: async (ctx, args): Promise<{
    workspaceId: Id<"workspaces">;
    connectionId: Id<"whatsappConnections">;
    verifyToken: string;
  } | null> => {
    const conn = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", args.phoneNumberId))
      .first();
    if (!conn || conn.status !== "connected") return null;
    return {
      workspaceId: conn.workspaceId,
      connectionId: conn._id,
      verifyToken: conn.webhookVerifyToken,
    };
  },
});

/* ============================================================ */
/* Internal — inbound message ingest                             */
/* ============================================================ */

export const ingestInboundMessage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    connectionId: v.id("whatsappConnections"),
    fromPhone: v.string(),                                      // E.164 without +
    fromName: v.optional(v.string()),
    metaMessageId: v.string(),
    messageType: v.string(),
    bodyText: v.string(),
    receivedAt: v.number(),
    mediaMetaId: v.optional(v.string()),
    mediaFilename: v.optional(v.string()),
    mediaContentType: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const phone = args.fromPhone.startsWith("+") ? args.fromPhone : `+${args.fromPhone}`;

    // Opt-out check
    const optedOut = await ctx.db
      .query("whatsappOptOuts")
      .withIndex("by_workspace_phone", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("phone", phone),
      )
      .first();
    if (optedOut) {
      // Still record it in webhookEvents for audit, but drop the message
      return { status: "opted_out" as const };
    }

    // Auto-detect opt-out keywords
    const body = args.bodyText.trim().toLowerCase();
    const isStopKeyword = body === "stop" || body === "unsubscribe" || body === "remove";
    if (isStopKeyword) {
      await ctx.db.insert("whatsappOptOuts", {
        workspaceId: args.workspaceId,
        phone,
        reason: "auto:stop_keyword",
        at: Date.now(),
      });
    }

    // Find or create contact
    let contact = await ctx.db
      .query("contacts")
      .filter((q) =>
        q.and(
          q.eq(q.field("workspaceId"), args.workspaceId),
          q.eq(q.field("whatsapp"), phone),
        ),
      )
      .first();
    if (!contact) {
      const [firstName, ...rest] = (args.fromName ?? phone).split(/\s+/);
      const id = await ctx.db.insert("contacts", {
        workspaceId: args.workspaceId,
        firstName: firstName || phone,
        lastName: rest.length ? rest.join(" ") : undefined,
        whatsapp: phone,
        phone,
        source: "inbound_whatsapp",
        lifecycleStage: "cold",
        tags: [],
      });
      contact = await ctx.db.get(id);
    }

    // Find or create conversation
    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_channel_time", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("channel", "whatsapp"),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("state"), "open"),
        ),
      )
      .collect()
      .then((rows) => rows.find((r) => (r.participantPhones ?? []).includes(phone)) ?? null);

    if (!conv) {
      const convId = await ctx.db.insert("conversations", {
        workspaceId: args.workspaceId,
        channel: "whatsapp",
        externalId: undefined,
        participantPhones: [phone],
        contactIds: contact ? [contact._id] : [],
        companyId: contact?.companyId,
        state: "open",
        lastMessageAt: args.receivedAt,
        lastInboundAt: args.receivedAt,
        unreadCount: 1,
        messageCount: 1,
      });
      conv = await ctx.db.get(convId);
    } else {
      await ctx.db.patch(conv._id, {
        lastMessageAt: args.receivedAt,
        lastInboundAt: args.receivedAt,
        unreadCount: conv.unreadCount + 1,
        messageCount: conv.messageCount + 1,
        state: conv.state === "archived" ? "open" : conv.state,
      });
    }

    // Save media pointer (media download is deferred to a scheduled action)
    if (args.mediaMetaId) {
      await ctx.db.insert("whatsappMedia", {
        workspaceId: args.workspaceId,
        metaMediaId: args.mediaMetaId,
        direction: "inbound",
        filename: args.mediaFilename,
        contentType: args.mediaContentType,
      });
    }

    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: conv!._id,
      direction: "inbound",
      senderPhone: phone,
      senderName: args.fromName,
      bodyText: args.bodyText,
      messageType: args.messageType,
      status: "received",
      externalId: args.metaMessageId,
      aiDrafted: false,
      receivedAt: args.receivedAt,
      providerPayload: args.rawPayload,
    });

    await recordTimelineEvent(ctx, {
      workspaceId: args.workspaceId,
      eventType: isStopKeyword ? "whatsapp_optout" : "whatsapp_received",
      subjectType: contact ? "contact" : "conversation",
      subjectId: (contact?._id as string) ?? (conv!._id as string),
      relatedRefs: { conversationId: conv!._id, messageId },
      payload: {
        from: phone,
        preview: args.bodyText.slice(0, 200),
        messageType: args.messageType,
      },
    });

    return {
      status: isStopKeyword ? ("opted_out" as const) : ("ingested" as const),
      conversationId: conv!._id,
      messageId,
    };
  },
});

/* ============================================================ */
/* Internal — status update (sent → delivered → read)            */
/* ============================================================ */

export const markStatusUpdate = internalMutation({
  args: {
    metaMessageId: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db
      .query("messages")
      .withIndex("by_external", (q) => q.eq("externalId", args.metaMessageId))
      .first();
    if (!msg) return { updated: false };
    const patch: Partial<Doc<"messages">> = { status: args.status };
    if (args.status === "read") patch.readAt = args.timestamp;
    if (args.status === "sent" && !msg.sentAt) patch.sentAt = args.timestamp;
    if (args.status === "failed") patch.failureReason = args.failureReason;
    await ctx.db.patch(msg._id, patch);
    return { updated: true };
  },
});

/* ============================================================ */
/* Internal — outbound persistence (called by whatsappOut action) */
/* ============================================================ */

export const persistOutboundMessage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.optional(v.id("conversations")),
    toPhone: v.string(),                                        // E.164
    contactId: v.optional(v.id("contacts")),
    bodyText: v.string(),
    messageType: v.string(),
    templateName: v.optional(v.string()),
    templateLanguage: v.optional(v.string()),
    metaMessageId: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("queued"), v.literal("failed")),
    failureReason: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let conv: Doc<"conversations"> | null = null;
    if (args.conversationId) {
      conv = await ctx.db.get(args.conversationId);
    }
    if (!conv) {
      // Look up open conversation for this phone
      const rows = await ctx.db
        .query("conversations")
        .withIndex("by_workspace_channel_time", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("channel", "whatsapp"),
        )
        .collect();
      conv = rows.find((r) => (r.participantPhones ?? []).includes(args.toPhone)) ?? null;
    }
    if (!conv) {
      const convId = await ctx.db.insert("conversations", {
        workspaceId: args.workspaceId,
        channel: "whatsapp",
        participantPhones: [args.toPhone],
        contactIds: args.contactId ? [args.contactId] : [],
        state: "open",
        lastMessageAt: now,
        lastOutboundAt: now,
        unreadCount: 0,
        messageCount: 1,
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
      recipientPhones: [args.toPhone],
      bodyText: args.bodyText,
      messageType: args.messageType,
      templateName: args.templateName,
      templateLanguage: args.templateLanguage,
      status: args.status,
      failureReason: args.failureReason,
      externalId: args.metaMessageId,
      aiDrafted: false,
      sentAt: args.status === "sent" ? now : undefined,
    });

    await recordTimelineEvent(ctx, {
      workspaceId: args.workspaceId,
      eventType: "whatsapp_sent",
      actorId: args.actorId,
      subjectType: args.contactId ? "contact" : "conversation",
      subjectId: (args.contactId as string) ?? (conv!._id as string),
      relatedRefs: { conversationId: conv!._id, messageId },
      payload: {
        to: args.toPhone,
        preview: args.bodyText.slice(0, 200),
        templateName: args.templateName,
        status: args.status,
      },
    });

    return { conversationId: conv!._id, messageId };
  },
});
