/**
 * Rough token estimation — chars ÷ 4 heuristic.
 *
 * Used everywhere in the AI router to size context and pick the right
 * model. Real tokenization varies per model by 10-20% but the router
 * only needs order-of-magnitude accuracy (does this fit in 8k? 32k?
 * 128k? 1M?).
 *
 * If a caller ever needs precise counts (billing, cache eviction),
 * they should tokenize via the provider's own SDK. For selection
 * purposes this is fine.
 */

export function estimateTokens(input: string | Array<{ content: string }>): number {
  if (typeof input === "string") {
    return Math.ceil(input.length / 4);
  }
  let total = 0;
  for (const m of input) {
    total += Math.ceil((m.content ?? "").length / 4);
  }
  return total;
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string; tool_calls?: unknown }>,
): number {
  let total = 0;
  for (const m of messages) {
    total += Math.ceil((m.content ?? "").length / 4);
    if (m.tool_calls) {
      try {
        total += Math.ceil(JSON.stringify(m.tool_calls).length / 4);
      } catch {}
    }
  }
  return total;
}
