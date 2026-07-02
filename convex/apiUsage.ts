/**
 * Google Maps API rate-limit tracker.
 *
 * Google gives every project $200/month free credit for Maps.
 * That's ~11,700 searchNearby calls or ~5,000 searchText calls.
 *
 * We enforce a HARD cap per workspace per day so the founder can
 * never accidentally blow through free tier. Default 200 calls/day
 * (~6,000/month) = 30% of free tier, big margin.
 *
 * Pattern: every action that calls the Places API checks the budget
 * first via `checkAndRecord`. If the day is capped, throws immediately
 * before making any billable HTTP call.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Id } from "./_generated/dataModel";

/**
 * Get today's Places API search count for a workspace.
 */
export const getTodayCount = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ count: number; cap: number; day: string }> => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return { count: 0, cap: 0, day: "" };

    const cap = ws.googleMapsDailySearchCap ?? 150;
    const day = todayKey();

    const row = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_workspace_provider_day", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", "google_maps_places")
          .eq("day", day),
      )
      .first();

    return { count: row?.count ?? 0, cap, day };
  },
});

/**
 * Enforces the cap AND increments the counter atomically. Call this
 * from any Google Places API action BEFORE the fetch.
 *
 * Throws ConvexError('RATE_LIMIT_HIT') if the day is capped.
 */
export const checkAndRecord = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) throw new ConvexError({ code: "NOT_FOUND", message: "Workspace not found." });

    const cap = ws.googleMapsDailySearchCap ?? 150;
    const day = todayKey();

    const existing = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_workspace_provider_day", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", "google_maps_places")
          .eq("day", day),
      )
      .first();

    const current = existing?.count ?? 0;
    if (current >= cap) {
      throw new ConvexError({
        code: "RATE_LIMIT_HIT",
        message: `Daily Google Maps cap reached (${current}/${cap}). Bump it at Settings → Workspace or wait until tomorrow. This protects you from accidentally leaving Google's free tier.`,
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, { count: current + 1, lastUsedAt: Date.now() });
    } else {
      await ctx.db.insert("apiUsageDaily", {
        workspaceId: args.workspaceId,
        provider: "google_maps_places",
        day,
        count: 1,
        firstUsedAt: Date.now(),
        lastUsedAt: Date.now(),
      });
    }
  },
});

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Today's Google Maps usage — public query so the UI can render
 * "X / cap searches left today" in the map header.
 */
export const getMapsUsageToday = query({
  args: {},
  handler: async (ctx): Promise<{
    count: number;
    cap: number;
    remaining: number;
    day: string;
  }> => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const cap = wsCtx.workspace.googleMapsDailySearchCap ?? 200;
    const day = new Date().toISOString().slice(0, 10);

    const row = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_workspace_provider_day", (q) =>
        q
          .eq("workspaceId", wsCtx.workspace._id)
          .eq("provider", "google_maps_places")
          .eq("day", day),
      )
      .first();

    const count = row?.count ?? 0;
    return { count, cap, remaining: Math.max(0, cap - count), day };
  },
});
