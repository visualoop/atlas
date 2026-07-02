"use client";

import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ListLayoutProps {
  eyebrow: string;
  title: string;
  italicLastWord?: boolean;
  description?: string;
  searchPlaceholder?: string;
  searchValue: string;
  onSearch: (q: string) => void;
  primaryAction?: { label: string; onClick: () => void };
  filterStrip?: ReactNode;
  count?: number;
  children: ReactNode;
}

/** Calm dense list shell: eyebrow + display headline + search/filter + content. */
export function ListLayout({
  eyebrow,
  title,
  italicLastWord = true,
  description,
  searchPlaceholder = "Search…",
  searchValue,
  onSearch,
  primaryAction,
  filterStrip,
  count,
  children,
}: ListLayoutProps) {
  const words = title.split(" ");
  const head = italicLastWord ? words.slice(0, -1).join(" ") : title;
  const tail = italicLastWord ? words.at(-1) : null;

  return (
    <div className="max-w-7xl mx-auto px-8 py-12 space-y-8">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <p className="eyebrow">{eyebrow}{typeof count === "number" && ` · ${count}`}</p>
          <h1 className="text-4xl md:text-5xl tracking-tight">
            {head}
            {tail && (
              <>
                {" "}
                <em className="italic font-display">{tail}</em>
              </>
            )}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-prose">{description}</p>
          )}
        </div>
        {primaryAction && (
          <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>
        )}
      </header>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] sm:min-w-[280px] max-w-md w-full">
          <Search className="absolute left-0 top-2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-6"
          />
        </div>
        {filterStrip}
      </div>

      <div>{children}</div>
    </div>
  );
}
