/**
 * Contacts — people inside companies (or standalone).
 *
 * Phase 1 surface: list, get, create, update, archive, restore.
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

function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ConvexError({ code: "INVALID_EMAIL", message: "Not a valid email." });
  }
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* list                                                                 */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {
    lifecycleStage: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    ownerId: v.optional(v.id("users")),
    search: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const limit = Math.min(args.limit ?? 100, 500);

    let contacts: Doc<"contacts">[];

    if (args.search && args.search.trim().length > 0) {
      contacts = await ctx.db
        .query("contacts")
        .withSearchIndex("search_name", (q) => {
          const base = q.search("firstName", args.search!).eq("workspaceId", wsId);
          if (args.lifecycleStage) {
            return base.eq("lifecycleStage", args.lifecycleStage);
          }
          return base;
        })
        .take(limit);
    } else if (args.companyId) {
      contacts = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_company", (q) =>
          q.eq("workspaceId", wsId).eq("companyId", args.companyId),
        )
        .order("desc")
        .take(limit);
    } else if (args.ownerId) {
      contacts = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_owner", (q) =>
          q.eq("workspaceId", wsId).eq("ownerId", args.ownerId),
        )
        .order("desc")
        .take(limit);
    } else {
      contacts = await ctx.db
        .query("contacts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .order("desc")
        .take(limit);
    }

    if (!args.includeArchived) {
      contacts = contacts.filter((c) => c.archivedAt === undefined);
    }
    return contacts;
  },
});

/* ------------------------------------------------------------------ */
/* get — contact + linked company + last 20 timeline events            */
/* ------------------------------------------------------------------ */

export const get = query({
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const contact = await ctx.db.get(id);
    if (!contact || contact.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Contact not found." });
    }

    const [company, timeline] = await Promise.all([
      contact.companyId ? ctx.db.get(contact.companyId) : Promise.resolve(null),
      ctx.db
        .query("timelineEvents")
        .withIndex("by_workspace_subject", (q) =>
          q
            .eq("workspaceId", wsCtx.workspace._id)
            .eq("subjectType", "contact")
            .eq("subjectId", contact._id),
        )
        .order("desc")
        .take(20),
    ]);

    return { contact, company, timeline };
  },
});

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    title: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    twitter: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    lifecycleStage: v.optional(v.string()),
    ownerId: v.optional(v.id("users")),
    tags: v.optional(v.array(v.string())),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const firstName = args.firstName.trim();
    if (!firstName) {
      throw new ConvexError({ code: "INVALID_NAME", message: "First name is required." });
    }
    const email = normalizeEmail(args.email);
    const lifecycleStage = (args.lifecycleStage ?? "cold") as LifecycleStage;
    if (!LIFECYCLE_STAGES.includes(lifecycleStage)) {
      throw new ConvexError({
        code: "INVALID_LIFECYCLE",
        message: `Lifecycle must be one of: ${LIFECYCLE_STAGES.join(", ")}`,
      });
    }

    if (email) {
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("email", email),
        )
        .unique();
      if (existing) {
        throw new ConvexError({
          code: "DUPLICATE_EMAIL",
          message: `A contact with email "${email}" already exists.`,
        });
      }
    }

    // Validate companyId is in same workspace if provided
    if (args.companyId) {
      const company = await ctx.db.get(args.companyId);
      if (!company || company.workspaceId !== wsCtx.workspace._id) {
        throw new ConvexError({
          code: "INVALID_COMPANY",
          message: "Company not found in this workspace.",
        });
      }
    }

    const contactId = await ctx.db.insert("contacts", {
      workspaceId: wsCtx.workspace._id,
      companyId: args.companyId,
      firstName,
      lastName: args.lastName?.trim() || undefined,
      email,
      phone: args.phone,
      whatsapp: args.whatsapp,
      title: args.title,
      linkedin: args.linkedin,
      twitter: args.twitter,
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
      resourceType: "contact",
      resourceId: contactId,
      after: { firstName, lastName: args.lastName, email },
    });

    await recordTimelineEvent(ctx, {
      workspaceId: wsCtx.workspace._id,
      eventType: "contact_created",
      actorId: wsCtx.user._id,
      subjectType: "contact",
      subjectId: contactId,
      payload: { firstName, lastName: args.lastName, email },
    });

    if (args.companyId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "contact_added_to_company",
        actorId: wsCtx.user._id,
        subjectType: "company",
        subjectId: args.companyId,
        payload: { contactId },
      });
    }

    return contactId;
  },
});

/* ------------------------------------------------------------------ */
/* update                                                              */
/* ------------------------------------------------------------------ */

export const update = mutation({
  args: {
    id: v.id("contacts"),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      title: v.optional(v.string()),
      linkedin: v.optional(v.string()),
      twitter: v.optional(v.string()),
      companyId: v.optional(v.id("companies")),
      lifecycleStage: v.optional(v.string()),
      ownerId: v.optional(v.id("users")),
      tags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const contact = await ctx.db.get(args.id);
    if (!contact || contact.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Contact not found." });
    }

    const patch: Record<string, unknown> = { ...args.patch };
    if (patch.email !== undefined) {
      patch.email = normalizeEmail(patch.email as string | undefined);
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
      resourceType: "contact",
      resourceId: args.id,
      before: contact,
      after: patch,
    });

    if ("lifecycleStage" in patch && patch.lifecycleStage !== contact.lifecycleStage) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "contact_lifecycle_changed",
        actorId: wsCtx.user._id,
        subjectType: "contact",
        subjectId: args.id,
        payload: { from: contact.lifecycleStage, to: patch.lifecycleStage },
      });
    }
  },
});

export const archive = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const contact = await ctx.db.get(id);
    if (!contact || contact.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Contact not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "contact",
      resourceId: id,
    });
  },
});

export const restore = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const contact = await ctx.db.get(id);
    if (!contact || contact.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Contact not found." });
    }
    await ctx.db.patch(id, { archivedAt: undefined });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "restored",
      resourceType: "contact",
      resourceId: id,
    });
  },
});
