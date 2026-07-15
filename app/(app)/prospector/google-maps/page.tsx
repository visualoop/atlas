"use client";

/**
 * /prospector/google-maps — full Google Maps JS rendering.
 * Requires Maps JavaScript API billing enabled on the API key.
 */

import { useQuery } from "convex/react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { MapBrowse } from "../map-browse";

export default function ProspectorGoogleMapsPage() {
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
          Google Maps JavaScript API key required.
        </p>
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          This mode renders the full Google Maps tile layer + Places data.
          You need Maps JavaScript API billing enabled. Add the key at{" "}
          <Link
            href="/settings/integrations"
            className="text-primary underline inline-flex items-center gap-1"
          >
            <KeyRound className="size-3" />
            Settings → Integrations
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground max-w-prose mx-auto italic">
          Cheaper alternatives:{" "}
          <Link href="/prospector/hybrid" className="text-primary underline">
            Places + OSM tiles
          </Link>{" "}
          or{" "}
          <Link href="/prospector/osm" className="text-primary underline">
            OSM only
          </Link>
          .
        </p>
      </div>
    );
  }

  return <MapBrowse />;
}
