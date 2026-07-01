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
