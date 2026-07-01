"use node";

/**
 * Document PDF renderer.
 *
 * Uses @react-pdf/renderer to turn a document (with its line items,
 * workspace details, contact/company, tax, mpesa refs) into a nicely
 * typeset A4 PDF. Stores the resulting blob in Convex storage and
 * updates document.pdfStorageId + pdfRenderedAt.
 *
 * Trigger points:
 *   - documents.transitionStatus('sent') automatically re-renders.
 *   - The document editor sidebar has a "Render PDF" button that
 *     invokes this action directly.
 */

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import React from "react";

interface RenderContext {
  workspaceName: string;
  workspaceLogoUrl?: string;
  document: {
    kind: string;
    number?: string;
    title: string;
    issueDate?: number;
    dueDate?: number;
    validUntil?: number;
    currency: string;
    subtotalCents: string;
    taxCents: string;
    discountCents: string;
    totalCents: string;
    taxRate?: number;
    taxLabel?: string;
    etimsReference?: string;
    mpesaPaybill?: string;
    mpesaTill?: string;
    mpesaAccountRef?: string;
    bodyText: string;
    footerNote?: string;
  };
  lineItems: Array<{
    label: string;
    description?: string;
    quantity: number;
    unitPriceCents: string;
    lineTotalCents: string;
  }>;
  recipient?: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    companyName?: string;
  };
}

/* User-invokable render */
export const renderDocumentPdf = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage"> }> => {
    return await runRender(ctx, args.documentId);
  },
});

/* Internal — called after status transitions to 'sent' */
export const renderDocumentPdfInternal = internalAction({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage"> }> => {
    return await runRender(ctx, args.documentId);
  },
});

async function runRender(
  ctx: { runQuery: Function; runMutation: Function; storage: { store: (blob: Blob) => Promise<Id<"_storage">> } },
  documentId: Id<"documents">,
): Promise<{ storageId: Id<"_storage"> }> {
  const context: RenderContext = await ctx.runQuery(
    internal.documentsActionsHelpers.gatherPdfContext,
    { documentId },
  );

  const element = React.createElement(DocumentPdf, { ctx: context });
  // @react-pdf's DocumentProps type expects Document as root; our element
  // wraps it internally, so the cast is safe.
  const pdfBuffer: Buffer = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
  const storageId = await ctx.storage.store(blob);

  await ctx.runMutation(internal.documentsActionsHelpers.savePdfRef, {
    documentId,
    storageId,
  });
  return { storageId };
}

/* ============================================================ */
/* PDF template                                                  */
/* ============================================================ */

const styles = StyleSheet.create({
  page: {
    fontSize: 10,
    fontFamily: "Helvetica",
    padding: 40,
    color: "#0A0A0B",
    backgroundColor: "#FDFDFB",
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  eyebrow: { fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: "#666" },
  title: { fontSize: 22, marginTop: 4, fontFamily: "Times-Roman" },
  number: { fontSize: 10, color: "#666", marginTop: 2 },
  meta: { fontSize: 8, color: "#666" },
  section: { marginBottom: 20 },
  h2: { fontSize: 8, color: "#666", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 },
  recipientName: { fontSize: 11, marginBottom: 2 },
  recipientLine: { fontSize: 9, color: "#444" },
  bodyText: { fontSize: 10, lineHeight: 1.5, marginBottom: 12, color: "#333" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#DDD", paddingVertical: 6 },
  headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#0A0A0B", paddingBottom: 4, marginBottom: 2 },
  colDesc: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1.2, textAlign: "right" },
  colTotal: { flex: 1.4, textAlign: "right" },
  th: { fontSize: 8, textTransform: "uppercase", letterSpacing: 1.2, color: "#666" },
  td: { fontSize: 10 },
  totalsBox: { alignSelf: "flex-end", width: 240, marginTop: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: "#666", fontSize: 10 },
  totalValue: { fontSize: 10 },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, borderTopWidth: 1, borderTopColor: "#0A0A0B" },
  grandTotalLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "#0A0A0B" },
  grandTotalValue: { fontSize: 14, fontFamily: "Times-Roman" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: "#DDD", paddingTop: 8 },
  footerText: { fontSize: 8, color: "#888", textAlign: "center" },
  payBox: { marginTop: 16, borderWidth: 0.5, borderColor: "#0A0A0B", padding: 10 },
});

function fmt(cents: string, currency: string): string {
  const bi = BigInt(cents);
  const major = bi / 100n;
  const minor = (bi % 100n).toString().padStart(2, "0");
  return `${currency} ${major.toLocaleString()}.${minor}`;
}

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

const DocumentPdf = ({ ctx }: { ctx: RenderContext }) => {
  const d = ctx.document;
  const kindLabel = d.kind.replace(/_/g, " ");
  return React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      // Header
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(
          View,
          {},
          React.createElement(Text, { style: styles.eyebrow }, kindLabel),
          React.createElement(Text, { style: styles.title }, d.title),
          d.number ? React.createElement(Text, { style: styles.number }, `${d.number}`) : null,
        ),
        React.createElement(
          View,
          { style: { alignItems: "flex-end" } },
          React.createElement(Text, { style: styles.eyebrow }, "From"),
          React.createElement(Text, { style: styles.recipientName }, ctx.workspaceName),
          React.createElement(Text, { style: styles.meta }, `Issued: ${fmtDate(d.issueDate)}`),
          d.dueDate ? React.createElement(Text, { style: styles.meta }, `Due: ${fmtDate(d.dueDate)}`) : null,
          d.validUntil ? React.createElement(Text, { style: styles.meta }, `Valid until: ${fmtDate(d.validUntil)}`) : null,
        ),
      ),
      // Recipient
      ctx.recipient
        ? React.createElement(
            View,
            { style: styles.section },
            React.createElement(Text, { style: styles.h2 }, "For"),
            React.createElement(Text, { style: styles.recipientName }, ctx.recipient.companyName ?? ctx.recipient.name),
            ctx.recipient.companyName
              ? React.createElement(Text, { style: styles.recipientLine }, `Attn: ${ctx.recipient.name}`)
              : null,
            ctx.recipient.email
              ? React.createElement(Text, { style: styles.recipientLine }, ctx.recipient.email)
              : null,
            ctx.recipient.phone
              ? React.createElement(Text, { style: styles.recipientLine }, ctx.recipient.phone)
              : null,
            ctx.recipient.address
              ? React.createElement(Text, { style: styles.recipientLine }, ctx.recipient.address)
              : null,
          )
        : null,
      // Body text
      d.bodyText && d.bodyText.trim().length > 0
        ? React.createElement(
            View,
            { style: styles.section },
            React.createElement(Text, { style: styles.bodyText }, d.bodyText),
          )
        : null,
      // Line items
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.h2 }, "Items"),
        React.createElement(
          View,
          { style: styles.headerRow },
          React.createElement(Text, { style: [styles.th, styles.colDesc] }, "Description"),
          React.createElement(Text, { style: [styles.th, styles.colQty] }, "Qty"),
          React.createElement(Text, { style: [styles.th, styles.colPrice] }, "Price"),
          React.createElement(Text, { style: [styles.th, styles.colTotal] }, "Total"),
        ),
        ...ctx.lineItems.map((li, i) =>
          React.createElement(
            View,
            { style: styles.row, key: `li-${i}` },
            React.createElement(
              View,
              { style: styles.colDesc },
              React.createElement(Text, { style: styles.td }, li.label),
              li.description
                ? React.createElement(Text, { style: { fontSize: 8, color: "#666" } }, li.description)
                : null,
            ),
            React.createElement(Text, { style: [styles.td, styles.colQty] }, li.quantity.toString()),
            React.createElement(Text, { style: [styles.td, styles.colPrice] }, fmt(li.unitPriceCents, d.currency)),
            React.createElement(Text, { style: [styles.td, styles.colTotal] }, fmt(li.lineTotalCents, d.currency)),
          ),
        ),
      ),
      // Totals
      React.createElement(
        View,
        { style: styles.totalsBox },
        React.createElement(
          View,
          { style: styles.totalRow },
          React.createElement(Text, { style: styles.totalLabel }, "Subtotal"),
          React.createElement(Text, { style: styles.totalValue }, fmt(d.subtotalCents, d.currency)),
        ),
        BigInt(d.discountCents) > 0n
          ? React.createElement(
              View,
              { style: styles.totalRow },
              React.createElement(Text, { style: styles.totalLabel }, "Discount"),
              React.createElement(Text, { style: styles.totalValue }, `-${fmt(d.discountCents, d.currency)}`),
            )
          : null,
        BigInt(d.taxCents) > 0n
          ? React.createElement(
              View,
              { style: styles.totalRow },
              React.createElement(
                Text,
                { style: styles.totalLabel },
                `${d.taxLabel ?? "Tax"}${d.taxRate ? ` (${Math.round(d.taxRate * 100)}%)` : ""}`,
              ),
              React.createElement(Text, { style: styles.totalValue }, fmt(d.taxCents, d.currency)),
            )
          : null,
        React.createElement(
          View,
          { style: styles.grandTotalRow },
          React.createElement(Text, { style: styles.grandTotalLabel }, "Total"),
          React.createElement(Text, { style: styles.grandTotalValue }, fmt(d.totalCents, d.currency)),
        ),
      ),
      // M-PESA + eTIMS info if invoice
      d.kind === "invoice" && (d.mpesaPaybill || d.mpesaTill || d.etimsReference)
        ? React.createElement(
            View,
            { style: styles.payBox },
            React.createElement(Text, { style: styles.h2 }, "Payment"),
            d.mpesaPaybill
              ? React.createElement(
                  Text,
                  { style: styles.recipientLine },
                  `M-PESA Paybill: ${d.mpesaPaybill}${d.mpesaAccountRef ? `  ·  Account: ${d.mpesaAccountRef}` : ""}`,
                )
              : null,
            d.mpesaTill
              ? React.createElement(Text, { style: styles.recipientLine }, `M-PESA Till: ${d.mpesaTill}`)
              : null,
            d.etimsReference
              ? React.createElement(Text, { style: styles.recipientLine }, `KRA eTIMS: ${d.etimsReference}`)
              : null,
          )
        : null,
      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(
          Text,
          { style: styles.footerText },
          d.footerNote ?? `Generated by Atlas · ${ctx.workspaceName}`,
        ),
      ),
    ),
  );
};
