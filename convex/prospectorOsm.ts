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

/**
 * Category → Geoapify category taxonomy.
 * Ref: https://apidocs.geoapify.com/docs/places/#categories
 * If a workspace has a Geoapify key, we try Geoapify FIRST (3000
 * requests/day free, dedicated infra) and only fall back to
 * Overpass if Geoapify errors.
 */
const GEOAPIFY_CATEGORY_MAP: Record<string, string> = {
  restaurant: "catering.restaurant,catering.cafe,catering.bar,catering.fast_food,catering.food_court,catering.pub,catering.ice_cream",
  retail: "commercial",
  services: "service,office",
  health: "healthcare",
  auto: "service.vehicle,commercial.vehicle,service.fuel",
  hotel: "accommodation",
  office: "office,commercial.money_lending",
};

/**
 * Keyword → Geoapify subcategory. When a user types a common keyword
 * we can hit an exact category rather than name-searching.
 */
const GEOAPIFY_KEYWORD_MAP: Record<string, string> = {
  pharmacy: "healthcare.pharmacy,commercial.health_and_beauty.pharmacy",
  chemist: "commercial.health_and_beauty.pharmacy",
  salon: "commercial.health_and_beauty",
  beauty: "commercial.health_and_beauty",
  hairdresser: "commercial.hairdresser",
  barber: "commercial.hairdresser",
  cafe: "catering.cafe",
  coffee: "catering.cafe",
  bar: "catering.bar,catering.pub",
  restaurant: "catering.restaurant",
  hospital: "healthcare.hospital",
  clinic: "healthcare.clinic_or_praxis",
  dentist: "healthcare.dentist",
  hotel: "accommodation.hotel,accommodation.guest_house",
  gym: "sport.fitness",
  hardware: "commercial.hardware",
  bookshop: "commercial.books",
  butcher: "commercial.food_and_drink.butcher",
  bakery: "commercial.food_and_drink.bakery",
  supermarket: "commercial.supermarket",
  furniture: "commercial.furniture",
  electronics: "commercial.electronics",
  boutique: "commercial.clothing",
  shoes: "commercial.shoes",
  bank: "service.financial.bank_or_atm",
  fuel: "service.vehicle.fuel",
  school: "education.school",
  church: "religion.place_of_worship",
  jewellery: "commercial.jewelry",
  optician: "commercial.health_and_beauty.optician",
  laundry: "commercial.laundry",
  grocery: "commercial.supermarket,commercial.convenience",
};

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
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
    refresh: v.optional(v.boolean()),         // bypass cache
  },
  handler: async (ctx, args): Promise<{
    places: Place[];
    error?: string;
    cached?: boolean;
    source?: "geoapify" | "overpass" | "nominatim";
  }> => {
    // Overpass performance degrades badly beyond 5km; cap it. Nairobi's
    // CBD is fully covered at 3-5km. If the user has panned way out,
    // they need to zoom in for meaningful business density anyway.
    const radius = Math.min(Math.max(args.radiusMeters, 300), 5_000);
    const category = args.category ?? "retail";
    const keyword = (args.nameKeyword ?? "").trim();

    // 0. Check if workspace has Geoapify — determines cache namespace
    // so we don't serve Overpass-era results after user upgrades to
    // Geoapify (different providers = different result sets).
    const geoapifyKey = await ctx.runQuery(
      internal.prospectorOsmHelpers.getGeoapifyKey,
      {},
    );
    const cacheNs = geoapifyKey ? "geoapify" : "overpass";
    const key = `${cacheNs}:${gridKey(args.latitude, args.longitude, radius, category)}:${keyword.toLowerCase().slice(0, 40)}`;

    // 1. Serve from cache if fresh (unless refresh explicitly requested)
    const cached = await ctx.runQuery(internal.prospectorOsmHelpers.getCached, { key });
    if (!args.refresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      // Defensively strip any legacy `_dupCount` field that may still
      // exist in cache entries written before that field was stripped
      // at write time.
      const sanitized = (cached.places as Array<Place & { _dupCount?: number }>).map(
        ({ _dupCount, ...rest }) => rest as Place,
      );
      return {
        places: sanitized,
        cached: true,
        source: cacheNs as "geoapify" | "overpass",
      };
    }

    // 2. Try Geoapify first (3000/day free, dedicated infra, no shared
    // rate limits with Overpass). Only if the workspace has a key.
    if (geoapifyKey) {
      const geo = await fetchFromGeoapify({
        apiKey: geoapifyKey,
        latitude: args.latitude,
        longitude: args.longitude,
        radius,
        category,
        keyword,
      });
      if (geo.places.length > 0) {
        const filtered = applyMegaBrandFilter(geo.places);
        await ctx.runMutation(internal.prospectorOsmHelpers.saveCached, {
          key,
          places: filtered,
        });
        return { places: filtered, cached: false, source: "geoapify" };
      }
      // Geoapify returned empty. If it wasn't a hard error, respect
      // it — don't burn 60s on 4 Overpass mirrors. User can widen the
      // radius or switch data source. If it WAS an error (401 / network),
      // fall through to Overpass as a safety net.
      if (!geo.error) {
        return {
          places: [],
          source: "geoapify",
          error: `Geoapify found no ${keyword || category} within ${Math.round(radius / 1000)}km. Widen the map, try another keyword, or switch to Places+OSM (Google) above.`,
        };
      }
      // Geoapify actually errored (network, 401, etc.) — fall through
      // to Overpass as a safety net
    }

    // 3. Fetch from Overpass
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
          const { _dupCount: dupCount, ...rest } = p;
          if (dupCount && dupCount > 1) {
            return {
              ...rest,
              types: [...(rest.types ?? []), `${dupCount} branches`],
            } as Place;
          }
          return rest as Place;
        });

        // 3. Cache the result
        await ctx.runMutation(internal.prospectorOsmHelpers.saveCached, {
          key,
          places: dedupedPlaces,
        });

        return { places: dedupedPlaces, cached: false, source: "overpass" };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Network error";
        continue;
      }
    }

    // All mirrors failed. Fallback chain:
    //   1. Stale cache — serve silently (no scary error banner)
    //   2. Nominatim text search — only helps for keyword queries
    //   3. Empty + informative error
    if (cached) {
      return {
        places: cached.places as Place[],
        cached: true,
        source: cacheNs as "geoapify" | "overpass",
      };
    }

    if (keyword) {
      try {
        // Nominatim doesn't do POI-by-category well but IS decent at
        // free-text place lookups within a bbox. Last resort only.
        const bboxDelta = Math.min(0.1, radius / 111_000); // rough deg per m
        const params = new URLSearchParams({
          q: keyword,
          format: "jsonv2",
          limit: "40",
          viewbox: [
            args.longitude - bboxDelta,
            args.latitude + bboxDelta,
            args.longitude + bboxDelta,
            args.latitude - bboxDelta,
          ].join(","),
          bounded: "1",
          extratags: "1",
        });
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            headers: { "User-Agent": USER_AGENT, "From": FROM_EMAIL },
          },
        );
        if (nomRes.ok) {
          const items = (await nomRes.json()) as Array<{
            osm_id: number;
            osm_type: string;
            display_name?: string;
            name?: string;
            lat: string;
            lon: string;
            type?: string;
            class?: string;
          }>;
          const nomPlaces: Place[] = items
            .filter((it) => it.name || it.display_name)
            .map((it) => ({
              googlePlaceId: `osm-${it.osm_type}-${it.osm_id}`,
              name: it.name ?? it.display_name?.split(",")[0] ?? "(unnamed)",
              address: it.display_name,
              latitude: parseFloat(it.lat),
              longitude: parseFloat(it.lon),
              types: [it.class ?? "", it.type ?? ""].filter(Boolean),
              businessStatus: "OPERATIONAL",
            }))
            .filter((p) => !isMegaBrand(p.name));
          if (nomPlaces.length > 0) {
            await ctx.runMutation(internal.prospectorOsmHelpers.saveCached, {
              key,
              places: nomPlaces,
            });
            return { places: nomPlaces, cached: false, source: "nominatim" };
          }
        }
      } catch {
        // Fall through to empty
      }
    }

    return {
      places: [],
      error: `OpenStreetMap free mirrors are all rate-limiting right now (${lastError.slice(0, 80)}). Wait 60 seconds, or switch to Places+OSM mode above (uses your Google Places key).`,
    };
  },
});

/**
 * Fetch places from Geoapify Places API.
 * Free tier: 3000 requests/day. Same OSM data as Overpass, but
 * Geoapify runs their own infra so rate limits are per-key, not
 * per-IP-shared-with-random-strangers.
 */
async function fetchFromGeoapify(args: {
  apiKey: string;
  latitude: number;
  longitude: number;
  radius: number;
  category: string;
  keyword: string;
}): Promise<{ places: Place[]; error?: string }> {
  try {
    // Category resolution:
    //   1. If keyword matches an alias → use its Geoapify subcategory
    //   2. Otherwise fall back to the top-level category map
    const kwLower = args.keyword.toLowerCase().trim();
    const kwCategory = kwLower ? GEOAPIFY_KEYWORD_MAP[kwLower] : undefined;
    const categories =
      kwCategory ??
      GEOAPIFY_CATEGORY_MAP[args.category] ??
      GEOAPIFY_CATEGORY_MAP.retail;

    const params = new URLSearchParams({
      categories,
      filter: `circle:${args.longitude},${args.latitude},${Math.round(args.radius)}`,
      bias: `proximity:${args.longitude},${args.latitude}`,
      limit: "40",
      apiKey: args.apiKey,
    });
    // If there's a keyword we couldn't match to a category, use `name`
    // as an additional filter (still returns even if name doesn't match
    // because Geoapify treats it as soft filter)
    if (args.keyword && !kwCategory) {
      params.set("name", args.keyword);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(
      `https://api.geoapify.com/v2/places?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      return { places: [], error: `Geoapify HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      features?: Array<{
        properties?: {
          name?: string;
          formatted?: string;
          place_id?: string;
          categories?: string[];
          website?: string;
          phone?: string;
          address_line1?: string;
          address_line2?: string;
          lat?: number;
          lon?: number;
        };
        geometry?: { coordinates?: [number, number] };
      }>;
    };
    const places: Place[] = (json.features ?? [])
      .map((f) => {
        const p = f.properties ?? {};
        const [lon, lat] = f.geometry?.coordinates ?? [];
        if (!p.name || typeof lat !== "number" || typeof lon !== "number") return null;
        return {
          googlePlaceId: `geo-${p.place_id ?? `${lat}-${lon}`}`,
          name: p.name,
          address: p.formatted ?? [p.address_line1, p.address_line2].filter(Boolean).join(", "),
          latitude: lat,
          longitude: lon,
          phoneRaw: p.phone,
          website: p.website,
          googleMapsUri: `https://www.openstreetmap.org/?query=${encodeURIComponent(p.name)}`,
          types: p.categories ?? [],
          rating: undefined,
          ratingCount: undefined,
          businessStatus: "OPERATIONAL",
        } as Place;
      })
      .filter((x): x is Place => x !== null);
    return { places };
  } catch (err) {
    return { places: [], error: err instanceof Error ? err.message : "network" };
  }
}

/**
 * Apply mega-brand deny-list + collapse same-name duplicates.
 * Shared between Geoapify and Overpass code paths.
 */
function applyMegaBrandFilter(places: Place[]): Place[] {
  const noMega = places.filter((p) => !isMegaBrand(p.name));
  const byName = new Map<string, Place & { _dupCount?: number }>();
  for (const p of noMega) {
    const nk = p.name.toLowerCase().trim();
    const existing = byName.get(nk);
    if (existing) {
      existing._dupCount = (existing._dupCount ?? 1) + 1;
    } else {
      byName.set(nk, p);
    }
  }
  return Array.from(byName.values()).map((p) => {
    const { _dupCount: dupCount, ...rest } = p;
    if (dupCount && dupCount > 1) {
      return {
        ...rest,
        types: [...(rest.types ?? []), `${dupCount} branches`],
      } as Place;
    }
    return rest as Place;
  });
}
