"use client";

/**
 * Prospector — shared layout with sub-nav across text search + three
 * map browse modes.
 *
 * Routes:
 *   /prospector             → text-search (default)
 *   /prospector/hybrid      → Google Places data + OSM tiles (recommended)
 *   /prospector/google-maps → full Google Maps JS (requires billing)
 *   /prospector/osm         → OSM-only (free, community-mapped)
 *
 * The sub-nav renders as a horizontal tab strip so switching between
 * modes preserves scroll + doesn't wipe local state on the current page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, MapIcon, MapPin, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/prospector",
    label: "Text search",
    hint: "AI-driven query",
    icon: Search,
    match: (p: string) => p === "/prospector",
  },
  {
    href: "/prospector/hybrid",
    label: "Places + OSM",
    hint: "Google business data on free OSM tiles",
    icon: MapIcon,
    match: (p: string) => p === "/prospector/hybrid",
  },
  {
    href: "/prospector/google-maps",
    label: "Google Maps JS",
    hint: "Full Google rendering, needs Maps billing",
    icon: MapPin,
    match: (p: string) => p === "/prospector/google-maps",
  },
  {
    href: "/prospector/osm",
    label: "OSM only",
    hint: "Free, community-mapped businesses",
    icon: Globe,
    match: (p: string) => p === "/prospector/osm",
  },
] as const;

export default function ProspectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const active = TABS.find((t) => t.match(pathname));

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-12">
      <header className="space-y-2 mb-8">
        <p className="eyebrow">Prospector</p>
        <h1 className="text-4xl md:text-5xl tracking-tight">
          Turn any query <em className="italic font-display">into leads</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Powered by Google Places. Search for businesses, then import the
          ones you want into your CRM as companies. Rejected leads are
          suppressed on future runs so you never see them twice.
        </p>
      </header>

      {/* Sub-nav */}
      <nav
        aria-label="Prospector modes"
        className="mb-6 border-b border-border overflow-x-auto"
      >
        <ul className="flex items-center gap-1 min-w-max">
          {TABS.map((t) => {
            const isActive = t.match(pathname);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 transition-colors whitespace-nowrap",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {active?.hint && (
        <p className="text-[11px] text-muted-foreground italic mb-4">
          {active.hint}
        </p>
      )}

      {children}
    </div>
  );
}
