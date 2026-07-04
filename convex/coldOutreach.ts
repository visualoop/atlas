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
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const EMAIL_COLD_SYSTEM = `You draft cold outreach emails for a solo founder.

Voice:
- Direct, human, Kenyan English. Never formal-corporate.
- Never AI-slop ("delve", "leverage", "unlock value", "in today's fast-paced world", "hope this finds you well", em-dash filler).
- Never marketing-speak. Write like a real person emailing another real person.
- Never end with "Best regards" or fake signatures — that's added by the sender identity later.

Structure:
- 2 concise paragraphs. Max 100 words total including subject.
- First line: acknowledge something specific about their business (from what you know).
- Second line: one clear reason our product helps their specific situation.
- Close with a single, low-friction ask (not a meeting request — a reply, a "worth a chat?", a link they'd click).
- No bullet points. No headers. Prose only.

CRITICAL: Return JSON exactly:
{"subject": "…", "body": "…"}
No prose outside the JSON. The subject must be under 60 chars and NOT include "" or their name — write like a colleague.`;

const WHATSAPP_COLD_SYSTEM = `You draft cold WhatsApp opening messages for a solo founder.

Voice:
- Extremely short. WhatsApp isn't email — 1-2 sentences max.
- Kenyan English + Sheng if it fits naturally.
- Direct: identify yourself, name-drop something specific about their business, ask a small question.
- Never marketing tone. Never "Hi, hope this finds you well".

Structure:
- Greeting → who you are + specific hook → small question.
- Under 200 characters total.

CRITICAL: Return ONLY the message text. No JSON, no prose around it. No signature block.`;

interface Brand {
  workspaceName?: string;
  oneLiner?: string;
  offerings?: string;
  targetMarket?: string;
  pricingSummary?: string;
  brandVoice?: string;
}

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

function buildBrandBlock(brand: Brand | null): string {
  if (!brand) return "(no brand context set — keep the pitch generic)";
  const parts: string[] = [];
  if (brand.workspaceName) parts.push(`Our business: ${brand.workspaceName}`);
  if (brand.oneLiner) parts.push(`We: ${brand.oneLiner}`);
  if (brand.offerings) parts.push(`Offer: ${brand.offerings.slice(0, 400)}`);
  if (brand.targetMarket) parts.push(`Ideal customer: ${brand.targetMarket.slice(0, 300)}`);
  if (brand.pricingSummary) parts.push(`Pricing: ${brand.pricingSummary.slice(0, 200)}`);
  if (brand.brandVoice) parts.push(`Voice guidelines: ${brand.brandVoice.slice(0, 200)}`);
  return parts.join("\n");
}

/* ============================================================ */
/* draftColdOutreach                                              */
/* ============================================================ */

export const draftColdOutreach = action({
  args: {
    companyId: v.id("companies"),
    contactId: v.optional(v.id("contacts")),
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
    const context = await ctx.runQuery(
      internal.aiWorkflowHelpers.loadCompanyForOutreach,
      { companyId: args.companyId, contactId: args.contactId },
    );
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Company not found." });
    }
    const { company, contact, workspace, userId } = context;

    const brandBlock = buildBrandBlock(context.brand);
    const profile = buildProfile(company, contact);
    const userPrompt = `${brandBlock}\n\nProspect:\n${profile}\n\nDraft the message.`;

    const system =
      args.channel === "email" ? EMAIL_COLD_SYSTEM : WHATSAPP_COLD_SYSTEM;

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
      resourceType: "company",
      resourceId: args.companyId,
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
