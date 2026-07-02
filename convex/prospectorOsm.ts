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
 * Keyword aliases → additional OSM tag queries.
 *
 * The problem: if a user types "pharmacy" under the "Retail" category,
 * we'd search `shop` with `name~pharmacy`, missing places tagged
 * `amenity=pharmacy` (which is where pharmacies actually live in OSM).
 *
 * Solution: for known common keywords, expand the search to also
 * include the tag queries that ACTUALLY host that business type in OSM.
 * The user's chosen category is still respected — we UNION with the
 * alias queries so both surface.
 */
const KEYWORD_ALIASES: Record<string, string[]> = {
  pharmacy: [
    'nwr["amenity"="pharmacy"]',
    'nwr["shop"="chemist"]',
    'nwr["healthcare"="pharmacy"]',
  ],
  chemist: [
    'nwr["amenity"="pharmacy"]',
    'nwr["shop"="chemist"]',
  ],
  salon: [
    'nwr["shop"="beauty"]',
    'nwr["shop"="hairdresser"]',
  ],
  beauty: [
    'nwr["shop"="beauty"]',
    'nwr["shop"="cosmetics"]',
  ],
  barber: [
    'nwr["shop"="hairdresser"]',
  ],
  hairdresser: [
    'nwr["shop"="hairdresser"]',
    'nwr["shop"="beauty"]',
  ],
  cafe: [
    'nwr["amenity"="cafe"]',
  ],
  coffee: [
    'nwr["amenity"="cafe"]',
    'nwr["shop"="coffee"]',
  ],
  bar: [
    'nwr["amenity"="bar"]',
    'nwr["amenity"="pub"]',
    'nwr["amenity"="nightclub"]',
  ],
  restaurant: [
    'nwr["amenity"="restaurant"]',
  ],
  hospital: [
    'nwr["amenity"="hospital"]',
  ],
  clinic: [
    'nwr["amenity"="clinic"]',
    'nwr["amenity"="doctors"]',
    'nwr["healthcare"="clinic"]',
  ],
  dentist: [
    'nwr["amenity"="dentist"]',
    'nwr["healthcare"="dentist"]',
  ],
  hotel: [
    'nwr["tourism"="hotel"]',
    'nwr["tourism"="guest_house"]',
    'nwr["tourism"="hostel"]',
  ],
  gym: [
    'nwr["leisure"="fitness_centre"]',
    'nwr["leisure"="sports_centre"]',
  ],
  fitness: [
    'nwr["leisure"="fitness_centre"]',
  ],
  laundry: [
    'nwr["shop"="laundry"]',
    'nwr["shop"="dry_cleaning"]',
  ],
  hardware: [
    'nwr["shop"="hardware"]',
    'nwr["shop"="doityourself"]',
    'nwr["shop"="paint"]',
  ],
  bookshop: [
    'nwr["shop"="books"]',
    'nwr["shop"="stationery"]',
  ],
  bookstore: [
    'nwr["shop"="books"]',
  ],
  butcher: [
    'nwr["shop"="butcher"]',
  ],
  bakery: [
    'nwr["shop"="bakery"]',
    'nwr["shop"="pastry"]',
  ],
  supermarket: [
    'nwr["shop"="supermarket"]',
    'nwr["shop"="convenience"]',
  ],
  furniture: [
    'nwr["shop"="furniture"]',
  ],
  electronics: [
    'nwr["shop"="electronics"]',
    'nwr["shop"="mobile_phone"]',
    'nwr["shop"="computer"]',
  ],
  phone: [
    'nwr["shop"="mobile_phone"]',
  ],
  boutique: [
    'nwr["shop"="clothes"]',
    'nwr["shop"="boutique"]',
  ],
  clothes: [
    'nwr["shop"="clothes"]',
  ],
  clothing: [
    'nwr["shop"="clothes"]',
  ],
  fashion: [
    'nwr["shop"="clothes"]',
    'nwr["shop"="boutique"]',
    'nwr["shop"="shoes"]',
  ],
  shoes: [
    'nwr["shop"="shoes"]',
  ],
  bank: [
    'nwr["amenity"="bank"]',
  ],
  atm: [
    'nwr["amenity"="atm"]',
  ],
  school: [
    'nwr["amenity"="school"]',
    'nwr["amenity"="kindergarten"]',
    'nwr["amenity"="college"]',
  ],
  garage: [
    'nwr["shop"="car_repair"]',
    'nwr["shop"="car_parts"]',
    'nwr["amenity"="car_wash"]',
  ],
  mechanic: [
    'nwr["shop"="car_repair"]',
  ],
  fuel: [
    'nwr["amenity"="fuel"]',
  ],
  petrol: [
    'nwr["amenity"="fuel"]',
  ],
  church: [
    'nwr["amenity"="place_of_worship"]',
  ],
  mosque: [
    'nwr["amenity"="place_of_worship"]',
  ],
  supermart: [
    'nwr["shop"="supermarket"]',
  ],
  grocery: [
    'nwr["shop"="supermarket"]',
    'nwr["shop"="convenience"]',
    'nwr["shop"="greengrocer"]',
  ],
  jewellery: [
    'nwr["shop"="jewelry"]',
  ],
  jewelry: [
    'nwr["shop"="jewelry"]',
  ],
  optician: [
    'nwr["shop"="optician"]',
  ],
  eyeglasses: [
    'nwr["shop"="optician"]',
  ],
};

function keywordAliasQueries(keyword: string): string[] {
  const lc = keyword.toLowerCase().trim();
  // Direct hit
  if (KEYWORD_ALIASES[lc]) return KEYWORD_ALIASES[lc];
  // Fuzzy — does any alias key appear as a whole word in the keyword?
  for (const [alias, queries] of Object.entries(KEYWORD_ALIASES)) {
    if (lc.includes(alias)) return queries;
  }
  return [];
}

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

    // Build the union of tag clauses:
    //  - If no keyword: use just the category tag queries
    //  - If keyword matches an alias: use category + alias tag queries + name-filtered category
    //  - If keyword is arbitrary: use category with name-contains filter
    let clauses: string[] = [];
    if (!keyword) {
      clauses = catQuery
        .split(";")
        .filter((q) => q.trim())
        .map((q) => `${q.trim()}(around:${radius},${args.latitude},${args.longitude});`);
    } else {
      const aliasQueries = keywordAliasQueries(keyword);
      const safeKw = keyword.replace(/["\\]/g, "");
      const nameFilter = `["name"~"${safeKw}",i]`;

      // Alias-matched tag queries (broad — everyone with amenity=pharmacy shows up)
      for (const q of aliasQueries) {
        clauses.push(`${q}(around:${radius},${args.latitude},${args.longitude});`);
      }
      // Also try name-in-category (catches things like "Ridge Pharmacy" tagged as shop=cosmetics)
      for (const q of catQuery.split(";").filter((s) => s.trim())) {
        clauses.push(
          `${q.trim()}${nameFilter}(around:${radius},${args.latitude},${args.longitude});`,
        );
      }
      // Fallback: any place with keyword in its name (covers non-standard tags)
      clauses.push(
        `nwr${nameFilter}(around:${radius},${args.latitude},${args.longitude});`,
      );
    }

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

        // Dedupe: multiple tag clauses can return the same OSM feature.
        const seenIds = new Set<string>();
        const rawPlaces = (json.elements ?? [])
          .filter((el) => {
            const key = `${el.type}:${el.id}`;
            if (seenIds.has(key)) return false;
            seenIds.add(key);
            return true;
          })
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
        const noMega = rawPlaces.filter((p) => !isMegaBrand(p.name));

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
