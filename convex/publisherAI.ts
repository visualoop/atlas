"use node";

/**
 * Publisher / newsletter / content / social AI.
 *
 * Every action here runs through the persona harness with the
 * appropriate role, so newsletters, social posts, and content
 * brainstorms all share Atlas's identity block and voice rules.
 *
 * These are user-facing actions used by the /content, /social,
 * /campaigns, and /analytics pages.
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildAgentSystem } from "./lib/agentPersona";

/* ============================================================ */
/* Newsletter drafts — long-form email body                       */
/* ============================================================ */

export const draftNewsletter = action({
  args: {
    brief: v.string(),                                        // "share the new pricing" / "welcome to Q1" / etc
    audienceNote: v.optional(v.string()),                     // "for existing customers" / "for retail owners"
    lengthWords: v.optional(v.number()),                      // default 400
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ markdown: string; provider: string; model: string }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) throw new ConvexError({ code: "NO_WORKSPACE", message: "No workspace." });
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) throw new ConvexError({ code: "NO_PERSONA", message: "Workspace not configured." });

    const systemPrompt = buildAgentSystem(persona, "newsletter_draft");
    const userPrompt = [
      `Newsletter brief: ${args.brief}`,
      args.audienceNote ? `Audience: ${args.audienceNote}` : "",
      `Target length: ${args.lengthWords ?? 400} words.`,
      "",
      "Write the newsletter body.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "generate_document",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "newsletter_draft",
      resourceId: `newsletter-${Date.now()}`,
    });

    return {
      markdown: result.text.trim(),
      provider: result.provider,
      model: result.model,
    };
  },
});

/* ============================================================ */
/* Social posts — short brand posts                              */
/* ============================================================ */

export const draftSocialPost = action({
  args: {
    platform: v.union(
      v.literal("twitter"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("facebook"),
    ),
    brief: v.string(),
    charLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ body: string; provider: string; model: string }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) throw new ConvexError({ code: "NO_WORKSPACE", message: "No workspace." });
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) throw new ConvexError({ code: "NO_PERSONA", message: "Workspace not configured." });

    const defaultLimit =
      args.platform === "twitter"
        ? 280
        : args.platform === "linkedin"
          ? 700
          : 500;
    const limit = args.charLimit ?? defaultLimit;

    const systemPrompt = buildAgentSystem(persona, "social_post");
    const userPrompt = [
      `Platform: ${args.platform}`,
      `Character limit: ${limit}`,
      `Post brief: ${args.brief}`,
      "",
      "Write the post now.",
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "draft_whatsapp_reply",                       // reuse the short-form chain
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "social_post",
      resourceId: `social-${args.platform}-${Date.now()}`,
    });

    return {
      body: result.text.trim().slice(0, limit),
      provider: result.provider,
      model: result.model,
    };
  },
});

/* ============================================================ */
/* Content ideas — brainstorm topics                              */
/* ============================================================ */

export const brainstormContentIdeas = action({
  args: {
    topic: v.optional(v.string()),
    audience: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ideas: Array<{ title: string; angle: string }>;
    provider: string;
    model: string;
  }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) throw new ConvexError({ code: "NO_WORKSPACE", message: "No workspace." });
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) throw new ConvexError({ code: "NO_PERSONA", message: "Workspace not configured." });

    const systemPrompt = buildAgentSystem(persona, "content_idea");
    const userPrompt = [
      args.topic ? `Topic anchor: ${args.topic}` : "",
      args.audience ? `Audience: ${args.audience}` : "",
      `Give me ${args.count ?? 5} ideas.`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "extract_json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      resourceType: "content_ideas",
      resourceId: `content-ideas-${Date.now()}`,
    });

    try {
      const parsed = JSON.parse(
        result.text
          .trim()
          .replace(/^```(?:json)?/i, "")
          .replace(/```$/i, "")
          .trim(),
      ) as { ideas?: Array<{ title: string; angle: string }> };
      return {
        ideas: (parsed.ideas ?? [])
          .filter((i) => i && typeof i.title === "string")
          .slice(0, args.count ?? 5)
          .map((i) => ({ title: i.title, angle: String(i.angle ?? "") })),
        provider: result.provider,
        model: result.model,
      };
    } catch {
      return { ideas: [], provider: result.provider, model: result.model };
    }
  },
});

/* ============================================================ */
/* Analytics narrative — summarise weekly metrics                */
/* ============================================================ */

export const summariseAnalytics = action({
  args: {
    period: v.string(),                                       // "last 7 days" | "last 30 days"
    metrics: v.array(
      v.object({
        name: v.string(),
        currentValue: v.number(),
        previousValue: v.optional(v.number()),
        unit: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ summary: string; provider: string; model: string }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) throw new ConvexError({ code: "NO_WORKSPACE", message: "No workspace." });
    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: setup.workspaceId },
    );
    if (!persona) throw new ConvexError({ code: "NO_PERSONA", message: "Workspace not configured." });

    if (args.metrics.length === 0) {
      return {
        summary: `No metrics to summarise for ${args.period}.`,
        provider: "canned",
        model: "no_metrics",
      };
    }

    const systemPrompt = buildAgentSystem(persona, "analytics_summary");
    const lines: string[] = [`Metrics for ${args.period}:`];
    for (const m of args.metrics) {
      const unit = m.unit ? ` ${m.unit}` : "";
      if (typeof m.previousValue === "number") {
        const delta = m.currentValue - m.previousValue;
        const pct = m.previousValue
          ? Math.round((delta / m.previousValue) * 100)
          : 0;
        lines.push(
          `- ${m.name}: ${m.currentValue}${unit} (was ${m.previousValue}${unit}, ${pct >= 0 ? "+" : ""}${pct}%)`,
        );
      } else {
        lines.push(`- ${m.name}: ${m.currentValue}${unit}`);
      }
    }
    lines.push("");
    lines.push(`Now write ${persona.ownerFirstName}'s summary.`);

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "summarize_thread",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lines.join("\n") },
      ],
      resourceType: "analytics_summary",
      resourceId: `analytics-${args.period}-${Date.now()}`,
    });

    return {
      summary: result.text.trim(),
      provider: result.provider,
      model: result.model,
    };
  },
});
