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
    logoUrl?: string;
    physicalAddress?: string;
    socialLinks?: {
      twitter?: string;
      linkedin?: string;
      instagram?: string;
      facebook?: string;
    };
    ownerName?: string;
  },
): string {
  const accent = opts.accent && /^#?[0-9a-fA-F]{3,8}$/.test(opts.accent)
    ? opts.accent.startsWith("#")
      ? opts.accent
      : `#${opts.accent}`
    : "#111827";
  const wsName = opts.workspaceName ?? "";
  const wsWebsite = opts.workspaceWebsite ?? "";
  const logoUrl = opts.logoUrl;
  const address = opts.physicalAddress;
  const socials = opts.socialLinks ?? {};

  // Header — logo image if configured, otherwise the workspace wordmark
  // with an accent-colored underline. Silicon-Valley-style clean.
  const defaultHeader = wsName
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin-bottom: 32px;">
         <tr>
           <td style="padding-bottom: 24px; border-bottom: 1px solid #e5e7eb;">
             ${
               logoUrl
                 ? `<img src="${logoUrl}" alt="${wsName}" style="height: 36px; display: block; border: 0;" />`
                 : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: ${accent};">${wsName}</div>`
             }
           </td>
         </tr>
       </table>`
    : "";

  // Footer — signature + workspace metadata + unsubscribe + social row
  const socialLinksList: string[] = [];
  if (socials.twitter) socialLinksList.push(`<a href="${socials.twitter}" style="color:${accent};text-decoration:none;margin-right:12px;">Twitter</a>`);
  if (socials.linkedin) socialLinksList.push(`<a href="${socials.linkedin}" style="color:${accent};text-decoration:none;margin-right:12px;">LinkedIn</a>`);
  if (socials.instagram) socialLinksList.push(`<a href="${socials.instagram}" style="color:${accent};text-decoration:none;margin-right:12px;">Instagram</a>`);
  if (socials.facebook) socialLinksList.push(`<a href="${socials.facebook}" style="color:${accent};text-decoration:none;margin-right:12px;">Facebook</a>`);
  const socialsHtml = socialLinksList.length > 0
    ? `<div style="margin-top: 12px; font-size: 12px;">${socialLinksList.join("")}</div>`
    : "";

  const defaultFooter = wsName
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin-top: 40px; border-top: 1px solid #e5e7eb;">
         <tr>
           <td style="padding-top: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #6b7280;">
             ${opts.ownerName ? `<div style="font-weight: 600; color: #374151; margin-bottom: 2px;">${opts.ownerName}</div>` : ""}
             <div style="margin-bottom: 8px;">${wsName}${wsWebsite ? ` · <a href="${wsWebsite}" style="color: ${accent}; text-decoration: none;">${wsWebsite.replace(/^https?:\/\//, "")}</a>` : ""}</div>
             ${address ? `<div style="color: #9ca3af; margin-bottom: 8px;">${address}</div>` : ""}
             ${socialsHtml}
             <div style="color: #9ca3af; margin-top: 12px; font-size: 11px;">Reply to this email to unsubscribe · Sent via Atlas</div>
           </td>
         </tr>
       </table>`
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin: 0; padding: 32px 16px; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden;"><tr><td style="padding: 40px 40px 32px 40px;">${header}${bodyHtml}${footer}</td></tr></table></body></html>`;
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
      logoUrl: setup.workspace?.emailLogoUrl,
      physicalAddress: setup.workspace?.emailPhysicalAddress,
      socialLinks: setup.workspace?.emailSocialLinks,
      ownerName: setup.owner?.name,
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
      logoUrl: setup.workspace?.emailLogoUrl,
      physicalAddress: setup.workspace?.emailPhysicalAddress,
      socialLinks: setup.workspace?.emailSocialLinks,
      ownerName: setup.owner?.name,
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
