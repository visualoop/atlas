/**
 * Per-page proactive agents.
 *
 * Each list page (contacts, companies, pipelines, prospector,
 * outreach queue) gets a small AI-ranked recommendation bar at
 * the top. Not "count of X, count of Y" — direct verdicts on
 * which records to act on right now, grounded in real data.
 *
 * All actions here run through the persona harness (Pass 1) and
 * read long-term memory (Pass 4) so recommendations are
 * consistent with the workspace's identity and history.
 */

"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildAgentSystem } from "./lib/agentPersona";

const SYSTEM_ROLE_HINT = `You are ranking a workspace's records so the founder knows what to act on today.

Return JSON exactly:
{"picks": [{"id": "<record id>", "reason": "one specific sentence why this is the top pick"}]}

Rules:
- Pick 3 records from the input list.
- Reason must be specific: mention actual field values (title, industry,
  days since contact, fit score) — never generic.
- Never invent an id — use one from the input list.
- If the list is empty, return {"picks": []}.

No prose, no code fences.`;

interface Pick {
  id: string;
  reason: string;
}

interface RankResponse {
  picks: Pick[];
}

function parsePicks(text: string, validIds: Set<string>): Pick[] {
  const clean = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(clean) as RankResponse;
    if (!Array.isArray(parsed.picks)) return [];
    return parsed.picks
      .filter((p) => p && typeof p.id === "string" && validIds.has(p.id))
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        reason: String(p.reason ?? "").slice(0, 240),
      }));
  } catch {
    return [];
  }
}

/* ============================================================ */
/* Contacts — who to reach out to first                          */
/* ============================================================ */

export const rankContactsForOutreach = action({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ picks: Array<Pick & { record: Record<string, unknown> }> }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) return { picks: [] };
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) return { picks: [] };

    const contacts = await ctx.runQuery(
      internal.pageAgentsHelpers.contactsForRanking,
      { workspaceId: setup.workspaceId, limit: args.limit ?? 40 },
    );
    if (contacts.length === 0) return { picks: [] };
    if (contacts.length <= 3) {
      // No point calling the model — return them as-is
      return {
        picks: contacts.map((c) => ({
          id: c._id,
          reason: c.title
            ? `${c.title}${c.companyName ? ` at ${c.companyName}` : ""} — cold contact, worth an intro touch.`
            : c.companyName
              ? `Primary contact at ${c.companyName} — cold, worth reaching out.`
              : "Cold contact in your workspace.",
          record: c as unknown as Record<string, unknown>,
        })),
      };
    }

    const systemPrompt = buildAgentSystem(persona, "general") +
      "\n\n" +
      SYSTEM_ROLE_HINT;

    const userPrompt = [
      `Rank the top 3 contacts ${persona.ownerFirstName} should reach out to first from ${persona.workspaceName}.`,
      "",
      "Contacts:",
      ...contacts.map((c) => {
        const parts = [
          `- id=${c._id}`,
          `name=${c.firstName}${c.lastName ? " " + c.lastName : ""}`,
          c.title ? `title=${c.title}` : "",
          c.companyName ? `company=${c.companyName}` : "",
          c.companyIndustry ? `industry=${c.companyIndustry}` : "",
          typeof c.fitScore === "number" ? `fit=${c.fitScore}/100` : "",
          c.lifecycleStage ? `stage=${c.lifecycleStage}` : "",
        ].filter(Boolean);
        return parts.join(" · ");
      }),
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "extract_json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "page_agent",
      resourceId: `contacts-rank-${Date.now()}`,
    });

    const validIds = new Set(contacts.map((c) => c._id as unknown as string));
    const picks = parsePicks(result.text, validIds);

    const byId = new Map(contacts.map((c) => [c._id as unknown as string, c]));
    return {
      picks: picks.map((p) => ({
        ...p,
        record: (byId.get(p.id) ?? {}) as unknown as Record<string, unknown>,
      })),
    };
  },
});

/* ============================================================ */
/* Companies — who to reach out to first                         */
/* ============================================================ */

export const rankCompaniesForOutreach = action({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ picks: Array<Pick & { record: Record<string, unknown> }> }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) return { picks: [] };
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) return { picks: [] };

    const companies = await ctx.runQuery(
      internal.pageAgentsHelpers.companiesForRanking,
      { workspaceId: setup.workspaceId, limit: args.limit ?? 40 },
    );
    if (companies.length === 0) return { picks: [] };
    if (companies.length <= 3) {
      return {
        picks: companies.map((c) => ({
          id: c._id,
          reason: c.industry
            ? `${c.industry} company in your workspace, not yet touched.`
            : "Uncontacted company in your workspace.",
          record: c as unknown as Record<string, unknown>,
        })),
      };
    }

    const systemPrompt = buildAgentSystem(persona, "general") +
      "\n\n" +
      SYSTEM_ROLE_HINT;

    const userPrompt = [
      `Rank the top 3 companies ${persona.ownerFirstName} should reach out to first from ${persona.workspaceName}.`,
      "",
      "Companies:",
      ...companies.map((c) => {
        const parts = [
          `- id=${c._id}`,
          `name=${c.name}`,
          c.industry ? `industry=${c.industry}` : "",
          c.city ? `city=${c.city}` : "",
          typeof c.fitScore === "number" ? `fit=${c.fitScore}/100` : "",
          c.lifecycleStage ? `stage=${c.lifecycleStage}` : "",
        ].filter(Boolean);
        return parts.join(" · ");
      }),
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "extract_json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "page_agent",
      resourceId: `companies-rank-${Date.now()}`,
    });

    const validIds = new Set(companies.map((c) => c._id as unknown as string));
    const picks = parsePicks(result.text, validIds);

    const byId = new Map(companies.map((c) => [c._id as unknown as string, c]));
    return {
      picks: picks.map((p) => ({
        ...p,
        record: (byId.get(p.id) ?? {}) as unknown as Record<string, unknown>,
      })),
    };
  },
});


/* ============================================================ */
/* Pipelines — deals about to slip                                */
/* ============================================================ */

export const rankDealsToSaveToday = action({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ picks: Array<Pick & { record: Record<string, unknown> }> }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) return { picks: [] };
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) return { picks: [] };

    const deals = await ctx.runQuery(
      internal.pageAgentsHelpers.dealsForRanking,
      { workspaceId: setup.workspaceId, limit: args.limit ?? 30 },
    );
    if (deals.length === 0) return { picks: [] };
    if (deals.length <= 3) {
      return {
        picks: deals.map((d) => ({
          id: d._id,
          reason:
            d.aiNextAction ??
            `${d.name} — ${d.daysStale ?? 0} days idle. ${d.healthNotes ?? "Worth a nudge."}`,
          record: d as unknown as Record<string, unknown>,
        })),
      };
    }

    const systemPrompt = buildAgentSystem(persona, "deal_analyst") +
      "\n\n" +
      SYSTEM_ROLE_HINT;

    const userPrompt = [
      `Rank the top 3 deals ${persona.ownerFirstName} should save today.`,
      "",
      "Deals:",
      ...deals.map((d) => {
        const parts = [
          `- id=${d._id}`,
          `name=${d.name}`,
          d.stage ? `stage=${d.stage}` : "",
          typeof d.healthScore === "number" ? `health=${d.healthScore}` : "",
          typeof d.daysStale === "number" ? `days_idle=${d.daysStale}` : "",
          d.aiNextAction ? `nudge=${d.aiNextAction}` : "",
        ].filter(Boolean);
        return parts.join(" · ");
      }),
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "extract_json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "page_agent",
      resourceId: `deals-rank-${Date.now()}`,
    });

    const validIds = new Set(deals.map((d) => d._id as unknown as string));
    const picks = parsePicks(result.text, validIds);

    const byId = new Map(deals.map((d) => [d._id as unknown as string, d]));
    return {
      picks: picks.map((p) => ({
        ...p,
        record: (byId.get(p.id) ?? {}) as unknown as Record<string, unknown>,
      })),
    };
  },
});
