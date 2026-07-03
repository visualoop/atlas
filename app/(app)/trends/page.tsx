"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  Plus, Loader2, ExternalLink, MessageSquare, Sparkles, X, Check,
  TrendingUp, Eye, Radio, MoreHorizontal, Pencil, Trash2, Pause, Play,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function TrendsPage() {
  const watches = useQuery(api.trends.listWatches, {});
  const [status, setStatus] = useState<"new" | "triaged" | "responded" | "posted" | "dismissed">("new");
  const mentions = useQuery(api.trends.listMentions, { status, limit: 200 });
  const [newWatchOpen, setNewWatchOpen] = useState(false);

  const STATUSES = ["new", "triaged", "responded", "posted", "dismissed"] as const;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
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

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
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
  const [editing, setEditing] = useState(false);
  const KIND_META: Record<string, { label: string; color: string }> = {
    brand: { label: "Brand", color: "text-primary" },
    competitor: { label: "Comp", color: "text-[var(--warning)]" },
    topic: { label: "Topic", color: "text-[var(--info)]" },
  };
  const meta = KIND_META[w.kind];
  const archive = useMutation(api.trends.archiveWatch);
  const update = useMutation(api.trends.updateWatch);

  async function toggleActive() {
    try {
      await update({ id: w._id, patch: { active: !w.active } });
      toast.success(w.active ? "Paused." : "Resumed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  async function handleArchive() {
    if (!window.confirm(`Delete watch "${w.label}"? Mentions will be preserved.`)) return;
    try {
      await archive({ id: w._id });
      toast.success("Deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  return (
    <>
      <li className="px-3 py-2.5 group hover:bg-muted/30 transition-colors">
        <div className="flex items-baseline justify-between gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium truncate text-left hover:underline min-w-0 flex-1"
          >
            {w.label}
          </button>
          <span
            className={cn(
              "text-[10px] font-mono uppercase tracking-[0.12em] shrink-0",
              meta?.color,
            )}
          >
            {meta?.label}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "size-6 grid place-items-center text-muted-foreground hover:text-foreground rounded transition-opacity",
                "opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100",
              )}
              aria-label="Watch options"
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleActive}>
                {w.active ? (
                  <>
                    <Pause className="size-3.5" /> Pause scans
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" /> Resume scans
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleArchive}
                className="text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-baseline justify-between mt-1 text-[10px] font-mono text-muted-foreground num">
          <span>
            {w.mentionCount} mention{w.mentionCount === 1 ? "" : "s"}
            {!w.active && (
              <span className="ml-2 text-[var(--warning)]">paused</span>
            )}
          </span>
          {w.lastScanAt ? (
            <span>
              {formatDistanceToNowStrict(new Date(w.lastScanAt), {
                addSuffix: true,
              })}
            </span>
          ) : (
            <span className="text-[var(--warning)]">never scanned</span>
          )}
        </div>
        {w.queries.length > 0 && (
          <p className="text-[10px] font-mono text-muted-foreground/70 mt-1 truncate">
            {w.queries.join(" · ")}
          </p>
        )}
      </li>
      {editing && (
        <WatchDialog
          existing={w}
          onClose={() => setEditing(false)}
        />
      )}
    </>
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

function WatchDialog({
  existing,
  onClose,
}: {
  existing?: Doc<"brandWatches">;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [kind, setKind] = useState<"brand" | "competitor" | "topic">(
    existing?.kind ?? "brand",
  );
  const [queries, setQueries] = useState(existing?.queries.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.trends.createWatch);
  const update = useMutation(api.trends.updateWatch);

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
      const parsedQueries = queries
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean);
      if (existing) {
        await update({
          id: existing._id,
          patch: { label: label.trim(), queries: parsedQueries },
        });
        toast.success("Updated.");
      } else {
        await create({
          label: label.trim(),
          kind,
          queries: parsedQueries,
        });
        toast.success("Watch added.");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {existing ? "Edit watch" : "New watch"}
          </p>
          <DialogTitle className="text-xl font-semibold">
            {existing ? existing.label : "What should we listen for?"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {existing ? "Update this watch" : "Create a new brand or topic watch"}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Omnix POS"
            />
          </div>
          {!existing && (
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <div className="flex gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    onClick={() => setKind(k.value)}
                    className={cn(
                      "h-9 px-4 rounded-md text-sm font-medium transition-colors",
                      kind === k.value
                        ? "bg-primary text-primary-foreground"
                        : "border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="flex items-baseline gap-2">
              Queries
              <span className="text-muted-foreground/60 text-[10px] font-normal">
                comma-separated
              </span>
            </Label>
            <Input
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              placeholder='"Omnix POS", "Blyss Omnix", "@blyss_ke"'
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Each query runs OR-matched. Include your brand as an @handle,
              hashtags, product names, and common misspellings.
            </p>
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-3 flex-row items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} size="sm" className="gap-1.5">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : existing ? (
              <Check className="size-3.5" />
            ) : (
              <Radio className="size-3.5" />
            )}
            {existing ? "Save" : "Add watch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Backwards-compat wrapper used by the page's create-flow state.
function NewWatchDialog({ onClose }: { onClose: () => void }) {
  return <WatchDialog onClose={onClose} />;
}
