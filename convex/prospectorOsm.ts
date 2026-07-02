"use node";

/**
 * OpenStreetMap POI search — Overpass API + workspace-level cache.
 *
 * Two problems with raw Overpass usage:
 *   1. Community endpoints are heavily rate-limited (429 during peak).
 *   2. Cold queries are slow (2-5s for a Nairobi bbox).
 *
 * Solution:
 *   - Server-side cache in Convex — key by (grid cell, category), 24h TTL.
 *     Rounds lat/lng to 0.02° precision (~2km) so nearby pans share cache.
 *   - Two mirror endpoints tried in sequence with 500ms backoff between.
 *   - Fair-use headers (User-Agent + From email) for better queue priority.
 *
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const USER_AGENT = "Atlas by Blyss (atlas.blyss.co.ke)";
const FROM_EMAIL = "justinequartz1@gmail.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GRID_PRECISION = 0.02;                 // ~2km at equator — cache buckets

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

const CATEGORY_TAG_QUERIES: Record<string, string> = {
  restaurant: 'nwr["amenity"~"^(restaurant|cafe|bar|fast_food|food_court|pub|ice_cream)$"]',
  retail: 'nwr["shop"]',
  services: 'nwr["office"]',
  health: 'nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|dentist)$"]',
  auto: 'nwr["amenity"~"^(fuel|car_wash|car_rental|charging_station)$"];nwr["shop"~"^(car|car_repair|car_parts|motorcycle)$"]',
  hotel: 'nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]',
  office: 'nwr["office"];nwr["amenity"~"^(bank|post_office|coworking_space)$"]',
};

interface Place {
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
}

function gridKey(lat: number, lng: number, radiusM: number, category: string): string {
  const rLat = Math.round(lat / GRID_PRECISION) * GRID_PRECISION;
  const rLng = Math.round(lng / GRID_PRECISION) * GRID_PRECISION;
  const rBucket = Math.round(radiusM / 1000);   // 1km buckets
  return `${rLat.toFixed(3)}:${rLng.toFixed(3)}:${rBucket}:${category}`;
}

export const searchNearbyOsm = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    places: Place[];
    error?: string;
    cached?: boolean;
  }> => {
    const radius = Math.min(Math.max(args.radiusMeters, 300), 25_000);
    const category = args.category ?? "retail";
    const key = gridKey(args.latitude, args.longitude, radius, category);

    // 1. Serve from cache if fresh
    const cached = await ctx.runQuery(internal.prospectorOsmHelpers.getCached, { key });
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return { places: cached.places as Place[], cached: true };
    }

    // 2. Fetch from Overpass
    const catQuery = CATEGORY_TAG_QUERIES[category] ?? CATEGORY_TAG_QUERIES.retail;
    const overpassQL = `
[out:json][timeout:25];
(
  ${catQuery
    .split(";")
    .filter((q) => q.trim())
    .map((q) => `${q.trim()}(around:${radius},${args.latitude},${args.longitude});`)
    .join("\n  ")}
);
out center tags 80;
`.trim();

    let lastError = "";
    for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
      const endpoint = OVERPASS_MIRRORS[i];
      // Backoff between mirror attempts
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            "From": FROM_EMAIL,
          },
          body: `data=${encodeURIComponent(overpassQL)}`,
        });

        if (res.status === 429) {
          lastError = `${endpoint} rate-limited (429)`;
          continue;
        }
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

            const addr = [
              tags["addr:housenumber"],
              tags["addr:street"],
              tags["addr:city"] ?? tags["addr:town"],
              tags["addr:country"],
            ]
              .filter(Boolean)
              .join(", ");

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
            } as Place;
          })
          .filter((x): x is Place => x !== null);

        // 3. Cache the result
        await ctx.runMutation(internal.prospectorOsmHelpers.saveCached, {
          key,
          places,
        });

        return { places, cached: false };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Network error";
        continue;
      }
    }

    // All mirrors failed — serve stale cache if we have anything, else error
    if (cached) {
      return {
        places: cached.places as Place[],
        cached: true,
        error: "Fresh OSM data unavailable — showing cached results from earlier.",
      };
    }
    return {
      places: [],
      error: `OpenStreetMap is temporarily rate-limiting free requests. Wait 60 seconds and try again, or switch to Places+OSM mode (uses your Google Places key instead).`,
    };
  },
});
