/**
 * Node-side helpers for campaignRunner.ts.
 *
 * These now delegate to `internal.emailsOutSystem.sendOrgEmail` for
 * real Resend delivery, and to a new WhatsApp send helper for
 * template messages via Meta Cloud API.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const sendEmailStep = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    to: v.array(v.string()),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.string(),
    senderIdentityId: v.optional(v.id("senderIdentities")),
    contactId: v.optional(v.id("contacts")),
    campaignId: v.optional(v.id("campaigns")),
    campaignRecipientId: v.optional(v.id("campaignRecipients")),
  },
  handler: async (ctx, args): Promise<{
    conversationId?: Id<"conversations">;
    messageId?: Id<"messages">;
  }> => {
    const res = await ctx.runAction(internal.emailsOutSystem.sendOrgEmail, {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      senderIdentityId: args.senderIdentityId,
      to: args.to,
      subject: args.subject,
      html: args.bodyHtml,
      text: args.bodyText,
      campaignId: args.campaignId,
      campaignRecipientId: args.campaignRecipientId,
      contactId: args.contactId,
    });
    if (res.status === "failed") {
      throw new Error(res.error ?? "send_failed");
    }
    return {
      conversationId: res.conversationId,
      messageId: res.messageId,
    };
  },
});

export const sendWaTemplateStep = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    toPhone: v.string(),
    templateName: v.string(),
    templateLanguage: v.optional(v.string()),
    variables: v.optional(v.array(v.string())),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args): Promise<{
    conversationId?: Id<"conversations">;
    messageId?: Id<"messages">;
  }> => {
    // Reuse the WhatsApp module's send-template helper. Falls back to
    // console warn if no connection is configured for the workspace.
    try {
      const res = await ctx.runAction(internal.whatsappOut.sendTemplateSystem, {
        workspaceId: args.workspaceId,
        organizationId: args.organizationId,
        toPhone: args.toPhone,
        templateName: args.templateName,
        templateLanguage: args.templateLanguage ?? "en",
        variables: args.variables ?? [],
        contactId: args.contactId,
      });
      return {
        conversationId: res.conversationId,
        messageId: res.messageId,
      };
    } catch (err) {
      throw err instanceof Error ? err : new Error("wa_send_failed");
    }
  },
});
