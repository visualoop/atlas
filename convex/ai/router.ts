/**
 * Task-aware model router.
 *
 * Given a task category + context size + which providers the workspace
 * has keys for, return a prioritized chain of (provider, model) pairs
 * to try in sequence. Each caller then walks the chain top-to-bottom
 * and returns the first successful response.
 *
 * Selection algorithm:
 *   1. Filter catalog by:
 *      - Model's `goodFor` array includes the requested TaskCategory
 *      - `contextWindow >= contextTokens + 20% safety`
 *      - Workspace has a key for this model's requiresProviderId
 *      - If task needs tools: supportsTools === true
 *      - If task needs JSON: supportsJsonMode === true
 *   2. Sort by:
 *      - qualityClass (best > great > good) — task-relevant score
 *      - latencyClass (fast > medium > slow) if speed matters
 *      - costPer1kIn ascending — cheaper wins tie
 *   3. Return top N (default 4) + openrouter/auto safety net if
 *      OpenRouter is configured
 *
 * See `catalog.ts` for the model metadata table.
 */

import type { ProviderId } from "./registry";
import {
  type ModelMeta,
  type TaskCategory,
  MODEL_CATALOG,
} from "./catalog";

export interface PickedStep {
  provider: ProviderId;
  model: string;
  family: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsJsonMode: boolean;
}

export interface PickOptions {
  /** Which providers the workspace has keys for. */
  availableProviders: ProviderId[];
  /** Estimated input tokens (context + prompt). */
  contextTokens?: number;
  /** Task requires tool-calling (agentic Copilot, etc.). */
  requireTools?: boolean;
  /** Task requires JSON structured output. */
  requireJson?: boolean;
  /** Max steps in returned chain. Default 4. */
  maxSteps?: number;
}

const QUALITY_RANK: Record<string, number> = { best: 3, great: 2, good: 1 };
const LATENCY_RANK: Record<string, number> = { fast: 3, medium: 2, slow: 1 };

const CONTEXT_SAFETY = 1.2; // add 20% headroom before ruling out a model

/**
 * The router's inputs are just what the caller knows at request time.
 * Everything else (per-provider workspace keys, catalog) is looked up.
 */
export function pickModelChain(
  taskCategory: TaskCategory,
  options: PickOptions,
): PickedStep[] {
  const {
    availableProviders,
    contextTokens = 0,
    requireTools = false,
    requireJson = false,
    maxSteps = 4,
  } = options;

  const needsLongContext =
    taskCategory === "long_context" || contextTokens > 30_000;
  const speedMatters =
    taskCategory === "chat_fast" || taskCategory === "draft_short";

  const available = new Set(availableProviders);
  const contextNeeded = Math.ceil(contextTokens * CONTEXT_SAFETY);

  const candidates = MODEL_CATALOG.filter((m) => {
    if (!available.has(m.requiresProviderId)) return false;
    if (!m.goodFor.includes(taskCategory)) return false;
    if (m.contextWindow < contextNeeded) return false;
    if (requireTools && !m.supportsTools) return false;
    if (requireJson && !m.supportsJsonMode) return false;
    return true;
  });

  candidates.sort((a, b) => {
    // Quality (task-relevant) wins first
    const q = QUALITY_RANK[b.qualityClass] - QUALITY_RANK[a.qualityClass];
    if (q !== 0) return q;

    // OpenRouter routes through a paid gateway with per-request token
    // caps that surprise users on free tiers. Prefer direct providers
    // (Groq / Gemini / Cerebras / OpenAI / Anthropic) at the same
    // quality tier so we don't hit "requires more credits" errors
    // when a direct alternative exists.
    const aOR = a.requiresProviderId === "openrouter" ? 1 : 0;
    const bOR = b.requiresProviderId === "openrouter" ? 1 : 0;
    if (aOR !== bOR) return aOR - bOR;

    // For speed-sensitive tasks, latency dominates cost
    if (speedMatters) {
      const l = LATENCY_RANK[b.latencyClass] - LATENCY_RANK[a.latencyClass];
      if (l !== 0) return l;
    }

    // For long-context tasks, prefer larger context (e.g. gemini-pro over -flash
    // when we're above 500k tokens)
    if (needsLongContext) {
      const c = b.contextWindow - a.contextWindow;
      if (c !== 0) return c;
    }

    // Cost ascending as final tie-breaker
    const cost = a.costPer1kIn - b.costPer1kIn;
    if (cost !== 0) return cost;

    // Latency ascending
    return LATENCY_RANK[b.latencyClass] - LATENCY_RANK[a.latencyClass];
  });

  const steps: PickedStep[] = candidates.slice(0, maxSteps).map((m) => ({
    provider: m.requiresProviderId,
    model: m.model,
    family: m.family,
    contextWindow: m.contextWindow,
    supportsTools: m.supportsTools,
    supportsJsonMode: m.supportsJsonMode,
  }));

  // Always append openrouter/auto as final safety net when OpenRouter is
  // configured and not already in the chain
  if (
    available.has("openrouter") &&
    !steps.some((s) => s.provider === "openrouter" && s.model === "openrouter/auto")
  ) {
    steps.push({
      provider: "openrouter",
      model: "openrouter/auto",
      family: "openrouter-auto",
      contextWindow: 128_000,
      supportsTools: !requireTools ? false : true, // openrouter/auto routes; support varies
      supportsJsonMode: false,
    });
  }

  return steps;
}

/**
 * Convenience — pick a single top model rather than a chain. For
 * tasks that don't need fallback (rare — most callers should use
 * pickModelChain).
 */
export function pickTopModel(
  taskCategory: TaskCategory,
  options: PickOptions,
): PickedStep | null {
  const chain = pickModelChain(taskCategory, { ...options, maxSteps: 1 });
  return chain[0] ?? null;
}

/**
 * Map an available provider list from workspace keys (which may be
 * empty strings for missing keys).
 */
export function providersFromKeys(keys: {
  [K in ProviderId]?: string | undefined;
}): ProviderId[] {
  const out: ProviderId[] = [];
  for (const [k, v] of Object.entries(keys) as Array<[ProviderId, string | undefined]>) {
    if (v && v.length > 8) out.push(k);
  }
  return out;
}
