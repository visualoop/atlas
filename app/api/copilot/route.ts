/**
 * Streaming Copilot agent endpoint.
 *
 * The client sends: { messages: UIMessage[] }
 * The response is a Server-Sent Events stream that the Vercel AI SDK
 * `useChat` hook consumes natively. Every text delta, tool call, and
 * tool result is emitted in real time so the UI shows an actual
 * "thinking → calling tool → answering" flow instead of a spinner.
 *
 * Auth: reads the caller's session cookie via convexAuthNextjsToken()
 * and passes that token on every Convex query for tool execution.
 *
 * Streaming: uses AI SDK's `streamText` + `toUIMessageStreamResponse()`.
 * Full opencode-style multi-turn tool loop with `stopWhen: stepCountIs(10)`.
 */

import { NextRequest } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchQuery, fetchMutation } from "convex/nextjs";
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { api } from "@/convex/_generated/api";
import { pickModelChain } from "@/convex/ai/router";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_SYSTEM = (assistantName: string) =>
  `You are ${assistantName}, a personal AI assistant embedded in Atlas, the founder's operating system. You help a solo founder run their business. Use the tools provided to answer every question about their workspace. Do not describe what you're going to do — just do it.

Tone: Direct, dense, Kenyan English. No preamble. No AI-slop phrases like "delve", "hope this finds you", "in today's fast-paced world", "let me help you with that", "I'll check". No em-dash filler.

Rules:
- For any question about contacts, companies, deals, conversations, messages, activity, tasks, KPIs, or the workspace in general — call the appropriate tool. Never guess. Never say "I don't have access" without checking first.
- For vague greetings or open-ended questions like "hi", "what should I do today", "catch me up", call the workspace snapshot tool first.
- For "who did I speak to" or "any replies" or "yesterday's messages", use the recent messages tool with an appropriate sinceHoursAgo (yesterday = 48, today = 24, last week = 168).
- When the user asks to "purge", "clean up", "remove malls", or "archive disqualified imports", use the purge tool. Confirm first with dryRun: true if the user hasn't explicitly said "yes, do it".
- When referencing a workspace record, include its ID in square brackets so the user can click through: [contact:jd7abc123].
- Never invent data. If a tool returns nothing, say so plainly.

Length: 1-3 short sentences, or a tight bulleted list. Never more unless the user asks for detail.`;

function systemWithBrand(brand: {
  workspaceName?: string;
  website?: string;
  oneLiner?: string;
  elevatorPitch?: string;
  offerings?: string;
  targetMarket?: string;
  brandVoice?: string;
  coreValues?: string;
  pricingSummary?: string;
  assistantName?: string;
  assistantPersonaTraits?: string;
} | undefined): string {
  const now = new Date();
  const dateLine = `Current UTC time: ${now.toISOString()}.`;
  const assistantName = brand?.assistantName?.trim() || "Atlas";
  const base = BASE_SYSTEM(assistantName);
  if (!brand) return `${base}\n\n${dateLine}`;
  const lines: string[] = [base, "", "## About this workspace"];
  if (brand.workspaceName) lines.push(`Name: ${brand.workspaceName}`);
  if (brand.website) lines.push(`Website: ${brand.website}`);
  if (brand.oneLiner) lines.push(`One-liner: ${brand.oneLiner}`);
  if (brand.elevatorPitch) lines.push(`Pitch: ${brand.elevatorPitch}`);
  if (brand.offerings) lines.push(`Offerings:\n${brand.offerings}`);
  if (brand.targetMarket) lines.push(`Ideal customer: ${brand.targetMarket}`);
  if (brand.pricingSummary) lines.push(`Pricing: ${brand.pricingSummary}`);
  if (brand.coreValues) lines.push(`Values: ${brand.coreValues}`);
  if (brand.brandVoice) lines.push(`Brand voice: ${brand.brandVoice}`);
  if (brand.assistantPersonaTraits?.trim()) {
    lines.push("", `## Your persona`);
    lines.push(`Character notes: ${brand.assistantPersonaTraits.trim()}`);
  }
  lines.push("", dateLine);
  return lines.join("\n");
}

/**
 * Build the Atlas toolset bound to the caller's Convex token.
 * Every tool.execute() calls a public Convex query with that token
 * so RLS + workspace scoping still applies.
 */
function buildTools(token: string) {
  const query = <T>(
    ref: Parameters<typeof fetchQuery>[0],
    args: Parameters<typeof fetchQuery>[1],
  ) => fetchQuery(ref, args, { token }) as Promise<T>;

  return {
    workspace_snapshot: tool({
      description:
        "One-shot workspace overview. Call this FIRST for vague greetings or open-ended questions like 'what should I do today', 'catch me up', 'hi'. Returns brand summary, today's queue counts, top 3 open deals, 3 recent messages, tasks due today.",
      inputSchema: z.object({}),
      execute: async () => query(api.copilotAgent.snapshotForAgent, {}),
    }),

    workspace_kpis: tool({
      description:
        "Pipeline value (all open deals summed), deals won this month, outstanding invoices amount, and cash runway. Use for 'how's the pipeline', 'how are we doing this month', 'cash flow' questions.",
      inputSchema: z.object({}),
      execute: async () => query(api.copilotAgent.kpisForAgent, {}),
    }),

    search_contacts: tool({
      description:
        "Search contacts by name or email substring. Case-insensitive.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.searchContactsForAgent, args),
    }),

    search_companies: tool({
      description: "Search companies by name or domain substring.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.searchCompaniesForAgent, args),
    }),

    search_deals: tool({
      description:
        "Search deals by name substring. For 'top deals' use list_deals instead.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.searchDealsForAgent, args),
    }),

    list_deals: tool({
      description:
        "List deals by state (open/won/lost/any). Sort by amount, activity, or recent. Best for 'top 3 open deals', 'biggest win this month'.",
      inputSchema: z.object({
        state: z
          .enum(["open", "won", "lost", "any"])
          .optional(),
        sortBy: z.enum(["amount", "activity", "recent"]).optional(),
        limit: z.number().optional(),
      }),
      execute: async (args) => query(api.copilotAgent.listDealsForAgent, args),
    }),

    list_recent_conversations: tool({
      description:
        "Most recent email + WhatsApp threads in the inbox, sorted by last message time.",
      inputSchema: z.object({
        limit: z.number().optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.recentConversationsForAgent, args),
    }),

    list_recent_messages: tool({
      description:
        "Every message (email + WhatsApp, inbound + outbound) in the last N hours. Use for 'who did I speak to yesterday' with sinceHoursAgo: 48.",
      inputSchema: z.object({
        limit: z.number().optional(),
        sinceHoursAgo: z.number().optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.recentMessagesForAgent, args),
    }),

    list_recent_activity: tool({
      description:
        "Workspace-wide timeline of activity — deals moved, contacts created, invoices sent, tasks completed. Best for 'what happened this week'.",
      inputSchema: z.object({
        limit: z.number().optional(),
        sinceHoursAgo: z.number().optional(),
        eventTypes: z.array(z.string()).optional(),
      }),
      execute: async (args) =>
        query(api.copilotAgent.recentActivityForAgent, args),
    }),

    list_tasks: tool({
      description:
        "Open (uncompleted) tasks. Filter: today = due today, overdue = due date passed, week = due this week, all = every open task.",
      inputSchema: z.object({
        filter: z
          .enum(["all", "today", "overdue", "week"])
          .optional(),
        limit: z.number().optional(),
      }),
      execute: async (args) => query(api.copilotAgent.listTasksForAgent, args),
    }),

    purge_disqualified_imports: tool({
      description:
        "Archive every company + reject every prospector result that matches the mall / plaza / mega-brand filter. Use when the user asks to 'clean up bad imports', 'remove malls', 'purge disqualified companies', or similar. Returns counts + a preview list. Pass dryRun: true to preview first without changing anything.",
      inputSchema: z.object({
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "If true, report what WOULD be archived without making changes. Default false = actually archive.",
          ),
      }),
      execute: async ({ dryRun }) =>
        fetchMutation(
          api.prospector.purgeDisqualifiedImports,
          { dryRun },
          { token },
        ),
    }),
  };
}

/* ============================================================ */
/* Provider chain                                                */
/* ============================================================ */

interface ProviderStep {
  provider: "groq" | "cerebras" | "gemini" | "openai" | "openrouter";
  model: string;
}

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
      return createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": process.env.SITE_URL ?? "https://atlas.blyss.co.ke",
          "X-Title": "Atlas Copilot",
        },
      })(step.model);
  }
}

/* ============================================================ */
/* POST handler                                                  */
/* ============================================================ */

export async function POST(req: NextRequest) {
  try {
    const token = await convexAuthNextjsToken();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as {
      messages: UIMessage[];
    };
    if (!body.messages?.length) {
      return new Response(
        JSON.stringify({ error: "empty_messages" }),
        { status: 400 },
      );
    }

    // Load workspace context + AI keys in parallel
    const [setup, keys] = await Promise.all([
      fetchQuery(api.copilotAgent.chatSetupForAgent, {}, { token }),
      fetchAction(api.copilotAgentKeys.chatKeysForAgent, {}, { token }),
    ]);

    const system = systemWithBrand(setup.brand);
    const tools = buildTools(token);

    const modelMessages = (await convertToModelMessages(body.messages)).slice(-8);

    // Task-aware routing. Estimate tokens (chars/4) to pick between
    // fast small models for short chats vs long-context Gemini for
    // dense multi-turn threads.
    const contextTokens = modelMessages.reduce(
      (n, m) =>
        n +
        Math.ceil(
          (typeof m.content === "string" ? m.content.length : 0) / 4,
        ),
      0,
    );
    const availableProviders = Object.entries(keys)
      .filter(([, v]) => v && v.length > 8)
      .map(([k]) => k) as Array<
      "groq" | "cerebras" | "gemini" | "openai" | "openrouter"
    >;
    const chain = pickModelChain("chat_agentic", {
      availableProviders,
      contextTokens,
      requireTools: true,
      maxSteps: 4,
    }).filter((s): s is typeof s & { provider: "groq" | "cerebras" | "gemini" | "openai" | "openrouter" } =>
      ["groq", "cerebras", "gemini", "openai", "openrouter"].includes(s.provider),
    );

    // First provider that has a key
    const chosen = chain[0];
    if (!chosen) {
      return new Response(
        JSON.stringify({
          error:
            "No AI provider configured. Add a Groq or Gemini key at Settings → Integrations.",
        }),
        { status: 400 },
      );
    }
    const apiKey = keys[chosen.provider]!;

    console.log("[copilot-stream] routing", {
      contextTokens,
      chainLength: chain.length,
      model: chosen.model,
    });

    const result = streamText({
      model: buildLanguageModel(chosen, apiKey),
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
      temperature: 0.4,
      onError({ error }) {
        console.error("[copilot] stream error", error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[copilot] POST error", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "unknown",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
