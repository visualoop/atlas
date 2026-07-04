/**
 * Outreach suggestion queries — power the /today "Who to contact next"
 * strip + the /outreach/queue batch drafter.
 *
 * Ranks candidates by (fitScore desc, reachability, freshness).
 * Excludes companies you've already messaged.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Doc } from "./_generated/dataModel";

interface Suggestion {
  companyId: string;
  companyName: string;
  city?: string;
  industry?: string;
  fitScore?: number;
  fitReason?: string;
  hasEmail: boolean;
  hasPhone: boolean;
  primaryEmail?: string;
  primaryPhone?: string;
  contactId?: string;
  contactName?: string;
}

/**
 * Top N cold companies with contact info and no prior outbound message.
 * Sorted by fitScore desc so highest-priority prospects surface first.
 */
export const nextContactSuggestions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Suggestion[]> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const limit = args.limit ?? 5;

    // 1. Load cold prospector-sourced companies
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_workspace_lifecycle", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("lifecycleStage", "cold"),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("source"), "prospector"),
        ),
      )
      .take(200);

    // 2. Filter to reachable + not already messaged
    const suggestions: Array<{ company: Doc<"companies">; fitScore: number }> = [];
    for (const c of companies) {
      const reachable = Boolean(c.phone?.trim() || c.emailPrimary?.trim() || c.website?.trim());
      if (!reachable) continue;

      // Check if we've sent any outbound message linked to a
      // contact at this company. Query conversations by companyId,
      // then messages by conversation.
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_company", (q) => q.eq("companyId", c._id))
        .take(5);
      let hasOutbound = false;
      for (const conv of convs) {
        const outbound = await ctx.db
          .query("messages")
          .withIndex("by_conversation_time", (q) =>
            q.eq("conversationId", conv._id),
          )
          .filter((q) => q.eq(q.field("direction"), "outbound"))
          .first();
        if (outbound) {
          hasOutbound = true;
          break;
        }
      }
      if (hasOutbound) continue;

      suggestions.push({
        company: c,
        fitScore: c.fitScore ?? 50,
      });
    }

    // 3. Sort by fit desc, take top N
    suggestions.sort((a, b) => b.fitScore - a.fitScore);
    const topN = suggestions.slice(0, limit);

    // 4. Attach primary contact
    return await Promise.all(
      topN.map(async ({ company: c }) => {
        const contact = await ctx.db
          .query("contacts")
          .withIndex("by_workspace_company", (q) =>
            q.eq("workspaceId", wsCtx.workspace._id).eq("companyId", c._id),
          )
          .filter((q) => q.eq(q.field("archivedAt"), undefined))
          .first();
        return {
          companyId: c._id,
          companyName: c.name,
          city: c.city,
          industry: c.industry,
          fitScore: c.fitScore,
          fitReason: undefined,
          hasEmail: Boolean(c.emailPrimary || contact?.email),
          hasPhone: Boolean(c.phone || contact?.phone),
          primaryEmail: c.emailPrimary ?? contact?.email,
          primaryPhone: c.phone ?? contact?.phone,
          contactId: contact?._id,
          contactName: contact
            ? `${contact.firstName}${contact.lastName ? " " + contact.lastName : ""}`
            : undefined,
        };
      }),
    );
  },
});
