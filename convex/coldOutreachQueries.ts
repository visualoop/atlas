/**
 * V8 queries for cold outreach — split from coldOutreach.ts because
 * that file is a Node action module and can't host queries.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";

export const companyAiDraft = query({
  args: { companyId: v.id("companies") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    email?: { subject?: string; body: string; draftedAt: number };
    whatsapp?: { body: string; draftedAt: number };
  } | null> => {
    const user = await requireUser(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;
    // Access check — user's active workspace must match
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.lastActiveWorkspaceId !== company.workspaceId) {
      return null;
    }
    const enrichment =
      typeof company.enrichmentData === "object" && company.enrichmentData
        ? (company.enrichmentData as Record<string, unknown>)
        : {};
    const draft = enrichment.aiDraft;
    if (!draft || typeof draft !== "object") return null;
    return draft as {
      email?: { subject?: string; body: string; draftedAt: number };
      whatsapp?: { body: string; draftedAt: number };
    };
  },
});
