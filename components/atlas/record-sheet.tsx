"use client";

import { type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface RecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  subtitle?: string;
  initials: string;
  /** "Quick actions" row under header — buttons. */
  actions?: ReactNode;
  /** Right-side meta rail (tags, owner, custom fields). */
  meta?: ReactNode;
  /** Tabs: id → label → content. Order preserved. */
  tabs: { id: string; label: string; count?: number; content: ReactNode }[];
  defaultTab?: string;
}

export function RecordSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  subtitle,
  initials,
  actions,
  meta,
  tabs,
  defaultTab,
}: RecordSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[640px] p-0 border-l border-[var(--border-strong)] bg-background rounded-none"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        <div className="h-full flex flex-col">
          {/* Header */}
          <header className="border-b border-border px-6 py-5 space-y-3">
            <p className="eyebrow">{eyebrow}</p>
            <div className="flex items-start gap-4">
              <Avatar className="size-11 rounded-none">
                <AvatarFallback className="rounded-none bg-muted font-mono text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-display leading-tight truncate">{title}</h2>
                {subtitle && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">{subtitle}</p>
                )}
              </div>
            </div>
            {actions && <div className="flex gap-2 flex-wrap pt-1">{actions}</div>}
          </header>

          {/* Optional meta rail */}
          {meta && (
            <div className="border-b border-border px-6 py-4 text-sm bg-[var(--surface)]">
              {meta}
            </div>
          )}

          {/* Tabs */}
          <Tabs defaultValue={defaultTab ?? tabs[0]?.id} className="flex-1 flex flex-col min-h-0">
            <TabsList className="border-b border-border bg-transparent rounded-none px-6 h-auto p-0 gap-0 justify-start overflow-x-auto">
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="rounded-none border-b-2 border-transparent px-4 py-3 text-xs eyebrow text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent"
                >
                  {t.label}
                  {typeof t.count === "number" && (
                    <span className="ml-1.5 text-[10px] opacity-70 num">{t.count}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((t) => (
              <TabsContent
                key={t.id}
                value={t.id}
                className="flex-1 overflow-y-auto px-6 py-6 mt-0 data-[state=inactive]:hidden"
              >
                {t.content}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
