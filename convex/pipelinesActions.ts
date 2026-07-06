"use node";

/**
 * Rotting-deal health cron. Runs weekly.
 *
 * Pulls all open deals where lastActivityAt + stage.rotDays days
 * has passed, and runs the AI feature `classify_deal_health` to
 * assign a healthScore (0-100) + healthNotes (why).
 *
 * The AI call is proxied through the org's Groq key (fallback:
 * Gemini) via the shared `runFeature` helper. If no key is
 * configured we skip the deal.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildAgentSystem } from "./lib/agentPersona";

const BATCH = 30;

export const classifyRottingDeals = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; classified: number }> => {
    const deals = await ctx.runQuery(internal.pipelines.listRottingDeals, {
      limit: BATCH,
    });
    let classified = 0;
    for (const d of deals) {
      const key: string | null = await ctx.runQuery(
        internal.trendsActionsHelpers.getGroqKey,
        { workspaceId: d.workspaceId },
      );
      if (!key) continue;

      // Persona harness — same identity every AI feature uses
      const persona = await ctx.runQuery(
        internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
        { workspaceId: d.workspaceId },
      );
      if (!persona) continue;
      const systemPrompt = buildAgentSystem(persona, "deal_analyst");

      const prompt = `Deal to analyse:
- Name: ${d.name}
- Stage: ${d.stageName}
- Amount: ${d.amountCents} ${d.currency}
- Days since last activity: ${d.daysSinceActivity}
- Age (days): ${d.ageDays}
- Notes: ${d.notes ?? "none"}

Only refer to this deal by its exact name above. ${persona.ownerFirstName} works alone — do NOT suggest assigning to teammates.`;

      let healthScore = 50;
      let healthNotes = "";
      let nextAction = "";
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 300,
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as {
            healthScore?: number;
            healthNotes?: string;
            nextAction?: string;
          };
          if (typeof parsed.healthScore === "number") healthScore = Math.max(0, Math.min(100, parsed.healthScore));
          if (typeof parsed.healthNotes === "string") healthNotes = parsed.healthNotes.slice(0, 200);
          if (typeof parsed.nextAction === "string") nextAction = parsed.nextAction.slice(0, 120);
        }
      } catch {
        continue;
      }

      await ctx.runMutation(internal.pipelines.updateDealHealth, {
        dealId: d._id,
        healthScore,
        healthNotes,
        nextAction,
      });
      // If health dropped low, notify the workspace
      if (healthScore < 40) {
        await ctx.runMutation(internal.notifications.notify, {
          workspaceId: d.workspaceId,
          kind: "rotting_deal",
          title: `Deal rotting: ${d.name}`,
          body: nextAction || healthNotes,
          actionLink: `/pipelines`,
        });
      }
      classified++;
    }
    return { scanned: deals.length, classified };
  },
});
