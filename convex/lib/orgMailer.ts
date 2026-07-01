"use node";

/**
 * Org mailer — sends email from a workspace using the org's encrypted
 * Resend key (stored in orgIntegrationKeys) and the workspace's
 * senderIdentities.
 *
 * Used for:
 *   - Campaign step dispatch (system-authoritative, no session)
 *   - Broadcast dispatch
 *   - Any future workspace-authored automated send
 *
 * The user-facing inbox send path (emailsOut.sendNew/sendReply) uses
 * the same underlying logic but through session-scoped requireWorkspaceContext.
 * This file exposes a system-friendly variant that takes explicit ids.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface OrgMailArgs {
  from: string;                                     // "Name <email>"
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string;                                // base64
    contentType?: string;
  }>;
}

export interface OrgMailResult {
  status: "sent" | "queued" | "failed";
  messageId?: string;
  error?: string;
}

export async function sendViaOrgResend(
  apiKey: string,
  args: OrgMailArgs,
): Promise<OrgMailResult> {
  try {
    const body: Record<string, unknown> = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    };
    if (args.cc?.length) body.cc = args.cc;
    if (args.bcc?.length) body.bcc = args.bcc;
    if (args.replyTo) body.reply_to = args.replyTo;
    if (args.headers) body.headers = args.headers;
    if (args.attachments?.length) body.attachments = args.attachments;

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}
