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
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
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
    const id = await ctx.db.insert("prospectorSearches", {
      workspaceId: wsCtx.workspace._id,
      query: args.query.trim(),
      location: args.location?.trim(),
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
      after: { query: args.query, location: args.location },
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
    for (const r of args.results) {
      if (suppressedIds.has(r.googlePlaceId)) continue;
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
    return { persisted };
  },
});

/* ============================================================ */
/* Import a result → creates a companies row                     */
/* ============================================================ */

export const importResult = mutation({
  args: { id: v.id("prospectorResults") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const r = await ctx.db.get(id);
    if (!r || r.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Result not found." });
    }
    if (r.importedAt && r.importedCompanyId) {
      return { companyId: r.importedCompanyId, alreadyImported: true };
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
      });
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
  args: { ids: v.array(v.id("prospectorResults")) },
  handler: async (ctx, { ids }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    let imported = 0;
    let skipped = 0;
    for (const id of ids) {
      const r = await ctx.db.get(id);
      if (!r || r.workspaceId !== wsCtx.workspace._id) continue;
      if (r.importedAt) { skipped++; continue; }

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
        });
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
    return { imported, skipped };
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
