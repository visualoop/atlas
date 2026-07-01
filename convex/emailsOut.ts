"use node";

/**
 * Outbound email sender — action (Node runtime for the Resend SDK).
 *
 * Two entry points:
 *
 *  - `sendReply` — reply to an existing conversation. Auto-picks
 *    In-Reply-To, References, subject prefix.
 *  - `sendNew` — start a new conversation with one or more recipients.
 *
 * Both:
 *   1. Resolve workspace + default sender identity
 *   2. Decrypt the org's Resend Tier-1 key
 *   3. Build the MIME (via Resend's typed helper) + attachments
 *   4. Call Resend
 *   5. On success: insert a message row (status='sent') + update
 *      conversation state + record timeline + audit
 *   6. On failure: insert with status='failed' + failureReason
 *
 * If the org's Resend key is not set, we still write the message as
 * `status='queued'` and log a warning. Once the key is added the
 * founder can retry from the UI (Phase 2 follow-up).
 */

import { v, ConvexError } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

interface SendResult {
  status: "sent" | "queued" | "failed";
  messageId?: string;
  error?: string;
}

async function sendViaResend(args: {
  apiKey: string;
  from: string;                                 // "Name <you@x.com>"
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;             // for In-Reply-To / References
  attachments?: Array<{
    filename: string;
    content: string;                             // base64
    contentType?: string;
  }>;
}): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    };
    if (args.html) body.html = args.html;
    if (args.cc?.length) body.cc = args.cc;
    if (args.bcc?.length) body.bcc = args.bcc;
    if (args.replyTo) body.reply_to = args.replyTo;
    if (args.headers) body.headers = args.headers;
    if (args.attachments?.length) body.attachments = args.attachments;

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return { status: "failed", error: `Resend ${res.status}: ${err.slice(0, 200)}` };
    }

    const json = (await res.json()) as { id?: string };
    return { status: "sent", messageId: json.id };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/* ------------------------------------------------------------------ */
/* sendNew                                                              */
/* ------------------------------------------------------------------ */

export const sendNew = action({
  args: {
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.string(),
    // Optional attachment refs — resolved server-side to Convex storage blobs
    attachmentFileIds: v.optional(v.array(v.id("files"))),
    senderIdentityId: v.optional(v.id("senderIdentities")),
  },
  handler: async (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    status: SendResult["status"];
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.emailsOutHelpers.prepareSend, {
      senderIdentityId: args.senderIdentityId,
      attachmentFileIds: args.attachmentFileIds,
    });

    if (!setup.senderIdentity) {
      throw new ConvexError({
        code: "NO_SENDER",
        message: "No sender identity configured for this workspace. Add one in Settings → Sender identities.",
      });
    }

    // Build attachments from Convex storage
    const attachments: Array<{ filename: string; content: string; contentType?: string }> = [];
    for (const att of setup.attachments ?? []) {
      const blob = await ctx.storage.get(att.storageId);
      if (!blob) continue;
      const buf = await blob.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      attachments.push({
        filename: att.filename,
        content: b64,
        contentType: att.contentType,
      });
    }

    const from = setup.senderIdentity.displayName
      ? `${setup.senderIdentity.displayName} <${setup.senderIdentity.address}>`
      : setup.senderIdentity.address;

    let result: SendResult = { status: "queued" };
    if (setup.resendApiKey) {
      result = await sendViaResend({
        apiKey: setup.resendApiKey,
        from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        html: args.bodyHtml,
        text: args.bodyText,
        attachments,
      });
    } else {
      // No key set — persist as queued so it can be retried later
      console.warn("[emailsOut.sendNew] Resend key not configured, queuing message");
    }

    const persisted: {
      conversationId: Id<"conversations">;
      messageId: Id<"messages">;
    } = await ctx.runMutation(internal.emailsOutHelpers.persistOutbound, {
      workspaceId: setup.workspaceId,
      senderIdentityId: setup.senderIdentity._id,
      senderEmail: setup.senderIdentity.address,
      senderName: setup.senderIdentity.displayName,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      bodyText: args.bodyText,
      bodyHtml: args.bodyHtml,
      attachmentFileIds: args.attachmentFileIds ?? [],
      resendMessageId: result.messageId,
      status: result.status,
      failureReason: result.error,
    });

    return { ...persisted, status: result.status, error: result.error };
  },
});

/* ------------------------------------------------------------------ */
/* sendReply                                                            */
/* ------------------------------------------------------------------ */

export const sendReply = action({
  args: {
    conversationId: v.id("conversations"),
    bodyHtml: v.string(),
    bodyText: v.string(),
    attachmentFileIds: v.optional(v.array(v.id("files"))),
  },
  handler: async (ctx, args): Promise<{
    messageId: Id<"messages">;
    status: SendResult["status"];
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.emailsOutHelpers.prepareReply, {
      conversationId: args.conversationId,
      attachmentFileIds: args.attachmentFileIds,
    });

    const attachments: Array<{ filename: string; content: string; contentType?: string }> = [];
    for (const att of setup.attachments ?? []) {
      const blob = await ctx.storage.get(att.storageId);
      if (!blob) continue;
      const buf = await blob.arrayBuffer();
      attachments.push({
        filename: att.filename,
        content: Buffer.from(buf).toString("base64"),
        contentType: att.contentType,
      });
    }

    const from = setup.senderIdentity.displayName
      ? `${setup.senderIdentity.displayName} <${setup.senderIdentity.address}>`
      : setup.senderIdentity.address;

    const headers: Record<string, string> = {};
    if (setup.inReplyTo) headers["In-Reply-To"] = setup.inReplyTo;
    if (setup.referencesChain?.length) {
      headers["References"] = setup.referencesChain.join(" ");
    }

    let result: SendResult = { status: "queued" };
    if (setup.resendApiKey) {
      result = await sendViaResend({
        apiKey: setup.resendApiKey,
        from,
        to: setup.replyTo,
        subject: setup.subject,
        html: args.bodyHtml,
        text: args.bodyText,
        headers,
        attachments,
      });
    }

    const persisted: { messageId: Id<"messages"> } = await ctx.runMutation(
      internal.emailsOutHelpers.persistReply,
      {
        conversationId: args.conversationId,
        senderIdentityId: setup.senderIdentity._id,
        senderEmail: setup.senderIdentity.address,
        senderName: setup.senderIdentity.displayName,
        to: setup.replyTo,
        subject: setup.subject,
        bodyText: args.bodyText,
        bodyHtml: args.bodyHtml,
        inReplyTo: setup.inReplyTo,
        referencesChain: setup.referencesChain,
        attachmentFileIds: args.attachmentFileIds ?? [],
        resendMessageId: result.messageId,
        status: result.status,
        failureReason: result.error,
      },
    );

    return { ...persisted, status: result.status, error: result.error };
  },
});
