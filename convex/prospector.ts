/**
 * Prospector — Google Maps Places lead-generation module.
 *
 * Read: listSearches, listResults, getSearch
 * Write: createSearch, deleteSearch, suppressResult, importResult,
 *        bulkImport, rejectResult
 * Internal: persistSearchResults (called by prospectorActions.search
 *   after hitting Google Places API), enqueueEnrichment
 *
 * Ops shape: `prospectorActions.search` (action) fires the actual
 * Google Places call, then invokes `prospector.persistSearchResults`
 * to write rows here.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import { getOrgKey } from "./lib/secretsAccess";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listSearches = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 50, 200);
    const rows = await ctx.db
      .query("prospectorSearches")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .order("desc")
      .take(limit);
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const getSearch = query({
  args: { id: v.id("prospectorSearches") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const s = await ctx.db.get(id);
    if (!s || s.workspaceId !== wsCtx.workspace._id) return null;
    return s;
  },
});

export const listResults = query({
  args: {
    searchId: v.id("prospectorSearches"),
    onlyUnimported: v.optional(v.boolean()),
    onlyImported: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const search = await ctx.db.get(args.searchId);
    if (!search || search.workspaceId !== wsCtx.workspace._id) return [];
    const limit = Math.min(args.limit ?? 100, 500);
    let rows = await ctx.db
      .query("prospectorResults")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .take(limit * 2);
    rows = rows.filter((r) => r.rejectedAt === undefined);
    if (args.onlyUnimported) rows = rows.filter((r) => r.importedAt === undefined);
    if (args.onlyImported) rows = rows.filter((r) => r.importedAt !== undefined);
    return rows.slice(0, limit);
  },
});

/* ============================================================ */
/* Create + delete search                                        */
/* ============================================================ */

export const createSearch = mutation({
  args: {
    query: v.string(),
    location: v.optional(v.string()),
    locationBias: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (args.query.trim().length < 3) {
      throw new ConvexError({ code: "INVALID", message: "Search query is too short." });
    }

    const normalizedQuery = args.query.trim();
    const normalizedLocation = args.location?.trim();

    // Dedup — reuse an identical search from the last 24h. Saves a
    // Google Places call and prevents cluttered history when the
    // founder retries the same query.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const existing = await ctx.db
      .query("prospectorSearches")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("query"), normalizedQuery),
          q.eq(q.field("location"), normalizedLocation),
          q.gte(q.field("_creationTime"), cutoff),
        ),
      )
      .first();
    if (existing) {
      // Bump lastRunAt so it shows recent in the sidebar
      await ctx.db.patch(existing._id, { lastRunBy: wsCtx.user._id });
      return existing._id;
    }

    const id = await ctx.db.insert("prospectorSearches", {
      workspaceId: wsCtx.workspace._id,
      query: normalizedQuery,
      location: normalizedLocation,
      locationBias: args.locationBias,
      resultCount: 0,
      importedCount: 0,
      lastRunBy: wsCtx.user._id,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "prospector_search",
      resourceId: id,
      after: { query: normalizedQuery, location: normalizedLocation },
    });
    return id;
  },
});

export const deleteSearch = mutation({
  args: { id: v.id("prospectorSearches") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const s = await ctx.db.get(id);
    if (!s || s.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found." });
    }
    // Soft delete search + hard delete unimported results.
    // Imported results stay because they may be referenced.
    await ctx.db.patch(id, { archivedAt: Date.now() });
    const results = await ctx.db
      .query("prospectorResults")
      .withIndex("by_search", (q) => q.eq("searchId", id))
      .collect();
    for (const r of results) {
      if (!r.importedAt) await ctx.db.delete(r._id);
    }
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "prospector_search",
      resourceId: id,
    });
  },
});

/* ============================================================ */
/* Persist Google Places response (called by action)             */
/* ============================================================ */

export const persistSearchResults = internalMutation({
  args: {
    searchId: v.id("prospectorSearches"),
    workspaceId: v.id("workspaces"),
    results: v.array(
      v.object({
        googlePlaceId: v.string(),
        name: v.string(),
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        country: v.optional(v.string()),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
        phoneRaw: v.optional(v.string()),
        website: v.optional(v.string()),
        googleMapsUri: v.optional(v.string()),
        types: v.optional(v.array(v.string())),
        rating: v.optional(v.number()),
        ratingCount: v.optional(v.number()),
        businessStatus: v.optional(v.string()),
        rawPlaceData: v.optional(v.any()),
      }),
    ),
    nextPageToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search || search.workspaceId !== args.workspaceId) return { persisted: 0 };

    // Preload existing results + suppressions for dedup
    const suppressed = await ctx.db
      .query("prospectorSuppressions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const suppressedIds = new Set(suppressed.map((s) => s.googlePlaceId));

    let persisted = 0;
    let filteredMega = 0;
    for (const r of args.results) {
      if (suppressedIds.has(r.googlePlaceId)) continue;
      // Skip mega-brands + malls / plazas / mega-buildings — these
      // aren't reachable via cold founder outreach and clog results.
      if (isMegaBrand(r.name) || isDisqualifyingPlace(r.name, r.types)) {
        filteredMega++;
        continue;
      }
      // Dedup by (workspaceId, googlePlaceId) — same place across searches
      const existing = await ctx.db
        .query("prospectorResults")
        .withIndex("by_workspace_place", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("googlePlaceId", r.googlePlaceId),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("prospectorResults", {
        workspaceId: args.workspaceId,
        searchId: args.searchId,
        googlePlaceId: r.googlePlaceId,
        name: r.name,
        address: r.address,
        city: r.city,
        country: r.country,
        latitude: r.latitude,
        longitude: r.longitude,
        phone: normalizePhone(r.phoneRaw),
        phoneRaw: r.phoneRaw,
        website: r.website,
        googleMapsUri: r.googleMapsUri,
        types: r.types,
        rating: r.rating,
        ratingCount: r.ratingCount,
        businessStatus: r.businessStatus,
        rawPlaceData: r.rawPlaceData,
        enrichmentStatus: r.website ? "pending" : "no_website",
      });
      persisted++;
    }
    await ctx.db.patch(args.searchId, {
      resultCount: (search.resultCount ?? 0) + persisted,
      lastRunAt: Date.now(),
      nextPageToken: args.nextPageToken,
    });

    // Kick auto-ranking — batch AI scoring runs in background
    if (persisted > 0) {
      // 1. Fill missing contact info from Place Details (fast, ~5s)
      await ctx.scheduler.runAfter(
        0,
        internal.prospectorPlaceDetails.fillPlaceDetails,
        { searchId: args.searchId },
      );
      // 2. AI-rank with the fresh contact data (delayed so rank sees
      // filled data, not empty)
      await ctx.scheduler.runAfter(
        6000,
        internal.prospectorAutoRank.rankSearchResults,
        { searchId: args.searchId },
      );
      // 3. Website-scrape enrichment for results with a website
      await ctx.scheduler.runAfter(
        9000,
        internal.prospectorAutoRank.enrichSearchResults,
        { searchId: args.searchId },
      );
    }

    return { persisted };
  },
});

/* ============================================================ */
/* Import a result → creates a companies row                     */
/* ============================================================ */

export const importResult = mutation({
  args: {
    id: v.id("prospectorResults"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, force }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const r = await ctx.db.get(id);
    if (!r || r.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Result not found." });
    }
    if (r.importedAt && r.importedCompanyId) {
      return { companyId: r.importedCompanyId, alreadyImported: true };
    }

    // Guardrail: refuse to import a lead you can't actually reach.
    // Cold outreach without at least one of phone/email/website is
    // a dead end. Enrichment might fill this later, but at import
    // time the user should acknowledge.
    const reachable = Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim());
    if (!reachable && !force) {
      throw new ConvexError({
        code: "NO_CONTACT_INFO",
        message: `"${r.name}" has no phone, email, or website. Import blocked so you don't waste time. Pass force: true to override.`,
      });
    }

    // Check if a company with this googlePlaceId already exists in the workspace
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_workspace_place", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("googlePlaceId", r.googlePlaceId),
      )
      .first();

    let companyId: Id<"companies">;
    if (existing) {
      companyId = existing._id;
    } else {
      companyId = await ctx.db.insert("companies", {
        workspaceId: wsCtx.workspace._id,
        name: r.name,
        domain: r.website ? domainFrom(r.website) : undefined,
        website: r.website,
        phone: r.phone,
        emailPrimary: r.email,
        country: r.country ?? "KE",
        city: r.city,
        address: r.address,
        source: "prospector",
        googlePlaceId: r.googlePlaceId,
        lifecycleStage: "cold",
        tags: [],
        enrichmentData: r.rawPlaceData
          ? { rating: r.rating, ratingCount: r.ratingCount, types: r.types }
          : undefined,
        enrichmentPending: true,
      });

      // If we have contact data, seed a primary contact record. The
      // owner can rename later, but this means the CRM view has a
      // person to reach out to immediately.
      if (r.email?.trim() || r.phone?.trim()) {
        await ctx.db.insert("contacts", {
          workspaceId: wsCtx.workspace._id,
          companyId,
          firstName: r.name.split(/\s+/)[0] ?? "Owner",
          lastName: undefined,
          email: r.email?.trim().toLowerCase(),
          phone: r.phone?.trim(),
          whatsapp: r.phone?.trim(),
          title: "Primary contact",
          source: "prospector",
          lifecycleStage: "cold",
          tags: ["prospector"],
        });
      }

      // Kick enrichment dispatcher (throttled, 3 in parallel)
      await ctx.scheduler.runAfter(
        0,
        internal.prospectorEnrich.runEnrichmentBatch,
        {},
      );
    }

    await ctx.db.patch(id, {
      importedAt: Date.now(),
      importedCompanyId: companyId,
    });

    // Bump the search counter
    const search = await ctx.db.get(r.searchId);
    if (search) {
      await ctx.db.patch(r.searchId, {
        importedCount: search.importedCount + 1,
      });
    }

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "company",
      resourceId: companyId,
      reason: "prospector_import",
      after: { name: r.name, googlePlaceId: r.googlePlaceId },
    });

    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "company_created",
      actorId: wsCtx.user._id,
      subjectType: "company",
      subjectId: companyId,
      payload: { source: "prospector", searchId: r.searchId },
    });

    return { companyId, alreadyImported: false };
  },
});

export const bulkImport = mutation({
  args: {
    ids: v.array(v.id("prospectorResults")),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { ids, force }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    let imported = 0;
    let skipped = 0;
    let skippedNoContact = 0;
    for (const id of ids) {
      const r = await ctx.db.get(id);
      if (!r || r.workspaceId !== wsCtx.workspace._id) continue;
      if (r.importedAt) { skipped++; continue; }

      // Reachability guard — skip contactless leads unless force=true
      const reachable = Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim());
      if (!reachable && !force) {
        skippedNoContact++;
        continue;
      }

      const existing = await ctx.db
        .query("companies")
        .withIndex("by_workspace_place", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("googlePlaceId", r.googlePlaceId),
        )
        .first();

      let companyId: Id<"companies">;
      if (existing) {
        companyId = existing._id;
      } else {
        companyId = await ctx.db.insert("companies", {
          workspaceId: wsCtx.workspace._id,
          name: r.name,
          domain: r.website ? domainFrom(r.website) : undefined,
          website: r.website,
          phone: r.phone,
          emailPrimary: r.email,
          country: r.country ?? "KE",
          city: r.city,
          address: r.address,
          source: "prospector",
          googlePlaceId: r.googlePlaceId,
          lifecycleStage: "cold",
          tags: [],
          enrichmentPending: true,
        });

        // Seed a primary contact if we have any reach info
        if (r.email?.trim() || r.phone?.trim()) {
          await ctx.db.insert("contacts", {
            workspaceId: wsCtx.workspace._id,
            companyId,
            firstName: r.name.split(/\s+/)[0] ?? "Owner",
            lastName: undefined,
            email: r.email?.trim().toLowerCase(),
            phone: r.phone?.trim(),
            whatsapp: r.phone?.trim(),
            title: "Primary contact",
            source: "prospector",
            lifecycleStage: "cold",
            tags: ["prospector"],
          });
        }

        imported++;
      }
      await ctx.db.patch(id, { importedAt: Date.now(), importedCompanyId: companyId });
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "company_created",
        actorId: wsCtx.user._id,
        subjectType: "company",
        subjectId: companyId,
        payload: { source: "prospector_bulk" },
      });
    }
    // Kick enrichment dispatcher if anything got enqueued
    if (imported > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.prospectorEnrich.runEnrichmentBatch,
        {},
      );
    }
    return { imported, skipped, skippedNoContact };
  },
});

export const rejectResult = mutation({
  args: { id: v.id("prospectorResults"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const r = await ctx.db.get(args.id);
    if (!r || r.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found." });
    }
    await ctx.db.patch(args.id, {
      rejectedAt: Date.now(),
      rejectedReason: args.reason,
    });
    // Add to suppression list so future searches skip it
    const already = await ctx.db
      .query("prospectorSuppressions")
      .withIndex("by_workspace_place", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("googlePlaceId", r.googlePlaceId),
      )
      .first();
    if (!already) {
      await ctx.db.insert("prospectorSuppressions", {
        workspaceId: wsCtx.workspace._id,
        googlePlaceId: r.googlePlaceId,
        reason: args.reason,
        addedBy: wsCtx.user._id,
      });
    }
  },
});

/* ============================================================ */
/* Helpers                                                       */
/* ============================================================ */

/** Kenya E.164 normalization for phone numbers. Falls back to raw if unclear. */
function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // '07…' or '01…' → '+2547…' / '+2541…'
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  // '2547…' or '2541…' (no leading +)
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  return digits.length >= 8 ? digits : undefined;
}

/** Extract lowercase domain from a URL (safe against parse errors). */
function domainFrom(url: string): string | undefined {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}


/* ============================================================ */
/* Map-browse import — one-shot company create from Google Place */
/* ============================================================ */

export const importMapPlace = internalMutation({
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
  handler: async (ctx, args) => {
    // Import here (inside handler) to avoid circular imports
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });

    // Enforce daily cap
    const cap = wsCtx.workspace.prospectorDailyCap ?? 100;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const todaysImports = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), dayStartMs),
          q.or(
            q.eq(q.field("source"), "prospector_map"),
            q.eq(q.field("source"), "prospector"),
          ),
        ),
      )
      .collect();
    if (todaysImports.length >= cap) {
      throw new ConvexError({
        code: "IMPORT_CAP_REACHED",
        message: `You've hit today's import cap (${cap}). Bump it in Settings → Workspace, or wait until tomorrow.`,
      });
    }

    // Dedupe by (workspace, googlePlaceId)
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_workspace_place", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("googlePlaceId", args.googlePlaceId),
      )
      .first();
    if (existing) {
      return { companyId: existing._id, duplicated: true };
    }

    // Also respect the suppression list
    const suppressed = await ctx.db
      .query("prospectorSuppressions")
      .withIndex("by_workspace_place", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("googlePlaceId", args.googlePlaceId),
      )
      .first();
    if (suppressed) {
      throw new ConvexError({
        code: "SUPPRESSED",
        message: "You've previously rejected this business — un-suppress it in Prospector to re-import.",
      });
    }

    // Extract domain from website
    let domain: string | undefined;
    if (args.website) {
      try {
        const u = new URL(args.website);
        domain = u.hostname.replace(/^www\./, "").toLowerCase();
      } catch {}
    }

    const companyId = await ctx.db.insert("companies", {
      workspaceId: wsCtx.workspace._id,
      name: args.name,
      domain,
      country: "KE",
      city: undefined,
      address: args.address,
      phone: args.phoneRaw,
      website: args.website,
      googlePlaceId: args.googlePlaceId,
      lifecycleStage: "lead",
      tags: ["prospector"],
      source: "prospector_map",
      enrichmentData: {
        googleMapsUri: args.googleMapsUri,
        types: args.types,
        rating: args.rating,
        ratingCount: args.ratingCount,
        latitude: args.latitude,
        longitude: args.longitude,
      },
      enrichedAt: Date.now(),
      ownerId: wsCtx.user._id,
    });

    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "company_created",
      actorId: wsCtx.user._id,
      subjectType: "company",
      subjectId: companyId,
      payload: { source: "prospector_map", googlePlaceId: args.googlePlaceId },
    });

    // Enqueue for background enrichment (throttled to 3 in parallel
    // via runEnrichmentBatch dispatcher — no thundering herd)
    await ctx.db.patch(companyId, { enrichmentPending: true });
    await ctx.scheduler.runAfter(
      0,
      internal.prospectorEnrich.runEnrichmentBatch,
      {},
    );

    return { companyId, duplicated: false };
  },
});


/* ============================================================ */
/* Maps client key — for the frontend Google Maps JS SDK          */
/* ============================================================ */

export const getMapsClientKey = query({
  args: {},
  handler: async (ctx): Promise<{ key: string | null }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    try {
      const k = await getOrgKey(ctx, {
        organizationId: wsCtx.workspace.organizationId,
        provider: "google_maps_places",
        reason: "map_browse_client",
        actorId: wsCtx.user._id,
      });
      return { key: k.value };
    } catch {
      return { key: null };
    }
  },
});


/* ============================================================ */
/* Map-browse dedup — check which Places are already known         */
/* ============================================================ */

export const checkMapPlaces = query({
  args: {
    googlePlaceIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{
    imported: string[];              // already in `companies`
    suppressed: string[];            // in `prospectorSuppressions`
  }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const wsId = wsCtx.workspace._id;

    const imported: string[] = [];
    const suppressed: string[] = [];

    // Look up each id in parallel using the by_workspace_place indexes
    await Promise.all(
      args.googlePlaceIds.map(async (placeId) => {
        const [company, suppression] = await Promise.all([
          ctx.db
            .query("companies")
            .withIndex("by_workspace_place", (q) =>
              q.eq("workspaceId", wsId).eq("googlePlaceId", placeId),
            )
            .first(),
          ctx.db
            .query("prospectorSuppressions")
            .withIndex("by_workspace_place", (q) =>
              q.eq("workspaceId", wsId).eq("googlePlaceId", placeId),
            )
            .first(),
        ]);
        if (company) imported.push(placeId);
        if (suppression) suppressed.push(placeId);
      }),
    );

    return { imported, suppressed };
  },
});

/* ============================================================ */
/* Daily import cap                                                */
/* ============================================================ */

export const getImportBudget = query({
  args: {},
  handler: async (ctx): Promise<{
    dailyCap: number;
    usedToday: number;
    remaining: number;
  }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const wsId = wsCtx.workspace._id;

    const cap = wsCtx.workspace.prospectorDailyCap ?? 100;

    // Start of today in workspace timezone. For simplicity we use UTC
    // midnight — Africa/Nairobi is UTC+3, so this rolls over at 03:00
    // Africa/Nairobi. Close enough for a soft cap.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();

    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), dayStartMs),
          q.eq(q.field("source"), "prospector_map"),
        ),
      )
      .collect();

    // Also count text-search imports (source=prospector or manual bulk import)
    const searchImports = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), dayStartMs),
          q.eq(q.field("source"), "prospector"),
        ),
      )
      .collect();

    const usedToday = rows.length + searchImports.length;
    return {
      dailyCap: cap,
      usedToday,
      remaining: Math.max(0, cap - usedToday),
    };
  },
});


/* ============================================================ */
/* Bulk import from map — 'Import top N' one-shot                  */
/* ============================================================ */

export const bulkImportMapPlaces = mutation({
  args: {
    places: v.array(
      v.object({
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
        businessStatus: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{
    imported: number;
    skippedDuplicate: number;
    skippedSuppressed: number;
    capReached: boolean;
    remainingBudget: number;
  }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const wsId = wsCtx.workspace._id;

    const cap = wsCtx.workspace.prospectorDailyCap ?? 100;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const todaysImports = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), dayStartMs),
          q.or(
            q.eq(q.field("source"), "prospector_map"),
            q.eq(q.field("source"), "prospector"),
          ),
        ),
      )
      .collect();
    let budget = Math.max(0, cap - todaysImports.length);

    let imported = 0;
    let skippedDuplicate = 0;
    let skippedSuppressed = 0;
    let capReached = false;

    for (const p of args.places) {
      if (budget <= 0) {
        capReached = true;
        break;
      }

      const existing = await ctx.db
        .query("companies")
        .withIndex("by_workspace_place", (q) =>
          q.eq("workspaceId", wsId).eq("googlePlaceId", p.googlePlaceId),
        )
        .first();
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      const suppressed = await ctx.db
        .query("prospectorSuppressions")
        .withIndex("by_workspace_place", (q) =>
          q.eq("workspaceId", wsId).eq("googlePlaceId", p.googlePlaceId),
        )
        .first();
      if (suppressed) {
        skippedSuppressed++;
        continue;
      }

      let domain: string | undefined;
      if (p.website) {
        try {
          const u = new URL(p.website);
          domain = u.hostname.replace(/^www\./, "").toLowerCase();
        } catch {}
      }

      const companyId = await ctx.db.insert("companies", {
        workspaceId: wsId,
        name: p.name,
        domain,
        country: "KE",
        city: undefined,
        address: p.address,
        phone: p.phoneRaw,
        website: p.website,
        googlePlaceId: p.googlePlaceId,
        lifecycleStage: "lead",
        tags: ["prospector"],
        source: "prospector_map",
        enrichmentData: {
          googleMapsUri: p.googleMapsUri,
          types: p.types,
          rating: p.rating,
          ratingCount: p.ratingCount,
          latitude: p.latitude,
          longitude: p.longitude,
        },
        enrichedAt: Date.now(),
        ownerId: wsCtx.user._id,
      });

      await recordTimelineEvent(ctx, {
        workspaceId: wsId,
        eventType: "company_created",
        actorId: wsCtx.user._id,
        subjectType: "company",
        subjectId: companyId,
        payload: { source: "prospector_map_bulk", googlePlaceId: p.googlePlaceId },
      });

      // Enqueue for background enrichment (dispatcher processes
      // 3 in parallel with 500ms rescheduling — no thundering herd
      // even if user imports 20 businesses at once)
      await ctx.db.patch(companyId, { enrichmentPending: true });

      imported++;
      budget--;
    }

    // Kick the dispatcher once at the end of the batch — it will
    // claim up to 3 pending, run them in parallel, and reschedule
    // itself until the queue is empty.
    if (imported > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.prospectorEnrich.runEnrichmentBatch,
        {},
      );
    }

    return {
      imported,
      skippedDuplicate,
      skippedSuppressed,
      capReached,
      remainingBudget: budget,
    };
  },
});

/**
 * Mega-brand + mall filter helpers — shared with prospectorActions.
 * Duplicated here (small, static, no cross-file import) so the
 * persistSearchResults mutation doesn't have to import from a
 * "use node" file.
 */
const _MEGA_BRAND_DENYLIST = [
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
  return _MEGA_BRAND_DENYLIST.some((brand) => lc.includes(brand));
}

const _DISQUALIFYING_TYPES = new Set([
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

const _DISQUALIFYING_NAME_PATTERNS = [
  /\bmall\b/i,
  /\bplaza\b/i,
  /\bshopping\s+cent(er|re)\b/i,
  /\bmarket\b/i,
  /\barcade\b/i,
  /\bcomplex\b/i,
  /\btowers?\b/i,
  /\bcentre\b/i,
  /\bcenter$/i,
  /\bhouse$/i,
];

function isDisqualifyingPlace(name: string, types: string[] | undefined): boolean {
  if (types) {
    for (const t of types) {
      if (_DISQUALIFYING_TYPES.has(t)) return true;
    }
  }
  const words = name.trim().split(/\s+/).length;
  if (words <= 4) {
    for (const pat of _DISQUALIFYING_NAME_PATTERNS) {
      if (pat.test(name)) return true;
    }
  }
  return false;
}

/**
 * One-shot cleanup — archives companies + prospector results that
 * match the mall / plaza / mega-brand filter. Safe to run multiple
 * times: only touches unarchived rows. Doesn't delete — soft-archives
 * so history is preserved.
 */
export const purgeDisqualifiedImports = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ companiesArchived: number; resultsRejected: number; matches: string[] }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "admin" });
    const dryRun = args.dryRun ?? false;

    // 1. Companies matching the filter
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(500);
    const matches: string[] = [];
    let companiesArchived = 0;
    for (const c of companies) {
      const types = Array.isArray(
        (c.enrichmentData as { types?: unknown })?.types,
      )
        ? ((c.enrichmentData as { types?: string[] }).types as string[])
        : undefined;
      if (isMegaBrand(c.name) || isDisqualifyingPlace(c.name, types)) {
        matches.push(c.name);
        if (!dryRun) {
          await ctx.db.patch(c._id, { archivedAt: Date.now() });
        }
        companiesArchived++;
      }
    }

    // 2. Prospector results matching the filter — reject so they never
    //    appear again + won't be re-imported
    const results = await ctx.db
      .query("prospectorResults")
      .withIndex("by_workspace_place", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id),
      )
      .filter((q) => q.eq(q.field("rejectedAt"), undefined))
      .take(500);
    let resultsRejected = 0;
    for (const r of results) {
      if (isMegaBrand(r.name) || isDisqualifyingPlace(r.name, r.types)) {
        if (!dryRun) {
          await ctx.db.patch(r._id, {
            rejectedAt: Date.now(),
            rejectedReason: "mall_or_mega_brand_filter",
          });
        }
        resultsRejected++;
      }
    }

    return { companiesArchived, resultsRejected, matches: matches.slice(0, 20) };
  },
});
