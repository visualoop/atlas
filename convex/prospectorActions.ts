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

// The bracketed dotted paths are the FieldMask.
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

    // 2. Build request
    const body: Record<string, unknown> = {
      textQuery: setup.search.query + (setup.search.location ? ` in ${setup.search.location}` : ""),
      pageSize: 20,
    };
    if (args.pageToken) body.pageToken = args.pageToken;
    // Bias to Kenya by default if the workspace hasn't set a location
    if (!setup.search.locationBias && !setup.search.location) {
      body.regionCode = "KE";
    }
    if (setup.search.locationBias) {
      body.locationBias = setup.search.locationBias;
    }

    // 3. Call Places API
    let json: PlacesResponse;
    try {
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
        const errText = await res.text();
        return {
          persisted: 0,
          error: `Places API ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      json = (await res.json()) as PlacesResponse;
    } catch (err) {
      return {
        persisted: 0,
        error: err instanceof Error ? err.message : "Network error",
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
