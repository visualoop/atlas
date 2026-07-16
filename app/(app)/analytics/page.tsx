"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  DollarSign, TrendingUp, TrendingDown, Users, FileText, Clock,
  Plus, Loader2, Copy, Check, ExternalLink, Link as LinkIcon, Sparkles, RefreshCw,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function AnalyticsPage() {
  const kpis = useQuery(api.analytics.kpiSummary, {});
  const funnel = useQuery(api.analytics.dealFunnel, {});
  const sources = useQuery(api.analytics.dealSourceAttribution, {});
  const cashFlow = useQuery(api.analytics.cashFlowOutlook, {});
  const utmLinks = useQuery(api.analytics.listUtmLinks, {});
  const expenses = useQuery(api.analytics.listBusinessExpenses, {});

  const [newUtmOpen, setNewUtmOpen] = useState(false);
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <header className="mb-8">
          <p className="eyebrow">Analytics</p>
          <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
            The <em className="italic font-display">business</em> at a glance.
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose mt-2">
            Pipeline, cash flow, attribution — computed live from your
            deals, invoices, and touchpoints.
          </p>
        </header>

        {/* KPI grid */}
        <section className="mb-10">
          {kpis === undefined ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard
                label="Pipeline"
                value={formatCurrency(kpis.pipelineValueCents, kpis.currency)}
                sub={`${kpis.openDealsCount} deals in flight`}
              />
              <KpiCard
                label="Won this month"
                value={formatCurrency(kpis.wonThisMonthCents, kpis.currency)}
                sub={`${kpis.wonThisMonthCount} closed`}
                accent={kpis.wonThisMonthCount > 0 ? "success" : "muted"}
              />
              <KpiCard
                label="Paid this month"
                value={formatCurrency(kpis.paidCentsThisMonth, kpis.currency)}
                sub="from Paystack + manual"
              />
              <KpiCard
                label="Outstanding"
                value={formatCurrency(kpis.outstandingCents, kpis.currency)}
                sub={`${kpis.outstandingInvoicesCount} invoices`}
                accent={BigInt(kpis.overdueCents) > 0n ? "warning" : "muted"}
              />
              <KpiCard
                label="Overdue"
                value={formatCurrency(kpis.overdueCents, kpis.currency)}
                sub="past due date"
                accent={BigInt(kpis.overdueCents) > 0n ? "danger" : "muted"}
              />
              <KpiCard
                label="Win rate"
                value={`${kpis.winRatePercent}%`}
                sub="all-time"
              />
              <KpiCard
                label="New contacts"
                value={String(kpis.newContactsCount)}
                sub="last 30 days"
              />
              <KpiCard
                label="Monthly expenses"
                value={formatCurrency(kpis.monthlyExpensesCents, kpis.currency)}
                sub={
                  kpis.runwayMonths === null
                    ? "no expenses set"
                    : `${kpis.runwayMonths.toFixed(1)}× coverage`
                }
                accent="muted"
              />
            </div>
          )}
        </section>

        {/* AI summary */}
        <AnalyticsAISummary kpis={kpis} />

        {/* Two-column: funnel + sources */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          <div>
            <p className="eyebrow mb-2">Funnel</p>
            {funnel === undefined ? (
              <Skeleton className="h-64 w-full" />
            ) : funnel.length === 0 ? (
              <EmptyPanel message="No pipelines yet. Seed defaults on /pipelines." />
            ) : (
              <div className="space-y-4">
                {funnel.map((p) => (
                  <FunnelBlock key={p.pipelineId} pipeline={p} />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="eyebrow mb-2">Deals by source</p>
            {sources === undefined ? (
              <Skeleton className="h-64 w-full" />
            ) : sources.length === 0 ? (
              <EmptyPanel message="No deals yet." />
            ) : (
              <ul className="border border-border divide-y divide-border">
                {sources.map((s) => (
                  <li key={s.source} className="px-4 py-3 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium capitalize">
                        {s.source.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm font-mono num">
                        {formatCurrency(s.valueCents, "KES")}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground font-mono num">
                      <span>{s.count} deals · {s.wonCount} won</span>
                      <span className="text-[var(--success)]">
                        {s.wonCount > 0 ? formatCurrency(s.wonValueCents, "KES") + " won" : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Cash flow */}
        <section className="mb-10">
          <p className="eyebrow mb-2">Cash flow outlook</p>
          {cashFlow === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="border border-border">
              <div className="grid grid-cols-1 md:grid-cols-4 divide-x divide-border">
                <CashCell
                  label="Overdue"
                  value={formatCurrency(cashFlow.overdueCents, cashFlow.currency)}
                  accent={BigInt(cashFlow.overdueCents) > 0n ? "danger" : "muted"}
                />
                <CashCell label="Next 30d" value={formatCurrency(cashFlow.expected30dCents, cashFlow.currency)} />
                <CashCell label="Next 60d" value={formatCurrency(cashFlow.expected60dCents, cashFlow.currency)} />
                <CashCell label="Next 90d" value={formatCurrency(cashFlow.expected90dCents, cashFlow.currency)} />
              </div>
              <div className="border-t border-border grid grid-cols-1 md:grid-cols-4 divide-x divide-border">
                <CashCell
                  label="Monthly expenses"
                  value={"-" + formatCurrency(cashFlow.monthlyExpensesCents, cashFlow.currency)}
                  accent="muted"
                />
                <CashCell
                  label="Net 30d"
                  value={formatCurrency(cashFlow.net30dCents, cashFlow.currency)}
                  accent={BigInt(cashFlow.net30dCents) < 0n ? "warning" : "success"}
                />
                <CashCell
                  label="Net 60d"
                  value={formatCurrency(cashFlow.net60dCents, cashFlow.currency)}
                  accent={BigInt(cashFlow.net60dCents) < 0n ? "warning" : "success"}
                />
                <CashCell
                  label="Net 90d"
                  value={formatCurrency(cashFlow.net90dCents, cashFlow.currency)}
                  accent={BigInt(cashFlow.net90dCents) < 0n ? "warning" : "success"}
                />
              </div>
            </div>
          )}
        </section>

        {/* UTM links + expenses two-column */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow">UTM links</p>
              <Button
                variant="link"
                onClick={() => setNewUtmOpen(true)}
                className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em]"
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
            {utmLinks === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : utmLinks.length === 0 ? (
              <EmptyPanel message="No UTM links yet." />
            ) : (
              <ul className="border border-border divide-y divide-border">
                {utmLinks.map((u) => (
                  <UtmRow key={u._id} link={u} />
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow">Fixed expenses</p>
              <Button
                variant="link"
                onClick={() => setNewExpenseOpen(true)}
                className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em]"
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
            {expenses === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : expenses.filter((e) => e.active).length === 0 ? (
              <EmptyPanel message="No fixed expenses tracked." />
            ) : (
              <ul className="border border-border divide-y divide-border">
                {expenses.filter((e) => e.active).map((e) => (
                  <li key={e._id} className="px-4 py-3 flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.label}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {e.cadence.replace("_", " ")}
                        {e.category && ` · ${e.category}`}
                      </p>
                    </div>
                    <span className="text-sm font-mono num shrink-0">
                      {formatCurrency(e.amountCents.toString(), e.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {newUtmOpen && <NewUtmDialog onClose={() => setNewUtmOpen(false)} />}
      {newExpenseOpen && <NewExpenseDialog onClose={() => setNewExpenseOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function KpiCard({
  label, value, sub, accent = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "default" | "success" | "warning" | "danger" | "muted";
}) {
  const styles: Record<string, string> = {
    default: "border-border",
    success: "border-[var(--success)]/40 bg-[var(--success)]/5",
    warning: "border-[var(--warning)]/40 bg-[var(--warning)]/5",
    danger: "border-[var(--danger)]/40 bg-[var(--danger)]/5",
    muted: "border-border opacity-90",
  };
  return (
    <div className={cn("border p-4 space-y-1", styles[accent])}>
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-mono num tracking-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function CashCell({
  label, value, accent = "default",
}: { label: string; value: string; accent?: "default" | "success" | "warning" | "danger" | "muted" }) {
  const colors: Record<string, string> = {
    default: "text-foreground",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    muted: "text-muted-foreground",
  };
  return (
    <div className="p-4 space-y-1">
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-lg font-mono num", colors[accent])}>{value}</p>
    </div>
  );
}

function FunnelBlock({ pipeline: p }: {
  pipeline: {
    pipelineId: Id<"pipelines">;
    pipelineName: string;
    stages: Array<{
      stageId: Id<"pipelineStages">;
      name: string;
      count: number;
      valueCents: string;
      isWon: boolean;
      isLost: boolean;
    }>;
  };
}) {
  const maxCount = Math.max(1, ...p.stages.map((s) => s.count));
  return (
    <div className="border border-border p-4 space-y-2">
      <p className="text-sm font-medium">{p.pipelineName}</p>
      <div className="space-y-1">
        {p.stages.map((s) => {
          const width = Math.max(6, (s.count / maxCount) * 100);
          return (
            <div key={s.stageId} className="flex items-center gap-3 text-xs">
              <span className={cn(
                "w-32 truncate font-mono uppercase tracking-[0.12em] text-[10px]",
                s.isWon && "text-[var(--success)]",
                s.isLost && "text-muted-foreground",
              )}>
                {s.name}
              </span>
              <div className="flex-1 h-5 bg-muted/30 relative">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0",
                    s.isWon ? "bg-[var(--success)]/40" : s.isLost ? "bg-muted" : "bg-primary/40",
                  )}
                  style={{ width: `${width}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono num">
                  {s.count}
                </span>
              </div>
              <span className="w-24 text-right font-mono num text-[10px] text-muted-foreground">
                {formatCurrency(s.valueCents, "KES")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UtmRow({ link: u }: { link: Doc<"utmLinks"> }) {
  const [copied, setCopied] = useState(false);
  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin.replace(":3010", ":3221")}/go/${u.shortCode}`
    : `/go/${u.shortCode}`;
  return (
    <li className="px-4 py-3 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium truncate">{u.label}</p>
        <span className="text-xs font-mono num text-muted-foreground">
          {u.clickCount} clicks
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
        {u.utmSource && <span>{u.utmSource}</span>}
        {u.utmMedium && <span>· {u.utmMedium}</span>}
        {u.utmCampaign && <span>· {u.utmCampaign}</span>}
      </div>
      <div className="flex items-center gap-2">
        <code className="font-mono text-[11px] bg-muted px-2 py-0.5 flex-1 truncate">
          /go/{u.shortCode}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          onClick={() => {
            navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success("Copied.");
          }}
        >
          {copied ? <Check className="size-3 text-[var(--success)]" /> : <Copy className="size-3" />}
        </Button>
      </div>
    </li>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground italic">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

function NewUtmDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.analytics.createUtmLink);

  async function submit() {
    if (!label.trim() || !destination.trim()) {
      toast.error("Label and destination required.");
      return;
    }
    setSaving(true);
    try {
      const res = await create({
        label: label.trim(),
        destination: destination.trim(),
        utmSource: utmSource.trim() || undefined,
        utmMedium: utmMedium.trim() || undefined,
        utmCampaign: utmCampaign.trim() || undefined,
      });
      toast.success(`Short code: ${res.shortCode}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New UTM link" onClose={onClose} saving={saving} onSubmit={submit} submitLabel="Create">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Label</span>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Newsletter — Jan 30 broadcast"
          />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Destination URL</span>
        <Input value={destination} onChange={(e) => setDestination(e.target.value)}
          placeholder="https://blyss.co.ke/omnix"
          className="font-mono" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Source</span>
          <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="newsletter"
            className="font-mono" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Medium</span>
          <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="email"
            className="font-mono" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Campaign</span>
          <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="jan-launch"
            className="font-mono" />
        </label>
      </div>
    </ModalShell>
  );
}

function NewExpenseDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [cadence, setCadence] = useState<"monthly" | "weekly" | "quarterly" | "yearly" | "one_time">("monthly");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.analytics.createBusinessExpense);

  async function submit() {
    const cents = BigInt(Math.round(Number(amount.replace(/[^\d.-]/g, "")) * 100));
    if (!label.trim() || cents <= 0n) {
      toast.error("Label + amount required.");
      return;
    }
    setSaving(true);
    try {
      await create({
        label: label.trim(),
        amountCents: cents,
        currency,
        cadence,
        category: category.trim() || undefined,
      });
      toast.success("Expense tracked.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New fixed expense" onClose={onClose} saving={saving} onSubmit={submit} submitLabel="Save">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Label</span>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Office rent"
          />
      </label>
      <div className="grid grid-cols-[1fr_100px] gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Amount</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
            className="font-mono num" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Currency</span>
          <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
            <SelectTrigger size="sm" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="KES">KES</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Cadence</span>
        <div className="flex flex-wrap gap-1">
          {(["weekly", "monthly", "quarterly", "yearly", "one_time"] as const).map((c) => (
            <Button
              key={c}
              type="button"
              variant={cadence === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCadence(c)}
              className={cn(
                "h-8 text-xs font-mono uppercase tracking-[0.12em]",
                cadence === c && "bg-foreground text-background hover:bg-foreground/90",
              )}
            >
              {c.replace("_", " ")}
            </Button>
          ))}
        </div>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Category</span>
        <Input value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="ops / infra / people"
          />
      </label>
    </ModalShell>
  );
}

function ModalShell({
  title, children, onClose, saving, onSubmit, submitLabel,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  saving: boolean;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">{title}</p>
        </header>
        <div className="px-6 py-4 space-y-3">{children}</div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving}
            className="h-8 px-5 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {submitLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function formatCurrency(cents: string | bigint, currency: string): string {
  const n = typeof cents === "bigint" ? cents : BigInt(cents);
  const value = Number(n) / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}


/* ============================================================ */
/* AnalyticsAISummary — 2-3 sentence narrative under KPIs        */
/* ============================================================ */

function AnalyticsAISummary({
  kpis,
}: {
  kpis:
    | {
        pipelineValueCents: string;
        openDealsCount: number;
        wonThisMonthCents: string;
        wonThisMonthCount: number;
        paidCentsThisMonth: string;
        outstandingCents: string;
        outstandingInvoicesCount: number;
        overdueCents: string;
        currency: string;
      }
    | undefined;
}) {
  const runSummary = useAction(api.publisherAI.summariseAnalytics);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!kpis) return;
    setLoading(true);
    try {
      const currency = kpis.currency;
      const r = await runSummary({
        period: "this month so far",
        metrics: [
          {
            name: "Pipeline value",
            currentValue: Number(kpis.pipelineValueCents) / 100,
            unit: currency,
          },
          {
            name: "Open deals",
            currentValue: kpis.openDealsCount,
          },
          {
            name: "Won this month",
            currentValue: Number(kpis.wonThisMonthCents) / 100,
            unit: currency,
          },
          {
            name: "Won deals",
            currentValue: kpis.wonThisMonthCount,
          },
          {
            name: "Paid this month",
            currentValue: Number(kpis.paidCentsThisMonth) / 100,
            unit: currency,
          },
          {
            name: "Outstanding",
            currentValue: Number(kpis.outstandingCents) / 100,
            unit: currency,
          },
          {
            name: "Overdue",
            currentValue: Number(kpis.overdueCents) / 100,
            unit: currency,
          },
        ],
      });
      setSummary(r.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI summary failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border-l-2 border-primary/60 pl-4 py-1 mb-10">
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          AI · How the month is going
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading || !kpis}
          className="h-auto px-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {summary ? "Refresh" : "Summarise"}
        </Button>
      </div>
      {summary === null ? (
        <p className="text-sm text-muted-foreground italic">
          Click Summarise for a narrative read of the numbers.
        </p>
      ) : (
        <p className="text-base leading-relaxed">{summary}</p>
      )}
    </section>
  );
}
