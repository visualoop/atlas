"use node";

/**
 * Place Details filler — auto-fetches full contact info for prospector
 * results whose phone/website came back empty from Text Search.
 *
 * Text Search (Places API New) sometimes omits contact fields for
 * lesser-known Kenyan SMEs. GET /v1/places/{id} with FieldMask
 * returns the full record including internationalPhoneNumber,
 * websiteUri, regularOpeningHours, etc.
 *
 * Cost: ~1 Places request per gap-fill. Runs in a throttled batch
 * (5 per pass, 1.5s between) so a 20-result search costs ~20 extra
 * requests spread over ~6 seconds. Within Google's free tier.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places/";
const DETAILS_FIELD_MASK = [
  "id",
  "internationalPhoneNumber",
  "nationalPhoneNumber",
  "websiteUri",
  "regularOpeningHours",
  "primaryType",
  "primaryTypeDisplayName",
].join(",");

const BATCH_SIZE = 5;

interface DetailsResponse {
  id?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

export const fillPlaceDetails = internalAction({
  args: { searchId: v.id("prospectorSearches") },
  handler: async (
    ctx,
    args,
  ): Promise<{ filled: number; remaining: boolean }> => {
    console.log("[placeDetails] start", { searchId: args.searchId });

    // 1. Load results in this search missing contact info + not yet
    // hit by /details.
    const rows = await ctx.runQuery(
      internal.prospectorHelpers.loadResultsMissingContact,
      { searchId: args.searchId, limit: BATCH_SIZE },
    );
    if (rows.length === 0) {
      console.log("[placeDetails] nothing to fill");
      return { filled: 0, remaining: false };
    }

    // 2. Resolve the workspace's Google Places API key (session-less
    // path — this runs from a scheduler)
    const setup = await ctx.runQuery(
      internal.prospectorHelpers.getPlacesKeyForWorkspace,
      { workspaceId: rows[0].workspaceId },
    );
    if (!setup?.apiKey) {
      console.error("[placeDetails] no API key");
      return { filled: 0, remaining: false };
    }

    // 3. Fetch details for each in parallel
    const filled = await Promise.allSettled(
      rows.map(async (r) => {
        try {
          const url = `${DETAILS_ENDPOINT}${encodeURIComponent(r.googlePlaceId)}?fields=${encodeURIComponent(DETAILS_FIELD_MASK)}`;
          const res = await fetch(url, {
            headers: {
              "X-Goog-Api-Key": setup.apiKey,
              "X-Goog-FieldMask": DETAILS_FIELD_MASK,
            },
          });
          if (!res.ok) {
            console.warn("[placeDetails] fetch failed", {
              placeId: r.googlePlaceId,
              status: res.status,
            });
            return { patched: false };
          }
          const j = (await res.json()) as DetailsResponse;
          const patch: {
            phone?: string;
            website?: string;
            hoursText?: string;
            enrichmentStatus?: "no_website";
          } = {};
          const phone = j.internationalPhoneNumber ?? j.nationalPhoneNumber;
          if (phone && !r.phone) patch.phone = phone;
          if (j.websiteUri && !r.website) patch.website = j.websiteUri;
          if (j.regularOpeningHours?.weekdayDescriptions?.length) {
            patch.hoursText =
              j.regularOpeningHours.weekdayDescriptions.join(" · ");
          }
          if (!patch.website && !r.website) {
            // Mark as no-website so enrichSearchResults skips it
            patch.enrichmentStatus = "no_website";
          }
          if (Object.keys(patch).length > 0) {
            await ctx.runMutation(
              internal.prospectorHelpers.patchResultContact,
              {
                resultId: r._id as Id<"prospectorResults">,
                patch,
              },
            );
            return { patched: true };
          }
          return { patched: false };
        } catch (err) {
          console.error("[placeDetails] error", {
            placeId: r.googlePlaceId,
            err: String(err),
          });
          return { patched: false };
        }
      }),
    );

    const patchedCount = filled.filter(
      (r) => r.status === "fulfilled" && r.value.patched,
    ).length;

    // 4. If more remain, reschedule
    const stillMissing = await ctx.runQuery(
      internal.prospectorHelpers.loadResultsMissingContact,
      { searchId: args.searchId, limit: 1 },
    );
    if (stillMissing.length > 0) {
      await ctx.scheduler.runAfter(
        1500,
        internal.prospectorPlaceDetails.fillPlaceDetails,
        { searchId: args.searchId },
      );
    }

    console.log("[placeDetails] batch done", {
      filled: patchedCount,
      remaining: stillMissing.length > 0,
    });
    return { filled: patchedCount, remaining: stillMissing.length > 0 };
  },
});
