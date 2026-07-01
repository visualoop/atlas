"use node";

/**
 * Automation engine — executes an automations.nodes graph.
 *
 * Node shapes supported:
 *   { id, kind: 'native', action: 'send_email' | 'create_task' | 'add_tag' | 'wait', args }
 *   { id, kind: 'composio', connectionId, action, args }
 *   { id, kind: 'ai', prompt, model, args }
 *
 * Triggers (called from the appropriate hook):
 *   - timeline_event: internal.automationEngine.runOnTimelineEvent
 *   - scheduler: cron picks up automations with triggerType='scheduler'
 *   - manual: called from UI
 *   - webhook: /webhook/automation/:automationId handler
 *
 * Each run is journalled in automationRuns.
 */

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

interface AutomationNode {
  id: string;
  kind: "native" | "composio" | "ai";
  action?: string;
  connectionId?: Id<"composioConnections">;
  args?: Record<string, unknown>;
  prompt?: string;
  model?: string;
  next?: string;
}

interface NodeResult {
  nodeId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

/* ---------------- User-triggered run ---------------- */

export const runAutomationManually = action({
  args: {
    automationId: v.id("automations"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"automationRuns"> }> => {
    const runId: Id<"automationRuns"> = await ctx.runMutation(
      internal.automationEngineHelpers.createRun,
      {
        automationId: args.automationId,
        triggerPayload: args.payload,
      },
    );
    await ctx.scheduler.runAfter(0, internal.automationEngine.executeRun, { runId });
    return { runId };
  },
});

/* ---------------- Internal executor ---------------- */

export const executeRun = internalAction({
  args: { runId: v.id("automationRuns") },
  handler: async (ctx, args): Promise<void> => {
    const setup: {
      automation: {
        _id: Id<"automations">;
        workspaceId: Id<"workspaces">;
        organizationId: Id<"organizations">;
        nodes: AutomationNode[];
      } | null;
      payload: Record<string, unknown> | null;
    } = await ctx.runQuery(internal.automationEngineHelpers.getRun, { runId: args.runId });

    if (!setup.automation) {
      await ctx.runMutation(internal.automationEngineHelpers.finishRun, {
        runId: args.runId,
        status: "failed",
        error: "automation_not_found",
        nodeResults: [],
      });
      return;
    }

    const results: NodeResult[] = [];
    for (const node of setup.automation.nodes) {
      const start = Date.now();
      try {
        const output = await executeNode(ctx, node, {
          workspaceId: setup.automation.workspaceId,
          organizationId: setup.automation.organizationId,
          payload: setup.payload,
        });
        results.push({
          nodeId: node.id,
          ok: true,
          output,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        results.push({
          nodeId: node.id,
          ok: false,
          error: err instanceof Error ? err.message : "unknown",
          durationMs: Date.now() - start,
        });
      }
    }

    const anyFailed = results.some((r) => !r.ok);
    const anyOk = results.some((r) => r.ok);
    const status = anyFailed ? (anyOk ? "partial" : "failed") : "success";

    await ctx.runMutation(internal.automationEngineHelpers.finishRun, {
      runId: args.runId,
      status,
      nodeResults: results,
    });
  },
});

async function executeNode(
  ctx: ActionCtx,
  node: AutomationNode,
  context: {
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
    payload: Record<string, unknown> | null;
  },
): Promise<unknown> {
  switch (node.kind) {
    case "native":
      return await executeNativeAction(ctx, node, context);
    case "composio":
      if (!node.connectionId || !node.action) throw new Error("composio_node_missing_fields");
      return await ctx.runAction(internal.composioActions.executeAction, {
        connectionId: node.connectionId,
        action: node.action,
        params: node.args ?? {},
      });
    case "ai":
      return await executeAiNode(ctx, node, context);
    default:
      throw new Error(`unknown_node_kind:${node.kind}`);
  }
}

async function executeNativeAction(
  ctx: ActionCtx,
  node: AutomationNode,
  context: {
    workspaceId: Id<"workspaces">;
    organizationId: Id<"organizations">;
  },
): Promise<unknown> {
  const args = node.args ?? {};
  switch (node.action) {
    case "send_email": {
      const to = (args.to as string[]) ?? [];
      const subject = (args.subject as string) ?? "";
      const html = (args.html as string) ?? "";
      const text = (args.text as string) ?? "";
      return await ctx.runAction(internal.emailsOutSystem.sendOrgEmail, {
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,
        to,
        subject,
        html,
        text,
      });
    }
    case "add_tag": {
      // TODO: mutation for adding a tag to a contact
      return { skipped: "add_tag_not_implemented" };
    }
    case "wait": {
      // Waits aren't inline — automation engine treats them as durable steps
      // in a follow-up. For now we no-op.
      return { skipped: "wait" };
    }
    default:
      throw new Error(`unknown_native_action:${node.action}`);
  }
}

async function executeAiNode(
  ctx: ActionCtx,
  node: AutomationNode,
  context: { workspaceId: Id<"workspaces">; organizationId: Id<"organizations"> },
): Promise<unknown> {
  // For MVP, we call our shared runFeature-like path via a Groq compound-beta
  // one-shot chat completion. The output is stored on the run.
  const key: string | null = await ctx.runQuery(
    internal.trendsActionsHelpers.getGroqKey,
    { workspaceId: context.workspaceId },
  );
  if (!key) throw new Error("no_ai_key");

  const model = node.model ?? "llama-3.3-70b-versatile";
  const prompt = node.prompt ?? "Summarize the triggering payload in one sentence.";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  });
  if (!res.ok) throw new Error(`ai_${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}
