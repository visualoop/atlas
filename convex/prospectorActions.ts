"use node";

/**
 * Prospector actions — Google Places (New) API integration.
 *
 * We use the modern REST endpoint:
 *   POST https://places.googleapis.com/v1/places:searchText
 *
 * Field mask keeps token cost low (billed per field group):
 *   Basic (free): id, displayName, formattedAddress, location, types,
 *                  businessStatus, googleMapsUri
 *   Contact (mid): internationalPhoneNumber, websiteUri, regularOpeningHours
 *   Atmosphere (high): rating, userRatingCount, priceLevel
 *
 * Two entry points:
 *   - searchAndPersist: run the search + write results in one shot.
 *   - runSearchById: re-runs an existing prospectorSearch record
 *     (for pagination + refresh).
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const LEGACY_TEXTSEARCH_ENDPOINT = "https://maps.googleapis.com/maps/api/place/textsearch/json";

// The bracketed dotted paths are the FieldMask.
// Include contact + hours + rating fields so search returns full lead data
// in ONE call — no follow-up /details roundtrip needed.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.regularOpeningHours",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

interface GooglePlace {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  location?: { latitude?: number; longitude?: number };
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
}

interface PlacesResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
  error?: { message?: string; status?: string };
}

export const searchAndPersist = action({
  args: {
    searchId: v.id("prospectorSearches"),
    pageToken: v.optional(v.string()),                    // for pagination
  },
  handler: async (ctx, args): Promise<{
    persisted: number;
    nextPageToken?: string;
    error?: string;
    cached?: boolean;
  }> => {
    // 1. Resolve the search + org key
    const setup = await ctx.runQuery(internal.prospectorHelpers.prepareSearch, {
      searchId: args.searchId,
    });
    if (!setup.apiKey) {
      throw new ConvexError({
        code: "NO_KEY",
        message: "Google Maps Places key not configured for this organization.",
      });
    }

    // Dedup — if this search ran within the last 5 minutes AND we're
    // not paginating, skip the API call and return cached results.
    // Saves Google Places quota + gives instant feedback on retry.
    const FRESH_MS = 5 * 60 * 1000;
    if (
      !args.pageToken &&
      setup.search.lastRunAt &&
      Date.now() - setup.search.lastRunAt < FRESH_MS &&
      (setup.search.resultCount ?? 0) > 0
    ) {
      return {
        persisted: 0,
        cached: true,
        nextPageToken: setup.search.nextPageToken,
      };
    }

    // Enforce daily cap BEFORE the billable call
    await ctx.runMutation(internal.apiUsage.checkAndRecord, {
      workspaceId: setup.search.workspaceId,
    });

    const query = setup.search.query + (setup.search.location ? ` in ${setup.search.location}` : "");

    // 2. Places API (New) — places:searchText.
    // Returns full contact fields (phone, website, hours) in one call
    // via the FieldMask above. No follow-up /details roundtrip needed.
    // Falls back to Legacy Text Search if New API is unavailable.
    let json: PlacesResponse;
    try {
      const body: Record<string, unknown> = {
        textQuery: query,
        maxResultCount: 20,
        regionCode: "ke",
      };
      if (args.pageToken) body.pageToken = args.pageToken;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": setup.apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // If the New API is disabled/unavailable, fall through to Legacy.
        if (res.status === 403 || res.status === 404) {
          throw new Error("new_api_unavailable");
        }
        return { persisted: 0, error: `Places API ${res.status}` };
      }
      json = (await res.json()) as PlacesResponse;
      if (json.error) {
        return {
          persisted: 0,
          error: json.error.message ?? json.error.status ?? "Unknown error",
        };
      }
    } catch (err) {
      // Fallback to Legacy Text Search (returns less contact data,
      // but always available).
      const params = new URLSearchParams({
        query,
        key: setup.apiKey,
      });
      if (!setup.search.locationBias && !setup.search.location) {
        params.set("region", "ke");
      }
      if (args.pageToken) params.set("pagetoken", args.pageToken);

      let legacyJson: LegacyNearbyResponse;
      try {
        const res = await fetch(`${LEGACY_TEXTSEARCH_ENDPOINT}?${params.toString()}`);
        if (!res.ok) {
          return { persisted: 0, error: `Places API ${res.status}` };
        }
        legacyJson = (await res.json()) as LegacyNearbyResponse;
        if (legacyJson.status && legacyJson.status !== "OK" && legacyJson.status !== "ZERO_RESULTS") {
          return { persisted: 0, error: legacyJson.error_message ?? legacyJson.status };
        }
      } catch (err2) {
        return { persisted: 0, error: err2 instanceof Error ? err2.message : "Network error" };
      }

      // Normalize into the shape expected downstream (mirrors the v1 shape)
      json = {
        places: (legacyJson.results ?? []).map((p) => ({
          id: p.place_id,
          displayName: { text: p.name ?? "(unnamed)" },
          formattedAddress: p.formatted_address ?? p.vicinity,
          addressComponents: [],
          location: {
            latitude: p.geometry?.location?.lat,
            longitude: p.geometry?.location?.lng,
          },
          types: p.types,
          rating: p.rating,
          userRatingCount: p.user_ratings_total,
          businessStatus: p.business_status,
          googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        })),
        nextPageToken: legacyJson.next_page_token,
      };
    }

    if (json.error) {
      return { persisted: 0, error: json.error.message ?? json.error.status ?? "Unknown error" };
    }

    // 4. Transform to our shape
    const results = (json.places ?? []).map((p) => {
      const cityComp = p.addressComponents?.find((c) => c.types?.includes("locality"));
      const countryComp = p.addressComponents?.find((c) => c.types?.includes("country"));
      return {
        googlePlaceId: p.id,
        name: p.displayName?.text ?? "(unnamed)",
        address: p.formattedAddress,
        city: cityComp?.longText,
        country: countryComp?.shortText ?? "KE",
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        phoneRaw: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
        website: p.websiteUri,
        googleMapsUri: p.googleMapsUri,
        types: p.types,
        rating: p.rating,
        ratingCount: p.userRatingCount,
        businessStatus: p.businessStatus,
        rawPlaceData: {
          rating: p.rating,
          ratingCount: p.userRatingCount,
          types: p.types,
        },
      };
    });

    // 5. Persist
    const persisted = await ctx.runMutation(internal.prospector.persistSearchResults, {
      searchId: args.searchId,
      workspaceId: setup.search.workspaceId,
      results,
      nextPageToken: json.nextPageToken,
    });

    return { persisted: persisted.persisted, nextPageToken: json.nextPageToken };
  },
});


/* ------------------------------------------------------------------ */
/* searchNearby — bounds-based query for the map browse UI              */
/* ------------------------------------------------------------------ */

// Legacy Places API — works with default billing (no separate 'Places API New'
// enablement required). Use these while the founder is on the free tier.
// If Places API (New) is enabled, we upgrade to /v1/places:searchNearby which
// has cleaner shape + better field selection.
const LEGACY_NEARBY_ENDPOINT = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const LEGACY_DETAILS_ENDPOINT = "https://maps.googleapis.com/maps/api/place/details/json";
const NEARBY_ENDPOINT_NEW = "https://places.googleapis.com/v1/places:searchNearby";
const NEARBY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

const INCLUDED_TYPE_MAP: Record<string, string[]> = {
  restaurant: ["restaurant", "cafe", "bar"],
  retail: ["store", "supermarket", "clothing_store", "shopping_mall"],
  services: ["accounting", "lawyer", "real_estate_agency", "insurance_agency"],
  health: ["hospital", "pharmacy", "dental_clinic", "spa"],
  auto: ["car_dealer", "car_repair", "gas_station"],
  hotel: ["hotel", "lodging"],
  office: ["corporate_office"],
};

// Legacy API uses a single string, not an array.
const LEGACY_TYPE_MAP: Record<string, string> = {
  restaurant: "restaurant",
  retail: "store",
  services: "accounting",
  health: "hospital",
  auto: "car_repair",
  hotel: "lodging",
  office: "point_of_interest",
};

interface LegacyPlace {
  place_id: string;
  name?: string;
  vicinity?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  photos?: unknown[];
}

interface LegacyNearbyResponse {
  results?: LegacyPlace[];
  status?: string;
  error_message?: string;
  next_page_token?: string;
}

interface LegacyDetailsResponse {
  result?: LegacyPlace & {
    international_phone_number?: string;
    formatted_phone_number?: string;
    website?: string;
    url?: string;
  };
  status?: string;
}

export const searchNearby = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.number(),                             // 1-50000
    category: v.optional(v.string()),                     // key of INCLUDED_TYPE_MAP
    includedType: v.optional(v.string()),                 // explicit override
    useLegacy: v.optional(v.boolean()),                   // default true — Legacy Places API
    nameKeyword: v.optional(v.string()),                  // free-text keyword (name/type/address)
  },
  handler: async (ctx, args): Promise<{
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
    const setup = await ctx.runQuery(internal.prospectorHelpers.prepareForNearby, {});
    if (!setup.apiKey) {
      throw new ConvexError({
        code: "NO_KEY",
        message: "Google Maps Places key not configured. Add it in Settings → Integrations.",
      });
    }
    if (!setup.workspaceId) {
      throw new ConvexError({ code: "NO_WORKSPACE", message: "Not in a workspace." });
    }

    // Check + record cap BEFORE we make the billable call
    await ctx.runMutation(internal.apiUsage.checkAndRecord, {
      workspaceId: setup.workspaceId,
    });

    // Default to Legacy API (free-tier-friendly)
    const useLegacy = args.useLegacy !== false;

    if (useLegacy) {
      const type = args.includedType ?? (args.category ? LEGACY_TYPE_MAP[args.category] : undefined);
      const params = new URLSearchParams({
        location: `${args.latitude},${args.longitude}`,
        radius: String(Math.min(Math.max(args.radiusMeters, 1), 50_000)),
        key: setup.apiKey,
      });
      if (type) params.set("type", type);
      // Google Legacy Nearby Search's `keyword` matches business
      // name, type, and address content.
      const kw = args.nameKeyword?.trim();
      if (kw) params.set("keyword", kw);

      try {
        const res = await fetch(`${LEGACY_NEARBY_ENDPOINT}?${params.toString()}`);
        if (!res.ok) return { places: [], error: `Places ${res.status}` };
        const json = (await res.json()) as LegacyNearbyResponse;
        if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
          return { places: [], error: json.error_message ?? json.status };
        }
        const places = (json.results ?? []).map((p) => ({
          googlePlaceId: p.place_id,
          name: p.name ?? "(unnamed)",
          address: p.formatted_address ?? p.vicinity,
          latitude: p.geometry?.location?.lat,
          longitude: p.geometry?.location?.lng,
          phoneRaw: undefined,                        // Legacy nearby doesn't include phone; need /details
          website: undefined,
          googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
          types: p.types,
          rating: p.rating,
          ratingCount: p.user_ratings_total,
          businessStatus: p.business_status,
        }));
        return { places };
      } catch (err) {
        return { places: [], error: err instanceof Error ? err.message : "Network error" };
      }
    }

    // Fallback: Places API (New)
    //   - If a keyword is provided, use `places:searchText` — the New
    //     API's text search that combines free-text with location bias.
    //   - Otherwise, use `places:searchNearby` — pure nearby by radius.
    const kwNew = args.nameKeyword?.trim();
    const includedTypes = args.includedType
      ? [args.includedType]
      : args.category
      ? INCLUDED_TYPE_MAP[args.category]
      : undefined;

    const endpointNew = kwNew
      ? "https://places.googleapis.com/v1/places:searchText"
      : NEARBY_ENDPOINT_NEW;

    const body: Record<string, unknown> = kwNew
      ? {
          textQuery: kwNew,
          maxResultCount: 20,
          locationBias: {
            circle: {
              center: { latitude: args.latitude, longitude: args.longitude },
              radius: Math.min(Math.max(args.radiusMeters, 1), 50_000),
            },
          },
        }
      : {
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: args.latitude, longitude: args.longitude },
              radius: Math.min(Math.max(args.radiusMeters, 1), 50_000),
            },
          },
        };
    if (!kwNew && includedTypes) body.includedTypes = includedTypes;
    if (kwNew && includedTypes) body.includedType = includedTypes[0];

    try {
      const res = await fetch(endpointNew, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": setup.apiKey,
          "X-Goog-FieldMask": NEARBY_FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { places: [], error: `Places API ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const json = (await res.json()) as PlacesResponse;
      if (json.error) {
        return { places: [], error: json.error.message ?? json.error.status ?? "unknown" };
      }
      const places = (json.places ?? []).map((p) => ({
        googlePlaceId: p.id,
        name: p.displayName?.text ?? "(unnamed)",
        address: p.formattedAddress,
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        phoneRaw: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
        website: p.websiteUri,
        googleMapsUri: p.googleMapsUri,
        types: p.types,
        rating: p.rating,
        ratingCount: p.userRatingCount,
        businessStatus: p.businessStatus,
      }));

      // Filter Kenyan mega-brands + collapse duplicates
      const filtered = filterAndDedupe(places);

      return { places: filtered };
    } catch (err) {
      return { places: [], error: err instanceof Error ? err.message : "Network error" };
    }
  },
});

/**
 * Shared mega-brand filter + duplicate collapser for both Google
 * Places + OSM sources. Kept here (in a "use node" file) to avoid
 * a Node/V8 boundary crossing.
 */
const MEGA_BRAND_DENYLIST = [
  "naivas", "carrefour", "quickmart", "chandarana", "cleanshelf",
  "tuskys", "tusky", "nakumatt", "uchumi", "ukwala", "eastmatt",
  "shoprite", "game store", "gamestore",
  "java house", "javahouse", "artcaffe", "kfc", "pizza inn", "chicken inn",
  "creamy inn", "galitos", "subway", "mcdonald", "burger king", "steers",
  "debonairs", "domino", "cj's", "cj s", "wimpy", "big square",
  "kcb", "equity bank", "co-operative bank", "cooperative bank", "co-op bank",
  "absa", "standard chartered", "stanchart", "stanbic", "ncba", "dtb",
  "national bank", "family bank", "i&m bank", "im bank", "citibank",
  "gulf african bank", "sidian", "cba bank", "commercial bank of africa",
  "hfc", "kwft", "faulu", "housing finance",
  "safaricom", "airtel", "telkom kenya", "jamii telecom",
  "shell", "total energies", "totalenergies", "rubis", "ola energy", "oilibya",
  "kenol kobil", "kenolkobil", "vivo", "hass petroleum",
  "goodlife pharmacy", "goodlife", "haltons", "healthplus", "afrimed", "portland pharmacy",
  "hotpoint", "samsung dealership", "samsung store",
  "britam", "jubilee", "cic insurance", "old mutual", "sanlam", "apa insurance",
  "uap", "resolution insurance", "madison insurance",
  "bata", "mr price", "woolworths", "truworths",
  "serena", "sarova", "fairmont", "hilton", "radisson", "movenpick",
  "intercontinental", "sheraton", "villa rosa", "kempinski",
  "text book centre", "textbook centre",
];

function isMegaBrand(name: string): boolean {
  const lc = name.toLowerCase();
  return MEGA_BRAND_DENYLIST.some((brand) => lc.includes(brand));
}

/**
 * Google Place types that indicate a shopping center / mall / big
 * complex — never an independent SMB, always a landlord. We hard-
 * filter these out because they clog up prospector results for
 * generic queries like "clothing shops in Nairobi".
 */
const DISQUALIFYING_TYPES = new Set([
  "shopping_mall",
  "department_store",
  "supermarket",
  "airport",
  "train_station",
  "bus_station",
  "subway_station",
  "transit_station",
  "school",
  "university",
  "hospital",
  "police",
  "post_office",
  "embassy",
  "city_hall",
  "courthouse",
  "local_government_office",
  "government_office",
]);

/**
 * Name patterns that give away a mall / complex / big-brand branch
 * even when the primary type doesn't. Google mixes types heavily.
 */
const DISQUALIFYING_NAME_PATTERNS = [
  /\bmall\b/i,
  /\bplaza\b/i,
  /\bshopping\s+center\b/i,
  /\bshopping\s+centre\b/i,
  /\bmarket\b/i,      // catches "Village Market", "City Market"
  /\barcade\b/i,
  /\bcomplex\b/i,
  /\btowers?\b/i,
  /\bcentre\b/i,      // "Sarit Centre", "Yaya Centre" (as full name)
  /\bcenter$/i,
  /\bhouse$/i,        // "Imenti House", "Development House" — buildings, not businesses
];

function isDisqualifyingType(types: string[] | undefined, name: string): boolean {
  if (types) {
    for (const t of types) {
      if (DISQUALIFYING_TYPES.has(t)) return true;
    }
  }
  // Name pattern check — but only if the name is short + isolated (not
  // "Salama Pharmacy at Sarit Centre"). Rule: name is 4 words or fewer.
  const words = name.trim().split(/\s+/).length;
  if (words <= 4) {
    for (const pat of DISQUALIFYING_NAME_PATTERNS) {
      if (pat.test(name)) return true;
    }
  }
  return false;
}

interface PlaceLike {
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

function filterAndDedupe<T extends PlaceLike>(places: T[]): T[] {
  const noMega = places.filter(
    (p) => !isMegaBrand(p.name) && !isDisqualifyingType(p.types, p.name),
  );
  const byName = new Map<string, T & { _dupCount?: number }>();
  for (const p of noMega) {
    const key = p.name.toLowerCase().trim();
    const existing = byName.get(key);
    if (existing) {
      existing._dupCount = (existing._dupCount ?? 1) + 1;
    } else {
      byName.set(key, p as T & { _dupCount?: number });
    }
  }
  return Array.from(byName.values()).map((p) => {
    const { _dupCount: dupCount, ...rest } = p;
    if (dupCount && dupCount > 1) {
      return {
        ...rest,
        types: [...(rest.types ?? []), `${dupCount} branches`],
      } as T;
    }
    return rest as T;
  });
}

/**
 * importOneFromMap — one-shot: pass a full place payload, we upsert
 * a company + optional contact stub.
 */
export const importOneFromMap = action({
  args: {
    googlePlaceId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    phoneRaw: v.optional(v.string()),
    website: v.optional(v.string()),
    googleMapsUri: v.optional(v.string()),
    types: v.optional(v.array(v.string())),
    rating: v.optional(v.number()),
    ratingCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    companyId: Id<"companies">;
    duplicated: boolean;
  }> => {
    return await ctx.runMutation(internal.prospector.importMapPlace, args);
  },
});
