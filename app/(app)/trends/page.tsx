"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  Plus, Loader2, ExternalLink, MessageSquare, Sparkles, X, Check,
  TrendingUp, Eye, Radio,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";

export default function TrendsPage() {
  const watches = useQuery(api.trends.listWatches, {});
  const [status, setStatus] = useState<"new" | "triaged" | "responded" | "posted" | "dismissed">("new");
  const mentions = useQuery(api.trends.listMentions, { status, limit: 200 });
  const [newWatchOpen, setNewWatchOpen] = useState(false);

  const STATUSES = ["new", "triaged", "responded", "posted", "dismissed"] as const;

  return (
    <>
      <div className="max-w-7xl mx-auto px-8 py-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Trend & Brand Intelligence</p>
            <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
              Know what's <em className="italic font-display">said</em>.
            </h1>
            <p className="text-sm text-muted-foreground max-w-prose mt-2">
              Watch your brand + competitors + industry topics. A daily AI
              sweep surfaces new mentions across the web with sentiment +
              relevance. Turn them into replies or posts in one click.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-[280px_1fr] gap-8">
          {/* Watches sidebar */}
          <aside className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Watches</p>
              <button
                onClick={() => setNewWatchOpen(true)}
                className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline inline-flex items-center gap-1"
              >
                <Plus className="size-3.5" /> Add
              </button>
            </div>
            {watches === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : watches.length === 0 ? (
              <div className="border border-dashed border-border p-4 text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Start by watching your brand name and one competitor.
                </p>
              </div>
            ) : (
              <ul className="border border-border divide-y divide-border">
                {watches.map((w) => (
                  <WatchRow key={w._id} watch={w} />
                ))}
              </ul>
            )}
          </aside>

          {/* Mentions */}
          <section className="space-y-3 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
                    status === s
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            {mentions === undefined ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : mentions.length === 0 ? (
              <EmptyMentions status={status} hasWatches={(watches?.length ?? 0) > 0} />
            ) : (
              <ul className="space-y-2">
                {mentions.map((m) => (
                  <MentionCard key={m._id} mention={m} watches={watches ?? []} />
                ))}
              </ul>
            )}

            <p className="text-[11px] text-muted-foreground italic mt-4">
              The scan runs every 6 hours via Groq Compound web search.
              Add a watch, then wait one cron cycle for mentions to appear.
            </p>
          </section>
        </div>
      </div>

      {newWatchOpen && <NewWatchDialog onClose={() => setNewWatchOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function WatchRow({ watch: w }: { watch: Doc<"brandWatches"> }) {
  const KIND_META: Record<string, { label: string; color: string }> = {
    brand: { label: "Brand", color: "text-primary" },
    competitor: { label: "Comp", color: "text-[var(--warning)]" },
    topic: { label: "Topic", color: "text-[var(--info)]" },
  };
  const meta = KIND_META[w.kind];
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium truncate">{w.label}</p>
        <span className={cn("text-[10px] font-mono uppercase tracking-[0.12em] shrink-0", meta?.color)}>
          {meta?.label}
        </span>
      </div>
      <div className="flex items-baseline justify-between mt-1 text-[10px] font-mono text-muted-foreground num">
        <span>{w.mentionCount} mentions</span>
        {w.lastScanAt ? (
          <span>{formatDistanceToNowStrict(new Date(w.lastScanAt), { addSuffix: true })}</span>
        ) : (
          <span className="text-[var(--warning)]">never scanned</span>
        )}
      </div>
    </li>
  );
}

function MentionCard({
  mention: m, watches,
}: { mention: Doc<"trendMentions">; watches: Doc<"brandWatches">[] }) {
  const watch = watches.find((w) => w._id === m.watchId);
  const updateStatus = useMutation(api.trends.updateMentionStatus);
  return (
    <li className="border border-border p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          {watch && (
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground shrink-0">
              {watch.label}
            </span>
          )}
          {typeof m.relevanceScore === "number" && (
            <span className={cn(
              "text-[10px] font-mono num shrink-0",
              m.relevanceScore >= 70 ? "text-[var(--success)]"
                : m.relevanceScore >= 40 ? "text-[var(--warning)]"
                  : "text-muted-foreground",
            )}>
              R{m.relevanceScore}
            </span>
          )}
          {m.sentiment && <SentimentPill sentiment={m.sentiment} />}
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {m.sourceType} · {formatDistanceToNowStrict(new Date(m.discoveredAt), { addSuffix: true })}
          </span>
        </div>
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          className="size-7 grid place-items-center text-muted-foreground hover:text-foreground shrink-0"
          title="Open source"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <p className="font-medium text-sm">{m.title}</p>
      <p className="text-sm text-muted-foreground line-clamp-3">{m.excerpt}</p>
      {m.status === "new" && (
        <div className="flex items-center gap-1 pt-2 border-t border-border">
          <button
            onClick={() => updateStatus({ id: m._id, status: "triaged" })}
            className="text-xs font-mono uppercase tracking-[0.12em] px-2 h-7 border border-border hover:border-foreground hover:bg-muted transition-colors inline-flex items-center gap-1"
          >
            <Eye className="size-3" /> Triage
          </button>
          <a
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => updateStatus({ id: m._id, status: "responded" })}
            className="text-xs font-mono uppercase tracking-[0.12em] px-2 h-7 border border-border hover:border-primary hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            <MessageSquare className="size-3" /> Reply on source
          </a>
          <button
            onClick={() => {
              updateStatus({ id: m._id, status: "posted" });
              toast.success("Marked as posted. Draft a social post from /social to reference this mention.");
            }}
            className="text-xs font-mono uppercase tracking-[0.12em] px-2 h-7 border border-border hover:border-primary hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            <Sparkles className="size-3" /> Mark posted
          </button>
          <button
            onClick={() => updateStatus({ id: m._id, status: "dismissed" })}
            className="ml-auto size-7 grid place-items-center text-muted-foreground hover:text-[var(--danger)] transition-colors"
            title="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function EmptyMentions({ status, hasWatches }: { status: string; hasWatches: boolean }) {
  return (
    <div className="border border-dashed border-border py-16 text-center space-y-2">
      <p className="font-display italic text-2xl text-muted-foreground">
        {!hasWatches ? "Add a watch first." : status === "new" ? "All clear." : `No ${status} mentions.`}
      </p>
      {!hasWatches ? (
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          A watch is what the daily scan looks for — your brand name, a
          competitor, an industry topic.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Come back tomorrow.</p>
      )}
    </div>
  );
}

function SentimentPill({ sentiment }: { sentiment: string }) {
  const styles: Record<string, string> = {
    positive: "border-[var(--success)] text-[var(--success)]",
    neutral: "border-border text-muted-foreground",
    negative: "border-[var(--danger)] text-[var(--danger)]",
  };
  return (
    <span className={cn(
      "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[9px] border px-1 py-0",
      styles[sentiment] ?? styles.neutral,
    )}>
      {sentiment}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* New watch dialog                                                     */
/* ------------------------------------------------------------------ */

function NewWatchDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"brand" | "competitor" | "topic">("brand");
  const [queries, setQueries] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.trends.createWatch);

  const KINDS = [
    { value: "brand" as const, label: "Brand" },
    { value: "competitor" as const, label: "Competitor" },
    { value: "topic" as const, label: "Topic" },
  ];

  async function submit() {
    if (!label.trim() || !queries.trim()) {
      toast.error("Fill both fields.");
      return;
    }
    setSaving(true);
    try {
      await create({
        label: label.trim(),
        kind,
        queries: queries.split(",").map((q) => q.trim()).filter(Boolean),
      });
      toast.success("Watch added.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">New watch</p>
          <h2 className="font-display italic text-2xl mt-1">What should we <em>listen for</em>?</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Label</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Omnix POS"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Kind</span>
            <div className="flex gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
                    kind === k.value
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Queries <span className="normal-case tracking-normal text-muted-foreground/60">— comma-separated</span>
            </span>
            <input
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              placeholder='"Omnix POS", "Blyss Omnix", "@blyss_ke"'
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
            />
          </label>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}
            Add watch
          </button>
        </footer>
      </div>
    </div>
  );
}
