"use client";

/**
 * /prospector/hybrid — Google Places business data on OSM tiles.
 * Cheapest path: Places API for the data, free OSM tiles for the map.
 */

import { useQuery } from "convex/react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { MapBrowseHybrid } from "../map-browse-hybrid";

export default function ProspectorHybridPage() {
  const mapsKey = useQuery(api.prospector.getMapsClientKey, {});

  return (
    <>
      <header className="space-y-2 mb-8">
        <p className="eyebrow">Prospector · Places + OSM</p>
        <h1 className="text-3xl md:text-4xl tracking-tight">
          Pan a map, <em className="italic font-display">pick businesses</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Google Places business data rendered on free OpenStreetMap
          tiles. Cheapest path — you only pay Places API for data lookups.
        </p>
      </header>

      {mapsKey === undefined ? (
        <div className="border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !mapsKey.key ? (
        <div className="border border-dashed border-border py-16 text-center space-y-3">
          <p className="font-display italic text-2xl text-muted-foreground">
            Google Places API key required.
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Hybrid mode uses Google's Places API for business data. Add
            a Places API key at{" "}
            <Link
              href="/settings/integrations"
              className="text-primary underline inline-flex items-center gap-1"
            >
              <KeyRound className="size-3" />
              Settings → Integrations
            </Link>{" "}
            to unlock it. Or switch to the free{" "}
            <Link href="/prospector/osm" className="text-primary underline">
              OSM-only
            </Link>{" "}
            mode.
          </p>
        </div>
      ) : (
        <MapBrowseHybrid />
      )}
    </>
  );
}
