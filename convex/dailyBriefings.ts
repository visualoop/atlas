"use node";

/**
 * Daily briefing generator.
 *
 * Fires 3x/day (06:00, 12:00, 18:00 UTC) via crons.ts. For each
 * active workspace it queries today's queue counts, top open deal,
 * rotting deals, recent messages, top uncontacted prospect — passes
 * them to a summarize task model, stores the resulting paragraph in
 * dailyBriefings, deletes older briefings for the same workspace.
 *
 * Runs session-less. Falls back gracefully when the workspace has
 * no data yet (returns a friendly onboarding briefing).
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const BRIEFING_SYSTEM = `You write a founder's daily briefing.

Style:
- 2-3 sentences, max 60 words.
- Direct, Kenyan English, no AI-slop.
- Actionable — mention specific names, deals, counts.
- Never generic ("You have some tasks"). Always specific ("Kimton Pharmacy hasn't replied in 6 days — worth a nudge.").
- No "Hope you're having a great day" preamble. Get straight to it.

Return ONLY the briefing paragraph. No headers, no bullets.`;

export const generateForAllWorkspaces = internalAction({
  args: {},
  handler: async (ctx): Promise<{ generated: number }> => {
    const workspaces = await ctx.runQuery(
      internal.dailyBriefingsHelpers.listActiveWorkspaces,
      {},
    );
    let generated = 0;
    for (const ws of workspaces) {
      try {
        await ctx.runAction(internal.dailyBriefings.generateOne, {
          workspaceId: ws._id as Id<"workspaces">,
        });
        generated++;
      } catch (err) {
        console.warn("[dailyBriefing] failed for", ws._id, err);
      }
    }
    return { generated };
  },
});

export const generateOne = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args,
  ): Promise<{ briefing: string; model: string }> => {
    // Load setup (org owner as actor for keys + brand)
    const setup = await ctx.runQuery(
      internal.copilotHelpers.prepareForWorkspace,
      { workspaceId: args.workspaceId },
    );
    if (!setup) throw new Error("no_setup");

    // Load today's snapshot data
    const snapshot = await ctx.runQuery(
      internal.dailyBriefingsHelpers.gatherBriefingContext,
      { workspaceId: args.workspaceId },
    );

    const assistantName = setup.brand?.workspaceName ?? "Atlas";
    const contextLines: string[] = [];
    contextLines.push(`Workspace: ${assistantName}`);
    if (setup.brand?.oneLiner)
      contextLines.push(`Business: ${setup.brand.oneLiner}`);
    contextLines.push("");
    contextLines.push("### Today's numbers");
    contextLines.push(
      `Unread conversations: ${snapshot.unreadConversations}`,
    );
    contextLines.push(`Tasks due today: ${snapshot.tasksDueToday}`);
    contextLines.push(`Meetings today: ${snapshot.meetingsToday}`);
    contextLines.push(`Rotting deals: ${snapshot.rottingDeals}`);
    contextLines.push(`Uncontacted prospects: ${snapshot.uncontactedProspects}`);
    if (snapshot.topOpenDeal) {
      contextLines.push(
        `Top open deal: ${snapshot.topOpenDeal.name} · ${snapshot.topOpenDeal.amount ?? "no amount"}`,
      );
    }
    if (snapshot.recentInboundSubjects.length > 0) {
      contextLines.push(
        `Recent messages: ${snapshot.recentInboundSubjects.slice(0, 3).join(" · ")}`,
      );
    }
    if (snapshot.stalestDealName) {
      contextLines.push(
        `Stalest deal: ${snapshot.stalestDealName} — ${snapshot.stalestDealDaysStale} days`,
      );
    }

    contextLines.push("");
    contextLines.push(
      "Now write the 2-3 sentence briefing for the founder.",
    );

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: args.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "summarize_thread",
      messages: [
        { role: "system", content: BRIEFING_SYSTEM },
        { role: "user", content: contextLines.join("\n") },
      ],
      resourceType: "daily_briefing",
      resourceId: `briefing-${args.workspaceId}-${Date.now()}`,
    });

    await ctx.runMutation(internal.dailyBriefingsHelpers.saveBriefing, {
      workspaceId: args.workspaceId,
      briefing: result.text.trim(),
      modelUsed: `${result.provider}/${result.model}`,
    });

    return { briefing: result.text.trim(), model: result.model };
  },
});
