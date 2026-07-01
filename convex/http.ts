import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";

/**
 * HTTP router for Atlas.
 *
 * - Convex Auth registers its sign-in / callback / session routes here.
 * - Webhook endpoints (Paystack, Resend inbound, Meta WhatsApp, etc.)
 *   will be added in their respective phases.
 *
 * Phase 2:
 *   POST /inbound/email — normalized inbound email webhook. Accepts
 *   Resend's inbound format (or any compatible sender). Verifies the
 *   Svix signature against `RESEND_INBOUND_SECRET`. Routes to the
 *   correct workspace by matching `to` against senderIdentities.
 */

const http = httpRouter();

auth.addHttpRoutes(http);

interface InboundAddress {
  name?: string;
  email: string;
}

interface InboundAttachment {
  filename: string;
  contentType: string;
  content: string;                              // base64-encoded
}

interface InboundPayload {
  from: InboundAddress;
  to: InboundAddress[];
  cc?: InboundAddress[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: InboundAttachment[];
  receivedAt?: string;                          // ISO
}

http.route({
  path: "/inbound/email",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // 1. Read raw body once — needed for both signature check + parse
    const rawBody = await req.text();

    // 2. Verify Svix signature (Resend inbound uses Svix)
    const secret = process.env.RESEND_INBOUND_SECRET;
    if (secret) {
      const svixId = req.headers.get("svix-id");
      const svixTs = req.headers.get("svix-timestamp");
      const svixSig = req.headers.get("svix-signature");
      if (!svixId || !svixTs || !svixSig) {
        return new Response("Missing signature headers", { status: 401 });
      }
      const ok = await verifySvix({
        secret,
        id: svixId,
        timestamp: svixTs,
        signatureHeader: svixSig,
        body: rawBody,
      });
      if (!ok) return new Response("Invalid signature", { status: 401 });
    }

    // 3. Parse
    let payload: InboundPayload;
    try {
      payload = JSON.parse(rawBody) as InboundPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!payload.from?.email || !payload.to?.[0]?.email) {
      return new Response("Missing from/to", { status: 400 });
    }

    // 4. Idempotency — dedupe by messageId or Svix id
    const externalId =
      payload.messageId ?? req.headers.get("svix-id") ?? crypto.randomUUID();
    const already = await ctx.runQuery(internal.emailsInbound.findWebhookEvent, {
      provider: "resend",
      externalId,
    });
    if (already) {
      return new Response(JSON.stringify({ status: "duplicate" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // 5. Resolve workspace via senderIdentities matching one of the `to` addresses
    const toEmails = payload.to.map((a) => a.email.trim().toLowerCase());
    const workspaceId: Id<"workspaces"> | null = await ctx.runQuery(
      internal.emailsInbound.resolveWorkspaceByAddress,
      { addresses: toEmails },
    );
    if (!workspaceId) {
      // Log event but drop — no workspace claims this recipient
      await ctx.runMutation(internal.emailsInbound.recordWebhookEvent, {
        provider: "resend",
        externalId,
        eventType: "inbound_email_unmatched",
        rawPayload: payload,
        error: "no_workspace_for_recipient",
      });
      return new Response(JSON.stringify({ status: "unmatched" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }

    // 6. Save attachments as _storage blobs (each becomes an Id)
    const savedAttachments: Array<{
      storageId: Id<"_storage">;
      filename: string;
      contentType: string;
      sizeBytes: number;
    }> = [];
    for (const att of payload.attachments ?? []) {
      try {
        const bytes = base64ToUint8Array(att.content);
        const storageId = await ctx.storage.store(
          new Blob([bytes as BlobPart], { type: att.contentType }),
        );
        savedAttachments.push({
          storageId,
          filename: att.filename,
          contentType: att.contentType,
          sizeBytes: bytes.byteLength,
        });
      } catch (err) {
        console.warn("Failed to save attachment", att.filename, err);
      }
    }

    // 7. Ingest
    const receivedAt = payload.receivedAt
      ? new Date(payload.receivedAt).getTime()
      : Date.now();

    const result = await ctx.runMutation(internal.emails.ingestInbound, {
      workspaceId,
      fromEmail: payload.from.email,
      fromName: payload.from.name,
      toEmails,
      ccEmails: payload.cc?.map((a) => a.email.trim().toLowerCase()),
      subject: payload.subject,
      bodyText: payload.text ?? "",
      bodyHtml: payload.html,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      referencesChain: payload.references,
      receivedAt,
      providerPayload: undefined,                 // we log to webhookEvents instead
      attachments: savedAttachments,
    });

    await ctx.runMutation(internal.emailsInbound.recordWebhookEvent, {
      provider: "resend",
      externalId,
      eventType: "inbound_email",
      rawPayload: { subject: payload.subject, from: payload.from, to: payload.to },
      resultStatus: result.status,
      conversationId: "conversationId" in result ? result.conversationId : undefined,
    });

    return new Response(
      JSON.stringify({
        status: result.status,
        conversationId: "conversationId" in result ? result.conversationId : undefined,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }),
});

/* ------------------------------------------------------------------ */
/* Svix signature verification (HMAC-SHA256)                            */
/* ------------------------------------------------------------------ */

async function verifySvix(args: {
  secret: string;                                // "whsec_..."
  id: string;
  timestamp: string;
  signatureHeader: string;                       // "v1,abc v1,def"
  body: string;
}): Promise<boolean> {
  const rawSecret = args.secret.startsWith("whsec_")
    ? args.secret.slice("whsec_".length)
    : args.secret;

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToUint8Array(rawSecret);
  } catch {
    return false;
  }

  const message = `${args.id}.${args.timestamp}.${args.body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const expected = uint8ArrayToBase64(new Uint8Array(sigBytes));

  const provided = args.signatureHeader
    .split(" ")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1,"))
    .map((p) => p.slice(3));

  return provided.some((p) => timingSafeEqualStrings(p, expected));
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
