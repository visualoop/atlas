/**
 * Model catalog + task-aware router.
 *
 * Every model Atlas can call is registered here with metadata: family,
 * context window, tool support, latency, quality tier, cost. The
 * router (see router.ts) filters this catalog per-task and picks the
 * best available for the workspace's configured providers.
 *
 * Pattern borrowed from opencode — they store family-based priority
 * lists and match by capability rather than exact model ID, so a
 * key rotation or provider change doesn't break routing.
 */

import type { ProviderId } from "./registry";

/**
 * Task categories — high-level intent classes the router understands.
 * Each Atlas AI caller picks one; the router selects a chain.
 */
export type TaskCategory =
  | "chat_agentic" // Copilot: multi-turn tools + reasoning
  | "chat_fast" // Quick lookups, one-shot answers
  | "draft_short" // WhatsApp reply, SMS, ≤2 sentences
  | "draft_long" // Cold email, proposal body, doc section
  | "summarize" // Thread summary, doc critique, briefing
  | "long_context" // Analyze whole thread/doc, >32k input tokens
  | "extract_json" // Ranker, website enrich, structured output
  | "reason_hard"; // Deal health, strategy, next-action recommendation

/**
 * Latency + quality tiers — hand-classified per model, updated when
 * new models drop. Router uses these to break ties.
 */
export type LatencyClass = "fast" | "medium" | "slow";
export type QualityClass = "good" | "great" | "best";

/**
 * Per-model metadata. Numbers are approximate — precise pricing
 * changes provider-side, but the ratios stay stable enough for
 * cost-ranked selection.
 */
export interface ModelMeta {
  provider: ProviderId | "openrouter-anthropic" | "openrouter-openai";
  model: string;
  family: string; // "gemini-flash" | "groq-llama-70b" | "claude-haiku" | ...
  contextWindow: number;
  supportsTools: boolean;
  supportsJsonMode: boolean;
  supportsSystemPrompt: boolean;
  latencyClass: LatencyClass;
  qualityClass: QualityClass;
  costPer1kIn: number; // USD, approximate
  costPer1kOut: number;
  /**
   * Which task categories this model is good at. Router filters + ranks
   * by this list.
   */
  goodFor: TaskCategory[];
  /** True if the workspace needs to have set up a key for this provider. */
  requiresProviderId: ProviderId;
  /** Optional: openrouter model routing prefix (e.g. "anthropic/claude-3.5-sonnet"). */
  openrouterModel?: string;
}

/**
 * The catalog. Ordered roughly by quality-per-task descending — the
 * router does its own filtering, but a stable order helps debugging.
 *
 * Cost columns from public pricing pages (Oct 2025 snapshot; router
 * uses these only for tie-breaking, so exact drift isn't critical).
 */
export const MODEL_CATALOG: ModelMeta[] = [
  /* ============================================================ */
  /* Groq — free tier, fast, tool-calling on all llama models      */
  /* ============================================================ */
  {
    provider: "groq",
    requiresProviderId: "groq",
    model: "llama-3.3-70b-versatile",
    family: "groq-llama-70b",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.00059,
    costPer1kOut: 0.00079,
    goodFor: [
      "chat_agentic",
      "draft_short",
      "draft_long",
      "extract_json",
      "reason_hard",
    ],
  },
  {
    provider: "groq",
    requiresProviderId: "groq",
    model: "llama-3.1-8b-instant",
    family: "groq-llama-8b",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "good",
    costPer1kIn: 0.00005,
    costPer1kOut: 0.00008,
    goodFor: ["chat_fast", "draft_short", "extract_json"],
  },
  {
    provider: "groq",
    requiresProviderId: "groq",
    model: "compound-beta",
    family: "groq-compound",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "great",
    costPer1kIn: 0.00059,
    costPer1kOut: 0.00079,
    goodFor: ["chat_agentic", "reason_hard"], // has built-in web search + code exec
  },

  /* ============================================================ */
  /* Gemini — long context is the killer feature                  */
  /* ============================================================ */
  {
    provider: "gemini",
    requiresProviderId: "gemini",
    model: "gemini-2.0-flash-exp",
    family: "gemini-flash",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.0001,
    costPer1kOut: 0.0004,
    goodFor: [
      "chat_agentic",
      "chat_fast",
      "draft_long",
      "summarize",
      "long_context",
      "extract_json",
    ],
  },
  {
    provider: "gemini",
    requiresProviderId: "gemini",
    model: "gemini-1.5-flash",
    family: "gemini-flash",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "good",
    costPer1kIn: 0.000075,
    costPer1kOut: 0.0003,
    goodFor: [
      "chat_fast",
      "draft_short",
      "draft_long",
      "summarize",
      "long_context",
      "extract_json",
    ],
  },
  {
    provider: "gemini",
    requiresProviderId: "gemini",
    model: "gemini-1.5-pro",
    family: "gemini-pro",
    contextWindow: 2_097_152, // 2M
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "best",
    costPer1kIn: 0.00125,
    costPer1kOut: 0.005,
    goodFor: ["reason_hard", "long_context", "summarize", "draft_long"],
  },

  /* ============================================================ */
  /* Cerebras — free tier, blazing fast inference                 */
  /* ============================================================ */
  {
    provider: "cerebras",
    requiresProviderId: "cerebras",
    model: "llama-3.3-70b",
    family: "cerebras-llama-70b",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.00085,
    costPer1kOut: 0.0012,
    goodFor: ["chat_agentic", "draft_long", "reason_hard"],
  },

  /* ============================================================ */
  /* OpenAI                                                        */
  /* ============================================================ */
  {
    provider: "openai",
    requiresProviderId: "openai",
    model: "gpt-4o-mini",
    family: "gpt-mini",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.00015,
    costPer1kOut: 0.0006,
    goodFor: [
      "chat_agentic",
      "chat_fast",
      "draft_short",
      "draft_long",
      "extract_json",
      "reason_hard",
    ],
  },
  {
    provider: "openai",
    requiresProviderId: "openai",
    model: "gpt-4o",
    family: "gpt-4o",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "best",
    costPer1kIn: 0.0025,
    costPer1kOut: 0.01,
    goodFor: ["reason_hard", "draft_long", "chat_agentic"],
  },

  /* ============================================================ */
  /* Anthropic — direct API                                        */
  /* ============================================================ */
  {
    provider: "anthropic",
    requiresProviderId: "anthropic",
    model: "claude-3-5-haiku-20241022",
    family: "claude-haiku",
    contextWindow: 200_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.001,
    costPer1kOut: 0.005,
    goodFor: ["chat_fast", "draft_short", "draft_long", "summarize"],
  },
  {
    provider: "anthropic",
    requiresProviderId: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    family: "claude-sonnet",
    contextWindow: 200_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "best",
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    goodFor: ["reason_hard", "draft_long", "chat_agentic", "long_context"],
  },

  /* ============================================================ */
  /* OpenRouter — universal free/auto safety net + Claude access */
  /* ============================================================ */
  {
    provider: "openrouter",
    requiresProviderId: "openrouter",
    model: "openrouter/auto",
    family: "openrouter-auto",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "good",
    costPer1kIn: 0.0005,
    costPer1kOut: 0.0015,
    goodFor: [
      "chat_agentic",
      "chat_fast",
      "draft_short",
      "draft_long",
      "extract_json",
      "summarize",
      "reason_hard",
    ],
  },
  {
    provider: "openrouter",
    requiresProviderId: "openrouter",
    model: "anthropic/claude-3.5-sonnet",
    family: "claude-sonnet",
    contextWindow: 200_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "best",
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    goodFor: ["draft_long", "reason_hard", "chat_agentic", "long_context"],
  },
  {
    provider: "openrouter",
    requiresProviderId: "openrouter",
    model: "anthropic/claude-3.5-haiku",
    family: "claude-haiku",
    contextWindow: 200_000,
    supportsTools: true,
    supportsJsonMode: false,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0.001,
    costPer1kOut: 0.005,
    goodFor: ["chat_fast", "draft_short", "summarize"],
  },
  {
    provider: "openrouter",
    requiresProviderId: "openrouter",
    model: "google/gemini-2.0-flash-exp:free",
    family: "gemini-flash",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "fast",
    qualityClass: "great",
    costPer1kIn: 0,
    costPer1kOut: 0,
    goodFor: [
      "chat_fast",
      "draft_long",
      "summarize",
      "long_context",
      "extract_json",
    ],
  },

  /* ============================================================ */
  /* Mistral, Together, DeepInfra — optional                       */
  /* ============================================================ */
  {
    provider: "mistral",
    requiresProviderId: "mistral",
    model: "mistral-large-latest",
    family: "mistral-large",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJsonMode: true,
    supportsSystemPrompt: true,
    latencyClass: "medium",
    qualityClass: "great",
    costPer1kIn: 0.002,
    costPer1kOut: 0.006,
    goodFor: ["draft_long", "reason_hard", "chat_agentic"],
  },
];
