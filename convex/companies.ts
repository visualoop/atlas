/**
 * Companies — businesses/orgs tracked inside a workspace.
 *
 * Phase 1 surface:
 *   - list (with filter + search)
 *   - get by id (with related contacts + timeline)
 *   - create
 *   - update
 *   - archive / restore
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc } from "./_generated/dataModel";

const LIFECYCLE_STAGES = [
  "cold",
  "warm",
  "qualified",
  "customer",
  "lost",
  "archived",
] as const;
type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

function normalizeDomain(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    || undefined;
}

/* ------------------------------------------------------------------ */
/* list — workspace-scoped, filterable, optional text search           */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {
    lifecycleStage: v.optional(v.string()),
    ownerId: v.optional(v.id("users")),
    search: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const limit = Math.min(args.limit ?? 100, 500);

    let companies: Doc<"companies">[];

    if (args.search && args.search.trim().length > 0) {
      // Full-text search
      const results = await ctx.db
        .query("companies")
        .withSearchIndex("search_name", (q) => {
          const base = q.search("name", args.search!).eq("workspaceId", wsId);
          if (args.lifecycleStage) {
            return base.eq("lifecycleStage", args.lifecycleStage);
          }
          return base;
        })
        .take(limit);
      companies = results;
    } else if (args.lifecycleStage) {
      companies = await ctx.db
        .query("companies")
        .withIndex("by_workspace_lifecycle", (q) =>
          q.eq("workspaceId", wsId).eq("lifecycleStage", args.lifecycleStage!),
        )
        .order("desc")
        .take(limit);
    } else if (args.ownerId) {
      companies = await ctx.db
        .query("companies")
        .withIndex("by_workspace_owner", (q) =>
          q.eq("workspaceId", wsId).eq("ownerId", args.ownerId),
        )
        .order("desc")
        .take(limit);
    } else {
      companies = await ctx.db
        .query("companies")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .order("desc")
        .take(limit);
    }

    if (!args.includeArchived) {
      companies = companies.filter((c) => c.archivedAt === undefined);
    }
    return companies;
  },
});

/* ------------------------------------------------------------------ */
/* get — single company + its contacts + last 10 timeline events       */
/* ------------------------------------------------------------------ */

export const get = query({
  args: { id: v.id("companies") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const company = await ctx.db.get(id);
    if (!company || company.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Company not found." });
    }

    const [contacts, timeline] = await Promise.all([
      ctx.db
        .query("contacts")
        .withIndex("by_workspace_company", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("companyId", company._id),
        )
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .collect(),
      ctx.db
        .query("timelineEvents")
        .withIndex("by_workspace_subject", (q) =>
          q
            .eq("workspaceId", wsCtx.workspace._id)
            .eq("subjectType", "company")
            .eq("subjectId", company._id),
        )
        .order("desc")
        .take(20),
    ]);

    return { company, contacts, timeline };
  },
});

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    name: v.string(),
    domain: v.optional(v.string()),
    industry: v.optional(v.string()),
    size: v.optional(v.string()),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    emailPrimary: v.optional(v.string()),
    website: v.optional(v.string()),
    description: v.optional(v.string()),
    lifecycleStage: v.optional(v.string()),
    ownerId: v.optional(v.id("users")),
    tags: v.optional(v.array(v.string())),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({ code: "INVALID_NAME", message: "Name is required." });
    }
    const domain = normalizeDomain(args.domain);
    const lifecycleStage = (args.lifecycleStage ?? "cold") as LifecycleStage;
    if (!LIFECYCLE_STAGES.includes(lifecycleStage)) {
      throw new ConvexError({
        code: "INVALID_LIFECYCLE",
        message: `Lifecycle must be one of: ${LIFECYCLE_STAGES.join(", ")}`,
      });
    }

    // Dedupe by domain within workspace
    if (domain) {
      const existing = await ctx.db
        .query("companies")
        .withIndex("by_workspace_domain", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("domain", domain),
        )
        .unique();
      if (existing) {
        throw new ConvexError({
          code: "DUPLICATE_DOMAIN",
          message: `A company with domain "${domain}" already exists.`,
        });
      }
    }

    const companyId = await ctx.db.insert("companies", {
      workspaceId: wsCtx.workspace._id,
      name,
      domain,
      industry: args.industry,
      size: args.size,
      country: args.country ?? "KE",
      city: args.city,
      address: args.address,
      phone: args.phone,
      whatsapp: args.whatsapp,
      emailPrimary: args.emailPrimary?.toLowerCase(),
      website: args.website,
      description: args.description,
      source: args.source ?? "manual",
      lifecycleStage,
      ownerId: args.ownerId ?? wsCtx.user._id,
      tags: args.tags ?? [],
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "company",
      resourceId: companyId,
      after: { name, domain, lifecycleStage },
    });

    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "company_created",
      actorId: wsCtx.user._id,
      subjectType: "company",
      subjectId: companyId,
      payload: { name },
    });

    return companyId;
  },
});

/* ------------------------------------------------------------------ */
/* update                                                              */
/* ------------------------------------------------------------------ */

export const update = mutation({
  args: {
    id: v.id("companies"),
    patch: v.object({
      name: v.optional(v.string()),
      domain: v.optional(v.string()),
      industry: v.optional(v.string()),
      size: v.optional(v.string()),
      country: v.optional(v.string()),
      city: v.optional(v.string()),
      address: v.optional(v.string()),
      phone: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      emailPrimary: v.optional(v.string()),
      website: v.optional(v.string()),
      description: v.optional(v.string()),
      lifecycleStage: v.optional(v.string()),
      ownerId: v.optional(v.id("users")),
      tags: v.optional(v.array(v.string())),
      fitScore: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const company = await ctx.db.get(args.id);
    if (!company || company.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Company not found." });
    }

    const patch: Record<string, unknown> = { ...args.patch };
    if (patch.domain !== undefined) {
      patch.domain = normalizeDomain(patch.domain as string | undefined);
    }
    if (patch.emailPrimary !== undefined && typeof patch.emailPrimary === "string") {
      patch.emailPrimary = patch.emailPrimary.toLowerCase();
    }
    if (patch.lifecycleStage !== undefined) {
      if (!LIFECYCLE_STAGES.includes(patch.lifecycleStage as LifecycleStage)) {
        throw new ConvexError({
          code: "INVALID_LIFECYCLE",
          message: `Lifecycle must be one of: ${LIFECYCLE_STAGES.join(", ")}`,
        });
      }
    }

    await ctx.db.patch(args.id, patch);

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "company",
      resourceId: args.id,
      before: company,
      after: patch,
    });

    if ("lifecycleStage" in patch && patch.lifecycleStage !== company.lifecycleStage) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "company_lifecycle_changed",
        actorId: wsCtx.user._id,
        subjectType: "company",
        subjectId: args.id,
        payload: { from: company.lifecycleStage, to: patch.lifecycleStage },
      });
    }
  },
});

/* ------------------------------------------------------------------ */
/* archive / restore                                                    */
/* ------------------------------------------------------------------ */

export const archive = mutation({
  args: { id: v.id("companies") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const company = await ctx.db.get(id);
    if (!company || company.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Company not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "company",
      resourceId: id,
    });
  },
});

export const restore = mutation({
  args: { id: v.id("companies") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const company = await ctx.db.get(id);
    if (!company || company.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Company not found." });
    }
    await ctx.db.patch(id, { archivedAt: undefined });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "restored",
      resourceType: "company",
      resourceId: id,
    });
  },
});
