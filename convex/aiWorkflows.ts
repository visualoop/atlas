"use node";

/**
 * AI workflows — user-facing actions that call the gateway.
 *
 * Every workflow:
 *   1. Loads the source data (conversation, lead, contact, …)
 *   2. Builds a prompt in Atlas voice (see plan/08-ai-gateway.md)
 *   3. Calls `runFeature`
 *   4. Persists the result via an internalMutation
 *   5. Returns the text (or writes to a target field) to the caller
 *
 * Prompts are engineered to bias toward Justine's editorial style:
 * ink + paper, plain language, no fluff. See system messages below.
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* Draft email reply                                                     */
/* ------------------------------------------------------------------ */

const EMAIL_REPLY_SYSTEM = `You are Justine's email assistant.

Style rules — non-negotiable:
- Match the sender's tone (formal for enterprise, casual for peers).
- Kenyan English spelling.
- No AI-slop tells: no "I hope this email finds you well", no
  "delve", no em-dashes as filler, no "That's a great question".
- One idea per paragraph. Short sentences.
- Address the actual ask. If you're unsure what to say, ask a
  clarifying question.
- Don't invent facts. If something is unknown, say so.

Return ONLY the reply body — no subject, no signature, no meta commentary.`;

export const draftEmailReply = action({
  args: {
    conversationId: v.id("conversations"),
    intent: v.optional(v.string()),                             // "accept" | "decline" | free text hint
    system: v.optional(v.boolean()),                            // scheduler-invoked, no user session
    persistToInboundMessage: v.optional(v.id("messages")),      // if set, save the draft on this message row
  },
  handler: async (ctx, args): Promise<{ draft: string; provider: string; model: string }> => {
    const context = args.system
      ? await ctx.runQuery(
          internal.aiWorkflowHelpers.loadConversationForReplyForSystem,
          { conversationId: args.conversationId },
        )
      : await ctx.runQuery(internal.aiWorkflowHelpers.loadConversationForReply, {
          conversationId: args.conversationId,
        });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Conversation not found." });
    }

    // Build the conversation transcript
    const transcript = context.messages
      .map((m) => {
        const who = m.direction === "inbound" ? (m.senderName ?? m.senderEmail ?? "them") : "You";
        return `${who}:\n${m.bodyText}`;
      })
      .join("\n\n---\n\n");

    const userPrompt = [
      `Subject: ${context.conversation.subject ?? "(no subject)"}`,
      "",
      "Transcript:",
      transcript,
      "",
      args.intent ? `Intent: ${args.intent}` : "Write the best next reply Justine could send.",
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: context.workspace._id,
      organizationId: context.workspace.organizationId,
      actorId: context.userId,
      featureId: "draft_email_reply",
      messages: [
        { role: "system", content: EMAIL_REPLY_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      resourceType: "conversation",
      resourceId: args.conversationId,
    });

    // If asked, persist the draft on the inbound message row so the
    // thread reader can offer a one-click use-the-draft UX.
    if (args.persistToInboundMessage) {
      await ctx.runMutation(
        internal.aiWorkflowHelpers.saveAutoDraft,
        {
          messageId: args.persistToInboundMessage,
          draft: result.text,
        },
      );
    }

    return { draft: result.text, provider: result.provider, model: result.model };
  },
});

/* ------------------------------------------------------------------ */
/* Draft WhatsApp reply                                                  */
/* ------------------------------------------------------------------ */

const WHATSAPP_SYSTEM = `You are Justine's WhatsApp assistant.

Style rules:
- Short and casual — WhatsApp is not email.
- Kenyan English + Sheng where it fits naturally.
- 1–2 sentences unless the ask needs more.
- No AI-slop, no marketing voice.
- Never send a formal signature.

Return ONLY the message body.`;

export const draftWhatsAppReply = action({
  args: {
    conversationId: v.id("conversations"),
    intent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ draft: string; provider: string; model: string }> => {
    const context = await ctx.runQuery(internal.aiWorkflowHelpers.loadConversationForReply, {
      conversationId: args.conversationId,
    });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Conversation not found." });
    }
    const transcript = context.messages
      .map((m) => {
        const who = m.direction === "inbound" ? "them" : "you";
        return `${who}: ${m.bodyText}`;
      })
      .join("\n");
    const userPrompt = [
      "WhatsApp conversation:",
      transcript,
      "",
      args.intent ? `Intent: ${args.intent}` : "Write the best next reply.",
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: context.workspace._id,
      organizationId: context.workspace.organizationId,
      actorId: context.userId,
      featureId: "draft_whatsapp_reply",
      messages: [
        { role: "system", content: WHATSAPP_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      resourceType: "conversation",
      resourceId: args.conversationId,
    });
    return { draft: result.text, provider: result.provider, model: result.model };
  },
});

/* ------------------------------------------------------------------ */
/* Fit-score a lead                                                      */
/* ------------------------------------------------------------------ */

const FIT_SCORE_SYSTEM = `You score sales leads for Blyss.

Blyss operates three products:
1. Omnix — POS/ERP for small East African retailers.
2. Blyss Marketplace — creator/artist marketplace for Kenya.
3. Blyss Studio — design + engineering agency (higher ACV).

Given a company profile, return a JSON object with:
  score: integer 0–100
  reasoning: 1–2 sentences

Output ONLY valid JSON, no prose. Example:
{"score": 78, "reasoning": "Retail chain in Nairobi — direct fit for Omnix."}`;

export const scoreLeadFit = action({
  args: { resultId: v.id("prospectorResults") },
  handler: async (ctx, args): Promise<{ score: number; reasoning: string }> => {
    const context = await ctx.runQuery(internal.aiWorkflowHelpers.loadProspectorResult, {
      resultId: args.resultId,
    });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Result not found." });
    }
    const { result: r, workspace, userId } = context;
    const profile = [
      `Name: ${r.name}`,
      r.address && `Address: ${r.address}`,
      r.website && `Website: ${r.website}`,
      r.phone && `Phone: ${r.phone}`,
      r.types?.length && `Types: ${r.types.join(", ")}`,
      typeof r.rating === "number" && `Rating: ${r.rating} (${r.ratingCount ?? "?"} reviews)`,
    ].filter(Boolean).join("\n");

    const aiResult = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      actorId: userId,
      featureId: "fit_score_lead",
      messages: [
        { role: "system", content: FIT_SCORE_SYSTEM },
        { role: "user", content: profile },
      ],
      resourceType: "prospector_result",
      resourceId: args.resultId,
    });

    const parsed = tryParseJSON(aiResult.text);
    const score = clampScore(parsed?.score);
    const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning : aiResult.text.slice(0, 300);

    await ctx.runMutation(internal.aiWorkflowHelpers.persistFitScore, {
      resultId: args.resultId,
      score,
      reasoning,
    });

    return { score, reasoning };
  },
});

/* ------------------------------------------------------------------ */
/* Enrich a website — extract emails, phones, socials, description       */
/* ------------------------------------------------------------------ */

const ENRICH_SYSTEM = `You extract company contact info from a website's HTML.

Given the HTML, return ONLY a JSON object with these keys (omit or set null if not found):
  email: primary contact email (prefer info@ / hello@ / sales@; personal names OK)
  phone: primary phone number
  description: 1-sentence description of what the company does
  linkedin: LinkedIn URL if present
  twitter: Twitter/X URL if present
  instagram: Instagram URL if present
  facebook: Facebook URL if present

Do not invent values. Return valid JSON, nothing else.`;

export const enrichWebsite = action({
  args: {
    resultId: v.id("prospectorResults"),
    system: v.optional(v.boolean()),        // true when called from scheduler (no user session)
  },
  handler: async (ctx, args): Promise<{
    email?: string;
    phone?: string;
    description?: string;
    socials?: Record<string, string>;
    error?: string;
  }> => {
    const context = args.system
      ? await ctx.runQuery(
          internal.aiWorkflowHelpers.loadProspectorResultForSystem,
          { resultId: args.resultId },
        )
      : await ctx.runQuery(internal.aiWorkflowHelpers.loadProspectorResult, {
          resultId: args.resultId,
        });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Result not found." });
    }
    const { result: r, workspace, userId } = context;
    if (!r.website) {
      await ctx.runMutation(internal.aiWorkflowHelpers.markEnrichment, {
        resultId: args.resultId,
        status: "no_website",
      });
      return { error: "no_website" };
    }

    // Fetch page — polite timeout + User-Agent
    let html = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(r.website, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Atlas Prospector (contact: hello@blyss.co.ke)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      const error = err instanceof Error ? err.message : "fetch failed";
      await ctx.runMutation(internal.aiWorkflowHelpers.markEnrichment, {
        resultId: args.resultId,
        status: "failed",
        error,
      });
      return { error };
    }

    // Strip most tags to keep prompt tokens reasonable
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 12000);

    const aiResult = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      actorId: userId,
      featureId: "enrich_website",
      messages: [
        { role: "system", content: ENRICH_SYSTEM },
        { role: "user", content: stripped },
      ],
      resourceType: "prospector_result",
      resourceId: args.resultId,
    });

    const parsed = tryParseJSON(aiResult.text) ?? {};
    const socials: Record<string, string> = {};
    for (const k of ["linkedin", "twitter", "instagram", "facebook"] as const) {
      const val = parsed[k];
      if (typeof val === "string" && val) socials[k] = val;
    }

    const email = typeof parsed.email === "string" ? parsed.email : undefined;
    const phone = typeof parsed.phone === "string" ? parsed.phone : undefined;
    const description = typeof parsed.description === "string" ? parsed.description : undefined;

    await ctx.runMutation(internal.aiWorkflowHelpers.persistEnrichment, {
      resultId: args.resultId,
      email,
      phone,
      description,
      socials: Object.keys(socials).length ? socials : undefined,
    });

    return {
      email,
      phone,
      description,
      socials: Object.keys(socials).length ? socials : undefined,
    };
  },
});

function tryParseJSON(text: string): Record<string, unknown> | null {
  // The model sometimes wraps JSON in markdown fences
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Fallback: extract the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* Generate document body                                                */
/* ------------------------------------------------------------------ */

const GENERATE_DOC_SYSTEM = `You draft business documents for Blyss.

Style rules — non-negotiable:
- Kenyan English spelling.
- No AI-slop: no "I hope this finds you well", no "delve into",
  no em-dashes as filler, no "That's a great question", no
  "in today's fast-paced world".
- Concrete over abstract. Specific numbers where you have them.
- One idea per paragraph. Short sentences.
- Match the document kind: proposals persuade, quotes list, invoices
  are neutral, contracts are precise.

Return Markdown — headings with ##, lists with -, bold with **. No
front-matter, no meta commentary, no "here is the document" preamble.`;

/* ============================================================ */
/* Compose assist — help write outbound emails from the inbox    */
/* ============================================================ */

const COMPOSE_SYSTEM = `You help a founder draft outbound emails from their inbox.

Voice:
- Direct, human, Kenyan English. Never formal-corporate.
- Never AI-slop ("delve", "leverage", "unlock value", "in today's fast-paced world", "hope this finds you well", em-dash filler).
- Match the length + tone the user asked for.
- Never end with fake signatures — that's added by the sender identity later.

Return ONLY the message body. No preamble, no meta commentary, no code fences.`;

export const composeAssist = action({
  args: {
    mode: v.union(
      v.literal("draft"), // empty compose → generate from a hint
      v.literal("improve"), // tighten current body
      v.literal("shorter"),
      v.literal("longer"),
      v.literal("different_angle"), // regenerate with fresh approach
    ),
    subject: v.optional(v.string()),
    currentBody: v.optional(v.string()),
    hint: v.optional(v.string()), // required for 'draft' — what's this about
    recipientName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ body: string; provider: string; model: string }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) {
      throw new ConvexError({
        code: "NO_WORKSPACE",
        message: "Not in a workspace.",
      });
    }

    const brandParts: string[] = [];
    if (setup.brand?.workspaceName)
      brandParts.push(`Workspace: ${setup.brand.workspaceName}`);
    if (setup.brand?.oneLiner) brandParts.push(`One-liner: ${setup.brand.oneLiner}`);
    if (setup.brand?.offerings)
      brandParts.push(`Offer: ${setup.brand.offerings.slice(0, 300)}`);
    if (setup.brand?.brandVoice)
      brandParts.push(`Voice guidance: ${setup.brand.brandVoice.slice(0, 200)}`);

    let userPrompt = "";
    switch (args.mode) {
      case "draft":
        userPrompt = [
          brandParts.join("\n"),
          "",
          args.recipientName ? `Recipient: ${args.recipientName}` : "",
          args.subject ? `Subject: ${args.subject}` : "",
          args.hint ? `About: ${args.hint}` : "",
          "",
          "Draft the email body. 100-150 words unless the topic needs more.",
        ]
          .filter(Boolean)
          .join("\n");
        break;
      case "improve":
        userPrompt = [
          brandParts.join("\n"),
          "",
          "Improve this email — tighten prose, remove any AI-slop, keep the meaning:",
          "",
          args.currentBody ?? "",
        ].join("\n");
        break;
      case "shorter":
        userPrompt = [
          "Rewrite this email in half the length while keeping the ask intact:",
          "",
          args.currentBody ?? "",
        ].join("\n");
        break;
      case "longer":
        userPrompt = [
          brandParts.join("\n"),
          "",
          "Expand this email — add one supporting sentence that helps the ask land. Do not add filler:",
          "",
          args.currentBody ?? "",
        ].join("\n");
        break;
      case "different_angle":
        userPrompt = [
          brandParts.join("\n"),
          "",
          "Rewrite this email from a different angle — different opening hook, different framing, same ask:",
          "",
          args.currentBody ?? "",
        ].join("\n");
        break;
    }

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: setup.workspaceId,
      organizationId: setup.organizationId,
      actorId: setup.userId,
      featureId: "draft_email_reply",
      messages: [
        { role: "system", content: COMPOSE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      resourceType: "compose",
      resourceId: `compose-${Date.now()}`,
    });

    return {
      body: result.text.trim(),
      provider: result.provider,
      model: result.model,
    };
  },
});

export const generateDocumentBody = action({
  args: {
    documentId: v.id("documents"),
    brief: v.string(),                                       // what to draft
  },
  handler: async (ctx, args): Promise<{ markdown: string; provider: string; model: string }> => {
    const context = await ctx.runQuery(internal.aiWorkflowHelpers.loadDocumentContext, {
      documentId: args.documentId,
    });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const { doc, workspace, userId, company, contact, deal } = context;

    const contextLines: string[] = [
      `Document kind: ${doc.kind}`,
      `Title: ${doc.title}`,
      `Currency: ${doc.currency}`,
    ];
    if (company) contextLines.push(`Company: ${company.name}${company.industry ? " (" + company.industry + ")" : ""}`);
    if (contact) contextLines.push(`Contact: ${contact.firstName}${contact.lastName ? " " + contact.lastName : ""}${contact.title ? " — " + contact.title : ""}`);
    if (deal) contextLines.push(`Deal: ${deal.name}, currently at ${Number(deal.amountCents) / 100} ${deal.currency}`);

    const userPrompt = [
      "Context:",
      contextLines.join("\n"),
      "",
      "Brief from Justine:",
      args.brief,
      "",
      "Write the document body in Markdown.",
    ].join("\n");

    const result = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      actorId: userId,
      featureId: "generate_document",
      messages: [
        { role: "system", content: GENERATE_DOC_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      resourceType: "document",
      resourceId: args.documentId,
    });
    return { markdown: result.text, provider: result.provider, model: result.model };
  },
});

/* ------------------------------------------------------------------ */
/* Critique document — anti-slop review                                  */
/* ------------------------------------------------------------------ */

const CRITIQUE_DOC_SYSTEM = `You review business documents for tone and clarity.

Flag any of these AI-slop tells:
- "I hope this email finds you well"
- "delve into", "elevate", "leverage", "seamless", "robust"
- em-dashes used as filler rather than punctuation
- "in today's fast-paced world"
- "That's a great question"
- excessive hedging: "somewhat", "essentially", "arguably"
- passive voice where active would be clearer
- vague phrases like "unlock potential" or "drive growth"

Also flag:
- unclear commitments (dates, numbers, deliverables missing)
- inconsistent tone (formal vs casual within one doc)
- missing critical fields for the document kind

Return JSON:
{
  "score": 0-100 (100 = ready to send),
  "issues": [{"quote": "verbatim text", "issue": "why", "suggestion": "replacement"}],
  "summary": "1-sentence overall verdict"
}`;

export const critiqueDocument = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<{
    score: number;
    issues: Array<{ quote: string; issue: string; suggestion: string }>;
    summary: string;
    provider: string;
    model: string;
  }> => {
    const context = await ctx.runQuery(internal.aiWorkflowHelpers.loadDocumentContext, {
      documentId: args.documentId,
    });
    if (!context) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    const { doc, workspace, userId } = context;

    if (!doc.bodyText.trim()) {
      return {
        score: 0,
        issues: [],
        summary: "Document body is empty.",
        provider: "internal",
        model: "internal",
      };
    }

    const userPrompt = [
      `Kind: ${doc.kind}`,
      `Title: ${doc.title}`,
      "",
      "Body:",
      doc.bodyText,
    ].join("\n");

    const aiResult = await ctx.runAction(internal.ai.runFeature, {
      workspaceId: workspace._id,
      organizationId: workspace.organizationId,
      actorId: userId,
      featureId: "critique_document",
      messages: [
        { role: "system", content: CRITIQUE_DOC_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      resourceType: "document",
      resourceId: args.documentId,
    });

    const parsed = tryParseJSON(aiResult.text) ?? {};
    const score = clampScore(parsed.score);
    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues = rawIssues
      .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
      .map((i) => ({
        quote: typeof i.quote === "string" ? i.quote : "",
        issue: typeof i.issue === "string" ? i.issue : "",
        suggestion: typeof i.suggestion === "string" ? i.suggestion : "",
      }))
      .filter((i) => i.quote && i.issue);
    const summary = typeof parsed.summary === "string"
      ? parsed.summary
      : aiResult.text.slice(0, 300);

    return {
      score,
      issues,
      summary,
      provider: aiResult.provider,
      model: aiResult.model,
    };
  },
});
