"use node";

/**
 * Composio integration actions (Node runtime — HTTP calls).
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const COMPOSIO_API = "https://backend.composio.dev/api/v1";

export const getAuthorizeUrl = action({
  args: {
    appSlug: v.string(),
    redirectUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ authUrl: string }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) throw new Error("Composio API key is not configured.");

    const res = await fetch(`${COMPOSIO_API}/connectedAccounts/link`, {
      method: "POST",
      headers: {
        "x-api-key": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        integration_id: args.appSlug,
        redirect_url: args.redirectUrl,
        entity_id: setup.userId,
      }),
    });
    if (!res.ok) {
      throw new Error(`Composio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { redirectUrl?: string; url?: string };
    const authUrl = json.redirectUrl ?? json.url ?? "";
    if (!authUrl) throw new Error("Composio did not return an auth URL.");
    return { authUrl };
  },
});

export const executeAction = internalAction({
  args: {
    connectionId: v.id("composioConnections"),
    action: v.string(),
    params: v.any(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepareExecute, {
      connectionId: args.connectionId,
    });
    if (!setup.apiKey || !setup.connectionRef) {
      return { ok: false, error: "not_configured" };
    }
    const res = await fetch(`${COMPOSIO_API}/actions/${args.action}/execute`, {
      method: "POST",
      headers: {
        "x-api-key": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connected_account_id: setup.connectionRef,
        input: args.params,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Composio ${res.status}` };
    }
    return { ok: true, result: await res.json() };
  },
});
