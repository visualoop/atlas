"use client";

import { useState, useEffect, use } from "react";
import { useQuery, useMutation } from "convex/react";
import { Check, Loader2, Building2, User } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function PublicDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolved = use(params);
  const token = resolved.token;
  const data = useQuery(api.documents.getBySharedToken, { token });
  const recordView = useMutation(api.documents.recordPublicView);
  const recordAcceptance = useMutation(api.documents.recordPublicAcceptance);

  const [accepting, setAccepting] = useState(false);
  const [acceptName, setAcceptName] = useState("");
  const [acceptEmail, setAcceptEmail] = useState("");
  const [acceptOpen, setAcceptOpen] = useState(false);

  // Record view exactly once
  useEffect(() => {
    if (data) {
      recordView({ token }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null || data === undefined ? undefined : data.doc._id]);

  if (data === undefined) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen grid place-items-center text-center p-8">
        <div className="space-y-2">
          <p className="font-display italic text-3xl text-muted-foreground">Not available.</p>
          <p className="text-sm text-muted-foreground">
            This link has expired or been revoked.
          </p>
        </div>
      </div>
    );
  }

  const { doc, share, lineItems, companyName, contactName } = data;
  const already = share.acceptedAt !== undefined;

  async function submitAccept() {
    if (!acceptEmail.trim() || !acceptName.trim()) {
      toast.error("Enter your name and email.");
      return;
    }
    setAccepting(true);
    try {
      await recordAcceptance({
        token,
        email: acceptEmail.trim(),
        name: acceptName.trim(),
      });
      toast.success("Accepted. Thank you.");
      setAcceptOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 md:px-12 py-12 md:py-16">
        {/* Header */}
        <header className="space-y-2 mb-10 pb-6 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">
            {doc.kind.replace(/_/g, " ")} · {doc.number}
          </p>
          <h1 className="font-display italic text-4xl md:text-5xl tracking-tight leading-tight">
            {doc.title}
          </h1>
          <div className="pt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {companyName && (
              <span className="flex items-center gap-1">
                <Building2 className="size-3" /> {companyName}
              </span>
            )}
            {contactName && (
              <span className="flex items-center gap-1">
                <User className="size-3" /> {contactName}
              </span>
            )}
            {doc.issueDate && (
              <span className="font-mono num">
                Issued {new Date(doc.issueDate).toLocaleDateString("en-KE", {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </span>
            )}
            {doc.kind === "invoice" && doc.dueDate && (
              <span className="font-mono num text-[var(--warning)]">
                Due {new Date(doc.dueDate).toLocaleDateString("en-KE", {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </span>
            )}
            {doc.kind === "quote" && doc.validUntil && (
              <span className="font-mono num">
                Valid until {new Date(doc.validUntil).toLocaleDateString("en-KE", {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </span>
            )}
          </div>
        </header>

        {/* Body */}
        <article
          className="prose prose-neutral dark:prose-invert max-w-none mb-10"
          dangerouslySetInnerHTML={{ __html: renderBodyHtml(doc.body) }}
        />

        {/* Line items */}
        {lineItems.length > 0 && (
          <section className="mb-10 space-y-3">
            <table className="w-full text-sm border border-border">
              <thead>
                <tr className="border-b border-[var(--border-strong)] bg-[var(--surface)]/40">
                  <th className="eyebrow font-mono h-9 px-3 text-left text-muted-foreground">
                    Description
                  </th>
                  <th className="eyebrow font-mono h-9 px-3 text-right text-muted-foreground">
                    Qty
                  </th>
                  <th className="eyebrow font-mono h-9 px-3 text-right text-muted-foreground">
                    Unit
                  </th>
                  <th className="eyebrow font-mono h-9 px-3 text-right text-muted-foreground">
                    Line total
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((it) => (
                  <tr key={it._id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-3">{it.description}</td>
                    <td className="px-3 py-3 text-right font-mono num">
                      {it.quantity} {it.unit ? <span className="text-muted-foreground text-[10px]">{it.unit}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right font-mono num">
                      {formatCurrency(Number(it.unitPriceCents), doc.currency)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono num">
                      {formatCurrency(Number(it.lineTotalCents), doc.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono num">{formatCurrency(Number(doc.subtotalCents), doc.currency)}</span>
                </div>
                {doc.discountCents !== 0n && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="font-mono num">-{formatCurrency(Number(doc.discountCents), doc.currency)}</span>
                  </div>
                )}
                {doc.taxCents !== 0n && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{doc.taxLabel ?? "Tax"} ({((doc.taxRate ?? 0) * 100).toFixed(0)}%)</span>
                    <span className="font-mono num">{formatCurrency(Number(doc.taxCents), doc.currency)}</span>
                  </div>
                )}
                <div className="border-t border-[var(--border-strong)] pt-2 flex justify-between text-base font-medium">
                  <span>Total</span>
                  <span className="font-mono num">{formatCurrency(Number(doc.totalCents), doc.currency)}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Payment info for invoices */}
        {doc.kind === "invoice" && (doc.mpesaPaybill || doc.mpesaTill) && (
          <section className="mb-10 border border-border p-5 bg-[var(--surface)]/40">
            <p className="eyebrow font-mono text-muted-foreground mb-2">Payment</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {doc.mpesaPaybill && (
                <div>
                  <p className="text-muted-foreground text-xs">M-PESA Paybill</p>
                  <p className="font-mono num text-lg">{doc.mpesaPaybill}</p>
                </div>
              )}
              {doc.mpesaTill && (
                <div>
                  <p className="text-muted-foreground text-xs">M-PESA Till</p>
                  <p className="font-mono num text-lg">{doc.mpesaTill}</p>
                </div>
              )}
              {doc.mpesaAccountRef && (
                <div className="col-span-2">
                  <p className="text-muted-foreground text-xs">Account reference</p>
                  <p className="font-mono num">{doc.mpesaAccountRef}</p>
                </div>
              )}
            </div>
            {doc.etimsReference && (
              <p className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                eTIMS reference: <span className="font-mono">{doc.etimsReference}</span>
              </p>
            )}
          </section>
        )}

        {/* Footer note */}
        {doc.footerNote && (
          <section className="mb-10 border-t border-border pt-6">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {doc.footerNote}
            </p>
          </section>
        )}

        {/* Accept CTA */}
        {(doc.kind === "proposal" || doc.kind === "quote" || doc.kind === "contract") && (
          <section className="border-t border-border pt-6 flex items-center justify-between gap-4 flex-wrap">
            {already ? (
              <p className="text-sm text-[var(--success)] flex items-center gap-2">
                <Check className="size-4" />
                Accepted on {new Date(share.acceptedAt!).toLocaleDateString("en-KE", {
                  day: "numeric", month: "long", year: "numeric",
                })}
                {share.acceptedByName && ` by ${share.acceptedByName}`}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Ready to move forward? Click accept to confirm.
                </p>
                <button
                  onClick={() => setAcceptOpen(true)}
                  className="inline-flex items-center gap-2 h-10 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
                >
                  Accept {doc.kind}
                </button>
              </>
            )}
          </section>
        )}
      </div>

      {/* Accept dialog */}
      {acceptOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <div
            onClick={() => !accepting && setAcceptOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
          />
          <div className="relative pointer-events-auto bg-background border border-border w-full max-w-md shadow-2xl">
            <header className="px-6 pt-5 pb-3 border-b border-border">
              <p className="eyebrow font-mono text-muted-foreground">Accept</p>
              <h2 className="font-display italic text-2xl mt-1">Sign to <em>proceed</em>.</h2>
            </header>
            <div className="px-6 py-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Full name
                </span>
                <input
                  autoFocus
                  value={acceptName}
                  onChange={(e) => setAcceptName(e.target.value)}
                  placeholder="Your name"
                  className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Email
                </span>
                <input
                  type="email"
                  value={acceptEmail}
                  onChange={(e) => setAcceptEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                By clicking accept, you confirm the terms of this {doc.kind}. A record is
                logged with your name, email, and the current timestamp.
              </p>
            </div>
            <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
              <button
                onClick={() => !accepting && setAcceptOpen(false)}
                disabled={accepting}
                className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitAccept}
                disabled={accepting}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {accepting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Accept
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

function formatCurrency(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function renderBodyHtml(body: unknown): string {
  // Support two shapes:
  //   1. { type: 'doc', html: '<p>...' } — our simplified persist format
  //   2. TipTap standard JSON — walk the tree.
  if (body && typeof body === "object") {
    const b = body as { type?: string; html?: string; content?: unknown };
    if (b.type === "doc" && typeof b.html === "string") return b.html;
  }
  return tiptapToHtml(body);
}

function tiptapToHtml(body: unknown): string {
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { level?: number } };
    if (n.type === "paragraph") {
      chunks.push("<p>");
      n.content?.forEach(walk);
      chunks.push("</p>");
      return;
    }
    if (n.type === "heading") {
      const lvl = n.attrs?.level ?? 2;
      chunks.push(`<h${lvl}>`);
      n.content?.forEach(walk);
      chunks.push(`</h${lvl}>`);
      return;
    }
    if (n.type === "bulletList") {
      chunks.push("<ul>");
      n.content?.forEach(walk);
      chunks.push("</ul>");
      return;
    }
    if (n.type === "orderedList") {
      chunks.push("<ol>");
      n.content?.forEach(walk);
      chunks.push("</ol>");
      return;
    }
    if (n.type === "listItem") {
      chunks.push("<li>");
      n.content?.forEach(walk);
      chunks.push("</li>");
      return;
    }
    if (n.text) {
      chunks.push(escapeHtml(n.text));
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(body);
  return chunks.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
