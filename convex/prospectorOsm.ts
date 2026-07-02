"use node";

/**
 * OpenStreetMap POI search — using Overpass API.
 *
 * Nominatim was the wrong tool: it's a geocoder (address → coords)
 * that treats free-text queries as place-name lookups. For "find all
 * restaurants around here" queries, Overpass is the correct engine —
 * it lets you query OSM by tags (amenity=restaurant, shop=*, etc.).
 *
 * Free forever. No API key. No billing. Rate-limited by fair-use
 * policy — we self-throttle in the frontend.
 *
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 * Live query builder: https://overpass-turbo.eu
 *
 * Data coverage in Kenya: strong in Nairobi + Mombasa CBDs (community-
 * mapped), thinner in rural areas. Contributors also add phone, website,
 * opening_hours tags to many businesses.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
// Backup endpoints if the main one is down or rate-limiting
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

/**
 * Overpass QL fragment per category — matches OSM tags for that kind
 * of business. Uses `nwr` (node + way + relation) so we catch tagged
 * points, polygons (mall footprints), and grouped features.
 */
const CATEGORY_TAG_QUERIES: Record<string, string> = {
  restaurant: 'nwr["amenity"~"^(restaurant|cafe|bar|fast_food|food_court|pub|ice_cream)$"]',
  retail: 'nwr["shop"]',
  services: 'nwr["office"]',
  health: 'nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|dentist)$"]',
  auto: 'nwr["amenity"~"^(fuel|car_wash|car_rental|charging_station)$"];nwr["shop"~"^(car|car_repair|car_parts|motorcycle)$"]',
  hotel: 'nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]',
  office: 'nwr["office"];nwr["amenity"~"^(bank|post_office|coworking_space)$"]',
};

export const searchNearbyOsm = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{
    places: Array<{
      googlePlaceId: string;
      name: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      phoneRaw?: string;
      website?: string;
      googleMapsUri?: string;
      types?: string[];
      rating?: number;
      ratingCount?: number;
      businessStatus?: string;
    }>;
    error?: string;
  }> => {
    // Overpass expects meters directly for `around:R` — no minimum
    // enforcement needed. Cap at 25km to keep the response small.
    const radius = Math.min(Math.max(args.radiusMeters, 300), 25_000);

    const catQuery =
      (args.category && CATEGORY_TAG_QUERIES[args.category]) ??
      CATEGORY_TAG_QUERIES.retail;

    // Overpass QL — the `out center;` returns coords for ways + relations
    // as their centroid, alongside their tags.
    const overpassQL = `
[out:json][timeout:25];
(
  ${catQuery
    .split(";")
    .filter((q) => q.trim())
    .map((q) => `${q.trim()}(around:${radius},${args.latitude},${args.longitude});`)
    .join("\n  ")}
);
out center tags 60;
`.trim();

    // Try mirrors sequentially if one fails
    let lastError = "";
    for (const endpoint of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQL)}`,
        });
        if (!res.ok) {
          lastError = `${endpoint} HTTP ${res.status}`;
          continue;
        }
        const json = (await res.json()) as OverpassResponse;
        if (json.remark) {
          lastError = json.remark;
          continue;
        }

        const places = (json.elements ?? [])
          .map((el) => {
            const lat = el.lat ?? el.center?.lat;
            const lon = el.lon ?? el.center?.lon;
            const tags = el.tags ?? {};
            const name = tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator;
            if (!name || !lat || !lon) return null;

            // Address from OSM addr:* tags
            const addr = [
              tags["addr:housenumber"],
              tags["addr:street"],
              tags["addr:city"] ?? tags["addr:town"],
              tags["addr:country"],
            ]
              .filter(Boolean)
              .join(", ");

            // Types — combine primary tag family with subtype
            const types: string[] = [];
            if (tags.amenity) types.push(tags.amenity);
            if (tags.shop) types.push(`shop:${tags.shop}`);
            if (tags.office) types.push(`office:${tags.office}`);
            if (tags.tourism) types.push(`tourism:${tags.tourism}`);
            if (tags.cuisine) types.push(`cuisine:${tags.cuisine}`);

            return {
              googlePlaceId: `osm-${el.type}-${el.id}`,
              name,
              address: addr || undefined,
              latitude: lat,
              longitude: lon,
              phoneRaw: tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"],
              website: tags.website ?? tags["contact:website"] ?? tags["contact:url"],
              googleMapsUri: `https://www.openstreetmap.org/${el.type}/${el.id}`,
              types,
              rating: undefined,
              ratingCount: undefined,
              businessStatus: "OPERATIONAL",
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        return { places };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Network error";
        continue;
      }
    }

    return { places: [], error: `OSM search failed: ${lastError}` };
  },
});
