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

/**
 * Kenyan mega-brand deny-list. These businesses have enterprise
 * procurement, existing POS/CRM systems, and multi-quarter sales
 * cycles. They almost never respond to a founder's cold outreach.
 *
 * We hard-filter them from Prospector results so founders don't
 * waste time seeing 15 Naivas branches in every search.
 *
 * Match is case-insensitive substring. Add to /settings/workspace
 * for per-workspace additions.
 */
const MEGA_BRAND_DENYLIST = [
  // Supermarkets
  "naivas", "carrefour", "quickmart", "chandarana", "cleanshelf",
  "tuskys", "tusky", "nakumatt", "uchumi", "ukwala", "eastmatt",
  "shoprite", "game store", "gamestore",
  // Restaurants + fast food
  "java house", "javahouse", "artcaffe", "kfc", "pizza inn", "chicken inn",
  "creamy inn", "galitos", "subway", "mcdonald", "burger king", "steers",
  "debonairs", "domino", "cj's", "cj s", "wimpy", "big square",
  // Banks + financial
  "kcb", "equity bank", "co-operative bank", "cooperative bank", "co-op bank",
  "absa", "standard chartered", "stanchart", "stanbic", "ncba", "dtb",
  "national bank", "family bank", "i&m bank", "im bank", "citibank",
  "gulf african bank", "sidian", "cba bank", "commercial bank of africa",
  "hfc", "kwft", "faulu", "housing finance",
  // Telcos
  "safaricom", "airtel", "telkom kenya", "jamii telecom",
  // Fuel
  "shell", "total energies", "totalenergies", "rubis", "ola energy", "oilibya",
  "kenol kobil", "kenolkobil", "vivo", "hass petroleum",
  // Pharmacies chains
  "goodlife pharmacy", "goodlife", "haltons", "healthplus", "afrimed", "portland pharmacy",
  // Electronics chains
  "hotpoint", "samsung dealership", "samsung store",
  // Insurance / big services
  "britam", "jubilee", "cic insurance", "old mutual", "sanlam", "apa insurance",
  "uap", "resolution insurance", "madison insurance",
  // Retail apparel chains
  "bata", "mr price", "woolworths", "truworths",
  // Hotels chains
  "serena", "sarova", "fairmont", "hilton", "radisson", "movenpick",
  "intercontinental", "sheraton", "villa rosa", "kempinski",
  // Bookshops + electronics chains
  "text book centre", "textbook centre",
];

function isMegaBrand(name: string): boolean {
  const lc = name.toLowerCase();
  return MEGA_BRAND_DENYLIST.some((brand) => lc.includes(brand));
}

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
    nameKeyword: v.optional(v.string()),      // free-text OSM name filter
  },
  handler: async (ctx, args): Promise<{
    places: Place[];
    error?: string;
    cached?: boolean;
  }> => {
    // Overpass performance degrades badly beyond 5km; cap it. Nairobi's
    // CBD is fully covered at 3-5km. If the user has panned way out,
    // they need to zoom in for meaningful business density anyway.
    const radius = Math.min(Math.max(args.radiusMeters, 300), 5_000);
    const category = args.category ?? "retail";
    const keyword = (args.nameKeyword ?? "").trim();
    const key = `${gridKey(args.latitude, args.longitude, radius, category)}:${keyword.toLowerCase().slice(0, 40)}`;

    // 1. Serve from cache if fresh
    const cached = await ctx.runQuery(internal.prospectorOsmHelpers.getCached, { key });
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return { places: cached.places as Place[], cached: true };
    }

    // 2. Fetch from Overpass
    const catQuery = CATEGORY_TAG_QUERIES[category] ?? CATEGORY_TAG_QUERIES.retail;
    // If keyword provided, wrap each tag clause with a name-contains filter.
    // Otherwise just use the tag clauses as-is.
    const clauses = catQuery
      .split(";")
      .filter((q) => q.trim())
      .map((q) => {
        const base = q.trim();
        const nameFilter = keyword
          ? `["name"~"${keyword.replace(/["\\]/g, "")}",i]`
          : "";
        return `${base}${nameFilter}(around:${radius},${args.latitude},${args.longitude});`;
      });

    const overpassQL = `
[out:json][timeout:15];
(
  ${clauses.join("\n  ")}
);
out center tags 60;
`.trim();

    let lastError = "";
    for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
      const endpoint = OVERPASS_MIRRORS[i];
      // Backoff between mirror attempts
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            "From": FROM_EMAIL,
          },
          body: `data=${encodeURIComponent(overpassQL)}`,
          signal: controller.signal,
        });
        clearTimeout(timer);

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

        // Filter out Kenyan mega-brands (Naivas, Safaricom, Bata, etc.)
        // — they don't respond to founder cold outreach.
        const noMega = places.filter((p) => !isMegaBrand(p.name));

        // Collapse duplicates by exact name — if OSM has 5 branches of
        // "Prestige Bookshop", keep just the first with a hint that
        // more exist. Keeps the list scannable.
        const byName = new Map<string, Place & { _dupCount?: number }>();
        for (const p of noMega) {
          const key = p.name.toLowerCase().trim();
          const existing = byName.get(key);
          if (existing) {
            existing._dupCount = (existing._dupCount ?? 1) + 1;
          } else {
            byName.set(key, p);
          }
        }
        const dedupedPlaces = Array.from(byName.values()).map((p) => {
          if (p._dupCount && p._dupCount > 1) {
            return {
              ...p,
              types: [...(p.types ?? []), `${p._dupCount} branches`],
            };
          }
          const { _dupCount: _dc, ...rest } = p;
          return rest as Place;
        });

        // 3. Cache the result
        await ctx.runMutation(internal.prospectorOsmHelpers.saveCached, {
          key,
          places: dedupedPlaces,
        });

        return { places: dedupedPlaces, cached: false };
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
