"use client";

/**
 * /prospector/osm — Free, community-mapped businesses via OSM Overpass.
 * No API key required.
 */

import { MapBrowseOsm } from "../map-browse-osm";

export default function ProspectorOsmPage() {
  return (
    <>
      <header className="space-y-2 mb-8">
        <p className="eyebrow">Prospector · OSM only</p>
        <h1 className="text-3xl md:text-4xl tracking-tight">
          Free, <em className="italic font-display">community-mapped</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Uses OpenStreetMap's Overpass API — no API key, no billing.
          Coverage varies: dense in Nairobi + Mombasa, sparse elsewhere.
        </p>
      </header>
      <MapBrowseOsm />
    </>
  );
}
