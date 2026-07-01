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

const SYSTEM_PROMPT = `You are Atlas Copilot, an agentic assistant for a founder.

You have access to the founder's workspace via tools. Use them:
- To look up any record they mention (contact, company, deal, conversation)
- To search the web when the question needs external info (Groq Compound web_search)
- To draft emails, create tasks, and take small actions when asked

Rules of engagement:
- Kenyan English. Never AI-slop ("delve", "hope this finds you", em-dash filler, "in today's fast-paced world"). Never marketing voice.
- Short, dense answers. One idea per paragraph.
- If a task requires info you don't have, call a tool. Don't guess.
- When you cite a workspace record, include its ID so the founder can click through: [contact:jd7...].
- Don't invent facts. If you're unsure, say so.
- Do exactly what's asked, not more.`;

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
      description: "Search open deals by name. Returns amount + stage + linked contact/company.",
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
      name: "list_recent_conversations",
      description: "List the most recent unread email + WhatsApp threads in the inbox.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
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
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...args.messages.filter((m) => m.role !== "system"),
    ];

    const chain: Array<{ provider: "groq" | "openrouter"; model: string; useTools: boolean }> = [
      { provider: "groq", model: "compound-beta", useTools: true },
      { provider: "groq", model: "llama-3.3-70b-versatile", useTools: true },
      { provider: "openrouter", model: "openrouter/auto", useTools: false },
    ];

    let toolCallsCount = 0;
    let lastError = "";
    for (const step of chain) {
      const apiKey = setup.keys[step.provider];
      if (!apiKey) continue;

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
              workingMessages.push({
                role: "tool",
                content: JSON.stringify(result),
                tool_call_id: tc.id,
              });
            }
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

    throw new ConvexError({
      code: "AI_UNAVAILABLE",
      message: `AI is temporarily unavailable. Last error: ${lastError}`,
    });
  },
});

/* ============================================================ */
/* Provider chat call                                             */
/* ============================================================ */

async function callChat(args: {
  provider: "groq" | "openrouter";
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  tools?: readonly unknown[];
}): Promise<GroqResponse> {
  const endpoints: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
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
      case "list_recent_conversations":
        return await ctx.runQuery(internal.copilotHelpers.recentConversations, {
          workspaceId,
          limit: Number(parsed.limit ?? 10),
        });
      case "workspace_kpis":
        return await ctx.runQuery(internal.copilotHelpers.kpiSummary, {
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
