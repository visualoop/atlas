"use node";

/**
 * ⌘J Atlas Copilot — agentic assistant, rebuilt with Vercel AI SDK.
 *
 * Architecture mirrors opencode's session.run pattern:
 *   1. Load workspace + AI keys via internal query
 *   2. Build a tool set — every workspace query is exposed as an
 *      AI SDK Tool with zod inputSchema + execute
 *   3. Fall through provider chain (Groq → Cerebras → Gemini → OpenAI
 *      → OpenRouter). AI SDK's generateText normalizes tool-calling
 *      across all of them — no manual per-provider loop code.
 *   4. stopWhen: stepCountIs(10) — model can chain up to 10 tool calls
 *   5. Compaction on very long threads via a separate helper action
 *
 * The old version had two fatal bugs:
 *   - Gemini fallback path had useTools: false, so when Groq was rate-
 *     limited the model got no tool schema. It would emit tool names as
 *     text ("call workspace_snapshot") because the system prompt told
 *     it to but no way to actually call.
 *   - Manual tool-call loop was fragile — text emitted alongside
 *     tool_calls got lost between iterations.
 *
 * AI SDK handles both correctly out of the box.
 */

import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

const CHAT_MSG = v.object({
  role: v.union(
    v.literal("user"),
    v.literal("assistant"),
    v.literal("system"),
    v.literal("tool"),
  ),
  content: v.string(),
  tool_call_id: v.optional(v.string()),
  tool_calls: v.optional(v.any()),
});

const BASE_SYSTEM = `You are Atlas Copilot, an agent that helps a solo founder run their business. Use the tools provided to answer every question about their workspace. Do not describe what you're going to do — just do it.

Tone: Direct, dense, Kenyan English. No preamble. No AI-slop phrases like "delve", "hope this finds you", "in today's fast-paced world", "let me help you with that", "I'll check". No em-dash filler.

Rules:
- For any question about contacts, companies, deals, conversations, messages, activity, tasks, KPIs, or the workspace in general — call the appropriate tool. Never guess. Never say "I don't have access" without checking first.
- For vague greetings or open-ended questions like "hi", "what should I do today", "catch me up", call the workspace snapshot tool first.
- For "who did I speak to" or "any replies" or "yesterday's messages", use the recent messages tool with an appropriate sinceHoursAgo (yesterday = 48, today = 24, last week = 168).
- When referencing a workspace record, include its ID in square brackets so the user can click through: [contact:jd7abc123].
- Never invent data. If a tool returns nothing, say so plainly.

Length: 1-3 short sentences, or a tight bulleted list. Never more unless the user asks for detail.`;

function buildSystemPrompt(brand: {
  workspaceName?: string;
  website?: string;
  oneLiner?: string;
  elevatorPitch?: string;
  offerings?: string;
  targetMarket?: string;
  brandVoice?: string;
  coreValues?: string;
  pricingSummary?: string;
} | null): string {
  const now = new Date();
  const dateLine = `Current UTC time: ${now.toISOString()}. When user says "yesterday" pass sinceHoursAgo=48. "last week" → 168. "today" → 24.`;

  if (!brand) return `${BASE_SYSTEM}\n\n${dateLine}`;
  const parts: string[] = [BASE_SYSTEM, "", "## About this workspace"];
  if (brand.workspaceName) parts.push(`Name: ${brand.workspaceName}`);
  if (brand.website) parts.push(`Website: ${brand.website}`);
  if (brand.oneLiner) parts.push(`One-liner: ${brand.oneLiner}`);
  if (brand.elevatorPitch) parts.push(`Pitch: ${brand.elevatorPitch}`);
  if (brand.offerings) parts.push(`Offerings:\n${brand.offerings}`);
  if (brand.targetMarket) parts.push(`Ideal customer: ${brand.targetMarket}`);
  if (brand.pricingSummary) parts.push(`Pricing: ${brand.pricingSummary}`);
  if (brand.coreValues) parts.push(`Values: ${brand.coreValues}`);
  if (brand.brandVoice) parts.push(`Brand voice: ${brand.brandVoice}`);
  parts.push("", dateLine);
  return parts.join("\n");
}

/* ============================================================ */
/* Tool definitions                                              */
/* ============================================================ */

/**
 * Build the Atlas toolset bound to a workspace + ActionCtx.
 * Each tool has:
 *   - description — how the model decides when to call it
 *   - inputSchema — zod schema for arguments
 *   - execute — server-side runQuery to Convex helpers
 */
function buildAtlasTools(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  return {
    workspace_snapshot: tool({
      description:
        "One-shot workspace overview. Call this FIRST for vague greetings or open-ended questions like 'what should I do today', 'catch me up', 'hi'. Returns brand summary, today's queue counts, top 3 open deals, 3 recent messages, 3 rotting deals.",
      inputSchema: z.object({}),
      execute: async () =>
        await ctx.runQuery(internal.copilotHelpers.workspaceSnapshot, {
          workspaceId,
        }),
    }),

    workspace_kpis: tool({
      description:
        "Snapshot of pipeline value (all open deals summed), deals won this month, outstanding invoices amount, and cash runway. Use for 'how's the pipeline', 'how are we doing this month', 'cash flow' questions.",
      inputSchema: z.object({}),
      execute: async () =>
        await ctx.runQuery(internal.copilotHelpers.kpiSummary, {
          workspaceId,
        }),
    }),

    search_contacts: tool({
      description:
        "Search contacts by name or email substring. Case-insensitive. Returns firstName, lastName, email, phone, company link, lifecycle stage.",
      inputSchema: z.object({
        query: z.string().describe("Name or email substring"),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ query, limit }) =>
        await ctx.runQuery(internal.copilotHelpers.searchContacts, {
          workspaceId,
          query,
          limit: limit ?? 10,
        }),
    }),

    search_companies: tool({
      description:
        "Search companies by name or domain substring. Returns name, domain, industry, size, city, website, phone, tags, lifecycle stage.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ query, limit }) =>
        await ctx.runQuery(internal.copilotHelpers.searchCompanies, {
          workspaceId,
          query,
          limit: limit ?? 10,
        }),
    }),

    search_deals: tool({
      description:
        "Search deals by name substring. Returns amount, stage, linked contact/company. For 'my top deals' or 'biggest wins' use list_deals instead.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ query, limit }) =>
        await ctx.runQuery(internal.copilotHelpers.searchDeals, {
          workspaceId,
          query,
          limit: limit ?? 10,
        }),
    }),

    list_deals: tool({
      description:
        "List deals by state (open/won/lost/any). Sort by amount (biggest first), activity (most recently touched), or recent (newly created). Best for 'top 3 open deals', 'biggest win this month', 'what's stuck in the pipeline'.",
      inputSchema: z.object({
        state: z
          .enum(["open", "won", "lost", "any"])
          .optional()
          .default("open")
          .describe("Deal state to filter by"),
        sortBy: z
          .enum(["amount", "activity", "recent"])
          .optional()
          .default("amount"),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ state, sortBy, limit }) =>
        await ctx.runQuery(internal.copilotHelpers.listDeals, {
          workspaceId,
          state: state ?? "open",
          sortBy: sortBy ?? "amount",
          limit: limit ?? 10,
        }),
    }),

    list_recent_conversations: tool({
      description:
        "Most recent email + WhatsApp threads in the inbox. Sorted by last message time. Returns thread id, channel, subject, participants, message count, last message preview.",
      inputSchema: z.object({
        limit: z.number().optional().default(10),
      }),
      execute: async ({ limit }) =>
        await ctx.runQuery(internal.copilotHelpers.recentConversations, {
          workspaceId,
          limit: limit ?? 10,
        }),
    }),

    list_recent_messages: tool({
      description:
        "Every message (email + WhatsApp, inbound + outbound) in the last N hours. **Use this for 'who did I speak to yesterday' — pass sinceHoursAgo: 48.** Returns sender name, channel, direction, subject, 200-char preview, timestamp.",
      inputSchema: z.object({
        limit: z.number().optional().default(20),
        sinceHoursAgo: z
          .number()
          .optional()
          .describe(
            "Only messages from this many hours ago. yesterday=48, today=24, last week=168.",
          ),
      }),
      execute: async ({ limit, sinceHoursAgo }) =>
        await ctx.runQuery(internal.copilotHelpers.recentMessages, {
          workspaceId,
          limit: limit ?? 20,
          sinceHoursAgo,
        }),
    }),

    list_recent_activity: tool({
      description:
        "Workspace-wide timeline of activity — deals moved, contacts created, invoices sent, tasks completed, meetings booked. Best for 'what happened this week', 'catch me up on the pipeline'.",
      inputSchema: z.object({
        limit: z.number().optional().default(25),
        sinceHoursAgo: z.number().optional(),
        eventTypes: z.array(z.string()).optional(),
      }),
      execute: async ({ limit, sinceHoursAgo, eventTypes }) =>
        await ctx.runQuery(internal.copilotHelpers.recentTimelineEvents, {
          workspaceId,
          limit: limit ?? 25,
          sinceHoursAgo,
          eventTypes,
        }),
    }),

    list_tasks: tool({
      description:
        "Open (uncompleted) tasks. Best for 'what should I do today', 'anything overdue', 'what's on my list'. Filter: today = due today, overdue = due date passed, week = due this week, all = every open task.",
      inputSchema: z.object({
        filter: z
          .enum(["all", "today", "overdue", "week"])
          .optional()
          .default("all"),
        limit: z.number().optional().default(20),
      }),
      execute: async ({ filter, limit }) =>
        await ctx.runQuery(internal.copilotHelpers.listTasks, {
          workspaceId,
          filter: filter ?? "all",
          limit: limit ?? 20,
        }),
    }),
  };
}

/* ============================================================ */
/* Provider chain                                                */
/* ============================================================ */

interface ProviderStep {
  provider: "groq" | "cerebras" | "gemini" | "openai" | "openrouter";
  model: string;
  supportsTools: boolean;
}

const PROVIDER_CHAIN: ProviderStep[] = [
  // Groq — free tier, fast, native tool calling on llama models
  { provider: "groq", model: "llama-3.3-70b-versatile", supportsTools: true },
  { provider: "groq", model: "llama-3.1-8b-instant", supportsTools: true },
  // Cerebras — free tier llama 3.3 70b
  { provider: "cerebras", model: "llama-3.3-70b", supportsTools: true },
  // Gemini free tier — Flash supports tool calling in AI SDK
  { provider: "gemini", model: "gemini-2.0-flash-exp", supportsTools: true },
  { provider: "gemini", model: "gemini-1.5-flash", supportsTools: true },
  // OpenAI paid fallback
  { provider: "openai", model: "gpt-4o-mini", supportsTools: true },
  // OpenRouter free auto (some free models don't support tools reliably)
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", supportsTools: true },
];

function buildLanguageModel(step: ProviderStep, apiKey: string) {
  switch (step.provider) {
    case "groq":
      return createGroq({ apiKey })(step.model);
    case "cerebras":
      return createCerebras({ apiKey })(step.model);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(step.model);
    case "openai":
      return createOpenAI({ apiKey })(step.model);
    case "openrouter":
      // OpenRouter is OpenAI-compatible — use OpenAI provider with base URL
      return createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        // OpenRouter requires attribution headers
        headers: {
          "HTTP-Referer": process.env.SITE_URL ?? "https://atlas.blyss.co.ke",
          "X-Title": "Atlas Copilot",
        },
      })(step.model);
  }
}

/* ============================================================ */
/* Chat entrypoint                                                */
/* ============================================================ */

interface ChatInputMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

/**
 * Convert legacy ChatInputMessage (from client) to AI SDK ModelMessage.
 * We flatten tool history into the user/assistant text stream — AI SDK
 * will re-emit its own tool_calls in its own format on next iteration.
 *
 * Sanitization: assistant messages from OLD sessions may contain
 * literal tool-name text like backticked names or `<function>` XML
 * from before AI SDK was wired. Those poison future turns because
 * the model learns to imitate them. Strip them here.
 *
 * Windowing: keep only the last 6 turns (3 exchanges) so ancient
 * broken exchanges fall out of context entirely.
 */
function toModelMessages(input: ChatInputMessage[]): ModelMessage[] {
  const cleaned = input
    .filter((m) => m.role !== "system") // system is passed separately
    .filter((m) => m.role !== "tool") // tool history is model-managed
    .filter((m) => m.content?.trim())
    .map((m): ModelMessage => {
      // Scrub tool-call syntax leakage from assistant messages so the
      // model doesn't imitate broken past responses
      let content = m.content;
      if (m.role === "assistant") {
        content = sanitizeAssistantText(content);
      }
      if (m.role === "user") return { role: "user", content };
      if (m.role === "assistant") return { role: "assistant", content };
      return { role: "user", content };
    });

  // Keep last 6 messages max — protects against context poisoning
  // from long broken threads. If user needs more history they can
  // clear + re-ask.
  const WINDOW = 6;
  return cleaned.slice(-WINDOW);
}

/**
 * Strip anything that looks like tool-call syntax leakage.
 * Common failure modes we've seen:
 *   - Backticked tool names: `workspace_snapshot`
 *   - XML function tags: <function>...</function>
 *   - Raw JSON tool_call blobs at end of message
 *   - Trailing "I need to check your workspace" placeholder
 */
function sanitizeAssistantText(text: string): string {
  let cleaned = text;

  // Strip <function>...</function> tags (Groq compound leakage)
  cleaned = cleaned.replace(/<function>[\s\S]*?<\/function>/gi, "");
  cleaned = cleaned.replace(/<\/?function[^>]*>/gi, "");

  // Strip backticked tool names — but only when they appear alone on
  // a line (typical failure pattern). Preserve inline code refs.
  cleaned = cleaned.replace(
    /^`(workspace_snapshot|workspace_kpis|search_contacts|search_companies|search_deals|list_deals|list_recent_conversations|list_recent_messages|list_recent_activity|list_tasks)[^`]*`\s*$/gm,
    "",
  );

  // Strip pseudo tool-call syntax like `tool_name>{...}
  cleaned = cleaned.replace(/`\w+>\{[^`]*`/g, "");

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // If we scrubbed everything, return a placeholder so the model
  // doesn't see an empty assistant message
  if (!cleaned) return "(previous response omitted)";
  return cleaned;
}

export const chat = action({
  args: {
    messages: v.array(CHAT_MSG),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    reply: string;
    provider: string;
    model: string;
    toolCalls: number;
  }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) {
      throw new ConvexError({
        code: "NO_WORKSPACE",
        message: "Not in a workspace.",
      });
    }

    const system = buildSystemPrompt(setup.brand);
    const messages = toModelMessages(args.messages);
    if (messages.length === 0) {
      throw new ConvexError({
        code: "EMPTY_MESSAGES",
        message: "Send a message first.",
      });
    }

    const tools = buildAtlasTools(ctx, setup.workspaceId);

    let anyKeyConfigured = false;
    const errors: string[] = [];

    for (const step of PROVIDER_CHAIN) {
      const apiKey = setup.keys[step.provider];
      if (!apiKey) continue;
      anyKeyConfigured = true;

      try {
        const result = await generateText({
          model: buildLanguageModel(step, apiKey),
          system,
          messages,
          tools,
          stopWhen: stepCountIs(10),
          temperature: 0.4,
        });

        // AI SDK returns .text for final response, .steps for tool history.
        // If the model chose no tools + no text (rare), retry next provider.
        const reply = result.text?.trim() ?? "";
        const toolCalls = result.steps?.reduce(
          (n, s) => n + (s.toolCalls?.length ?? 0),
          0,
        ) ?? 0;

        if (!reply && toolCalls === 0) {
          errors.push(`${step.provider}/${step.model}: empty response`);
          continue;
        }

        return {
          reply: reply || "(no answer)",
          provider: step.provider,
          model: step.model,
          toolCalls,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${step.provider}/${step.model}: ${msg.slice(0, 200)}`);
        continue;
      }
    }

    if (!anyKeyConfigured) {
      throw new ConvexError({
        code: "NO_AI_KEY",
        message:
          "No AI provider is configured for this workspace. Add a Groq or Gemini key at Settings → Integrations to use Copilot (both free).",
      });
    }

    // Every configured provider failed
    const isRateLimit = errors.some((e) => /429|rate.?limit|quota/i.test(e));
    throw new ConvexError({
      code: isRateLimit ? "RATE_LIMITED" : "AI_UNAVAILABLE",
      message: isRateLimit
        ? `All AI providers are currently rate-limited. Wait 60 seconds and retry. Details: ${errors[0]}`
        : `AI temporarily unavailable. Tried ${errors.length} providers. First error: ${errors[0]}`,
    });
  },
});
