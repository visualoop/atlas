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

/**
 * Wrap a template body in the workspace's email chrome. Uses the
 * workspace's header/footer HTML when set, otherwise falls back to
 * a sensible branded default. Conservative HTML for email-client
 * compatibility.
 */
function wrapInChrome(
  bodyHtml: string,
  opts: {
    workspaceName?: string;
    workspaceWebsite?: string;
    accent?: string;
    headerHtml?: string;
    footerHtml?: string;
  },
): string {
  const accent = opts.accent && /^#?[0-9a-fA-F]{3,8}$/.test(opts.accent)
    ? opts.accent.startsWith("#")
      ? opts.accent
      : `#${opts.accent}`
    : "#111827";
  const wsName = opts.workspaceName ?? "";
  const wsWebsite = opts.workspaceWebsite ?? "";

  const defaultHeader = wsName
    ? `<div style="border-bottom: 2px solid ${accent}; padding: 12px 0 16px; margin-bottom: 24px;"><div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: ${accent}; font-weight: 600;">${wsName}</div></div>`
    : "";

  const defaultFooter = wsName
    ? `<div style="border-top: 1px solid #e5e7eb; margin-top: 32px; padding-top: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #6b7280; line-height: 1.5;"><p style="margin: 0 0 4px;">${wsName}${wsWebsite ? ` · <a href="${wsWebsite}" style="color: ${accent}; text-decoration: none;">${wsWebsite.replace(/^https?:\/\//, "")}</a>` : ""}</p><p style="margin: 0; color: #9ca3af;">Sent from Atlas · reply to unsubscribe.</p></div>`
    : "";

  const header =
    opts.headerHtml && opts.headerHtml.trim().length > 0
      ? opts.headerHtml
      : defaultHeader;
  const footer =
    opts.footerHtml && opts.footerHtml.trim().length > 0
      ? opts.footerHtml
      : defaultFooter;

  if (/^\s*<!DOCTYPE|^\s*<html/i.test(bodyHtml)) return bodyHtml;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin: 0; padding: 24px; background: #ffffff;"><div style="max-width: 640px; margin: 0 auto;">${header}${bodyHtml}${footer}</div></body></html>`;
}

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

    // Wrap the body in the workspace's email chrome (header + footer)
    // so every send looks branded. Falls back to a sensible default.
    const wrappedHtml = wrapInChrome(args.bodyHtml, {
      workspaceName: setup.workspace?.name,
      workspaceWebsite: setup.workspace?.website,
      accent: setup.workspace?.emailAccentColor,
      headerHtml: setup.workspace?.emailHeaderHtml,
      footerHtml: setup.workspace?.emailFooterHtml,
    });

    let result: SendResult = { status: "queued" };
    if (setup.resendApiKey) {
      result = await sendViaResend({
        apiKey: setup.resendApiKey,
        from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        html: wrappedHtml,
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
      bodyHtml: wrappedHtml,
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

    // Chrome-wrap the reply body so replies match the branded look
    // of outbound sends.
    const wrappedHtml = wrapInChrome(args.bodyHtml, {
      workspaceName: setup.workspace?.name,
      workspaceWebsite: setup.workspace?.website,
      accent: setup.workspace?.emailAccentColor,
      headerHtml: setup.workspace?.emailHeaderHtml,
      footerHtml: setup.workspace?.emailFooterHtml,
    });

    let result: SendResult = { status: "queued" };
    if (setup.resendApiKey) {
      result = await sendViaResend({
        apiKey: setup.resendApiKey,
        from,
        to: setup.replyTo,
        subject: setup.subject,
        html: wrappedHtml,
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
        bodyHtml: wrappedHtml,
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
