/**
 * V8-runtime helpers for prospectorEnrich.
 *
 * The action file itself is Node-runtime (needs fetch on flexible APIs),
 * so DB reads + writes live here.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import { recordTimelineEvent } from "./lib/timeline";

export const prepareForEnrichment = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;

    // Fetch API keys for whichever provider we'll use
    const workspace = await ctx.db.get(company.workspaceId);
    if (!workspace) return null;
    const orgOwner = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", workspace.organizationId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    if (!orgOwner) return null;

    let geoapifyKey: string | undefined;
    let googlePlacesKey: string | undefined;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: workspace.organizationId,
        provider: "geoapify",
        reason: "prospector_enrich",
        actorId: orgOwner.userId,
      });
      geoapifyKey = k.value;
    } catch {}
    try {
      const k = await getOrgKey(ctx, {
        organizationId: workspace.organizationId,
        provider: "google_maps_places",
        reason: "prospector_enrich",
        actorId: orgOwner.userId,
      });
      googlePlacesKey = k.value;
    } catch {}

    return {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      enrichedAt: company.enrichedAt,
      currentPhone: company.phone,
      currentWebsite: company.website,
      currentEmail: company.emailPrimary,
      currentAddress: company.address,
      geoapifyKey,
      googlePlacesKey,
      ownerId: company.ownerId ?? orgOwner.userId,
    };
  },
});

export const applyEnrichment = internalMutation({
  args: {
    companyId: v.id("companies"),
    result: v.object({
      phone: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      email: v.optional(v.string()),
      website: v.optional(v.string()),
      openingHours: v.optional(v.array(v.string())),
      facilities: v.optional(v.array(v.string())),
      categoriesFine: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return;

    // Merge existing enrichmentData with the new details
    const prevData =
      typeof company.enrichmentData === "object" && company.enrichmentData
        ? (company.enrichmentData as Record<string, unknown>)
        : {};
    const nextData: Record<string, unknown> = { ...prevData };
    if (args.result.openingHours?.length) {
      nextData.openingHours = args.result.openingHours;
    }
    if (args.result.facilities?.length) {
      nextData.facilities = args.result.facilities;
    }
    if (args.result.categoriesFine?.length) {
      nextData.categoriesFine = args.result.categoriesFine;
    }

    // Patch company — only overwrite empty fields (don't clobber user edits)
    const patch: Record<string, unknown> = {
      enrichedAt: Date.now(),
      enrichmentData: nextData,
    };
    if (args.result.phone && !company.phone) patch.phone = args.result.phone;
    if (args.result.whatsapp && !company.whatsapp) patch.whatsapp = args.result.whatsapp;
    if (args.result.email && !company.emailPrimary) patch.emailPrimary = args.result.email;
    if (args.result.website && !company.website) patch.website = args.result.website;

    // Derive domain from new website if missing
    if (args.result.website && !company.domain) {
      try {
        const u = new URL(args.result.website);
        patch.domain = u.hostname.replace(/^www\./, "").toLowerCase();
      } catch {}
    }

    await ctx.db.patch(args.companyId, patch);

    // Timeline event so the user sees the enrichment happened
    const enrichedFields: string[] = [];
    if (patch.phone) enrichedFields.push("phone");
    if (patch.emailPrimary) enrichedFields.push("email");
    if (patch.website) enrichedFields.push("website");
    if (args.result.openingHours?.length) enrichedFields.push("hours");
    if (enrichedFields.length > 0) {
      await recordTimelineEvent(ctx, {
        workspaceId: company.workspaceId,
        eventType: "note_added",
        actorId: company.ownerId,
        subjectType: "company",
        subjectId: args.companyId,
        payload: {
          kind: "prospector_enrichment",
          fields: enrichedFields,
        },
      });
    }
  },
});
