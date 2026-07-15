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

  if (mapsKey === undefined) {
    return (
      <div className="border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!mapsKey.key) {
    return (
      <div className="border border-dashed border-border py-16 text-center space-y-3">
        <p className="font-display italic text-2xl text-muted-foreground">
          Google Places API key required.
        </p>
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          Hybrid mode uses Google's Places API for business data. Add a
          Places API key at{" "}
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
    );
  }

  return <MapBrowseHybrid />;
}
