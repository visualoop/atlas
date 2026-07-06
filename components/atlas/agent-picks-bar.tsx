"use client";

/**
 * AgentPicksBar
 *
 * Renders at the top of a list page. Calls a Convex action once
 * on mount, shows a horizontal card row of 3 AI-recommended
 * records with a "why" reason and a one-click primary action.
 *
 * Same skeleton used by contacts + companies + pipelines pages.
 */

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Sparkles, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { FunctionReference } from "convex/server";

interface Pick {
  id: string;
  reason: string;
  record: Record<string, unknown>;
}

export function AgentPicksBar<A extends FunctionReference<"action">>({
  actionRef,
  title,
  emptyLabel,
  renderTitle,
  renderPrimaryAction,
  autoRun = true,
}: {
  actionRef: A;
  title: string;
  emptyLabel: string;
  renderTitle: (record: Record<string, unknown>) => string;
  renderPrimaryAction: (record: Record<string, unknown>, pick: Pick) => {
    label: string;
    onClick: () => void;
  };
  autoRun?: boolean;
}) {
  const run = useAction(actionRef);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function runOnce() {
    setLoading(true);
    try {
      const r = (await run({})) as { picks: Pick[] };
      setPicks(r.picks ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI rank failed");
      setPicks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoRun && picks === null && !loading) {
      void runOnce();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  if (!autoRun && picks === null) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-muted-foreground">
            AI-ranked recommendations available
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={runOnce} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Rank now
        </Button>
      </div>
    );
  }

  if (picks === null || (loading && picks.length === 0)) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Ranking your list with AI…
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          {emptyLabel}
        </div>
        <Button size="sm" variant="ghost" onClick={runOnce}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-primary/5 border-primary/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          {title}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={runOnce}
          disabled={loading}
          className="h-7 text-[11px] font-mono uppercase tracking-[0.12em]"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {picks.map((p) => {
          const action = renderPrimaryAction(p.record, p);
          return (
            <div
              key={p.id}
              className="rounded-md border bg-background p-3 space-y-2 flex flex-col"
            >
              <div>
                <p className="font-medium text-sm truncate">
                  {renderTitle(p.record)}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-3 mt-1">
                  {p.reason}
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={action.onClick}
                className="mt-auto"
              >
                {action.label}
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
