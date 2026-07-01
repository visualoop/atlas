/**
 * Sales Enablement Vault (Phase 7a).
 *
 * Playbooks, battlecards, testimonials, case studies, one-pagers,
 * demo scripts, objection handlers — the reference material Justine
 * pulls from mid-conversation.
 *
 * All content is TipTap JSON. Every asset has a `searchIndex` on
 * `bodyText` so ⌘K palette can surface them.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import type { Doc } from "./_generated/dataModel";

const ASSET_KIND = v.union(
  v.literal("playbook"),
  v.literal("battlecard"),
  v.literal("testimonial"),
  v.literal("case_study"),
  v.literal("one_pager"),
  v.literal("demo_script"),
  v.literal("objection"),
);

export const listAssets = query({
  args: {
    kind: v.optional(ASSET_KIND),
    productId: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);

    if (args.search && args.search.trim().length >= 2) {
      const q = args.search.trim();
      let rows = await ctx.db
        .query("salesAssets")
        .withSearchIndex("search_body", (b) => {
          let builder = b.search("bodyText", q).eq("workspaceId", wsCtx.workspace._id);
          if (args.kind) builder = builder.eq("kind", args.kind);
          if (args.productId) builder = builder.eq("productId", args.productId);
          return builder;
        })
        .take(limit);
      return rows.filter((r) => r.archivedAt === undefined);
    }

    let rows: Doc<"salesAssets">[];
    if (args.kind) {
      rows = await ctx.db
        .query("salesAssets")
        .withIndex("by_workspace_kind", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("kind", args.kind!),
        )
        .order("desc")
        .take(limit);
    } else if (args.productId) {
      rows = await ctx.db
        .query("salesAssets")
        .withIndex("by_workspace_product", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("productId", args.productId),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("salesAssets")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const getAsset = query({
  args: { id: v.id("salesAssets") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const a = await ctx.db.get(id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) return null;
    return a;
  },
});

export const createAsset = mutation({
  args: {
    kind: ASSET_KIND,
    title: v.string(),
    body: v.any(),
    tags: v.optional(v.array(v.string())),
    productId: v.optional(v.string()),
    persona: v.optional(v.string()),
    stage: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    fileId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const bodyText = extractBodyText(args.body);
    const id = await ctx.db.insert("salesAssets", {
      workspaceId: wsCtx.workspace._id,
      kind: args.kind,
      title: args.title,
      body: args.body,
      bodyText,
      tags: args.tags ?? [],
      productId: args.productId,
      persona: args.persona,
      stage: args.stage,
      contactId: args.contactId,
      companyId: args.companyId,
      fileId: args.fileId,
      usageCount: 0,
      authorId: wsCtx.user._id,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "sales_asset",
      resourceId: id,
      after: { kind: args.kind, title: args.title },
    });
    return id;
  },
});

export const updateAsset = mutation({
  args: {
    id: v.id("salesAssets"),
    patch: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.any()),
      tags: v.optional(v.array(v.string())),
      productId: v.optional(v.string()),
      persona: v.optional(v.string()),
      stage: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(args.id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Asset not found." });
    }
    const patch: Partial<Doc<"salesAssets">> = { ...args.patch };
    if (args.patch.body) patch.bodyText = extractBodyText(args.patch.body);
    await ctx.db.patch(args.id, patch);
  },
});

export const archiveAsset = mutation({
  args: { id: v.id("salesAssets") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { archivedAt: Date.now() });
  },
});

export const trackUse = mutation({
  args: { id: v.id("salesAssets") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const a = await ctx.db.get(id);
    if (!a || a.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, {
      usageCount: a.usageCount + 1,
      lastUsedAt: Date.now(),
    });
  },
});

function extractBodyText(body: unknown): string {
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") chunks.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(body);
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
