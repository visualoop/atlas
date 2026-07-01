/**
 * Internal queries for the ⌘J Copilot's tool-use.
 *
 * All queries scoped to a workspaceId that's resolved from the caller's
 * userProfile.lastActiveWorkspaceId (via prepare()).
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";
import type { Doc, Id } from "./_generated/dataModel";

export const prepare = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
    userId: Id<"users">;
    keys: {
      groq?: string;
      openrouter?: string;
    };
    brand: {
      workspaceName?: string;
      website?: string;
      oneLiner?: string;
      elevatorPitch?: string;
      offerings?: string;
      targetMarket?: string;
      brandVoice?: string;
      coreValues?: string;
      pricingSummary?: string;
    } | null;
  } | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId || !profile?.lastActiveOrgId) return null;

    // Fetch AI keys (Groq for Compound, OpenRouter for fallback)
    const keys: { groq?: string; openrouter?: string } = {};
    for (const p of ["groq", "openrouter"] as const) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: profile.lastActiveOrgId,
          provider: p,
          reason: "copilot_chat",
          actorId: user._id,
        });
        keys[p] = k.value;
      } catch {
        // Missing key — skipped
      }
    }

    // Workspace brand context
    const ws = await ctx.db.get(profile.lastActiveWorkspaceId);
    const brand = ws
      ? {
          workspaceName: ws.name,
          website: ws.website,
          oneLiner: ws.oneLiner,
          elevatorPitch: ws.elevatorPitch,
          offerings: ws.offerings,
          targetMarket: ws.targetMarket,
          brandVoice: ws.brandVoice,
          coreValues: ws.coreValues,
          pricingSummary: ws.pricingSummary,
        }
      : null;

    return {
      workspaceId: profile.lastActiveWorkspaceId,
      organizationId: profile.lastActiveOrgId,
      userId: user._id,
      keys,
      brand,
    };
  },
});

export const searchContacts = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    if (q.length < 1) return [];
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const matches = rows
      .filter((c) => c.archivedAt === undefined)
      .filter((c) => {
        const hay = `${c.firstName} ${c.lastName ?? ""} ${c.email ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, args.limit)
      .map((c) => ({
        id: c._id,
        name: `${c.firstName}${c.lastName ? " " + c.lastName : ""}`,
        email: c.email,
        phone: c.phone,
        lifecycleStage: c.lifecycleStage,
        companyId: c.companyId,
      }));
    return matches;
  },
});

export const searchCompanies = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    if (q.length < 1) return [];
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    return rows
      .filter((c) => c.archivedAt === undefined)
      .filter((c) => `${c.name} ${c.domain ?? ""}`.toLowerCase().includes(q))
      .slice(0, args.limit)
      .map((c) => ({
        id: c._id,
        name: c.name,
        domain: c.domain,
        lifecycleStage: c.lifecycleStage,
        city: c.city,
      }));
  },
});

export const searchDeals = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim().toLowerCase();
    const rows = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_workspace", (b) => b.eq("workspaceId", args.workspaceId))
      .collect();
    const stageById = new Map(stages.map((s) => [s._id, s]));
    return rows
      .filter((d) => d.archivedAt === undefined)
      .filter((d) => q.length === 0 || d.name.toLowerCase().includes(q))
      .slice(0, args.limit)
      .map((d) => ({
        id: d._id,
        name: d.name,
        amountCents: d.amountCents.toString(),
        currency: d.currency,
        stage: stageById.get(d.stageId)?.name ?? "unknown",
        won: !!d.wonAt,
        lost: !!d.lostAt,
        contactId: d.contactId,
        companyId: d.companyId,
      }));
  },
});

export const recentConversations = internalQuery({
  args: { workspaceId: v.id("workspaces"), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_state_time", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("state", "open"),
      )
      .order("desc")
      .take(args.limit);
    return rows.map((c) => ({
      id: c._id,
      channel: c.channel,
      subject: c.subject,
      participants: c.channel === "email" ? c.participantEmails : c.participantPhones,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      aiSummary: c.aiSummary,
    }));
  },
});

export const kpiSummary = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const deals = await ctx.db
      .query("deals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const open = deals.filter((d) => d.archivedAt === undefined && !d.wonAt && !d.lostAt);
    const wonMonth = deals.filter((d) => d.wonAt && d.wonAt >= thirtyDaysAgo);
    const pipelineCents = open.reduce((s, d) => s + d.amountCents, 0n);
    const wonCents = wonMonth.reduce((s, d) => s + d.amountCents, 0n);

    const invoices = await ctx.db
      .query("documents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "invoice"))
      .collect();
    const outstanding = invoices.filter(
      (i) => i.archivedAt === undefined && i.status !== "paid" && i.status !== "cancelled" && i.status !== "void",
    );
    const outstandingCents = outstanding.reduce((s, i) => s + i.totalCents, 0n);

    return {
      openDeals: open.length,
      pipelineCents: pipelineCents.toString(),
      wonThisMonth: wonMonth.length,
      wonThisMonthCents: wonCents.toString(),
      outstandingInvoices: outstanding.length,
      outstandingCents: outstandingCents.toString(),
      currency: deals[0]?.currency ?? "KES",
    };
  },
});


/* ============================================================ */
/* Public preflight — used by the CopilotPanel                    */
/* ============================================================ */

import { query } from "./_generated/server";

export const canRun = query({
  args: {},
  handler: async (ctx): Promise<{ ready: boolean; reason?: string }> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return { ready: false, reason: "not_in_workspace" };

    // Check for any AI key
    for (const provider of ["groq", "openrouter"] as const) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: profile.lastActiveOrgId,
          provider,
          reason: "copilot_preflight",
          actorId: user._id,
        });
        if (k.value) return { ready: true };
      } catch {}
    }
    return { ready: false, reason: "no_ai_key" };
  },
});
