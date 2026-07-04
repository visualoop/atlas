/**
 * Internal helpers for aiWorkflows.ts.
 *
 * These queries/mutations run in the default V8 runtime and are
 * called by the "use node" workflow actions to load source data and
 * persist AI-derived results.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Doc, Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* Conversation → messages, workspace, user                              */
/* ------------------------------------------------------------------ */

export const loadConversationForReply = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.workspaceId !== wsCtx.workspace._id) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_time", (q) => q.eq("conversationId", conv._id))
      .order("asc")
      .take(30);                                                // limit context window
    return {
      conversation: conv,
      messages,
      workspace: wsCtx.workspace,
      userId: wsCtx.user._id,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Prospector result → self, workspace, user                             */
/* ------------------------------------------------------------------ */

export const loadProspectorResult = internalQuery({
  args: { resultId: v.id("prospectorResults") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const result = await ctx.db.get(args.resultId);
    if (!result || result.workspaceId !== wsCtx.workspace._id) return null;
    return {
      result,
      workspace: wsCtx.workspace,
      userId: wsCtx.user._id,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Document → self, workspace, user, company, contact, deal              */
/* ------------------------------------------------------------------ */

export const loadDocumentContext = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.workspaceId !== wsCtx.workspace._id) return null;
    const [company, contact, deal] = await Promise.all([
      doc.companyId ? ctx.db.get(doc.companyId) : Promise.resolve(null),
      doc.contactId ? ctx.db.get(doc.contactId) : Promise.resolve(null),
      doc.dealId ? ctx.db.get(doc.dealId) : Promise.resolve(null),
    ]);
    return {
      doc,
      workspace: wsCtx.workspace,
      userId: wsCtx.user._id,
      company,
      contact,
      deal,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Persist fit score                                                     */
/* ------------------------------------------------------------------ */

export const persistFitScore = internalMutation({
  args: {
    resultId: v.id("prospectorResults"),
    score: v.number(),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resultId, {
      fitScore: args.score,
      fitReasoning: args.reasoning,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Persist enrichment                                                    */
/* ------------------------------------------------------------------ */

export const persistEnrichment = internalMutation({
  args: {
    resultId: v.id("prospectorResults"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    description: v.optional(v.string()),
    socials: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.get(args.resultId);
    if (!result) return;
    const rawEnrichment = ((result.rawPlaceData as Record<string, unknown>) ?? {});
    await ctx.db.patch(args.resultId, {
      email: args.email ?? result.email,
      phone: args.phone ?? result.phone,
      enrichedAt: Date.now(),
      enrichmentStatus: "done",
      rawPlaceData: {
        ...rawEnrichment,
        description: args.description,
        socials: args.socials,
      },
    });
  },
});

export const markEnrichment = internalMutation({
  args: {
    resultId: v.id("prospectorResults"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("no_website"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resultId, {
      enrichmentStatus: args.status,
      enrichmentError: args.error,
      enrichedAt: args.status === "done" ? Date.now() : undefined,
    });
  },
});

/**
 * Load full context for cold outreach drafting — company + optional
 * contact + workspace brand fields. Session-scoped (uses
 * requireWorkspaceContext), so the calling user must be in the
 * workspace.
 */
export const loadCompanyForOutreach = internalQuery({
  args: {
    companyId: v.id("companies"),
    contactId: v.optional(v.id("contacts")),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const company = await ctx.db.get(args.companyId);
    if (!company || company.workspaceId !== wsCtx.workspace._id) return null;

    let contact: Doc<"contacts"> | null = null;
    if (args.contactId) {
      const c = await ctx.db.get(args.contactId);
      if (c && c.workspaceId === wsCtx.workspace._id) contact = c;
    } else {
      // Auto-pick primary contact for this company (most recent one)
      const rows = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_company", (q) =>
          q
            .eq("workspaceId", wsCtx.workspace._id)
            .eq("companyId", args.companyId),
        )
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .order("desc")
        .first();
      contact = rows;
    }

    const enrichment =
      typeof company.enrichmentData === "object" && company.enrichmentData
        ? (company.enrichmentData as Record<string, unknown>)
        : {};
    const description = typeof enrichment.description === "string"
      ? enrichment.description
      : company.description;
    const types = Array.isArray(enrichment.types) ? (enrichment.types as string[]) : undefined;

    return {
      workspace: wsCtx.workspace,
      userId: wsCtx.user._id,
      brand: {
        workspaceName: wsCtx.workspace.name,
        oneLiner: wsCtx.workspace.oneLiner,
        offerings: wsCtx.workspace.offerings,
        targetMarket: wsCtx.workspace.targetMarket,
        pricingSummary: wsCtx.workspace.pricingSummary,
        brandVoice: wsCtx.workspace.brandVoice,
      },
      company: {
        name: company.name,
        domain: company.domain,
        industry: company.industry,
        city: company.city,
        country: company.country,
        address: company.address,
        website: company.website,
        description,
        types,
        fitScore: company.fitScore,
        fitReasoning: undefined,
      },
      contact: contact
        ? {
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title,
            email: contact.email,
            phone: contact.phone,
          }
        : undefined,
    };
  },
});
