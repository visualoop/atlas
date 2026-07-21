"use node";

/**
 * Prospector enrichment — post-import contact detail fetch.
 *
 * When a workspace imports a place via bulkImportMapPlaces or
 * importOneFromMap, the base Places/Geoapify Nearby response often
 * lacks phone + website (OSM data is spotty, Google Legacy Nearby
 * doesn't include those fields by default). Result: contacts land
 * without a reachable channel.
 *
 * This action fires per company after import and:
 *   1. Detects the source (Geoapify vs Google based on googlePlaceId)
 *   2. Calls the appropriate Place Details API
 *   3. Patches company + primary contact with phone/website/hours
 *   4. Records a timeline event so user knows it was enriched
 *
 * Costs 1 Geoapify credit OR 1 Google Places Details call per import.
 * Geoapify free tier is 3000/day so this is essentially free.
 *
 * Runs as an internal action scheduled from the import mutations so
 * it doesn't block the UI response.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Parallelism budget for enrichment.
 * Geoapify free tier is 3000/day + 20 req/sec — 3 in-flight is safe.
 * Google Places also comfortably handles this.
 */
const BATCH_SIZE = 3;
const RESCHEDULE_DELAY_MS = 500;

interface EnrichmentResult {
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  openingHours?: string[];
  facilities?: string[];
  categoriesFine?: string[];
}

export const enrichCompany = internalAction({
  args: {
    companyId: v.id("companies"),
    googlePlaceId: v.string(),
  },
  handler: async (ctx, args): Promise<{ enriched: boolean; reason?: string }> => {
    const setup = await ctx.runQuery(
      internal.prospectorEnrichHelpers.prepareForEnrichment,
      { companyId: args.companyId },
    );
    if (!setup) return { enriched: false, reason: "company_not_found" };

    // Skip if already enriched recently (within 30 days)
    if (
      setup.enrichedAt &&
      Date.now() - setup.enrichedAt < 30 * 24 * 60 * 60 * 1000
    ) {
      return { enriched: false, reason: "already_enriched" };
    }

    // Detect source from googlePlaceId prefix.
    // Geoapify ids start with 'geo-', OSM ids with 'osm-', Google
    // Places ids are opaque ChIJ-prefixed base64-ish strings.
    let result: EnrichmentResult = {};
    if (args.googlePlaceId.startsWith("geo-")) {
      // Extract the raw Geoapify place_id (after our 'geo-' prefix)
      const rawId = args.googlePlaceId.slice(4);
      if (setup.geoapifyKey) {
        result = await fetchGeoapifyDetails(rawId, setup.geoapifyKey);
      }
    } else if (args.googlePlaceId.startsWith("osm-")) {
      // OSM-native ids have no details endpoint — skip Place Details,
      // but we can still scrape the website below for an email.
    } else if (setup.googlePlacesKey) {
      // Google Places
      result = await fetchGooglePlaceDetails(
        args.googlePlaceId,
        setup.googlePlacesKey,
      );
    }

    // Website scrape for EMAIL (+ fallback phone) — Place Details never
    // returns an email, so we fetch the company's site and extract
    // contacts via the same AI path text-search uses. Runs for every
    // source that has a website (Google New API + OSM both provide one).
    const siteUrl = result.website ?? setup.currentWebsite;
    if (siteUrl && !result.email && !setup.currentEmail) {
      try {
        const scraped = await ctx.runAction(
          internal.aiWorkflows.extractContactsFromUrl,
          {
            url: siteUrl,
            workspaceId: setup.workspaceId,
            organizationId: setup.organizationId,
            actorId: setup.ownerId,
            resourceType: "company",
            resourceId: args.companyId,
          },
        );
        if (scraped.email) result.email = scraped.email.toLowerCase();
        if (scraped.phone && !result.phone) {
          const norm = normalizePhoneKe(scraped.phone);
          result.phone = norm;
          result.whatsapp = result.whatsapp ?? norm;
        }
      } catch {
        // scrape failed — keep whatever Place Details gave us
      }
    }

    // Only patch if we got at least one useful field
    const hasNew =
      Boolean(result.phone && !setup.currentPhone) ||
      Boolean(result.website && !setup.currentWebsite) ||
      Boolean(result.email && !setup.currentEmail) ||
      Boolean(result.openingHours?.length);

    if (!hasNew) return { enriched: false, reason: "no_new_data" };

    await ctx.runMutation(internal.prospectorEnrichHelpers.applyEnrichment, {
      companyId: args.companyId,
      result: {
        phone: result.phone,
        whatsapp: result.whatsapp,
        email: result.email,
        website: result.website,
        openingHours: result.openingHours,
        facilities: result.facilities,
        categoriesFine: result.categoriesFine,
      },
    });

    return { enriched: true };
  },
});

/**
 * Geoapify Place Details — free tier included.
 * https://apidocs.geoapify.com/docs/place-details/
 */
async function fetchGeoapifyDetails(
  placeId: string,
  apiKey: string,
): Promise<EnrichmentResult> {
  try {
    const url = `https://api.geoapify.com/v2/place-details?id=${encodeURIComponent(placeId)}&features=details,contact,facilities&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const j = (await res.json()) as {
      features?: Array<{
        properties?: {
          contact?: {
            phone?: string | string[];
            fax?: string;
            email?: string | string[];
            website?: string;
            facebook?: string;
            instagram?: string;
            twitter?: string;
          };
          website?: string;
          phone?: string;
          email?: string;
          opening_hours?: string | string[];
          facilities?: Record<string, unknown>;
          categories?: string[];
        };
      }>;
    };
    const props = j.features?.[0]?.properties ?? {};
    const contact = props.contact ?? {};

    // Contact fields can be scalar OR array — normalize
    const pickFirst = (v: unknown): string | undefined => {
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
      return undefined;
    };

    const rawPhone = pickFirst(contact.phone) ?? props.phone;
    const rawEmail = pickFirst(contact.email) ?? props.email;
    const website = contact.website ?? props.website;

    // Parse opening_hours which comes as a semi-structured string
    // like "Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off"
    let openingHours: string[] | undefined;
    const oh = props.opening_hours;
    if (typeof oh === "string" && oh.trim()) {
      openingHours = oh
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(oh)) {
      openingHours = oh.filter((x): x is string => typeof x === "string");
    }

    return {
      phone: normalizePhoneKe(rawPhone),
      whatsapp: normalizePhoneKe(rawPhone),
      email: rawEmail ? rawEmail.toLowerCase() : undefined,
      website: website,
      openingHours,
      facilities: props.facilities ? Object.keys(props.facilities) : undefined,
      categoriesFine: props.categories,
    };
  } catch {
    return {};
  }
}

/**
 * Google Places Details (Legacy API).
 * https://developers.google.com/maps/documentation/places/web-service/details
 */
async function fetchGooglePlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<EnrichmentResult> {
  try {
    const fields = [
      "name",
      "formatted_phone_number",
      "international_phone_number",
      "website",
      "opening_hours",
      "types",
      "business_status",
    ].join(",");
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const j = (await res.json()) as {
      status?: string;
      result?: {
        formatted_phone_number?: string;
        international_phone_number?: string;
        website?: string;
        opening_hours?: { weekday_text?: string[] };
        types?: string[];
      };
    };
    if (j.status !== "OK") return {};
    const r = j.result ?? {};
    return {
      phone: normalizePhoneKe(r.international_phone_number ?? r.formatted_phone_number),
      whatsapp: normalizePhoneKe(r.international_phone_number ?? r.formatted_phone_number),
      website: r.website,
      openingHours: r.opening_hours?.weekday_text,
      categoriesFine: r.types,
    };
  } catch {
    return {};
  }
}

/**
 * Normalize Kenyan phone numbers to E.164.
 * Handles: 07XX..., +2547XX..., 2547XX..., 07 XX XX XX XX (spaces)
 */
function normalizePhoneKe(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  // Already E.164
  if (digits.startsWith("+")) return digits;
  // 254 prefix without + → add
  if (digits.startsWith("254") && digits.length >= 12) return `+${digits}`;
  // 07... or 01... → prepend +254
  if ((digits.startsWith("07") || digits.startsWith("01")) && digits.length >= 10) {
    return `+254${digits.slice(1)}`;
  }
  // Return as-is if we can't confidently normalize (still might be a
  // valid intl number from a non-KE place)
  return raw;
}

/**
 * Batch dispatcher — claims up to BATCH_SIZE pending companies from
 * the queue, runs their enrichments in parallel via Promise.allSettled,
 * then re-schedules itself in RESCHEDULE_DELAY_MS if anything remains.
 *
 * Called from bulkImportMapPlaces + importMapPlace via a single
 * scheduler.runAfter(0, runEnrichmentBatch, {}). Any subsequent import
 * that fires while a batch is running will just be picked up by the
 * next batch tick — the queue is single-consumer per-tick but the
 * flag is idempotent.
 *
 * Retry policy: enqueueEnrichment sets enrichmentPending=true.
 * claimEnrichmentBatch clears the flag and bumps enrichmentAttempts.
 * If enrichCompany fails, the flag stays cleared but the attempt
 * counter persists — the user can manually re-enqueue via a UI
 * button (not implemented yet) or the next import of the same place
 * will re-trigger.
 */
export const runEnrichmentBatch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; remaining: boolean }> => {
    const claimed = await ctx.runMutation(
      internal.prospectorEnrichHelpers.claimEnrichmentBatch,
      { batchSize: BATCH_SIZE },
    );

    if (claimed.length === 0) {
      return { processed: 0, remaining: false };
    }

    // Run all claimed enrichments in parallel
    await Promise.allSettled(
      claimed.map((c) =>
        ctx.runAction(internal.prospectorEnrich.enrichCompany, {
          companyId: c.companyId as Id<"companies">,
          googlePlaceId: c.googlePlaceId,
        }),
      ),
    );

    // Check if more are pending, and reschedule if so
    const stillPending = await ctx.runQuery(
      internal.prospectorEnrichHelpers.hasPendingEnrichments,
      {},
    );
    if (stillPending) {
      await ctx.scheduler.runAfter(
        RESCHEDULE_DELAY_MS,
        internal.prospectorEnrich.runEnrichmentBatch,
        {},
      );
    }

    return { processed: claimed.length, remaining: stillPending };
  },
});
