/**
 * V8-runtime helpers for the Node-runtime emailsInboundFetch action.
 *
 * Session-less by design — inbound webhooks have no user context, so
 * we resolve API keys via org owner (like emailsOutSystem does).
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import { internal, api } from "./_generated/api";

export const getResendKeyForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<string | null> => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: ws.organizationId,
        provider: "resend",
        reason: "inbound_body_fetch",
        actorId: owner.userId,
      });
      return k.value;
    } catch {
      return null;
    }
  },
});

export const updateMessageBody = internalMutation({
  args: {
    messageId: v.id("messages"),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    const patch: Record<string, unknown> = {
      bodyText: args.bodyText,
    };
    if (args.bodyHtml) patch.bodyHtml = args.bodyHtml;
    if (args.inReplyTo) patch.inReplyTo = args.inReplyTo;
    if (args.referencesChain) patch.referencesChain = args.referencesChain;
    await ctx.db.patch(args.messageId, patch);
  },
});

export const attachToMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    inline: v.boolean(),
    contentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messageAttachments", {
      messageId: args.messageId,
      storageId: args.storageId,
      filename: args.filename,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      inline: args.inline,
      contentId: args.contentId,
    });
  },
});

/**
 * Schedule auto-draft reply once the inbound body has been fetched.
 * Uses draftEmailReply session-less mode with persistToInboundMessage
 * so the resulting draft ends up on messages.aiDraftReply for the
 * thread reader UI to pick up.
 */
export const scheduleAutoDraft = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    // Only draft replies for inbound messages that don't already have one
    if (msg.direction !== "inbound") return;
    if (msg.aiDraftReply) return;
    await ctx.scheduler.runAfter(
      0,
      api.aiWorkflows.draftEmailReply,
      {
        conversationId: msg.conversationId,
        system: true,
        persistToInboundMessage: args.messageId,
      },
    );
    // Also extract long-term facts from the message body — runs in
    // parallel to draft generation, writes to workspaceKnowledge so
    // future turns already know what the sender said.
    await ctx.scheduler.runAfter(
      2000,
      internal.aiWorkflows.extractFactsFromMessage,
      {
        messageId: args.messageId,
        workspaceId: msg.workspaceId,
      },
    );
    // Notify the workspace that inbound arrived + a draft is coming
    const conversation = await ctx.db.get(msg.conversationId);
    if (conversation) {
      await ctx.runMutation(internal.notifications.notify, {
        workspaceId: msg.workspaceId,
        kind: "inbound_arrived",
        title: `New reply${msg.senderName ? ` from ${msg.senderName}` : ""}`,
        body: msg.subject ?? (msg.bodyText ?? "").slice(0, 100),
        actionLink: `/inbox?id=${msg.conversationId}`,
      });
    }
  },
});
