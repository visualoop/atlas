/**
 * OSM/Overpass server-side cache.
 *
 * We cache Overpass API results in Convex for 24h to sidestep the
 * community endpoint's 429 rate limits. Grid-cell keyed
 * (2km precision) so nearby pans share the same cache bucket.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

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
