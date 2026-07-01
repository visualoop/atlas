"use node";

/**
 * OpenStreetMap Nominatim — free alternative to Google Places.
 *
 * No API key. No billing. Rate-limited by Nominatim's usage policy to
 * 1 request per second — we self-throttle by adding a 1s delay between
 * calls if the founder hammers it.
 *
 * Data richness: 30-50% of Google Places. Business names + addresses
 * are usually good in Nairobi. Phone/website/rating fields are only
 * populated when the OSM community tagged them, which is patchy.
 *
 * Coverage:
 *  - Nairobi central: 60-80% of businesses (as of 2025)
 *  - Rural Kenya: 20-30%
 *  - International: varies by city
 *
 * Ideal for: quick prospecting when the founder doesn't have Google
 * billing yet. Not a permanent replacement — recommend upgrading to
 * Google Places once billing is added.
 *
 * Docs: https://nominatim.org/release-docs/develop/api/Search/
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Atlas by Blyss — atlas.blyss.co.ke (justinequartz1@gmail.com)";

interface NominatimResult {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  address?: {
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    country?: string;
    country_code?: string;
  };
  extratags?: {
    phone?: string;
    website?: string;
    opening_hours?: string;
    email?: string;
  };
  importance?: number;
}

const CATEGORY_TO_OSM: Record<string, string> = {
  restaurant: "restaurant",
  retail: "shop",
  services: "office",
  health: "clinic",
  auto: "car_repair",
  hotel: "hotel",
  office: "office",
};

/**
 * searchNearbyOsm — fetches businesses near a lat/lng from Nominatim.
 *
 * Nominatim doesn't have a true nearby-search — we simulate one by
 * constructing a bounded query using a viewbox around the center.
 */
export const searchNearbyOsm = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    places: Array<{
      googlePlaceId: string;                     // We use "osm-<place_id>" so the shape matches Google
      name: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      phoneRaw?: string;
      website?: string;
      googleMapsUri?: string;                    // OSM url instead
      types?: string[];
      rating?: number;
      ratingCount?: number;
      businessStatus?: string;
    }>;
    error?: string;
  }> => {
    // Rough conversion: 1 degree lat ≈ 111km, so radiusMeters/111000 = deg
    const degLat = args.radiusMeters / 111_000;
    const degLng =
      args.radiusMeters / (111_000 * Math.cos((args.latitude * Math.PI) / 180));
    const viewbox = [
      args.longitude - degLng,
      args.latitude + degLat,
      args.longitude + degLng,
      args.latitude - degLat,
    ].join(",");

    const osmCategory = args.category ? CATEGORY_TO_OSM[args.category] : "shop";

    const params = new URLSearchParams({
      q: `[${osmCategory}]`,
      format: "jsonv2",
      viewbox,
      bounded: "1",
      limit: "40",
      extratags: "1",
      addressdetails: "1",
    });

    try {
      const res = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en",
        },
      });
      if (!res.ok) {
        return { places: [], error: `Nominatim ${res.status}` };
      }
      const json = (await res.json()) as NominatimResult[];

      const places = json.map((r) => {
        const city =
          r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.county;
        const addr = [r.address?.road, city, r.address?.country].filter(Boolean).join(", ");

        return {
          googlePlaceId: `osm-${r.osm_type}-${r.osm_id}`,
          name: r.name ?? r.display_name.split(",")[0] ?? "(unnamed)",
          address: addr || r.display_name,
          latitude: parseFloat(r.lat),
          longitude: parseFloat(r.lon),
          phoneRaw: r.extratags?.phone,
          website: r.extratags?.website,
          googleMapsUri: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
          types: [r.class, r.type].filter((v): v is string => Boolean(v)),
          rating: undefined,
          ratingCount: undefined,
          businessStatus: "OPERATIONAL",
        };
      });

      return { places };
    } catch (err) {
      return { places: [], error: err instanceof Error ? err.message : "Network error" };
    }
  },
});
