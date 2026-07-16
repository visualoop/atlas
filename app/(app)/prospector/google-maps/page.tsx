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

  return (
    <>
      <header className="space-y-2 mb-8">
        <p className="eyebrow">Prospector · Google Maps</p>
        <h1 className="text-3xl md:text-4xl tracking-tight">
          Full Google Maps <em className="italic font-display">rendering</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Real Google map tiles with satellite + traffic layers. Requires
          the Maps JavaScript API to be enabled on your Places key +
          billing turned on.
        </p>
      </header>

      {mapsKey === undefined ? (
        <div className="border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !mapsKey.key ? (
        <div className="border border-dashed border-border py-16 text-center space-y-3">
          <p className="font-display italic text-2xl text-muted-foreground">
            Google Maps JavaScript API key required.
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            This mode renders the full Google Maps tile layer + Places
            data. Add the key at{" "}
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
      ) : (
        <MapBrowse />
      )}
    </>
  );
}
