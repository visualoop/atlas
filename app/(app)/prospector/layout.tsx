"use client";

/**
 * Prospector — shared page chrome for every prospector route.
 *
 * The mode picker used to live here as a tab strip. Modes are now
 * dedicated pages routed via the sidebar's expanded children:
 *   /prospector             → overview + stats
 *   /prospector/search      → text search + AI-driven query
 *   /prospector/hybrid      → Google Places data on OSM tiles
 *   /prospector/google-maps → full Google Maps JS
 *   /prospector/osm         → OSM only (free, community-mapped)
 *
 * This layout only owns the outer container + the page hero. Each
 * route renders its own content beneath.
 */

export default function ProspectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-12">{children}</div>
  );
}
