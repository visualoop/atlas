/**
 * Documents module (Phase 7a).
 *
 * Read:   listDocuments, getDocument, listLineItems, listSharesForDocument,
 *         getBySharedToken (public, no auth — used by /d/[token] page)
 * Write:  createDocument, updateDocument, archiveDocument,
 *         addLineItem, updateLineItem, removeLineItem,
 *         recomputeTotals, transitionStatus,
 *         createShareLink, revokeShareLink,
 *         recordPublicView (called from public page), recordPublicAcceptance
 *
 * All money is v.int64() cents. Line-item math is done in Convex so the
 * UI can't drift.
 *
 * Numbering: nextDocumentNumber generates a per-workspace + kind serial
 * like INV-2026-0042 or QUO-2026-0007. Uses the current year + count.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const DOC_KIND = v.union(
  v.literal("proposal"),
  v.literal("quote"),
  v.literal("invoice"),
  v.literal("contract"),
  v.literal("brief"),
  v.literal("statement_of_work"),
);

const DOC_STATUS = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("viewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("paid"),
  v.literal("partially_paid"),
  v.literal("overdue"),
  v.literal("cancelled"),
  v.literal("void"),
);

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listDocuments = query({
  args: {
    kind: v.optional(DOC_KIND),
    status: v.optional(DOC_STATUS),
    dealId: v.optional(v.id("deals")),
    companyId: v.optional(v.id("companies")),
    contactId: v.optional(v.id("contacts")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);

    if (args.search && args.search.trim().length >= 2) {
      const q = args.search.trim();
      let rows = await ctx.db
        .query("documents")
        .withSearchIndex("search_body", (b) => {
          let builder = b.search("bodyText", q).eq("workspaceId", wsCtx.workspace._id);
          if (args.kind) builder = builder.eq("kind", args.kind);
          return builder;
        })
        .take(limit);
      return rows.filter((r) => r.archivedAt === undefined);
    }

    let rows: Doc<"documents">[];
    if (args.dealId) {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace_deal", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("dealId", args.dealId),
        )
        .order("desc")
        .take(limit);
    } else if (args.companyId) {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace_company", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("companyId", args.companyId),
        )
        .order("desc")
        .take(limit);
    } else if (args.contactId) {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace_contact", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("contactId", args.contactId),
        )
        .order("desc")
        .take(limit);
    } else if (args.kind) {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace_kind", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("kind", args.kind!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    rows = rows.filter((r) => r.archivedAt === undefined);
    if (args.status) rows = rows.filter((r) => r.status === args.status);
    return rows;
  },
});

export const getDocument = query({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const doc = await ctx.db.get(id);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) return null;
    const [lineItems, contact, company, deal, shares] = await Promise.all([
      ctx.db
        .query("documentLineItems")
        .withIndex("by_document_order", (q) => q.eq("documentId", id))
        .collect(),
      doc.contactId ? ctx.db.get(doc.contactId) : Promise.resolve(null),
      doc.companyId ? ctx.db.get(doc.companyId) : Promise.resolve(null),
      doc.dealId ? ctx.db.get(doc.dealId) : Promise.resolve(null),
      ctx.db
        .query("documentShares")
        .withIndex("by_document", (q) => q.eq("documentId", id))
        .collect(),
    ]);
    return {
      doc,
      lineItems: lineItems.sort((a, b) => a.order - b.order),
      contact,
      company,
      deal,
      shares: shares.filter((s) => s.revokedAt === undefined),
    };
  },
});

/* ============================================================ */
/* Public share — no auth required                                */
/* ============================================================ */

export const getBySharedToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const share = await ctx.db
      .query("documentShares")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!share || share.revokedAt !== undefined) return null;
    if (share.expiresAt && share.expiresAt < Date.now()) return null;
    const doc = await ctx.db.get(share.documentId);
    if (!doc || doc.archivedAt !== undefined) return null;
    const [lineItems, company, contact, paymentReqs] = await Promise.all([
      ctx.db
        .query("documentLineItems")
        .withIndex("by_document_order", (q) => q.eq("documentId", doc._id))
        .collect(),
      doc.companyId ? ctx.db.get(doc.companyId) : Promise.resolve(null),
      doc.contactId ? ctx.db.get(doc.contactId) : Promise.resolve(null),
      ctx.db
        .query("paymentRequests")
        .withIndex("by_workspace_document", (q) =>
          q.eq("workspaceId", doc.workspaceId).eq("documentId", doc._id),
        )
        .collect(),
    ]);
    // Pick the most recent active payment link (if any)
    const activePayment = paymentReqs
      .filter((p) => p.authorizationUrl && p.status !== "success" && p.status !== "cancelled")
      .sort((a, b) => b._creationTime - a._creationTime)[0];
    return {
      doc,
      share,
      lineItems: lineItems.sort((a, b) => a.order - b.order),
      // Company + contact display info only (not the full row)
      companyName: company?.name,
      contactName: contact ? `${contact.firstName}${contact.lastName ? " " + contact.lastName : ""}` : undefined,
      paymentLink: activePayment?.authorizationUrl ?? null,
      paidAny: paymentReqs.some((p) => p.status === "success"),
    };
  },
});

/* ============================================================ */
/* Create + update                                               */
/* ============================================================ */

export const createDocument = mutation({
  args: {
    kind: DOC_KIND,
    title: v.string(),
    body: v.optional(v.any()),
    currency: v.optional(v.string()),
    dealId: v.optional(v.id("deals")),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    templateId: v.optional(v.id("documentTemplates")),
    taxRate: v.optional(v.number()),
    taxLabel: v.optional(v.string()),
    validUntil: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    footerNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });

    // If templateId provided, load it and merge defaults
    let body = args.body ?? { type: "doc", content: [] };
    let bodyText = "";
    if (args.templateId) {
      const tpl = await ctx.db.get(args.templateId);
      if (tpl && tpl.workspaceId === wsCtx.workspace._id) {
        body = args.body ?? tpl.body;
      }
    }
    bodyText = extractBodyText(body);

    const number = await nextDocumentNumber(ctx, wsCtx.workspace._id, args.kind);

    const id = await ctx.db.insert("documents", {
      workspaceId: wsCtx.workspace._id,
      kind: args.kind,
      number,
      title: args.title,
      status: "draft",
      body,
      bodyText,
      currency: args.currency ?? "KES",
      subtotalCents: 0n,
      taxCents: 0n,
      discountCents: 0n,
      totalCents: 0n,
      taxRate: args.taxRate ?? (args.kind === "invoice" ? 0.16 : undefined),
      taxLabel: args.taxLabel ?? (args.kind === "invoice" ? "VAT" : undefined),
      dealId: args.dealId,
      contactId: args.contactId,
      companyId: args.companyId,
      templateId: args.templateId,
      ownerId: wsCtx.user._id,
      issueDate: Date.now(),
      dueDate: args.dueDate,
      validUntil: args.validUntil,
      footerNote: args.footerNote,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "document",
      resourceId: id,
      after: { kind: args.kind, number, title: args.title },
    });
    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "document_created",
      actorId: wsCtx.user._id,
      subjectType: args.dealId ? "deal" : args.contactId ? "contact" : args.companyId ? "company" : "document",
      subjectId: (args.dealId as string) ?? (args.contactId as string) ?? (args.companyId as string) ?? id,
      relatedRefs: { documentId: id },
      payload: { kind: args.kind, number, title: args.title },
    });
    return id;
  },
});

export const updateDocument = mutation({
  args: {
    id: v.id("documents"),
    patch: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.any()),
      currency: v.optional(v.string()),
      taxRate: v.optional(v.number()),
      taxLabel: v.optional(v.string()),
      validUntil: v.optional(v.number()),
      dueDate: v.optional(v.number()),
      issueDate: v.optional(v.number()),
      etimsReference: v.optional(v.string()),
      mpesaPaybill: v.optional(v.string()),
      mpesaTill: v.optional(v.string()),
      mpesaAccountRef: v.optional(v.string()),
      footerNote: v.optional(v.string()),
      dealId: v.optional(v.id("deals")),
      contactId: v.optional(v.id("contacts")),
      companyId: v.optional(v.id("companies")),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const patch: Partial<Doc<"documents">> = { ...args.patch };
    if (args.patch.body) patch.bodyText = extractBodyText(args.patch.body);
    await ctx.db.patch(args.id, patch);
    // If tax rate changed, recompute totals
    if (typeof args.patch.taxRate === "number") {
      await recomputeTotalsInner(ctx, args.id);
    }
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "document",
      resourceId: args.id,
      after: args.patch,
    });
  },
});

export const archiveDocument = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(id);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "document",
      resourceId: id,
    });
  },
});

export const transitionStatus = mutation({
  args: {
    id: v.id("documents"),
    status: DOC_STATUS,
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const patch: Partial<Doc<"documents">> = { status: args.status };
    const now = Date.now();
    if (args.status === "sent" && !doc.sentAt) patch.sentAt = now;
    if (args.status === "accepted" && !doc.acceptedAt) patch.acceptedAt = now;
    await ctx.db.patch(args.id, patch);
    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: `document_${args.status}`,
      actorId: wsCtx.user._id,
      subjectType: doc.dealId ? "deal" : doc.contactId ? "contact" : "document",
      subjectId: (doc.dealId as string) ?? (doc.contactId as string) ?? args.id,
      relatedRefs: { documentId: args.id },
      payload: { kind: doc.kind, number: doc.number, status: args.status },
    });
  },
});

/* ============================================================ */
/* Line items                                                    */
/* ============================================================ */

export const addLineItem = mutation({
  args: {
    documentId: v.id("documents"),
    description: v.string(),
    quantity: v.number(),
    unit: v.optional(v.string()),
    unitPriceCents: v.int64(),
    discountCents: v.optional(v.int64()),
    taxable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const existing = await ctx.db
      .query("documentLineItems")
      .withIndex("by_document_order", (q) => q.eq("documentId", args.documentId))
      .collect();
    const maxOrder = existing.reduce((m, li) => Math.max(m, li.order), -1);
    const discount = args.discountCents ?? 0n;
    const qtyCents = BigInt(Math.round(args.quantity * 10000));
    // qty * unitPrice, scaled down: (qtyCents / 10000) * unitPrice, in cents
    const rawLine = (qtyCents * args.unitPriceCents) / 10000n;
    const lineTotal = rawLine - discount;

    const id = await ctx.db.insert("documentLineItems", {
      workspaceId: wsCtx.workspace._id,
      documentId: args.documentId,
      order: maxOrder + 1,
      description: args.description,
      quantity: args.quantity,
      unit: args.unit,
      unitPriceCents: args.unitPriceCents,
      discountCents: discount,
      taxable: args.taxable ?? true,
      lineTotalCents: lineTotal,
    });
    await recomputeTotalsInner(ctx, args.documentId);
    return id;
  },
});

export const updateLineItem = mutation({
  args: {
    id: v.id("documentLineItems"),
    patch: v.object({
      description: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unit: v.optional(v.string()),
      unitPriceCents: v.optional(v.int64()),
      discountCents: v.optional(v.int64()),
      taxable: v.optional(v.boolean()),
      order: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const li = await ctx.db.get(args.id);
    if (!li || li.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Line item not found." });
    }
    const quantity = args.patch.quantity ?? li.quantity;
    const unitPrice = args.patch.unitPriceCents ?? li.unitPriceCents;
    const discount = args.patch.discountCents ?? li.discountCents;
    const qtyCents = BigInt(Math.round(quantity * 10000));
    const rawLine = (qtyCents * unitPrice) / 10000n;
    const lineTotal = rawLine - discount;

    await ctx.db.patch(args.id, {
      ...args.patch,
      lineTotalCents: lineTotal,
    });
    await recomputeTotalsInner(ctx, li.documentId);
  },
});

export const removeLineItem = mutation({
  args: { id: v.id("documentLineItems") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const li = await ctx.db.get(id);
    if (!li || li.workspaceId !== wsCtx.workspace._id) return;
    const documentId = li.documentId;
    await ctx.db.delete(id);
    await recomputeTotalsInner(ctx, documentId);
  },
});

/* ============================================================ */
/* Share links                                                    */
/* ============================================================ */

export const createShareLink = mutation({
  args: {
    documentId: v.id("documents"),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const token = randomToken(32);
    const id = await ctx.db.insert("documentShares", {
      workspaceId: wsCtx.workspace._id,
      documentId: args.documentId,
      token,
      createdBy: wsCtx.user._id,
      accessCount: 0,
      expiresAt: args.expiresAt,
    });
    return { id, token };
  },
});

export const revokeShareLink = mutation({
  args: { id: v.id("documentShares") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const share = await ctx.db.get(id);
    if (!share || share.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

/**
 * Called by the /d/[token] page load — no workspace context.
 * Updates access count + last-view timestamp + transitions document to
 * 'viewed' if still in draft/sent.
 */
export const recordPublicView = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const share = await ctx.db
      .query("documentShares")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!share || share.revokedAt !== undefined) return;
    if (share.expiresAt && share.expiresAt < Date.now()) return;
    await ctx.db.patch(share._id, {
      accessCount: share.accessCount + 1,
      lastAccessedAt: Date.now(),
    });
    const doc = await ctx.db.get(share.documentId);
    if (doc && (doc.status === "sent" || doc.status === "draft")) {
      await ctx.db.patch(share.documentId, {
        status: "viewed",
        viewedAt: doc.viewedAt ?? Date.now(),
      });
      await recordTimelineEvent(ctx, {
        workspaceId: doc.workspaceId,
        eventType: "document_viewed",
        subjectType: doc.dealId ? "deal" : doc.contactId ? "contact" : "document",
        subjectId: (doc.dealId as string) ?? (doc.contactId as string) ?? doc._id,
        relatedRefs: { documentId: doc._id, shareId: share._id },
        payload: { kind: doc.kind, number: doc.number },
      });
    }
  },
});

/**
 * Recipient clicks Accept (or signs) via the public link.
 */
export const recordPublicAcceptance = mutation({
  args: {
    token: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    signatureData: v.optional(v.string()),                  // base64 PNG
  },
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query("documentShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!share || share.revokedAt !== undefined) {
      throw new ConvexError({ code: "INVALID", message: "Share link not valid." });
    }
    if (share.acceptedAt) return;
    const now = Date.now();
    await ctx.db.patch(share._id, {
      acceptedAt: now,
      acceptedByEmail: args.email.trim().toLowerCase(),
      acceptedByName: args.name?.trim(),
      acceptedSignatureData: args.signatureData,
    });
    const doc = await ctx.db.get(share.documentId);
    if (doc) {
      await ctx.db.patch(share.documentId, {
        status: "accepted",
        acceptedAt: now,
      });
      await recordTimelineEvent(ctx, {
        workspaceId: doc.workspaceId,
        eventType: "document_accepted",
        subjectType: doc.dealId ? "deal" : doc.contactId ? "contact" : "document",
        subjectId: (doc.dealId as string) ?? (doc.contactId as string) ?? doc._id,
        relatedRefs: { documentId: doc._id, shareId: share._id },
        payload: {
          kind: doc.kind,
          number: doc.number,
          acceptedByEmail: args.email,
          acceptedByName: args.name,
        },
      });
    }
  },
});

/* ============================================================ */
/* Helpers                                                       */
/* ============================================================ */

async function recomputeTotalsInner(ctx: MutationCtx, documentId: Id<"documents">) {
  const doc = await ctx.db.get(documentId);
  if (!doc) return;
  const items = await ctx.db
    .query("documentLineItems")
    .withIndex("by_document_order", (q) => q.eq("documentId", documentId))
    .collect();
  let subtotal = 0n;
  let taxableBase = 0n;
  let discount = 0n;
  for (const it of items) {
    subtotal += it.lineTotalCents;
    discount += it.discountCents;
    if (it.taxable) taxableBase += it.lineTotalCents;
  }
  const rate = doc.taxRate ?? 0;
  // tax = round(taxableBase * rate). To avoid float drift, use rate * 10000.
  const rateBps = BigInt(Math.round(rate * 10000));
  const tax = (taxableBase * rateBps) / 10000n;
  const total = subtotal + tax;
  await ctx.db.patch(documentId, {
    subtotalCents: subtotal,
    taxCents: tax,
    discountCents: discount,
    totalCents: total,
  });
}

export const recomputeTotals = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    await recomputeTotalsInner(ctx, args.documentId);
  },
});

async function nextDocumentNumber(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  kind: Doc<"documents">["kind"],
): Promise<string> {
  const prefix = KIND_PREFIX[kind];
  const year = new Date().getFullYear();
  const existing = await ctx.db
    .query("documents")
    .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", kind))
    .collect();
  const thisYearCount = existing.filter((d) => d.number?.includes(`-${year}-`)).length;
  const seq = String(thisYearCount + 1).padStart(4, "0");
  return `${prefix}-${year}-${seq}`;
}

const KIND_PREFIX: Record<Doc<"documents">["kind"], string> = {
  proposal: "PROP",
  quote: "QUO",
  invoice: "INV",
  contract: "CON",
  brief: "BRIEF",
  statement_of_work: "SOW",
};

function extractBodyText(body: unknown): string {
  // Walk TipTap JSON collecting text nodes.
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") chunks.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(body);
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function randomToken(len: number): string {
  // URL-safe alphabet
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}


/* ------------------------------------------------------------------ */
/* listDocumentsPaginated                                                */
/* ------------------------------------------------------------------ */

import { paginationOptsValidator } from "convex/server";

const DOC_KIND_UNION = v.union(
  v.literal("proposal"),
  v.literal("quote"),
  v.literal("invoice"),
  v.literal("contract"),
  v.literal("brief"),
  v.literal("statement_of_work"),
);

export const listDocumentsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    kind: v.optional(DOC_KIND_UNION),
    status: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;

    let cursorQuery;
    if (args.kind) {
      cursorQuery = ctx.db
        .query("documents")
        .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", wsId).eq("kind", args.kind!))
        .order("desc");
    } else {
      cursorQuery = ctx.db
        .query("documents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .order("desc");
    }

    const result = await cursorQuery.paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.filter(
        (d) =>
          (args.includeArchived || d.archivedAt === undefined) &&
          (!args.status || d.status === args.status),
      ),
    };
  },
});
