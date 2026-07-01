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
/* Paystack webhook — POST /webhook/paystack                           */
/* ------------------------------------------------------------------ */
/*
 * Paystack signs with HMAC-SHA512 of the raw body using the account's
 * secret key. Because a workspace's secret key is encrypted at rest,
 * we look up the paymentRequest by reference FIRST to discover the
 * workspace, then decrypt and verify.
 *
 * Events handled:
 *   charge.success — success on card / bank / mobile-money charge
 *   transfer.success | .failed | .reversed — outbound transfers
 *   subscription.create | .disable | .not_renew — future
 *
 * All webhook payloads are recorded in paystackTransactions for audit,
 * deduplication, and replay.
 */

http.route({
  path: "/webhook/paystack",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");
    let parsed: PaystackWebhookPayload;
    try {
      parsed = JSON.parse(rawBody) as PaystackWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const reference = parsed.data?.reference ?? "";
    const event = parsed.event ?? "";
    if (!reference || !event) {
      return new Response("Missing fields", { status: 400 });
    }

    // Dedupe
    const dup = await ctx.runQuery(internal.payments.findDuplicateWebhook, {
      reference,
      event,
      externalId: parsed.data?.id?.toString(),
    });
    if (dup) {
      return new Response(JSON.stringify({ status: "duplicate" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Look up the paymentRequest to discover workspace + verify signature
    const pr = await ctx.runQuery(internal.payments.findPaymentRequestByReference, {
      reference,
    });

    // Signature verification — MUST happen before we trust the payload
    if (pr && signature) {
      const apiKey = await ctx.runQuery(internal.paymentsHelpers.getPaystackKey, {
        organizationId: pr.organizationId,
      });
      if (apiKey) {
        const expected = await hmacSha512Hex(apiKey, rawBody);
        if (!timingSafeEqualStrings(signature, expected)) {
          await ctx.runMutation(internal.payments.recordPaystackWebhook, {
            reference,
            event,
            externalId: parsed.data?.id?.toString(),
            amountCents: typeof parsed.data?.amount === "number" ? BigInt(parsed.data.amount) : undefined,
            currency: parsed.data?.currency,
            channel: parsed.data?.channel,
            status: parsed.data?.status,
            payload: parsed,
            workspaceId: pr.workspaceId,
            organizationId: pr.organizationId,
            processed: false,
            processingError: "invalid_signature",
          });
          return new Response("Invalid signature", { status: 401 });
        }
      }
    }

    let workspaceId = pr?.workspaceId;
    let organizationId = pr?.organizationId;
    let processingError: string | undefined;

    try {
      if (event === "charge.success" && parsed.data?.amount) {
        const result = await ctx.runMutation(internal.payments.applyChargeSuccess, {
          reference,
          externalId: parsed.data?.id?.toString(),
          amountCents: BigInt(parsed.data.amount),
          currency: parsed.data.currency ?? "KES",
          channel: parsed.data.channel,
          feeCents: typeof parsed.data.fees === "number" ? BigInt(parsed.data.fees) : undefined,
          paidAt: parsed.data.paid_at ? new Date(parsed.data.paid_at).getTime() : Date.now(),
          verifiedPayload: parsed.data,
        });
        if (!result.applied) processingError = result.reason;
        else workspaceId ??= result.workspaceId;
      }
      // Transfer events + subscriptions can be added later
    } catch (err) {
      processingError = err instanceof Error ? err.message : "unknown";
    }

    await ctx.runMutation(internal.payments.recordPaystackWebhook, {
      reference,
      event,
      externalId: parsed.data?.id?.toString(),
      amountCents: typeof parsed.data?.amount === "number" ? BigInt(parsed.data.amount) : undefined,
      currency: parsed.data?.currency,
      channel: parsed.data?.channel,
      status: parsed.data?.status,
      payload: parsed,
      workspaceId,
      organizationId,
      processed: !processingError,
      processingError,
    });

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

interface PaystackWebhookPayload {
  event?: string;
  data?: {
    id?: number;
    reference?: string;
    amount?: number;
    currency?: string;
    channel?: string;
    status?: string;
    paid_at?: string;
    fees?: number;
    customer?: { email?: string };
  };
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* WhatsApp (Meta Cloud API) webhook                                   */
/* ------------------------------------------------------------------ */
/*
 * Meta sends a GET during verification with:
 *   ?hub.mode=subscribe&hub.verify_token=<...>&hub.challenge=<...>
 * We look up the workspace by verify_token (there can be many —
 * one per connected number) and echo back the challenge.
 *
 * Ongoing POSTs carry messages and status updates. Envelope shape:
 * {
 *   object: 'whatsapp_business_account',
 *   entry: [{
 *     id: '<WABA_ID>',
 *     changes: [{
 *       field: 'messages',
 *       value: {
 *         messaging_product: 'whatsapp',
 *         metadata: { display_phone_number, phone_number_id },
 *         contacts: [{ profile: { name }, wa_id }],
 *         messages: [{ id, from, timestamp, type, text: { body } }] // or image/audio/etc
 *         statuses: [{ id, status, timestamp, recipient_id }]
 *       }
 *     }]
 *   }]
 * }
 */

http.route({
  path: "/webhook/whatsapp",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !token || !challenge) {
      return new Response("Bad request", { status: 400 });
    }
    // Look up any connection with this verify token — either the
    // workspace's own token or a global env fallback (multi-tenant).
    const envFallback = process.env.WHATSAPP_VERIFY_TOKEN;
    if (envFallback && token === envFallback) {
      return new Response(challenge, { status: 200 });
    }
    const matched = await ctx.runQuery(internal.whatsappInbound.findByVerifyToken, {
      verifyToken: token,
    });
    if (matched) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }),
});

http.route({
  path: "/webhook/whatsapp",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const rawBody = await req.text();

    // Verify Meta signature: header x-hub-signature-256: sha256=<hex>
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (appSecret) {
      const provided = req.headers.get("x-hub-signature-256");
      if (!provided || !provided.startsWith("sha256=")) {
        return new Response("Missing signature", { status: 401 });
      }
      const expected = await hmacSha256Hex(appSecret, rawBody);
      if (!timingSafeEqualStrings(provided.slice("sha256=".length), expected)) {
        return new Response("Invalid signature", { status: 401 });
      }
    }

    let payload: MetaWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as MetaWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Route each entry/change/message
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const route = await ctx.runQuery(
          internal.whatsapp.findWorkspaceByPhoneNumberId,
          { phoneNumberId },
        );
        if (!route) continue;

        // Statuses (delivered/read/failed)
        for (const s of value?.statuses ?? []) {
          const status = normalizeMetaStatus(s.status);
          if (!status) continue;
          const ts = Number(s.timestamp ?? 0) * 1000 || Date.now();
          await ctx.runMutation(internal.whatsapp.markStatusUpdate, {
            metaMessageId: s.id,
            status,
            failureReason: s.errors?.[0]?.message,
            timestamp: ts,
          });
        }

        // Inbound messages
        for (const m of value?.messages ?? []) {
          const from = m.from ? `+${m.from}` : "";
          const contactProfile = value?.contacts?.find((c) => c.wa_id === m.from);
          const receivedAt = Number(m.timestamp ?? 0) * 1000 || Date.now();

          const bodyText = extractInboundBody(m);
          const mediaMetaId =
            m.image?.id ?? m.video?.id ?? m.audio?.id ?? m.document?.id ?? undefined;

          await ctx.runMutation(internal.whatsapp.ingestInboundMessage, {
            workspaceId: route.workspaceId,
            connectionId: route.connectionId,
            fromPhone: from,
            fromName: contactProfile?.profile?.name,
            metaMessageId: m.id,
            messageType: m.type,
            bodyText,
            receivedAt,
            mediaMetaId,
            mediaFilename: m.document?.filename,
            mediaContentType: m.document?.mime_type ?? m.image?.mime_type ?? m.video?.mime_type,
            rawPayload: m,
          });
        }
      }
    }

    return new Response("ok", { status: 200 });
  }),
});

/* ------------------------------------------------------------------ */
/* Types + helpers for the WhatsApp webhook                            */
/* ------------------------------------------------------------------ */

interface MetaWebhookMessage {
  id: string;
  from?: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { text?: string; payload?: string };
  reaction?: { message_id?: string; emoji?: string };
  contacts?: Array<Record<string, unknown>>;
}

interface MetaWebhookStatus {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; message?: string; title?: string }>;
}

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: MetaWebhookValue }>;
  }>;
}

function extractInboundBody(m: MetaWebhookMessage): string {
  if (m.text?.body) return m.text.body;
  if (m.image?.caption) return `[image] ${m.image.caption}`;
  if (m.image) return `[image]`;
  if (m.video?.caption) return `[video] ${m.video.caption}`;
  if (m.video) return `[video]`;
  if (m.audio) return `[audio]`;
  if (m.document?.filename) return `[document] ${m.document.filename}`;
  if (m.document) return `[document]`;
  if (m.location) return `[location] ${m.location.name ?? m.location.address ?? ""}`;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  if (m.reaction?.emoji) return `[reaction] ${m.reaction.emoji}`;
  return `[${m.type}]`;
}

function normalizeMetaStatus(s: string | undefined): "sent" | "delivered" | "read" | "failed" | null {
  if (s === "sent" || s === "delivered" || s === "read" || s === "failed") return s;
  return null;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
