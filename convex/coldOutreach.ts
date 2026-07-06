"use node";

/**
 * Cold outreach drafting — turns imported prospects into personalized
 * email + WhatsApp drafts, ready to review and send.
 *
 * Two entry points:
 *   - draftColdOutreach(companyId, contactId?, channel) — one draft
 *   - draftColdOutreachBatch(companyIds, channel) — batch (top N)
 *
 * The prompt weaves in:
 *   - Workspace brand context (offering, ICP, pricing, voice)
 *   - Company info (name, address, industry, website)
 *   - Fit score reasoning (why AI thought this was a match)
 *   - Contact channel choice (email = full pitch, WhatsApp = terse)
 *
 * Result is a draft the user reviews before sending. Never
 * auto-sends — that's a compliance risk.
 */

import { v, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildAgentSystem } from "./lib/agentPersona";

// Silence unused Id import when only used in generics elsewhere.
void ({} as Id<"companies"> | undefined);

/* System prompts moved to buildAgentSystem(persona, "email_cold" | "whatsapp_cold").
   See convex/lib/agentPersona.ts. The prompt no longer says "You draft cold
   outreach for a solo founder" — it names the workspace + owner explicitly. */

interface CompanyContext {
  name: string;
  domain?: string;
  industry?: string;
  city?: string;
  country?: string;
  address?: string;
  website?: string;
  description?: string;
  fitScore?: number;
  fitReasoning?: string;
  types?: string[];
}

interface ContactContext {
  firstName: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
}

function buildProfile(company: CompanyContext, contact?: ContactContext): string {
  const lines: string[] = [];
  lines.push(`Company: ${company.name}`);
  if (company.industry) lines.push(`Industry: ${company.industry}`);
  if (company.city || company.country) {
    lines.push(`Location: ${[company.city, company.country].filter(Boolean).join(", ")}`);
  }
  if (company.address) lines.push(`Address: ${company.address}`);
  if (company.website) lines.push(`Website: ${company.website}`);
  if (company.description) lines.push(`About: ${company.description.slice(0, 300)}`);
  if (company.types?.length) lines.push(`Type: ${company.types.slice(0, 3).join(", ")}`);
  if (typeof company.fitScore === "number") {
    lines.push(`AI fit: ${company.fitScore}/100${company.fitReasoning ? " — " + company.fitReasoning : ""}`);
  }
  if (contact) {
    lines.push("");
    lines.push(`Contact: ${contact.firstName}${contact.lastName ? " " + contact.lastName : ""}${contact.title ? " (" + contact.title + ")" : ""}`);
  }
  return lines.join("\n");
}

/* ============================================================ */
/* draftColdOutreach                                              */
/* ============================================================ */

export const draftColdOutreach = action({
  args: {
    companyId: v.optional(v.id("companies")),
    contactId: v.optional(v.id("contacts")),
    resultId: v.optional(v.id("prospectorResults")),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    subject?: string;
    body: string;
    channel: "email" | "whatsapp";
    provider: string;
    model: string;
  }> => {
    if (!args.companyId && !args.resultId) {
      throw new ConvexError({
        code: "BAD_INPUT",
        message: "Provide either companyId or resultId.",
      });
    }
    const context = args.companyId
      ? await ctx.runQuery(
          internal.aiWorkflowHelpers.loadCompanyForOutreach,
          { companyId: args.companyId, contactId: args.contactId },
        )
      : await ctx.runQuery(
          internal.aiWorkflowHelpers.loadResultForOutreach,
          { resultId: args.resultId! },
        );
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Prospect not found." });
    }
    const { company, contact, workspace, userId } = context;

    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: workspace._id },
    );
    if (!persona) throw new ConvexError({ code: "NO_PERSONA", message: "Workspace not configured." });
    const systemBase = buildAgentSystem(
      persona,
      args.channel === "email" ? "email_cold" : "whatsapp_cold",
    );

    // Pull memory for this company + contact so we don't repeat what
    // we already learned in past conversations.
    const memories: Array<{ fact: string }> = [];
    if (args.companyId) {
      const cf = await ctx.runQuery(
        internal.workspaceKnowledge.retrieveInternal,
        {
          workspaceId: workspace._id,
          subjectType: "company",
          subjectId: args.companyId,
          limit: 5,
        },
      );
      memories.push(...cf);
    }
    if (args.contactId) {
      const cf = await ctx.runQuery(
        internal.workspaceKnowledge.retrieveInternal,
        {
          workspaceId: workspace._id,
          subjectType: "contact",
          subjectId: args.contactId,
          limit: 3,
        },
      );
      memories.push(...cf);
    }
    const memoryBlock = memories.length > 0
      ? "\n\n# What you already know\n" + memories.map((m) => `- ${m.fact}`).join("\n")
      : "";
    const system = systemBase + memoryBlock;

    const profile = buildProfile(company, contact);
    const userPrompt = `Prospect to reach out to:\n${profile}\n\nDraft the message ${persona.ownerFirstName} will send from ${persona.workspaceName}.`;

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      actorId: userId,
      featureId:
        args.channel === "email" ? "draft_cold_email" : "draft_cold_whatsapp",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      resourceType: args.companyId ? "company" : "prospector_result",
      resourceId: args.companyId ?? args.resultId!,
    });

    if (args.channel === "email") {
      // Expect JSON — parse subject/body
      const raw = result.text.trim();
      let parsed: { subject?: string; body?: string } = {};
      try {
        parsed = JSON.parse(
          raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
        );
      } catch {
        // Fallback — split by first double-newline as best-effort
        const firstBreak = raw.indexOf("\n\n");
        if (firstBreak > 0 && firstBreak < 120) {
          parsed.subject = raw.slice(0, firstBreak).replace(/^Subject:\s*/i, "").trim();
          parsed.body = raw.slice(firstBreak + 2).trim();
        } else {
          parsed.body = raw;
        }
      }
      return {
        subject: parsed.subject?.slice(0, 200),
        body: parsed.body ?? "(no draft returned)",
        channel: "email",
        provider: result.provider,
        model: result.model,
      };
    }

    // WhatsApp — plain text only
    return {
      body: result.text.trim().slice(0, 500),
      channel: "whatsapp",
      provider: result.provider,
      model: result.model,
    };
  },
});


/* ============================================================ */
/* System-scheduled auto-draft — after prospect import           */
/* ============================================================ */

export const autoDraftForCompany = internalAction({
  args: {
    companyId: v.id("companies"),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const context = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadCompanyForOutreachForSystem,
      { companyId: args.companyId },
    );
    if (!context) return { ok: false };
    const { company, contact, workspace, userId } = context;

    const persona = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadAgentPersonaForWorkspace,
      { workspaceId: workspace._id },
    );
    if (!persona) return { ok: false };

    const systemBase = buildAgentSystem(
      persona,
      args.channel === "email" ? "email_cold" : "whatsapp_cold",
    );

    const companyFacts = await ctx.runQuery(
      internal.workspaceKnowledge.retrieveInternal,
      {
        workspaceId: workspace._id,
        subjectType: "company",
        subjectId: args.companyId,
        limit: 5,
      },
    );
    const memoryBlock = companyFacts.length > 0
      ? "\n\n# What you already know\n" + companyFacts.map((m) => `- ${m.fact}`).join("\n")
      : "";
    const system = systemBase + memoryBlock;

    const profile = buildProfile(company, contact);
    const userPrompt = `Prospect to reach out to:\n${profile}\n\nDraft the message ${persona.ownerFirstName} will send from ${persona.workspaceName}.`;

    try {
      const result = await ctx.runAction(internal.ai.runFeature, {
        workspaceId: workspace._id,
        organizationId: workspace.organizationId,
        actorId: userId,
        featureId:
          args.channel === "email"
            ? "draft_cold_email"
            : "draft_cold_whatsapp",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        resourceType: "auto_draft_company",
        resourceId: args.companyId,
      });

      if (args.channel === "email") {
        const raw = result.text.trim();
        let parsed: { subject?: string; body?: string } = {};
        try {
          parsed = JSON.parse(
            raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
          );
        } catch {
          const firstBreak = raw.indexOf("\n\n");
          if (firstBreak > 0 && firstBreak < 120) {
            parsed.subject = raw
              .slice(0, firstBreak)
              .replace(/^Subject:\s*/i, "")
              .trim();
            parsed.body = raw.slice(firstBreak + 2).trim();
          } else {
            parsed.body = raw;
          }
        }
        await ctx.runMutation(
          internal.aiWorkflowHelpers.saveCompanyAiDraft,
          {
            companyId: args.companyId,
            channel: "email",
            subject: parsed.subject?.slice(0, 200),
            body: parsed.body?.slice(0, 4000) ?? "",
          },
        );
      } else {
        await ctx.runMutation(
          internal.aiWorkflowHelpers.saveCompanyAiDraft,
          {
            companyId: args.companyId,
            channel: "whatsapp",
            body: result.text.trim().slice(0, 500),
          },
        );
      }

      return { ok: true };
    } catch (err) {
      console.warn(
        "[autoDraft] failed for company",
        args.companyId,
        err,
      );
      return { ok: false };
    }
  },
});


/* ============================================================ */
/* Public query — read cached AI draft off a company              */
/*                                                                 */
/* Moved to convex/coldOutreachQueries.ts (V8) since this file    */
/* is a Node action module.                                        */
/* ============================================================ */
