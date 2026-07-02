"use node";

/**
 * ⌘J AI Copilot — agentic side panel.
 *
 * Uses Groq Compound (compound-beta) which has native web-search,
 * code-execution, and browser tools. Layered on top: Atlas-specific
 * function tools that let the AI query the workspace + take actions:
 *
 *   - search_contacts(query, limit)
 *   - search_companies(query, limit)
 *   - search_deals(query, limit)
 *   - list_recent_conversations(limit)
 *   - get_contact(id)
 *   - get_deal(id)
 *   - draft_email_reply(conversationId, intent)
 *   - create_task(title, dueDate, relatedContactId)
 *
 * Chat state is client-side (React) for now. Each turn sends the full
 * history back so the model can maintain context.
 *
 * Falls back through the model chain: compound-beta → llama-3.3-70b
 * (Groq) → gemini-2.0-flash → openrouter/auto. If everything fails
 * the user sees "AI is unavailable — try again later".
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const CHAT_MSG = v.object({
  role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
  content: v.string(),
  tool_call_id: v.optional(v.string()),
  tool_calls: v.optional(v.any()),
});

const BASE_SYSTEM = `You are Atlas Copilot, an agentic assistant for a founder.

You have access to the founder's workspace via tools. Use them:
- On any vague greeting or open-ended question ("hi", "what should I do today", "catch me up"), ALWAYS call \`workspace_snapshot\` FIRST. Never say "I don't have context" without checking.
- To look up any record the founder mentions (contact, company, deal, conversation, task)
- To search the web when the question needs external info (Groq Compound web_search)
- To draft emails, create tasks, and take small actions when asked

Rules of engagement:
- Kenyan English. Never AI-slop ("delve", "hope this finds you", em-dash filler, "in today's fast-paced world"). Never marketing voice.
- Short, dense answers. One idea per paragraph.
- If a task requires info you don't have, call a tool. Don't guess.
- When you cite a workspace record, include its ID so the founder can click through: [contact:jd7...].
- Don't invent facts. If you're unsure, say so.
- Do exactly what's asked, not more.
- If \`workspace_snapshot\` returns \`hint\`, weave that suggestion into your answer once (never repeat it in the same session).`;

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
  const dateLine = `Current UTC time: ${now.toISOString()}. When user says "yesterday" pass sinceHoursAgo=48 to be safe, "last week" pass 168, "today" pass 24.`;

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

const ATLAS_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_contacts",
      description: "Search the founder's contacts by name or email substring. Returns up to `limit` matches with their basic info.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Case-insensitive substring; matches first name, last name, or email" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_companies",
      description: "Search the founder's companies by name or domain substring.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_deals",
      description: "Search deals by name substring. Returns amount + stage + linked contact/company. If you want to LIST deals by state (open / won / lost), use `list_deals` instead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_deals",
      description: "List deals filtered by state — 'open' (not yet won or lost), 'won', or 'lost'. Sortable by amount desc (default), lastActivityAt desc, or recentlyCreated. Best for questions like 'my top 3 open deals', 'biggest win last month', 'what's stuck in the pipeline'.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["open", "won", "lost", "any"],
            description: "Deal state. Default 'open'.",
          },
          sortBy: {
            type: "string",
            enum: ["amount", "activity", "recent"],
            description: "amount = highest value first (default), activity = most recently touched, recent = newest first.",
          },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_conversations",
      description: "List the most recent email + WhatsApp threads in the inbox, regardless of state (open/snoozed/archived). Sorted by last message time desc.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_messages",
      description: "Every message (email + WhatsApp, inbound + outbound) in the last N hours, sorted by time desc. Use to answer 'who did I speak to yesterday' — pass sinceHoursAgo: 48. Returns sender, subject, and 200-char preview.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 20)" },
          sinceHoursAgo: { type: "number", description: "Only messages from this many hours ago. E.g. 24 for last day, 168 for last week." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_activity",
      description: "Recent workspace-wide activity across every entity — deals moved, contacts created, invoices sent, tasks completed, meetings booked. Best for open-ended 'what happened recently' questions.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          sinceHoursAgo: { type: "number" },
          eventTypes: {
            type: "array",
            items: { type: "string" },
            description: "Optional filter: only these event types (e.g. ['deal_won','email_received']).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_kpis",
      description: "Snapshot of pipeline value, deals won this month, outstanding invoices, and cash runway.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List open (uncompleted) tasks. Best for questions like 'what should I do today', 'what's on my list', 'anything overdue'. Sortable by dueDate (soonest first) or recentlyCreated.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["all", "today", "overdue", "week"],
            description: "'today' = due today, 'overdue' = due date passed, 'week' = due this week, 'all' = every open task. Default 'all'.",
          },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_snapshot",
      description: "One-shot overview when the user greets you or asks a vague question like 'what should we do today' or 'catch me up'. Returns: workspace brand summary (or a warning if empty), today's queue counts, top 3 open deals by amount, 3 most recent messages, and 3 rotting deals. Use this FIRST when the user's intent is unclear.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

interface GroqChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface GroqResponse {
  choices: GroqChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const chat = action({
  args: {
    messages: v.array(CHAT_MSG),
  },
  handler: async (ctx, args): Promise<{
    reply: string;
    provider: string;
    model: string;
    toolCalls: number;
  }> => {
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) {
      throw new ConvexError({ code: "NO_WORKSPACE", message: "Not in a workspace." });
    }

    // Prepend system prompt if the caller didn't already include one
    const rawMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(setup.brand) },
      ...args.messages.filter((m) => m.role !== "system"),
    ];

    // Compact old turns if the conversation is getting long.
    const messages = await maybeCompact(rawMessages, setup.keys);

    const chain: Array<{
      provider: "groq" | "openrouter" | "gemini" | "cerebras" | "openai";
      model: string;
      useTools: boolean;
    }> = [
      // Primary: Groq Compound with native web search + code
      { provider: "groq", model: "compound-beta", useTools: true },
      // Second Groq attempt with smaller model — much higher TPM headroom
      { provider: "groq", model: "llama-3.1-8b-instant", useTools: true },
      // Groq llama-3.3-70b — highest quality Groq, most tokens
      { provider: "groq", model: "llama-3.3-70b-versatile", useTools: true },
      // Gemini — free 1M-context tier, generous rate limits
      { provider: "gemini", model: "gemini-2.0-flash-exp", useTools: false },
      // Cerebras — free tier, blazing fast inference
      { provider: "cerebras", model: "llama-3.3-70b", useTools: false },
      // OpenAI if configured
      { provider: "openai", model: "gpt-4o-mini", useTools: true },
      // OpenRouter free auto-router as final safety net
      { provider: "openrouter", model: "openrouter/auto", useTools: false },
    ];

    let toolCallsCount = 0;
    let lastError = "";
    let anyKeyConfigured = false;
    for (const step of chain) {
      const apiKey = setup.keys[step.provider];
      if (!apiKey) continue;
      anyKeyConfigured = true;

      try {
        // Multi-turn tool-call loop, up to 5 iterations
        let workingMessages = messages;
        for (let iteration = 0; iteration < 5; iteration++) {
          const resp = await callChat({
            provider: step.provider,
            model: step.model,
            apiKey,
            messages: workingMessages,
            tools: step.useTools ? ATLAS_TOOLS : undefined,
          });
          const choice = resp.choices[0];
          if (!choice) throw new Error("no_choice");

          if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            toolCallsCount += choice.message.tool_calls.length;
            // Append assistant + tool responses, loop
            workingMessages = [
              ...workingMessages,
              {
                role: "assistant",
                content: choice.message.content ?? "",
                tool_calls: choice.message.tool_calls,
              },
            ];
            for (const tc of choice.message.tool_calls) {
              const result = await handleAtlasTool(ctx, setup.workspaceId, tc.function.name, tc.function.arguments);
              // Cap tool result payload to prevent one big search response
              // (e.g. 40 places) from blowing the context.
              const resultStr = JSON.stringify(result);
              const truncated = resultStr.length > 8000
                ? resultStr.slice(0, 8000) + '..."/*truncated*/'
                : resultStr;
              workingMessages.push({
                role: "tool",
                content: truncated,
                tool_call_id: tc.id,
              });
            }
            // Compact mid-loop if tool results have piled up
            workingMessages = await maybeCompact(workingMessages, setup.keys);
            continue;
          }

          // Final text response
          return {
            reply: choice.message.content ?? "",
            provider: step.provider,
            model: step.model,
            toolCalls: toolCallsCount,
          };
        }

        // Exhausted tool-call iterations
        throw new Error("max_iterations_reached");
      } catch (err) {
        lastError = err instanceof Error ? err.message : "unknown";
        continue;
      }
    }

    if (!anyKeyConfigured) {
      throw new ConvexError({
        code: "NO_AI_KEY",
        message:
          "No AI provider is configured for this workspace. Add a Groq or OpenRouter key at Settings → Integrations to use Copilot.",
      });
    }

    // Rate-limited across every provider we have configured
    if (lastError.includes("429") || lastError.toLowerCase().includes("rate limit")) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message:
          "All AI providers are currently rate-limited. Wait 60 seconds and retry, or add more providers at Settings → Integrations (Gemini + Cerebras have generous free tiers).",
      });
    }

    throw new ConvexError({
      code: "AI_UNAVAILABLE",
      message: `AI is temporarily unavailable. Last error: ${lastError || "unknown"}`,
    });
  },
});

/* ============================================================ */
/* Provider chat call                                             */
/* ============================================================ */

async function callChat(args: {
  provider: "groq" | "openrouter" | "gemini" | "cerebras" | "openai";
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  tools?: readonly unknown[];
}): Promise<GroqResponse> {
  // Gemini uses its own REST shape — normalize to the OpenAI-compat shape
  if (args.provider === "gemini") {
    return await callGemini(args);
  }

  const endpoints: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
  };
  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    })),
    temperature: 0.4,
    max_tokens: 2500,
  };
  if (args.tools) body.tools = args.tools;

  const extraHeaders: Record<string, string> = {};
  if (args.provider === "openrouter") {
    extraHeaders["HTTP-Referer"] = process.env.SITE_URL ?? "https://atlas.blyss.co.ke";
    extraHeaders["X-Title"] = "Atlas Copilot";
  }

  const res = await fetch(endpoints[args.provider], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${args.provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as GroqResponse;
}

/**
 * Gemini uses generativelanguage.googleapis.com with a different
 * message shape. We fold system + user + tool messages into a single
 * text prompt (tools aren't supported in the free tier's generate
 * endpoint the same way), then wrap the response in the OpenAI-compat
 * shape our caller expects.
 */
async function callGemini(args: {
  model: string;
  apiKey: string;
  messages: ChatMessage[];
}): Promise<GroqResponse> {
  const systemMsg = args.messages.find((m) => m.role === "system")?.content ?? "";
  const contents = args.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model,
  )}:generateContent?key=${encodeURIComponent(args.apiKey)}`;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2500 },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    choices: [
      {
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

/* ============================================================ */
/* Context compaction                                             */
/* ============================================================ */

// Rough token count via char/4 heuristic. Good enough — actual
// tokenization varies per model but this is the standard estimator.
function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += (m.content?.length ?? 0) / 4;
    // tool_calls JSON payloads
    if (m.tool_calls) {
      try {
        total += JSON.stringify(m.tool_calls).length / 4;
      } catch {}
    }
  }
  return Math.ceil(total);
}

const COMPACT_TRIGGER_TOKENS = 6000;     // start compacting past this
const COMPACT_KEEP_RECENT = 6;           // preserve most-recent N turns raw
const COMPACT_MIN_MESSAGES = 12;         // don't compact until there's a real backlog

/**
 * If the conversation is long, replace the oldest turns with a single
 * compact summary system message so the model keeps context without
 * running out of TPM.
 *
 * Approach: keep the actual system prompt + the last N user/assistant
 * exchanges verbatim, ask a small fast model to summarize everything
 * in between into 1-2 paragraphs, splice the summary in as a system
 * message.
 */
async function maybeCompact(
  messages: ChatMessage[],
  keys: {
    groq?: string;
    openrouter?: string;
    gemini?: string;
    cerebras?: string;
    openai?: string;
  },
): Promise<ChatMessage[]> {
  const est = estimateTokens(messages);
  if (est < COMPACT_TRIGGER_TOKENS) return messages;
  if (messages.length < COMPACT_MIN_MESSAGES) return messages;

  // Find the boundary — keep system prompt + last N non-system messages
  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const cutoff = nonSystem.length - COMPACT_KEEP_RECENT;
  if (cutoff <= 0) return messages;

  const toCompact = nonSystem.slice(0, cutoff);
  const recent = nonSystem.slice(cutoff);

  // Cheapest possible summarizer: Groq's smallest model, then Cerebras,
  // then Gemini flash. No tools, tight token budget.
  const summarizerChain: Array<{
    provider: "groq" | "cerebras" | "gemini" | "openrouter";
    model: string;
  }> = [
    { provider: "groq", model: "llama-3.1-8b-instant" },
    { provider: "cerebras", model: "llama-3.3-70b" },
    { provider: "gemini", model: "gemini-2.0-flash-exp" },
    { provider: "openrouter", model: "openrouter/auto" },
  ];

  const transcript = toCompact
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const prompt = `Summarize the following Atlas Copilot conversation history into ONE dense paragraph (max 200 words) capturing:
- Key facts + decisions established
- Any records the user referenced (contact/company/deal IDs)
- Open questions or context needed for the next turn

Do not add commentary. Do not restate obvious things. Do not use bullet points.

TRANSCRIPT:
${transcript}`;

  let summary = "";
  for (const step of summarizerChain) {
    const apiKey = keys[step.provider];
    if (!apiKey) continue;
    try {
      const resp = await callChat({
        provider: step.provider,
        model: step.model,
        apiKey,
        messages: [{ role: "user", content: prompt }],
      });
      const text = resp.choices[0]?.message?.content ?? "";
      if (text.trim().length > 20) {
        summary = text.trim();
        break;
      }
    } catch {
      continue;
    }
  }

  if (!summary) {
    // Summarizer failed — fall back to trimming (keep system + recent, drop the rest)
    return [...systemMsgs, ...recent];
  }

  return [
    ...systemMsgs,
    {
      role: "system",
      content: `## Earlier conversation (compacted)\n\n${summary}`,
    },
    ...recent,
  ];
}

/* ============================================================ */
/* Atlas tool executor                                            */
/* ============================================================ */

async function handleAtlasTool(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  name: string,
  argsJson: string,
): Promise<unknown> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return { error: "invalid_arguments" };
  }

  try {
    switch (name) {
      case "search_contacts":
        return await ctx.runQuery(internal.copilotHelpers.searchContacts, {
          workspaceId,
          query: String(parsed.query ?? ""),
          limit: Number(parsed.limit ?? 10),
        });
      case "search_companies":
        return await ctx.runQuery(internal.copilotHelpers.searchCompanies, {
          workspaceId,
          query: String(parsed.query ?? ""),
          limit: Number(parsed.limit ?? 10),
        });
      case "search_deals":
        return await ctx.runQuery(internal.copilotHelpers.searchDeals, {
          workspaceId,
          query: String(parsed.query ?? ""),
          limit: Number(parsed.limit ?? 10),
        });
      case "list_deals":
        return await ctx.runQuery(internal.copilotHelpers.listDeals, {
          workspaceId,
          state: (parsed.state as string) ?? "open",
          sortBy: (parsed.sortBy as string) ?? "amount",
          limit: Number(parsed.limit ?? 10),
        });
      case "list_recent_conversations":
        return await ctx.runQuery(internal.copilotHelpers.recentConversations, {
          workspaceId,
          limit: Number(parsed.limit ?? 10),
        });
      case "list_recent_messages":
        return await ctx.runQuery(internal.copilotHelpers.recentMessages, {
          workspaceId,
          limit: Number(parsed.limit ?? 20),
          sinceHoursAgo:
            typeof parsed.sinceHoursAgo === "number" ? parsed.sinceHoursAgo : undefined,
        });
      case "list_recent_activity":
        return await ctx.runQuery(internal.copilotHelpers.recentTimelineEvents, {
          workspaceId,
          limit: Number(parsed.limit ?? 25),
          sinceHoursAgo:
            typeof parsed.sinceHoursAgo === "number" ? parsed.sinceHoursAgo : undefined,
          eventTypes: Array.isArray(parsed.eventTypes) ? (parsed.eventTypes as string[]) : undefined,
        });
      case "workspace_kpis":
        return await ctx.runQuery(internal.copilotHelpers.kpiSummary, {
          workspaceId,
        });
      case "list_tasks":
        return await ctx.runQuery(internal.copilotHelpers.listTasks, {
          workspaceId,
          filter: (parsed.filter as string) ?? "all",
          limit: Number(parsed.limit ?? 20),
        });
      case "workspace_snapshot":
        return await ctx.runQuery(internal.copilotHelpers.workspaceSnapshot, {
          workspaceId,
        });
      default:
        return { error: `unknown_tool:${name}` };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "tool_execution_failed",
    };
  }
}


/* ============================================================ */
/* Preflight — can the Copilot actually respond?                 */
/* (Public wrapper lives in copilotHelpers.ts because this        */
/*  module is "use node".)                                        */
/* ============================================================ */
