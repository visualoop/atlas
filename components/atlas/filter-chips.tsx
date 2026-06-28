"use client";

import { cn } from "@/lib/utils";

interface FilterChipsProps<T extends string> {
  options: { value: T; label: string; count?: number }[];
  value: T | null;
  onChange: (v: T | null) => void;
}

export function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 transition-colors",
          "hover:border-border-strong hover:text-foreground",
          "border",
          value === null
            ? "border-primary text-primary"
            : "border-border text-muted-foreground",
        )}
      >
        All
      </button>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? null : opt.value)}
            className={cn(
              "font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 transition-colors",
              "hover:border-border-strong hover:text-foreground",
              "border inline-flex items-center gap-1.5",
              active
                ? "border-primary text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {opt.label}
            {typeof opt.count === "number" && (
              <span className="text-[10px] opacity-70">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
