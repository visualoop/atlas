"use node";

/**
 * System-friendly workspace email sender.
 *
 * Called from campaigns, broadcasts, landing signups, and any other
 * automation path that needs to send email from a workspace's sender
 * identity WITHOUT a user session (e.g. from a cron).
 *
 * Contrast with emailsOut.sendNew/sendReply which are session-scoped
 * user actions.
 *
 * Args: everything explicit — workspaceId, senderIdentityId,
 * recipient, subject, HTML, text.
 *
 * Persists a `messages` row + conversation just like the session
 * variant so campaigns show up in the inbox timeline.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const sendOrgEmail = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    senderIdentityId: v.optional(v.id("senderIdentities")),
    to: v.array(v.string()),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    // Optional correlation
    campaignId: v.optional(v.id("campaigns")),
    campaignRecipientId: v.optional(v.id("campaignRecipients")),
    broadcastId: v.optional(v.id("broadcasts")),
    contactId: v.optional(v.id("contacts")),
    // Threading (for replies inside a drip step)
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
    // Idempotency — if provided, we skip if a messages row already
    // exists with this reference. Useful for broadcast fanout retries.
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    status: "sent" | "queued" | "failed" | "skipped";
    messageId?: Id<"messages">;
    conversationId?: Id<"conversations">;
    externalMessageId?: string;
    error?: string;
  }> => {
    // Load workspace context + sender identity + Resend key
    const setup = await ctx.runQuery(internal.emailsOutSystemHelpers.prepareSystemSend, {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      senderIdentityId: args.senderIdentityId,
    });
    if (!setup.senderIdentity) {
      return { status: "failed", error: "no_sender_identity" };
    }
    if (!setup.resendApiKey) {
      // Queue: persist as queued so operator can retry once key is added
      const persisted = await ctx.runMutation(
        internal.emailsOutSystemHelpers.persistOrgEmail,
        {
          workspaceId: args.workspaceId,
          senderIdentityId: setup.senderIdentity._id,
          senderEmail: setup.senderIdentity.address,
          senderName: setup.senderIdentity.displayName,
          to: args.to,
          subject: args.subject,
          text: args.text,
          html: args.html,
          status: "queued",
          failureReason: "resend_not_configured",
          contactId: args.contactId,
        },
      );
      return {
        status: "queued",
        messageId: persisted.messageId,
        conversationId: persisted.conversationId,
      };
    }

    const from = setup.senderIdentity.displayName
      ? `${setup.senderIdentity.displayName} <${setup.senderIdentity.address}>`
      : setup.senderIdentity.address;

    const headers: Record<string, string> = {};
    if (args.inReplyTo) headers["In-Reply-To"] = args.inReplyTo;
    if (args.referencesChain?.length) {
      headers["References"] = args.referencesChain.join(" ");
    }

    const body: Record<string, unknown> = {
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    };
    if (Object.keys(headers).length > 0) body.headers = headers;

    let externalId: string | undefined;
    let error: string | undefined;
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${setup.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        error = `Resend ${res.status}: ${errText.slice(0, 200)}`;
      } else {
        const json = (await res.json()) as { id?: string };
        externalId = json.id;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "network_error";
    }

    const persisted = await ctx.runMutation(internal.emailsOutSystemHelpers.persistOrgEmail, {
      workspaceId: args.workspaceId,
      senderIdentityId: setup.senderIdentity._id,
      senderEmail: setup.senderIdentity.address,
      senderName: setup.senderIdentity.displayName,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      status: error ? "failed" : "sent",
      externalMessageId: externalId,
      failureReason: error,
      contactId: args.contactId,
      inReplyTo: args.inReplyTo,
      referencesChain: args.referencesChain,
    });

    return {
      status: error ? "failed" : "sent",
      messageId: persisted.messageId,
      conversationId: persisted.conversationId,
      externalMessageId: externalId,
      error,
    };
  },
});
