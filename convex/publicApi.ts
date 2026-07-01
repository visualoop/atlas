/**
 * Public API — Convex-side helpers for the Next.js /api/v1/* routes.
 *
 * The route handlers do bearer-token auth by SHA-256 hashing the token
 * and looking it up here. Each function accepts a workspaceId that has
 * already been resolved from the key.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const resolveKey = query({
  args: {
    tokenHash: v.string(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("publicApiKeys")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    if (!key) return null;
    if (key.revokedAt !== undefined) return null;
    if (key.expiresAt && key.expiresAt < Date.now()) return null;
    // Scope check — allow wildcard '*' or explicit match
    if (!key.scopes.includes(args.scope) && !key.scopes.includes("*")) return null;
    return {
      _id: key._id,
      workspaceId: key.workspaceId,
    };
  },
});

export const recordUsage = mutation({
  args: { keyId: v.id("publicApiKeys") },
  handler: async (ctx, args) => {
    const k = await ctx.db.get(args.keyId);
    if (!k) return;
    await ctx.db.patch(args.keyId, {
      lastUsedAt: Date.now(),
      usageCount: k.usageCount + 1,
    });
  },
});

/* ---------------------------- Contacts ---------------------------- */

export const listContacts = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });
    return {
      data: rows.page.map((c) => ({
        id: c._id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        lifecycleStage: c.lifecycleStage,
        createdAt: c._creationTime,
      })),
      cursor: rows.continueCursor,
      isDone: rows.isDone,
    };
  },
});

export const createContact = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"contacts">> => {
    return await ctx.db.insert("contacts", {
      workspaceId: args.workspaceId,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email?.toLowerCase(),
      phone: args.phone,
      lifecycleStage: "lead",
      tags: [],
      source: "public_api",
    });
  },
});

/* ---------------------------- Companies ---------------------------- */

export const listCompanies = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });
    return {
      data: rows.page.map((c) => ({
        id: c._id,
        name: c.name,
        domain: c.domain,
        lifecycleStage: c.lifecycleStage,
        city: c.city,
        country: c.country,
        createdAt: c._creationTime,
      })),
      cursor: rows.continueCursor,
      isDone: rows.isDone,
    };
  },
});

export const createCompany = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"companies">> => {
    return await ctx.db.insert("companies", {
      workspaceId: args.workspaceId,
      name: args.name,
      domain: args.domain?.toLowerCase(),
      country: "KE",
      lifecycleStage: "lead",
      tags: [],
      source: "public_api",
    });
  },
});

/* ---------------------------- Deals ---------------------------- */

export const listDeals = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(args.limit);
    return {
      data: rows.map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents.toString(),
        currency: d.currency,
        contactId: d.contactId,
        companyId: d.companyId,
        stageId: d.stageId,
        wonAt: d.wonAt,
        lostAt: d.lostAt,
        createdAt: d._creationTime,
      })),
    };
  },
});

/* ---------------------------- Documents ---------------------------- */

export const listDocuments = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.number(),
    kind: v.optional(
      v.union(
        v.literal("proposal"),
        v.literal("quote"),
        v.literal("invoice"),
        v.literal("contract"),
        v.literal("brief"),
        v.literal("statement_of_work"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    let rows;
    if (args.kind) {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace_kind", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("kind", args.kind!),
        )
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .take(args.limit);
    } else {
      rows = await ctx.db
        .query("documents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .take(args.limit);
    }
    return {
      data: rows.map((d) => ({
        id: d._id,
        kind: d.kind,
        number: d.number,
        title: d.title,
        status: d.status,
        currency: d.currency,
        totalCents: d.totalCents.toString(),
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        contactId: d.contactId,
        companyId: d.companyId,
        pdfStorageId: d.pdfStorageId,
        createdAt: d._creationTime,
      })),
    };
  },
});
