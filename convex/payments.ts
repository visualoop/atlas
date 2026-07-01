/**
 * Payments module (Phase 7b) — Paystack full-stack integration.
 *
 * Read:   listPaymentRequests, getPaymentRequest,
 *         listPaymentRequestsForDocument, listTransfers
 * Write:  createPaymentRequest (queries only — action does the API call),
 *         cancelPaymentRequest, markManuallyPaid
 * Internal:
 *         upsertPaymentRequestFromInit — called by paymentsActions.initialize
 *         applyChargeSuccess — called by webhook when Paystack confirms payment
 *         recordWebhookEvent — dedupe + audit trail
 *
 * Convention: `reference` is unique per workspace. We prefix with workspace id
 * so cross-workspace collisions are impossible: `ws_<shortId>-<random>`.
 *
 * Multi-tenancy: the webhook payload doesn't carry workspace context, so we
 * discover the workspace by looking up the reference OR the customer email
 * (falling back to sender-identity match, similar to email inbound).
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listPaymentRequests = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("initialized"),
        v.literal("pending"),
        v.literal("success"),
        v.literal("failed"),
        v.literal("abandoned"),
        v.literal("cancelled"),
      ),
    ),
    documentId: v.optional(v.id("documents")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"paymentRequests">[];
    if (args.documentId) {
      rows = await ctx.db
        .query("paymentRequests")
        .withIndex("by_workspace_document", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("documentId", args.documentId),
        )
        .order("desc")
        .take(limit);
    } else if (args.status) {
      rows = await ctx.db
        .query("paymentRequests")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("paymentRequests")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows;
  },
});

export const getPaymentRequest = query({
  args: { id: v.id("paymentRequests") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const r = await ctx.db.get(id);
    if (!r || r.workspaceId !== wsCtx.workspace._id) return null;
    return r;
  },
});

export const listPaymentRequestsForDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    return await ctx.db
      .query("paymentRequests")
      .withIndex("by_workspace_document", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("documentId", documentId),
      )
      .order("desc")
      .collect();
  },
});

export const listTransfers = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    const rows = await ctx.db
      .query("paystackTransfers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .order("desc")
      .take(limit);
    if (args.status) return rows.filter((r) => r.status === args.status);
    return rows;
  },
});

/* ============================================================ */
/* Mutations                                                     */
/* ============================================================ */

/**
 * Marks a payment request as manually paid (M-PESA STK, bank transfer
 * confirmed offline, cash). Flips linked invoice to 'paid' and emits
 * a payment_received timeline event.
 */
export const markManuallyPaid = mutation({
  args: {
    id: v.id("paymentRequests"),
    channel: v.optional(v.string()),                          // 'mpesa_manual' | 'bank' | 'cash'
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const pr = await ctx.db.get(args.id);
    if (!pr || pr.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Payment request not found." });
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "success",
      channel: args.channel ?? "manual",
      paidAt: now,
    });
    if (pr.documentId) {
      const doc = await ctx.db.get(pr.documentId);
      if (doc && doc.status !== "paid") {
        await ctx.db.patch(pr.documentId, { status: "paid" });
      }
    }
    await recordAudit(ctx, {
      organizationId: pr.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "payment_request",
      resourceId: args.id,
      reason: "manual_payment_confirmation",
      after: { status: "success", channel: args.channel, note: args.note },
    });
    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "payment_received",
      actorId: wsCtx.user._id,
      subjectType: pr.dealId ? "deal" : pr.contactId ? "contact" : "document",
      subjectId: (pr.dealId as string) ?? (pr.contactId as string) ?? (pr.documentId as string) ?? args.id,
      relatedRefs: { paymentRequestId: args.id, documentId: pr.documentId },
      payload: {
        amountCents: pr.amountCents.toString(),
        currency: pr.currency,
        channel: args.channel ?? "manual",
        note: args.note,
      },
    });
  },
});

export const cancelPaymentRequest = mutation({
  args: { id: v.id("paymentRequests") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const pr = await ctx.db.get(id);
    if (!pr || pr.workspaceId !== wsCtx.workspace._id) return;
    if (pr.status === "success") {
      throw new ConvexError({ code: "ALREADY_PAID", message: "Payment already succeeded." });
    }
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

/* ============================================================ */
/* Internal — used by the action + webhook                        */
/* ============================================================ */

export const upsertPaymentRequestFromInit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    reference: v.string(),
    amountCents: v.int64(),
    currency: v.string(),
    description: v.string(),
    documentId: v.optional(v.id("documents")),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    accessCode: v.optional(v.string()),
    authorizationUrl: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paymentRequests")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        accessCode: args.accessCode,
        authorizationUrl: args.authorizationUrl,
        status: "pending",
      });
      return existing._id;
    }
    const id = await ctx.db.insert("paymentRequests", {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      reference: args.reference,
      amountCents: args.amountCents,
      currency: args.currency,
      description: args.description,
      documentId: args.documentId,
      contactId: args.contactId,
      dealId: args.dealId,
      accessCode: args.accessCode,
      authorizationUrl: args.authorizationUrl,
      status: "initialized",
      createdBy: args.createdBy,
    });
    return id;
  },
});

/**
 * Called by the webhook when Paystack sends charge.success. Marks
 * the payment request as paid + flips linked invoice + emits
 * timeline event.
 */
export const applyChargeSuccess = internalMutation({
  args: {
    reference: v.string(),
    externalId: v.optional(v.string()),
    amountCents: v.int64(),
    currency: v.string(),
    channel: v.optional(v.string()),
    feeCents: v.optional(v.int64()),
    paidAt: v.number(),
    verifiedPayload: v.any(),
  },
  handler: async (ctx, args) => {
    const pr = await ctx.db
      .query("paymentRequests")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .first();
    if (!pr) return { applied: false, reason: "no_matching_request" as const };
    if (pr.status === "success") return { applied: false, reason: "already_paid" as const };

    await ctx.db.patch(pr._id, {
      status: "success",
      channel: args.channel,
      paidAt: args.paidAt,
      feeCents: args.feeCents,
      verifiedPayload: args.verifiedPayload,
    });

    if (pr.documentId) {
      const doc = await ctx.db.get(pr.documentId);
      if (doc && doc.status !== "paid") {
        await ctx.db.patch(pr.documentId, { status: "paid" });
      }
    }

    await recordTimelineEvent(ctx, {
      workspaceId: pr.workspaceId,
      eventType: "payment_received",
      subjectType: pr.dealId ? "deal" : pr.contactId ? "contact" : "document",
      subjectId: (pr.dealId as string) ?? (pr.contactId as string) ?? (pr.documentId as string) ?? pr._id,
      relatedRefs: { paymentRequestId: pr._id, documentId: pr.documentId },
      payload: {
        amountCents: args.amountCents.toString(),
        currency: args.currency,
        channel: args.channel,
        reference: args.reference,
      },
    });

    return { applied: true as const, paymentRequestId: pr._id, workspaceId: pr.workspaceId };
  },
});

export const findPaymentRequestByReference = internalQuery({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    return await ctx.db
      .query("paymentRequests")
      .withIndex("by_reference", (q) => q.eq("reference", reference))
      .first();
  },
});

export const recordPaystackWebhook = internalMutation({
  args: {
    reference: v.string(),
    event: v.string(),
    externalId: v.optional(v.string()),
    amountCents: v.optional(v.int64()),
    currency: v.optional(v.string()),
    channel: v.optional(v.string()),
    status: v.optional(v.string()),
    payload: v.any(),
    workspaceId: v.optional(v.id("workspaces")),
    organizationId: v.optional(v.id("organizations")),
    processed: v.boolean(),
    processingError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("paystackTransactions", {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      reference: args.reference,
      event: args.event,
      externalId: args.externalId,
      amountCents: args.amountCents,
      currency: args.currency,
      channel: args.channel,
      status: args.status,
      payload: args.payload,
      receivedAt: Date.now(),
      processed: args.processed,
      processingError: args.processingError,
    });
  },
});

export const findDuplicateWebhook = internalQuery({
  args: { reference: v.string(), event: v.string(), externalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.externalId) return null;
    // Same event + external id already processed = dedupe
    const rows = await ctx.db
      .query("paystackTransactions")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .collect();
    return rows.find(
      (r) => r.event === args.event && r.externalId === args.externalId && r.processed,
    ) ?? null;
  },
});

/**
 * Helper: given a payment request id, return workspace + org context
 * for the initializing action.
 */
export const prepareInit = internalQuery({
  args: {
    documentId: v.optional(v.id("documents")),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    // Resolve the doc if provided — needed to compute amount + email
    let doc: Doc<"documents"> | null = null;
    let contact: Doc<"contacts"> | null = null;
    if (args.documentId) {
      doc = await ctx.db.get(args.documentId);
      if (doc && doc.workspaceId !== wsCtx.workspace._id) doc = null;
    }
    if (args.contactId) {
      contact = await ctx.db.get(args.contactId);
      if (contact && contact.workspaceId !== wsCtx.workspace._id) contact = null;
    } else if (doc?.contactId) {
      contact = await ctx.db.get(doc.contactId);
    }
    return {
      workspaceId: wsCtx.workspace._id,
      organizationId: wsCtx.workspace.organizationId,
      userId: wsCtx.user._id,
      doc,
      contact,
    };
  },
});
