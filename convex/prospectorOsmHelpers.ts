/**
 * OSM/Overpass server-side cache.
 *
 * We cache Overpass API results in Convex for 24h to sidestep the
 * community endpoint's 429 rate limits. Grid-cell keyed
 * (2km precision) so nearby pans share the same cache bucket.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";

/**
 * Return the workspace's Geoapify API key if configured, else null.
 * Used to route Prospector OSM traffic through Geoapify (3000/day free,
 * dedicated infra) instead of shared-IP Overpass mirrors.
 */
export const getGeoapifyKey = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: profile.lastActiveOrgId,
        provider: "geoapify",
        reason: "prospector_osm",
        actorId: user._id,
      });
      return k.value;
    } catch {
      return null;
    }
  },
});

export const getCached = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("osmSearchCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    return row;
  },
});

export const saveCached = internalMutation({
  args: {
    key: v.string(),
    places: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("osmSearchCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        places: args.places,
        cachedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("osmSearchCache", {
        key: args.key,
        places: args.places,
        cachedAt: Date.now(),
      });
    }
  },
});
