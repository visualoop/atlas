"use node";

/**
 * Resend inbound body fetcher.
 *
 * Resend's 2026 email.received webhook only ships metadata — body,
 * html, headers, and attachments live behind separate API calls:
 *   GET /emails/received/{email_id}
 *   GET /emails/received/{email_id}/attachments/{attachment_id}
 *
 * This action runs after the /inbound/email webhook has stored the
 * shell message. It fetches the full content, patches the message
 * record, downloads attachments into Convex _storage, and then
 * schedules an auto-draft reply (Task 4).
 *
 * Runs session-less — the webhook has no user context, so we resolve
 * the workspace's Resend key via the org owner.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const RESEND_API_BASE = "https://api.resend.com";

interface ResendReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  received_for?: string[];
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    id: string;
    filename: string;
    content_type: string;
    content_disposition?: string;
    content_id?: string;
    size?: number;
  }>;
  created_at: string;
}

export const fetchInboundBody = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    messageId: v.id("messages"),
    resendEmailId: v.string(),
    attachmentsMeta: v.array(
      v.object({
        id: v.string(),
        filename: v.string(),
        content_type: v.string(),
        content_disposition: v.optional(v.string()),
        content_id: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ status: string; error?: string }> => {
    console.log("[inbound-fetch] start", { emailId: args.resendEmailId });

    // 1. Load Resend API key session-lessly (org owner as actor)
    const key = await ctx.runQuery(
      internal.emailsInboundFetch_helpers.getResendKeyForWorkspace,
      { workspaceId: args.workspaceId },
    );
    if (!key) {
      console.error("[inbound-fetch] no resend key configured");
      return { status: "no_key", error: "Resend key not configured for workspace" };
    }

    // 2. Fetch the received email body
    try {
      const res = await fetch(
        `${RESEND_API_BASE}/emails/received/${encodeURIComponent(args.resendEmailId)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
        },
      );
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 300);
        console.error("[inbound-fetch] retrieve failed", { status: res.status, errText });
        return { status: "fetch_failed", error: `Resend ${res.status}: ${errText}` };
      }
      const email = (await res.json()) as ResendReceivedEmail;

      // Extract threading headers if present
      const headers = email.headers ?? {};
      const inReplyTo = headers["in-reply-to"] ?? headers["In-Reply-To"];
      const references = (headers["references"] ?? headers["References"])
        ?.split(/\s+/)
        .filter(Boolean);

      // 3. Update the message record with body content
      await ctx.runMutation(
        internal.emailsInboundFetch_helpers.updateMessageBody,
        {
          messageId: args.messageId,
          bodyText: email.text ?? "",
          bodyHtml: email.html,
          inReplyTo,
          referencesChain: references,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[inbound-fetch] error", msg);
      return { status: "error", error: msg };
    }

    // 4. Download attachments (each stored as its own binary)
    for (const att of args.attachmentsMeta) {
      try {
        const res = await fetch(
          `${RESEND_API_BASE}/emails/received/${encodeURIComponent(args.resendEmailId)}/attachments/${encodeURIComponent(att.id)}`,
          {
            headers: { Authorization: `Bearer ${key}` },
          },
        );
        if (!res.ok) {
          console.warn("[inbound-fetch] attachment failed", { att: att.filename, status: res.status });
          continue;
        }
        const blob = await res.blob();
        const storageId = await ctx.storage.store(blob);
        await ctx.runMutation(
          internal.emailsInboundFetch_helpers.attachToMessage,
          {
            messageId: args.messageId,
            storageId,
            filename: att.filename,
            contentType: att.content_type,
            sizeBytes: blob.size,
            inline: att.content_disposition === "inline",
            contentId: att.content_id,
          },
        );
      } catch (err) {
        console.warn("[inbound-fetch] attachment error", att.filename, err);
      }
    }

    // 5. Schedule auto-draft reply — Task 4 wires this
    // Fires 3 seconds later so body write commits before draft reads
    await ctx.scheduler.runAfter(
      3000,
      internal.emailsInboundFetch_helpers.scheduleAutoDraft,
      { messageId: args.messageId },
    );

    console.log("[inbound-fetch] done", { emailId: args.resendEmailId });
    return { status: "hydrated" };
  },
});
