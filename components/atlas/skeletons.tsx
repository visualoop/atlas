"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

/**
 * Consistent table-shaped skeleton for list pages.
 * Renders `rows` skeleton rows of `columns` cells with mono-widths.
 */
export function TableSkeleton({
  rows = 8,
  columns = 4,
  className,
}: TableSkeletonProps) {
  return (
    <div className={cn("border border-border divide-y divide-border", className)}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-3 rounded-none"
              style={{ width: c === 0 ? "60%" : c === columns - 1 ? "30%" : "80%" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ListSkeletonProps {
  rows?: number;
  className?: string;
}

/**
 * Vertical list skeleton — used for inbox threads, notifications,
 * search results, etc. Each row is a title + subtitle pair.
 */
export function ListSkeleton({ rows = 6, className }: ListSkeletonProps) {
  return (
    <div className={cn("border border-border divide-y divide-border", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 space-y-2">
          <Skeleton className="h-3 rounded-none w-1/3" />
          <Skeleton className="h-2.5 rounded-none w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card skeleton — for grid layouts (vault assets, landing pages).
 */
export function CardGridSkeleton({
  cards = 6,
  columns = 3,
}: {
  cards?: number;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="border border-border p-4 space-y-3">
          <Skeleton className="h-32 rounded-none" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Detail skeleton — for slide-over sheets or split-panel detail views.
 */
export function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
      <div className="pt-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * KPI grid skeleton for the Today / Analytics dashboards.
 */
export function KpiGridSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="border border-border p-4 space-y-2">
          <Skeleton className="h-2.5 w-1/3" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}
