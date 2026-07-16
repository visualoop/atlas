"use client";

/**
 * /prospector — overview landing page.
 *
 * Shows workspace-level prospector stats + a set of large cards
 * linking to each mode. The sidebar expands to show the same modes
 * as children once the user is anywhere under /prospector.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  Search,
  Map as MapIcon,
  MapPin,
  Globe,
  ArrowRight,
  Loader2,
  Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MODES = [
  {
    href: "/prospector/search",
    icon: Search,
    title: "Text search",
    tagline: "Ask in plain English, get ranked leads.",
    detail:
      "AI-driven Google Places query. Best for 'salons in Karen with rating > 4.2, less than 500 reviews'.",
    accent: "text-primary",
  },
  {
    href: "/prospector/hybrid",
    icon: MapIcon,
    title: "Places + OSM",
    tagline: "Google business data, free OSM tiles.",
    detail:
      "Cheapest path — Places API for the data, OpenStreetMap tiles for the map. Recommended default.",
    accent: "text-[var(--success)]",
  },
  {
    href: "/prospector/google-maps",
    icon: MapPin,
    title: "Google Maps JS",
    tagline: "Full Google rendering.",
    detail:
      "Complete Google Maps view with satellite/traffic layers. Requires Maps JavaScript API billing.",
    accent: "text-[var(--warning)]",
  },
  {
    href: "/prospector/osm",
    icon: Globe,
    title: "OSM only",
    tagline: "Free, community-mapped businesses.",
    detail:
      "No API key needed. Coverage varies by city — great for Nairobi + Mombasa, sparse elsewhere.",
    accent: "text-[var(--info)]",
  },
] as const;

export default function ProspectorOverviewPage() {
  const searches = useQuery(api.prospector.listSearches, {});
  const budget = useQuery(api.prospector.getImportBudget, {});

  const totalSearches = searches?.length ?? 0;
  const totalResults = searches?.reduce((a, s) => a + s.resultCount, 0) ?? 0;
  const totalImported = searches?.reduce((a, s) => a + s.importedCount, 0) ?? 0;

  return (
    <>
      <header className="space-y-2 mb-10">
        <p className="eyebrow">Prospector</p>
        <h1 className="text-4xl md:text-5xl tracking-tight">
          Turn any query <em className="italic font-display">into leads</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Four ways to find prospects. Pick a mode from the sidebar or
          the cards below.
        </p>
      </header>

      {/* Stats strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <StatCard
          label="Total searches"
          value={searches === undefined ? null : totalSearches}
        />
        <StatCard
          label="Results scraped"
          value={searches === undefined ? null : totalResults}
        />
        <StatCard
          label="Imported to CRM"
          value={searches === undefined ? null : totalImported}
        />
        <StatCard
          label="Today's cap"
          value={
            budget === undefined
              ? null
              : `${budget.usedToday} / ${budget.dailyCap}`
          }
          hint={
            budget === undefined
              ? undefined
              : `${budget.remaining} left`
          }
        />
      </section>

      {/* Modes */}
      <section className="space-y-3">
        <p className="eyebrow">Choose a mode</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODES.map((m) => (
            <Link key={m.href} href={m.href} className="group">
              <Card className="h-full transition-colors hover:border-foreground/40">
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between">
                    <m.icon className={cn("size-5", m.accent)} />
                    <ArrowRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </div>
                  <CardTitle className="text-lg">{m.title}</CardTitle>
                  <CardDescription className="text-sm">
                    {m.tagline}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {m.detail}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent searches */}
      {searches && searches.length > 0 && (
        <section className="mt-10 space-y-3">
          <p className="eyebrow">Recent searches</p>
          <ul className="border border-border divide-y divide-border">
            {searches.slice(0, 8).map((s) => (
              <li key={s._id}>
                <Link
                  href={`/prospector/search?id=${s._id}`}
                  className="block px-3 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium truncate flex-1">{s.query}</p>
                    <span className="text-xs font-mono text-muted-foreground num shrink-0">
                      {s.resultCount} · {s.importedCount} imported
                    </span>
                  </div>
                  {s.location && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <MapPin className="size-3" />
                      {s.location}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {searches && searches.length === 0 && (
        <section className="mt-10 border border-dashed border-border py-16 text-center space-y-3">
          <p className="font-display italic text-2xl text-muted-foreground">
            No searches yet.
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Start with a text search — describe your ideal customer in
            plain English and let AI rank the results.
          </p>
          <Link
            href="/prospector/search"
            className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm"
          >
            <Zap className="size-3.5" />
            Start a text search
          </Link>
        </section>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string | null;
  hint?: string;
}) {
  return (
    <div className="border border-border p-4">
      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      {value === null ? (
        <Skeleton className="h-7 w-20 mt-2" />
      ) : (
        <p className="text-2xl font-mono mt-1 num">{value}</p>
      )}
      {hint && (
        <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
      )}
    </div>
  );
}
