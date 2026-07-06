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
import { buildAgentSystem } from "./lib/agentPersona";

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
    // Persona harness — same identity block every AI feature gets
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: args.workspaceId },
    );
    if (!persona) throw new Error("no_persona");
    const systemPrompt = buildAgentSystem(persona, "briefing");

    // Setup — used for AI keys + audit actorId
    const setup = await ctx.runQuery(
      internal.copilotHelpers.prepareForWorkspace,
      { workspaceId: args.workspaceId },
    );
    if (!setup) throw new Error("no_setup");

    // Grounded snapshot — real names, real numbers only
    const snapshot = await ctx.runQuery(
      internal.dailyBriefingsHelpers.gatherBriefingContext,
      { workspaceId: args.workspaceId },
    );

    // If nothing is actually happening, skip the AI call entirely and
    // return a canned briefing. Avoids hallucination when data is empty.
    const totalActivity =
      snapshot.unreadConversations +
      snapshot.tasksDueToday +
      snapshot.meetingsToday +
      snapshot.rottingDealsCount +
      snapshot.uncontactedProspectsCount +
      snapshot.topOpenDeals.length +
      snapshot.recentInbounds.length;
    if (totalActivity === 0) {
      const canned = `Your queue is clear, ${persona.ownerFirstName}. No replies waiting, no deals rotting, no tasks due, calendar is empty. Good time to run a prospector search or refine the workspace context.`;
      await ctx.runMutation(internal.dailyBriefingsHelpers.saveBriefing, {
        workspaceId: args.workspaceId,
        briefing: canned,
        modelUsed: "canned:no_activity",
      });
      return { briefing: canned, model: "canned:no_activity" };
    }

    // Build a data block the model MUST ground its briefing in.
    const lines: string[] = ["# Today's data", ""];
    lines.push(`Unread inbound conversations: ${snapshot.unreadConversations}`);
    lines.push(`Open tasks due today: ${snapshot.tasksDueToday}`);
    lines.push(`Meetings today: ${snapshot.meetingsToday}`);
    if (snapshot.upcomingMeetings.length > 0) {
      lines.push(`  - ${snapshot.upcomingMeetings.map((m) => `${m.at} · ${m.title}`).join("; ")}`);
    }
    lines.push(`Uncontacted prospect companies: ${snapshot.uncontactedProspectsCount}`);
    if (snapshot.uncontactedCompanies.length > 0) {
      lines.push(`  - Names in system: ${snapshot.uncontactedCompanies.join(", ")}`);
    }
    lines.push(`Rotting deals (>7 days idle): ${snapshot.rottingDealsCount}`);
    if (snapshot.rottingDeals.length > 0) {
      for (const d of snapshot.rottingDeals) {
        lines.push(`  - ${d.name} · ${d.daysStale} days idle`);
      }
    }
    if (snapshot.topOpenDeals.length > 0) {
      lines.push("Top open deals by size:");
      for (const d of snapshot.topOpenDeals) {
        lines.push(`  - ${d.name}${d.amount ? ` · ${d.amount}` : ""} · ${d.daysStale} days idle`);
      }
    }
    if (snapshot.recentInbounds.length > 0) {
      lines.push("Recent inbound (last 24h):");
      for (const i of snapshot.recentInbounds) {
        lines.push(`  - From ${i.from}: ${i.subject}`);
      }
    }
    lines.push("");
    lines.push(
      `Write ${persona.ownerFirstName}'s briefing now. 2-3 sentences max. Only reference records above by their exact names. If a section has zero, do NOT mention it.`,
    );

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: args.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "summarize_thread",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lines.join("\n") },
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
