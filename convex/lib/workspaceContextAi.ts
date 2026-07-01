/**
 * Workspace brand-context helper.
 *
 * Every AI feature (Copilot, campaign runner, meeting brief, rotting
 * deal classifier, trend intelligence, social post generator, etc.)
 * calls this to prefix the system prompt with the current workspace's
 * brand context.
 *
 * Import as:
 *   import { workspaceBrandBlock } from './lib/workspaceContextAi';
 *
 * Usage in an internalQuery:
 *   const block = await workspaceBrandBlock(ctx, workspaceId);
 *   const systemPrompt = `${block}\n\n${TASK_INSTRUCTIONS}`;
 */

import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function workspaceBrandBlock(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const ws = await ctx.db.get(workspaceId);
  if (!ws) return "";

  const parts: string[] = ["## Workspace context"];
  parts.push(`Name: ${ws.name}`);
  if (ws.oneLiner) parts.push(`One-liner: ${ws.oneLiner}`);
  if (ws.website) parts.push(`Website: ${ws.website}`);
  if (ws.elevatorPitch) parts.push(`Pitch: ${ws.elevatorPitch}`);
  if (ws.offerings) parts.push(`Offerings:\n${ws.offerings}`);
  if (ws.targetMarket) parts.push(`Ideal customer: ${ws.targetMarket}`);
  if (ws.pricingSummary) parts.push(`Pricing: ${ws.pricingSummary}`);
  if (ws.coreValues) parts.push(`Values: ${ws.coreValues}`);
  if (ws.brandVoice) {
    parts.push(`Brand voice: ${ws.brandVoice}`);
  } else {
    parts.push(`Brand voice: Kenyan English, direct, no marketing fluff, no AI-slop phrases.`);
  }
  parts.push(`Timezone: ${ws.timezone}`);
  parts.push(`Currency: ${ws.currency}`);
  return parts.join("\n");
}
