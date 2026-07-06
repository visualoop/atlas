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

/**
 * Session-less variant — used when the caller is a scheduler action
 * (auto-draft on inbound). Resolves org owner as the actor for logging.
 */
export const loadConversationForReplyForSystem = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    const workspace = await ctx.db.get(conv.workspaceId);
    if (!workspace) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", workspace.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_time", (q) => q.eq("conversationId", conv._id))
      .order("asc")
      .take(30);
    // Load workspace sender identities so callers can detect
    // self-addressed / echoed emails and skip drafting.
    const senderIdentities = await ctx.db
      .query("senderIdentities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const ownAddresses = senderIdentities
      .map((s) => s.address?.toLowerCase())
      .filter((a): a is string => Boolean(a));
    return {
      conversation: conv,
      messages,
      workspace,
      userId: owner.userId,
      ownAddresses,
    };
  },
});

/**
 * Persist the auto-generated reply draft onto the inbound message row.
 * The thread reader detects it and shows a "Use draft" chip.
 */
export const saveAutoDraft = internalMutation({
  args: { messageId: v.id("messages"), draft: v.string() },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    await ctx.db.patch(args.messageId, {
      aiDraftReply: args.draft,
      aiDraftedAt: Date.now(),
    });
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

/**
 * Session-less variant used by scheduler actions (auto-enrich).
 * Resolves workspace + org owner directly from the result's
 * workspaceId. Same output shape as loadProspectorResult so callers
 * can share code.
 */
export const loadProspectorResultForSystem = internalQuery({
  args: { resultId: v.id("prospectorResults") },
  handler: async (ctx, args) => {
    const result = await ctx.db.get(args.resultId);
    if (!result) return null;
    const workspace = await ctx.db.get(result.workspaceId);
    if (!workspace) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", workspace.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;
    return {
      result,
      workspace,
      userId: owner.userId,
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

/**
 * Load full context for cold outreach directly from a prospector
 * result (before it's been imported as a company). Same shape as
 * loadCompanyForOutreach so the AI action can reuse the same prompt
 * builder.
 */
export const loadResultForOutreach = internalQuery({
  args: { resultId: v.id("prospectorResults") },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const r = await ctx.db.get(args.resultId);
    if (!r || r.workspaceId !== wsCtx.workspace._id) return null;

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
        name: r.name,
        industry: undefined,
        city: r.city,
        country: r.country,
        address: r.address,
        website: r.website,
        description: undefined,
        types: r.types,
        fitScore: r.fitScore,
        fitReasoning: r.fitReasoning,
      },
      contact: r.email || r.phone
        ? {
            firstName: r.name.split(/\s+/)[0] ?? "Owner",
            lastName: undefined,
            title: "Primary contact",
            email: r.email,
            phone: r.phone,
          }
        : undefined,
    };
  },
});


/* ============================================================ */
/* Fit scoring helpers                                            */
/* ============================================================ */

export const loadContactForScoring = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    firstName: string;
    lastName?: string;
    email?: string;
    title?: string;
    notes?: string;
    companyName?: string;
    companyIndustry?: string;
  } | null> => {
    const c = await ctx.db.get(args.contactId);
    if (!c) return null;
    let companyName: string | undefined;
    let companyIndustry: string | undefined;
    if (c.companyId) {
      const co = await ctx.db.get(c.companyId);
      if (co) {
        companyName = co.name;
        companyIndustry = co.industry;
      }
    }
    return {
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      title: c.title,
      notes: c.notes,
      companyName,
      companyIndustry,
    };
  },
});

export const saveContactFitScore = internalMutation({
  args: {
    contactId: v.id("contacts"),
    score: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, {
      fitScore: args.score,
      fitScoreReason: args.reason,
    });
  },
});

export const loadCompanyForScoring = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    name: string;
    industry?: string;
    description?: string;
    website?: string;
    city?: string;
  } | null> => {
    const c = await ctx.db.get(args.companyId);
    if (!c) return null;
    return {
      name: c.name,
      industry: c.industry,
      description: c.description,
      website: c.website,
      city: c.city,
    };
  },
});

export const saveCompanyFitScore = internalMutation({
  args: {
    companyId: v.id("companies"),
    score: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.companyId, {
      fitScore: args.score,
      fitScoreReason: args.reason,
    });
  },
});


/* ============================================================ */
/* Session-less variant of loadCompanyForOutreach — used by      */
/* auto-draft scheduler after prospect import.                    */
/* ============================================================ */

export const loadCompanyForOutreachForSystem = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;

    const workspace = await ctx.db.get(company.workspaceId);
    if (!workspace) return null;

    // Resolve org owner for the actorId that runFeature audits with
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) =>
        q.eq("organizationId", workspace.organizationId),
      )
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return null;

    // Auto-pick primary contact for this company
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_company", (q) =>
        q
          .eq("workspaceId", workspace._id)
          .eq("companyId", args.companyId),
      )
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .order("desc")
      .first();

    const enrichment =
      typeof company.enrichmentData === "object" && company.enrichmentData
        ? (company.enrichmentData as Record<string, unknown>)
        : {};
    const description = typeof enrichment.description === "string"
      ? enrichment.description
      : company.description;
    const types = Array.isArray(enrichment.types)
      ? (enrichment.types as string[])
      : undefined;

    return {
      workspace,
      userId: owner.userId,
      brand: {
        workspaceName: workspace.name,
        oneLiner: workspace.oneLiner,
        offerings: workspace.offerings,
        targetMarket: workspace.targetMarket,
        pricingSummary: workspace.pricingSummary,
        brandVoice: workspace.brandVoice,
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

export const saveCompanyAiDraft = internalMutation({
  args: {
    companyId: v.id("companies"),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return;
    const enrichment =
      typeof company.enrichmentData === "object" && company.enrichmentData
        ? { ...(company.enrichmentData as Record<string, unknown>) }
        : {};
    const existing =
      typeof enrichment.aiDraft === "object" && enrichment.aiDraft
        ? { ...(enrichment.aiDraft as Record<string, unknown>) }
        : {};
    if (args.channel === "email") {
      existing.email = { subject: args.subject, body: args.body, draftedAt: Date.now() };
    } else {
      existing.whatsapp = { body: args.body, draftedAt: Date.now() };
    }
    enrichment.aiDraft = existing;
    await ctx.db.patch(args.companyId, {
      enrichmentData: enrichment,
    });
  },
});


/* ============================================================ */
/* Central persona harness loader — used by every AI action      */
/* ============================================================ */

import { loadAgentPersonaContext } from "./lib/agentPersona";

export const loadAgentPersonaForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await loadAgentPersonaContext(ctx, args.workspaceId);
  },
});
