"use client";

import { useState, useEffect, use } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Send, Copy, Check, ExternalLink, Loader2,
  Building2, User, Calendar, Receipt, Sparkles, Wand2, AlertTriangle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RichComposer } from "@/components/atlas/rich-composer";

export default function DocumentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = use(params);
  const documentId = resolved.id as Id<"documents">;
  const data = useQuery(api.documents.getDocument, { id: documentId });
  const updateDoc = useMutation(api.documents.updateDocument);
  const transitionStatus = useMutation(api.documents.transitionStatus);
  const createShare = useMutation(api.documents.createShareLink);
  const archive = useMutation(api.documents.archiveDocument);
  const generateBody = useAction(api.aiWorkflows.generateDocumentBody);
  const critique = useAction(api.aiWorkflows.critiqueDocument);
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [footer, setFooter] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<"draft" | "critique" | null>(null);
  const [critiqueResult, setCritiqueResult] = useState<{
    score: number;
    summary: string;
    issues: Array<{ quote: string; issue: string; suggestion: string }>;
  } | null>(null);
  const [aiBrief, setAiBrief] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);

  useEffect(() => {
    if (data?.doc) {
      setTitle(data.doc.title);
      setFooter(data.doc.footerNote ?? "");
    }
  }, [data?.doc?._id]);

  if (data === undefined) return <EditorSkeleton />;
  if (data === null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-16 text-center">
        <p className="font-display italic text-2xl text-muted-foreground">Document not found.</p>
        <Link href="/documents" className="text-primary underline text-sm mt-4 inline-block">
          Back to documents
        </Link>
      </div>
    );
  }

  const { doc, lineItems, contact, company, deal, shares } = data;

  async function saveTitle() {
    if (title === data?.doc?.title || !data) return;
    setSaving(true);
    try {
      await updateDoc({ id: documentId, patch: { title } });
    } finally {
      setSaving(false);
    }
  }

  async function saveFooter() {
    if (footer === (data?.doc?.footerNote ?? "") || !data) return;
    setSaving(true);
    try {
      await updateDoc({ id: documentId, patch: { footerNote: footer } });
    } finally {
      setSaving(false);
    }
  }

  async function generateShareLink() {
    setSharing(true);
    try {
      const res = await createShare({ documentId });
      const url = `${window.location.origin}/d/${res.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
      setCopiedToken(res.token);
      setTimeout(() => setCopiedToken(null), 3000);
      // Transition to 'sent' if still draft
      if (doc.status === "draft") {
        await transitionStatus({ id: documentId, status: "sent" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSharing(false);
    }
  }

  async function handleAiDraft() {
    if (!aiBrief.trim()) {
      toast.error("Give the AI a brief.");
      return;
    }
    setAiBusy("draft");
    try {
      const res = await generateBody({ documentId, brief: aiBrief.trim() });
      // Insert as a raw HTML paragraph body (via updateDoc)
      await updateDoc({
        id: documentId,
        patch: { body: { type: "doc", html: markdownToHtml(res.markdown) } },
      });
      toast.success(`Drafted · ${res.provider}`);
      setBriefOpen(false);
      setAiBrief("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed.");
    } finally {
      setAiBusy(null);
    }
  }

  async function handleCritique() {
    setAiBusy("critique");
    setCritiqueResult(null);
    try {
      const res = await critique({ documentId });
      setCritiqueResult({
        score: res.score,
        summary: res.summary,
        issues: res.issues,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Critique failed.");
    } finally {
      setAiBusy(null);
    }
  }

  const isInvoice = doc.kind === "invoice";

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/documents"
            className="size-9 grid place-items-center border border-border hover:bg-muted transition-colors shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="eyebrow font-mono text-muted-foreground">
              {doc.kind.replace(/_/g, " ")} · {doc.number}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="text-2xl md:text-3xl tracking-tight bg-transparent focus:outline-none min-w-0 flex-1"
              />
              {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={doc.status} />
          <Button
            variant="outline"
            onClick={() => setBriefOpen(true)}
            disabled={aiBusy !== null}
            title="Generate body with AI"
            className="h-9 text-xs font-mono uppercase tracking-[0.12em] hover:border-primary hover:text-primary"
          >
            {aiBusy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            AI draft
          </Button>
          <Button
            variant="outline"
            onClick={handleCritique}
            disabled={aiBusy !== null}
            title="Critique — check for slop"
            className="h-9 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {aiBusy === "critique" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Critique
          </Button>
          <Button
            onClick={generateShareLink}
            disabled={sharing}
            className="h-9 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Share link
          </Button>
        </div>
      </header>

      {critiqueResult && (
        <div className={cn(
          "mb-6 border p-4",
          critiqueResult.score >= 70
            ? "border-[var(--success)] bg-[var(--success)]/5"
            : critiqueResult.score >= 40
              ? "border-[var(--warning)] bg-[var(--warning)]/5"
              : "border-[var(--danger)] bg-[var(--danger)]/5",
        )}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={cn(
              "size-4 shrink-0 mt-0.5",
              critiqueResult.score >= 70 ? "text-[var(--success)]"
                : critiqueResult.score >= 40 ? "text-[var(--warning)]"
                  : "text-[var(--danger)]",
            )} />
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">
                  Score: <span className="font-mono num">{critiqueResult.score}/100</span>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCritiqueResult(null)}
                  className="h-auto px-1.5 text-xs text-muted-foreground"
                >
                  Dismiss
                </Button>
              </div>
              <p className="text-sm text-muted-foreground italic">{critiqueResult.summary}</p>
              {critiqueResult.issues.length > 0 && (
                <ul className="space-y-2 pt-2 border-t border-border/50">
                  {critiqueResult.issues.map((issue, i) => (
                    <li key={i} className="text-xs space-y-0.5">
                      <p className="text-muted-foreground italic">"{issue.quote}"</p>
                      <p><span className="text-[var(--danger)]">Issue:</span> {issue.issue}</p>
                      <p><span className="text-[var(--success)]">Try:</span> {issue.suggestion}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {briefOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <div
            onClick={() => aiBusy !== "draft" && setBriefOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
          />
          <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
            <header className="px-6 pt-5 pb-3 border-b border-border">
              <p className="eyebrow font-mono text-muted-foreground">AI draft</p>
              <h2 className="font-display italic text-2xl mt-1">What should this <em>say</em>?</h2>
            </header>
            <div className="px-6 py-4 space-y-2">
              <textarea
                autoFocus
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                rows={5}
                placeholder="e.g. 3-page proposal to Java House for a 12-month Omnix rollout covering 8 branches, KES 4M budget, phased delivery."
                className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
              />
              <p className="text-xs text-muted-foreground">
                The AI will use the linked contact + company + deal context automatically.
                Existing body will be replaced.
              </p>
            </div>
            <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => aiBusy !== "draft" && setBriefOpen(false)}
                disabled={aiBusy === "draft"}
                className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAiDraft}
                disabled={aiBusy === "draft" || !aiBrief.trim()}
                className="h-8 px-5 text-xs font-mono uppercase tracking-[0.12em]"
              >
                {aiBusy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                Draft
              </Button>
            </footer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 lg:gap-8">
        <main className="space-y-8">
          {/* Body */}
          <section>
            <p className="eyebrow mb-2">Body</p>
            <RichComposer
              initialHtml={renderBodyPreview(doc.body)}
              placeholder="Write the pitch, scope, or terms…"
              minHeight={260}
              onChange={(v) => {
                // Debounce save — for MVP, save on blur via the outer state.
                // Store the current HTML in body via updateDoc when it changes.
                // This is a simplified path: convert HTML back to TipTap JSON
                // by wrapping in a doc/paragraph tree.
                updateDoc({
                  id: documentId,
                  patch: { body: htmlToTiptap(v.html) },
                }).catch(() => {});
              }}
            />
          </section>

          {/* Line items */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">Line items</p>
              <AddLineItemButton documentId={documentId} />
            </div>
            <LineItemsTable
              items={lineItems}
              currency={doc.currency}
              documentId={documentId}
            />
            <TotalsPanel doc={doc} />
          </section>

          {/* Footer note */}
          <section>
            <p className="eyebrow mb-2">Recipient note</p>
            <textarea
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              onBlur={saveFooter}
              placeholder="Payment terms, thank-you note, anything the recipient should see at the bottom."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
            />
          </section>
        </main>

        <aside className="space-y-6">
          <SidebarSection title="Details">
            <DetailRow label="Kind" value={doc.kind.replace(/_/g, " ")} />
            <DetailRow label="Number" value={doc.number ?? "—"} mono />
            <DetailRow
              label="Currency"
              value={doc.currency}
              mono
            />
            {doc.taxRate !== undefined && (
              <DetailRow
                label={doc.taxLabel ?? "Tax"}
                value={`${(doc.taxRate * 100).toFixed(1)}%`}
                mono
              />
            )}
            <DetailRow
              label="Issued"
              value={doc.issueDate ? new Date(doc.issueDate).toLocaleDateString("en-KE") : "—"}
            />
            {isInvoice && doc.dueDate && (
              <DetailRow
                label="Due"
                value={new Date(doc.dueDate).toLocaleDateString("en-KE")}
              />
            )}
            {doc.kind === "quote" && doc.validUntil && (
              <DetailRow
                label="Valid until"
                value={new Date(doc.validUntil).toLocaleDateString("en-KE")}
              />
            )}
            {doc.viewedAt && (
              <DetailRow
                label="Viewed"
                value={new Date(doc.viewedAt).toLocaleString("en-KE", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              />
            )}
          </SidebarSection>

          {(contact || company || deal) && (
            <SidebarSection title="Linked">
              {company && (
                <SidebarLink
                  href={`/companies?open=${company._id}`}
                  icon={<Building2 className="size-3.5" />}
                  label={company.name}
                />
              )}
              {contact && (
                <SidebarLink
                  href={`/contacts?open=${contact._id}`}
                  icon={<User className="size-3.5" />}
                  label={`${contact.firstName}${contact.lastName ? " " + contact.lastName : ""}`}
                />
              )}
              {deal && (
                <SidebarLink
                  href={`/pipelines`}
                  icon={<Receipt className="size-3.5" />}
                  label={deal.name}
                />
              )}
            </SidebarSection>
          )}

          {isInvoice && (
            <SidebarSection title="Payment (Kenya)">
              <PaymentField
                label="M-PESA Paybill"
                value={doc.mpesaPaybill}
                onSave={(v) => updateDoc({ id: documentId, patch: { mpesaPaybill: v } })}
              />
              <PaymentField
                label="M-PESA Till"
                value={doc.mpesaTill}
                onSave={(v) => updateDoc({ id: documentId, patch: { mpesaTill: v } })}
              />
              <PaymentField
                label="Account ref"
                value={doc.mpesaAccountRef ?? doc.number}
                onSave={(v) => updateDoc({ id: documentId, patch: { mpesaAccountRef: v } })}
              />
              <PaymentField
                label="eTIMS ref"
                value={doc.etimsReference}
                onSave={(v) => updateDoc({ id: documentId, patch: { etimsReference: v } })}
              />
            </SidebarSection>
          )}

          {isInvoice && (
            <PaystackSection documentId={documentId} />
          )}

          <SidebarSection title="Share links">
            {shares.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No share links yet.</p>
            ) : (
              <ul className="space-y-2">
                {shares.map((s) => (
                  <ShareRow
                    key={s._id}
                    share={s}
                    copied={copiedToken === s.token}
                    onCopy={() => {
                      const url = `${window.location.origin}/d/${s.token}`;
                      navigator.clipboard.writeText(url);
                      setCopiedToken(s.token);
                      setTimeout(() => setCopiedToken(null), 3000);
                      toast.success("Copied.");
                    }}
                  />
                ))}
              </ul>
            )}
          </SidebarSection>

          <SidebarSection title="Actions">
            <Button
              variant="ghost"
              onClick={async () => {
                if (!confirm("Archive this document?")) return;
                await archive({ id: documentId });
                toast.success("Archived.");
                router.push("/documents");
              }}
              className="w-full h-8 text-xs font-mono uppercase tracking-[0.12em] text-[var(--danger)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
            >
              <Trash2 className="size-3.5" /> Archive
            </Button>
          </SidebarSection>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Line items table                                                     */
/* ------------------------------------------------------------------ */

function LineItemsTable({
  items, currency, documentId,
}: {
  items: Doc<"documentLineItems">[];
  currency: string;
  documentId: Id<"documents">;
}) {
  if (items.length === 0) {
    return (
      <div className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No line items. Add one to compute totals.
      </div>
    );
  }
  return (
    <div className="border border-border">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-[var(--border-strong)]">
            <Th>Description</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Unit</Th>
            <Th className="text-right">Line total</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <LineItemRow key={it._id} item={it} currency={currency} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineItemRow({
  item, currency,
}: { item: Doc<"documentLineItems">; currency: string }) {
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(Number(item.unitPriceCents) / 100));
  const update = useMutation(api.documents.updateLineItem);
  const remove = useMutation(api.documents.removeLineItem);
  const [busy, setBusy] = useState(false);

  async function commit() {
    setBusy(true);
    try {
      const qty = Number(quantity);
      const unit = Number(unitPrice);
      if (!Number.isFinite(qty) || !Number.isFinite(unit)) return;
      await update({
        id: item._id,
        patch: {
          description,
          quantity: qty,
          unitPriceCents: BigInt(Math.round(unit * 100)),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <Td>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full bg-transparent focus:outline-none"
        />
      </Td>
      <Td className="text-right">
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputMode="decimal"
          className="w-16 bg-transparent focus:outline-none text-right font-mono num"
        />
      </Td>
      <Td className="text-right">
        <input
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputMode="decimal"
          className="w-24 bg-transparent focus:outline-none text-right font-mono num"
        />
      </Td>
      <Td className="text-right font-mono num text-xs">
        {formatCurrency(Number(item.lineTotalCents), currency)}
      </Td>
      <Td className="w-8">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 hover:text-[var(--danger)]"
          onClick={() => remove({ id: item._id })}
          title="Remove"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </Td>
    </tr>
  );
}

function AddLineItemButton({ documentId }: { documentId: Id<"documents"> }) {
  const add = useMutation(api.documents.addLineItem);
  return (
    <Button
      variant="link"
      onClick={async () => {
        await add({
          documentId,
          description: "New item",
          quantity: 1,
          unitPriceCents: 0n,
        });
      }}
      className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em]"
    >
      <Plus className="size-3.5" /> Add
    </Button>
  );
}

function TotalsPanel({ doc }: { doc: Doc<"documents"> }) {
  const rows: Array<[string, bigint]> = [
    ["Subtotal", doc.subtotalCents],
  ];
  if (doc.discountCents !== 0n) rows.push(["Discount", -doc.discountCents]);
  if (doc.taxCents !== 0n) rows.push([doc.taxLabel ?? "Tax", doc.taxCents]);

  return (
    <div className="border-t border-border pt-3 flex justify-end">
      <div className="w-64 space-y-1 text-sm">
        {rows.map(([label, cents]) => (
          <div key={label} className="flex justify-between text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono num">{formatCurrency(Number(cents), doc.currency)}</span>
          </div>
        ))}
        <div className="border-t border-[var(--border-strong)] pt-2 flex justify-between font-medium">
          <span>Total</span>
          <span className="font-mono num">{formatCurrency(Number(doc.totalCents), doc.currency)}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar bits                                                         */
/* ------------------------------------------------------------------ */

function SidebarSection({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="eyebrow font-mono text-muted-foreground/70">{title}</p>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function DetailRow({
  label, value, mono,
}: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && "font-mono num text-xs")}>{value}</span>
    </div>
  );
}

function SidebarLink({
  href, icon, label,
}: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function PaymentField({
  label, value, onSave,
}: {
  label: string;
  value: string | undefined;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => local !== (value ?? "") && onSave(local)}
        placeholder="—"
        className="w-full h-7 bg-transparent focus:outline-none text-xs font-mono num border-b border-transparent focus:border-border transition-colors"
      />
    </div>
  );
}

function ShareRow({
  share, copied, onCopy,
}: {
  share: Doc<"documentShares">;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <li className="border border-border p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-[11px] truncate flex-1 min-w-0">…{share.token.slice(-8)}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          onClick={onCopy}
          title="Copy link"
        >
          {copied ? <Check className="size-3 text-[var(--success)]" /> : <Copy className="size-3" />}
        </Button>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
        <span>{share.accessCount} views</span>
        {share.acceptedAt && <span className="text-[var(--success)]">Accepted</span>}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Paystack payment section                                              */
/* ------------------------------------------------------------------ */

function PaystackSection({ documentId }: { documentId: Id<"documents"> }) {
  const requests = useQuery(api.payments.listPaymentRequestsForDocument, { documentId });
  const initialize = useAction(api.paymentsActions.initializePayment);
  const markPaid = useMutation(api.payments.markManuallyPaid);
  const [busy, setBusy] = useState(false);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  async function generateLink() {
    setBusy(true);
    try {
      const res = await initialize({ documentId });
      await navigator.clipboard.writeText(res.authorizationUrl);
      setCopiedRef(res.reference);
      setTimeout(() => setCopiedRef(null), 3000);
      toast.success("Payment link copied.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidebarSection title="Paystack">
      <Button
        variant="outline"
        onClick={generateLink}
        disabled={busy}
        className="w-full h-8 text-xs font-mono uppercase tracking-[0.12em] hover:border-primary hover:text-primary"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
        Generate payment link
      </Button>

      {requests && requests.length > 0 && (
        <ul className="space-y-1 mt-2">
          {requests.slice(0, 5).map((r) => (
            <li key={r._id} className="border border-border p-2 space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <PaymentStatusPill status={r.status} />
                <span className="font-mono num">{formatCurrency(Number(r.amountCents), r.currency)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                <span>…{r.reference.slice(-10)}</span>
                {r.authorizationUrl && r.status !== "success" && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(r.authorizationUrl!);
                      setCopiedRef(r.reference);
                      setTimeout(() => setCopiedRef(null), 3000);
                      toast.success("Copied.");
                    }}
                    className="hover:text-foreground transition-colors"
                  >
                    {copiedRef === r.reference ? "✓ copied" : "copy link"}
                  </button>
                )}
                {r.status !== "success" && r.status !== "cancelled" && (
                  <button
                    onClick={async () => {
                      if (!confirm("Mark as paid manually? (Use for M-PESA STK, cash, or bank confirmations.)")) return;
                      await markPaid({ id: r._id, channel: "manual" });
                      toast.success("Marked paid.");
                    }}
                    className="hover:text-[var(--success)] transition-colors"
                  >
                    mark paid
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}

function PaymentStatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    initialized: "border-border text-muted-foreground",
    pending: "border-[var(--info)] text-[var(--info)]",
    success: "border-[var(--success)] text-[var(--success)]",
    failed: "border-[var(--danger)] text-[var(--danger)]",
    abandoned: "border-border text-muted-foreground opacity-60",
    cancelled: "border-border text-muted-foreground opacity-60",
  };
  return (
    <span className={cn(
      "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[9px] border px-1.5 py-0.5",
      styles[status] ?? styles.initialized,
    )}>
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`eyebrow font-mono h-9 px-3 text-muted-foreground font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className ?? ""}`}>{children}</td>;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  sent: "border-[var(--info)] text-[var(--info)]",
  viewed: "border-[var(--info)] text-[var(--info)]",
  accepted: "border-[var(--success)] text-[var(--success)]",
  rejected: "border-[var(--danger)] text-[var(--danger)]",
  paid: "border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10",
  partially_paid: "border-[var(--warning)] text-[var(--warning)]",
  overdue: "border-[var(--danger)] text-[var(--danger)]",
  cancelled: "border-border text-muted-foreground opacity-60",
  void: "border-border text-muted-foreground opacity-40",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

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

function renderBodyPreview(body: unknown): string {
  // Convert TipTap JSON → simple HTML for the editor to initialize with.
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "paragraph") {
      chunks.push("<p>");
      n.content?.forEach(walk);
      chunks.push("</p>");
      return;
    }
    if (n.type === "heading") {
      chunks.push("<h2>");
      n.content?.forEach(walk);
      chunks.push("</h2>");
      return;
    }
    if (n.type === "bulletList") {
      chunks.push("<ul>");
      n.content?.forEach(walk);
      chunks.push("</ul>");
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

function htmlToTiptap(html: string): unknown {
  // Simplified: wrap as a raw HTML paragraph. TipTap re-parses on load.
  // For a fully round-tripping conversion we'd need a DOM parser, but
  // this is fine because the editor keeps its own internal state — we
  // only need to persist the current rendered HTML back to the DB.
  // Store as { type: 'doc', content: [{ type: 'html', text: html }] }.
  return { type: "doc", html };
}

/**
 * Minimal markdown → HTML for AI-generated document bodies. Handles
 * the subset our system prompt asks for: `## heading`, `- list`,
 * `**bold**`, blank-line-separated paragraphs.
 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const chunks: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      chunks.push("</ul>");
      inList = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const headingMatch = /^(#{2,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      closeList();
      const lvl = headingMatch[1].length;
      chunks.push(`<h${lvl}>${inline(headingMatch[2])}</h${lvl}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        chunks.push("<ul>");
        inList = true;
      }
      chunks.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    chunks.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return chunks.join("");

  function inline(s: string): string {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function EditorSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <Skeleton className="h-10 w-96" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 lg:gap-8">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
