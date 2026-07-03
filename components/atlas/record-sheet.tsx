"use client";

import { type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  subtitle?: string;
  initials: string;
  /** Small badge next to the title (e.g. "lead", "customer"). */
  status?: string;
  /** Quick action row — expects `<Button>` children from consumer. */
  actions?: ReactNode;
  /** Two-column key/value grid rendered below the header. */
  meta?: ReactNode;
  /** Tabs. Order preserved. `count` renders as a subtle number badge. */
  tabs: { id: string; label: string; count?: number; content: ReactNode }[];
  defaultTab?: string;
}

/**
 * RecordSheet — polished shadcn-native detail panel used by
 * Companies / Contacts / Deals. Right-aligned slide-in sheet with:
 *   1. Sticky header (avatar, title, status badge, actions)
 *   2. Optional meta grid (2-column key/value)
 *   3. Sticky tab bar with badge counters
 *   4. Scrollable tab content
 */
export function RecordSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  subtitle,
  initials,
  status,
  actions,
  meta,
  tabs,
  defaultTab,
}: RecordSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 space-y-3 shrink-0">
          <SheetDescription className="sr-only">
            {eyebrow} · {title}
          </SheetDescription>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="flex items-center gap-3">
            <Avatar className="size-11 shrink-0">
              <AvatarFallback className="bg-muted font-mono text-sm">
                {initials || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-xl font-semibold leading-tight truncate">
                  {title}
                </SheetTitle>
                {status && (
                  <Badge variant="secondary" className="capitalize text-[10px]">
                    {status}
                  </Badge>
                )}
              </div>
              {subtitle && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {actions}
            </div>
          )}
        </SheetHeader>

        {meta && (
          <>
            <Separator />
            <div className="px-6 py-4 bg-muted/30">{meta}</div>
          </>
        )}

        <Separator />

        <Tabs
          defaultValue={defaultTab ?? tabs[0]?.id}
          className="flex-1 flex flex-col min-h-0 gap-0"
        >
          <div className="px-3 sm:px-6 shrink-0 overflow-x-auto scrollbar-none">
            <TabsList className="h-10 justify-start bg-transparent p-0 gap-1 rounded-none border-b w-full">
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="h-10 px-3 rounded-none border-b-2 border-transparent bg-transparent shadow-none text-xs font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none shrink-0 whitespace-nowrap gap-1.5"
                >
                  {t.label}
                  {typeof t.count === "number" && t.count > 0 && (
                    <Badge
                      variant="secondary"
                      className="h-4 min-w-4 px-1 rounded-full text-[9px] font-mono"
                    >
                      {t.count}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {tabs.map((t) => (
            <TabsContent
              key={t.id}
              value={t.id}
              className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
            >
              <ScrollArea className="h-full">
                <div className="px-6 py-6">{t.content}</div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
