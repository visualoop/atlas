"use node";

/**
 * Nightly analytics snapshot cron.
 *
 * Runs at 00:15 Africa/Nairobi (21:15 UTC). For each workspace,
 * aggregates yesterday's totals and upserts into analyticsSnapshots
 * with a 'YYYY-MM-DD' key.
 *
 * Uses UTC day boundaries for simplicity; UI localizes for display.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const rollupDailySnapshots = internalAction({
  args: {},
  handler: async (ctx): Promise<{ workspaces: number }> => {
    const workspaces = await ctx.runQuery(
      internal.analyticsActionsHelpers.listActiveWorkspaces,
      {},
    );

    // Snapshot the day that just ended: yesterday-in-UTC.
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    now.setUTCDate(now.getUTCDate() - 1);
    const day = now.toISOString().slice(0, 10);
    const startMs = now.getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000;

    for (const ws of workspaces) {
      await ctx.runMutation(internal.analyticsActionsHelpers.rollupOneWorkspace, {
        workspaceId: ws._id,
        day,
        startMs,
        endMs,
      });
    }

    return { workspaces: workspaces.length };
  },
});
