"use node";

/**
 * Paystack Node runtime actions (Phase 7b).
 *
 *   initializePayment — creates a Paystack transaction, returns
 *     { authorizationUrl, accessCode, reference } and persists a
 *     paymentRequests row so the webhook can correlate later.
 *   verifyTransaction — client-side callback after redirect. Not
 *     strictly needed if the webhook fires reliably, but lets the
 *     UI update faster.
 *   initiateTransfer — payouts to a Paystack recipient (bank or
 *     M-PESA).
 *
 * The org's Paystack secret key lives in orgIntegrationKeys under
 * provider='paystack' (Tier-1 encrypted).
 *
 * Kenyan constraint: M-PESA subscriptions can't auto-charge. The
 * subscription reminder loop in convex/crons.ts posts a reminder
 * template to WhatsApp N days before renewal.
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const PAYSTACK_BASE = "https://api.paystack.co";

interface PaystackErrorResp {
  status?: false;
  message?: string;
  error?: string;
}

async function callPaystack<T>(
  secretKey: string,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as PaystackErrorResp & { data?: T };
  if (!res.ok || json.status === false) {
    throw new Error(
      `Paystack ${res.status}: ${json.message ?? json.error ?? "unknown"}`,
    );
  }
  return json.data as T;
}

/* ------------------------------------------------------------------ */
/* Initialize                                                            */
/* ------------------------------------------------------------------ */

export const initializePayment = action({
  args: {
    documentId: v.optional(v.id("documents")),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    // Overrides — if not tied to a doc
    amountCents: v.optional(v.int64()),
    currency: v.optional(v.string()),
    description: v.optional(v.string()),
    email: v.optional(v.string()),
    callbackUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    reference: string;
    authorizationUrl: string;
    accessCode?: string;
    paymentRequestId: Id<"paymentRequests">;
  }> => {
    const setup = await ctx.runQuery(internal.payments.prepareInit, {
      documentId: args.documentId,
      contactId: args.contactId,
      dealId: args.dealId,
    });

    // Resolve amount + currency + email
    const amountCents = args.amountCents ?? setup.doc?.totalCents ?? 0n;
    const currency = args.currency ?? setup.doc?.currency ?? "KES";
    const email = args.email ?? setup.contact?.email ?? "";
    if (!email) {
      throw new ConvexError({
        code: "NO_EMAIL",
        message: "Payer email required. Attach a contact or pass 'email'.",
      });
    }
    if (amountCents <= 0n) {
      throw new ConvexError({ code: "INVALID_AMOUNT", message: "Amount must be > 0." });
    }
    const description = args.description
      ?? (setup.doc ? `${setup.doc.kind} ${setup.doc.number}` : "Payment");

    // Decrypt Paystack key
    const apiKey = await ctx.runQuery(internal.paymentsHelpers.getPaystackKey, {
      organizationId: setup.organizationId,
      actorId: setup.userId,
    });
    if (!apiKey) {
      throw new ConvexError({
        code: "NO_KEY",
        message: "Paystack is not configured for this organization.",
      });
    }

    // Reference: workspace-prefixed random
    const reference = `atlas_${shortId(setup.workspaceId)}_${randomId(12)}`;

    // Paystack amount is in kobo/cents (already in cents in our schema)
    const body: Record<string, unknown> = {
      email,
      amount: Number(amountCents),
      currency,
      reference,
      metadata: {
        workspaceId: setup.workspaceId,
        documentId: args.documentId,
        contactId: args.contactId,
        dealId: args.dealId,
        description,
      },
    };
    if (args.callbackUrl) body.callback_url = args.callbackUrl;

    interface InitResp {
      authorization_url: string;
      access_code: string;
      reference: string;
    }
    const data = await callPaystack<InitResp>(apiKey, "/transaction/initialize", "POST", body);

    const paymentRequestId: Id<"paymentRequests"> = await ctx.runMutation(
      internal.payments.upsertPaymentRequestFromInit,
      {
        workspaceId: setup.workspaceId,
        organizationId: setup.organizationId,
        reference,
        amountCents,
        currency,
        description,
        documentId: args.documentId,
        contactId: args.contactId ?? setup.contact?._id,
        dealId: args.dealId,
        accessCode: data.access_code,
        authorizationUrl: data.authorization_url,
        createdBy: setup.userId,
      },
    );

    return {
      reference,
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      paymentRequestId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Verify — client-side sanity check after callback                     */
/* ------------------------------------------------------------------ */

export const verifyTransaction = action({
  args: { reference: v.string() },
  handler: async (ctx, args): Promise<{
    status: string;
    paid: boolean;
    channel?: string;
  }> => {
    const pr = await ctx.runQuery(internal.payments.findPaymentRequestByReference, {
      reference: args.reference,
    });
    if (!pr) throw new ConvexError({ code: "NOT_FOUND", message: "Reference not found." });

    // Load key from org
    const apiKey = await ctx.runQuery(internal.paymentsHelpers.getPaystackKey, {
      organizationId: pr.organizationId,
    });
    if (!apiKey) {
      throw new ConvexError({ code: "NO_KEY", message: "Paystack not configured." });
    }

    interface VerifyResp {
      status: string;                      // 'success' | 'failed' | 'abandoned'
      reference: string;
      amount: number;
      currency: string;
      channel: string;
      paid_at?: string;
      fees?: number;
      id?: number;
    }
    const data = await callPaystack<VerifyResp>(
      apiKey,
      `/transaction/verify/${encodeURIComponent(args.reference)}`,
      "GET",
    );

    if (data.status === "success" && pr.status !== "success") {
      await ctx.runMutation(internal.payments.applyChargeSuccess, {
        reference: args.reference,
        externalId: data.id?.toString(),
        amountCents: BigInt(data.amount),
        currency: data.currency,
        channel: data.channel,
        feeCents: data.fees ? BigInt(data.fees) : undefined,
        paidAt: data.paid_at ? new Date(data.paid_at).getTime() : Date.now(),
        verifiedPayload: data,
      });
    }

    return {
      status: data.status,
      paid: data.status === "success",
      channel: data.channel,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Transfers — payout to bank / M-PESA                                  */
/* ------------------------------------------------------------------ */

export const initiateTransfer = action({
  args: {
    recipientCode: v.string(),                              // Paystack recipient RCP_xxx
    recipientLabel: v.string(),
    amountCents: v.int64(),
    currency: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: string; reference: string; transferId?: Id<"paystackTransfers"> }> => {
    const setup = await ctx.runQuery(internal.payments.prepareInit, {});
    const apiKey = await ctx.runQuery(internal.paymentsHelpers.getPaystackKey, {
      organizationId: setup.organizationId,
      actorId: setup.userId,
    });
    if (!apiKey) throw new ConvexError({ code: "NO_KEY", message: "Paystack not configured." });

    const reference = `atlas_xfer_${shortId(setup.workspaceId)}_${randomId(12)}`;
    interface TransferResp {
      status: string;
      reference: string;
      id?: number;
      failures?: string;
      message?: string;
    }

    let transferData: TransferResp;
    try {
      transferData = await callPaystack<TransferResp>(apiKey, "/transfer", "POST", {
        source: "balance",
        reason: args.reason,
        amount: Number(args.amountCents),
        currency: args.currency ?? "KES",
        recipient: args.recipientCode,
        reference,
      });
    } catch (err) {
      // Persist as failed
      const id = await ctx.runMutation(internal.paymentsHelpers.persistTransfer, {
        workspaceId: setup.workspaceId,
        organizationId: setup.organizationId,
        reference,
        recipientCode: args.recipientCode,
        recipientLabel: args.recipientLabel,
        amountCents: args.amountCents,
        currency: args.currency ?? "KES",
        reason: args.reason,
        status: "failed",
        failureReason: err instanceof Error ? err.message : "unknown",
        createdBy: setup.userId,
      });
      throw err;
    }

    const status = normalizeTransferStatus(transferData.status);
    const id = await ctx.runMutation(internal.paymentsHelpers.persistTransfer, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      reference,
      recipientCode: args.recipientCode,
      recipientLabel: args.recipientLabel,
      amountCents: args.amountCents,
      currency: args.currency ?? "KES",
      reason: args.reason,
      status,
      externalId: transferData.id?.toString(),
      createdBy: setup.userId,
    });
    return { status, reference, transferId: id };
  },
});

/* ------------------------------------------------------------------ */

function shortId(id: string): string {
  // Use last 8 chars of the workspace id for a compact prefix
  return id.slice(-8);
}

function randomId(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function normalizeTransferStatus(s: string | undefined):
  | "pending" | "processing" | "success" | "failed" | "reversed" | "otp_required" {
  switch (s) {
    case "success": return "success";
    case "failed": return "failed";
    case "reversed": return "reversed";
    case "otp": return "otp_required";
    case "pending": return "pending";
    default: return "processing";
  }
}
