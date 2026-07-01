"use client";

import { useState } from "react";
import { ChevronDown, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STAGES = ["cold", "warm", "qualified", "customer", "lost"] as const;

interface BulkBarProps {
  count: number;
  onClear: () => void;
  onChangeStage: (stage: string) => Promise<unknown>;
  onArchive: () => Promise<unknown>;
}

/**
 * Floating bottom bar shown when 1+ rows are selected in a list table.
 * Sharp corners, dense, mono labels.
 */
export function BulkActionBar({ count, onClear, onChangeStage, onArchive }: BulkBarProps) {
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  }

  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 border border-[var(--border-strong)] bg-[var(--popover)] shadow-lg">
      <div className="px-4 py-3 border-r border-border flex items-center gap-3">
        <span className="font-mono uppercase tracking-[0.12em] text-xs num">
          {count} selected
        </span>
        <button
          onClick={onClear}
          className="size-6 inline-flex items-center justify-center hover:bg-muted text-muted-foreground"
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "px-3 py-3 font-mono uppercase tracking-[0.12em] text-xs inline-flex items-center gap-1.5",
            "hover:bg-muted transition-colors",
            pending && "opacity-50 pointer-events-none",
          )}
        >
          Change stage <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="rounded-none">
          {STAGES.map((s) => (
            <DropdownMenuItem
              key={s}
              onClick={() => run(() => onChangeStage(s))}
              className="font-mono uppercase tracking-[0.12em] text-xs"
            >
              {s}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        onClick={() => run(onArchive)}
        disabled={pending}
        className={cn(
          "px-3 py-3 font-mono uppercase tracking-[0.12em] text-xs inline-flex items-center gap-1.5",
          "hover:bg-muted text-destructive transition-colors",
          pending && "opacity-50 pointer-events-none",
        )}
      >
        <Trash2 className="size-3.5" /> Archive
      </button>
    </div>
  );
}
