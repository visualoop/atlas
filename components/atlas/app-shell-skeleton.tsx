"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Full-shell skeleton shown on cold load. Matches the real AppShell
 * layout — sidebar rail + header + content grid — so page refreshes
 * feel like the app painting itself instead of a blank "Loading…"
 * message.
 *
 * The Atlas wordmark stays visible so brand identity doesn't blink
 * away between navigations.
 */
export function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar rail */}
      <aside className="w-14 md:w-56 border-r border-border shrink-0 hidden md:flex flex-col">
        <div className="h-14 border-b border-border flex items-center px-3 gap-2">
          <div className="size-8 bg-primary/80 grid place-items-center shrink-0">
            <span className="font-display italic text-lg leading-none text-primary-foreground">
              A
            </span>
          </div>
          <Skeleton className="h-3 flex-1 rounded-none opacity-30" />
        </div>
        <div className="flex-1 p-2 space-y-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-8 px-2 flex items-center gap-2 rounded-none">
              <Skeleton className="size-4 rounded-none opacity-30" />
              <Skeleton
                className="h-2.5 rounded-none opacity-30"
                style={{ width: `${40 + ((i * 7) % 45)}%` }}
              />
            </div>
          ))}
        </div>
      </aside>

      {/* Right column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 border-b border-border flex items-center px-4 gap-3">
          <Skeleton className="size-6 rounded-none opacity-30" />
          <div className="w-px h-4 bg-border" />
          <Skeleton className="h-3 w-24 rounded-none opacity-30" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-6 w-20 rounded-none opacity-30 hidden md:block" />
            <Skeleton className="size-8 rounded-full opacity-30" />
          </div>
        </header>

        {/* Content — editorial split */}
        <main className="flex-1 relative overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 md:px-8 py-10 space-y-8">
            <div className="space-y-3">
              <Skeleton className="h-3 w-16 rounded-none opacity-40" />
              <h1 className="font-display italic text-5xl md:text-6xl tracking-tight leading-none">
                Atlas<span className="text-primary">.</span>
              </h1>
              <Skeleton className="h-3 w-1/2 rounded-none opacity-30" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-border p-4 space-y-2">
                  <Skeleton className="h-2.5 w-1/3 rounded-none opacity-30" />
                  <Skeleton className="h-5 w-3/4 rounded-none opacity-40" />
                  <Skeleton className="h-2.5 w-1/2 rounded-none opacity-30" />
                </div>
              ))}
            </div>

            <div className="border border-border divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <Skeleton className="size-6 rounded-none opacity-30" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3 rounded-none opacity-30" />
                    <Skeleton className="h-2.5 w-1/2 rounded-none opacity-30" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editorial signature bar at the bottom-left */}
          <div className="absolute bottom-6 left-6 md:left-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60">
              Warming things up
              <span className="ml-2 inline-block">
                <span className="animate-pulse">·</span>
                <span className="animate-pulse [animation-delay:150ms]">·</span>
                <span className="animate-pulse [animation-delay:300ms]">·</span>
              </span>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
