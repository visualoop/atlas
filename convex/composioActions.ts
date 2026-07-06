"use node";

/**
 * Composio integration actions (Node runtime — HTTP calls).
 *
 * Migrated to Composio API v3.1 (POST /api/v3.1/connected_accounts/link
 * for the connect flow, POST /api/v3/tools/execute for tool execution).
 * The old v1 endpoints (/api/v1/connectedAccounts/link etc.) are gone.
 *
 * Auth: x-api-key header with the project API key (starts with
 * "sk_live_..." from dashboard.composio.dev/~/project/api-keys).
 * The two identifiers you may also see:
 *   - Project id (pr_...)     — visible in dashboard URL path
 *   - Auth config id (ac_..)  — one per third-party app you enabled
 * These are NOT API keys.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const COMPOSIO_BASE = "https://backend.composio.dev";
const LINK_ENDPOINT = `${COMPOSIO_BASE}/api/v3.1/connected_accounts/link`;
const EXECUTE_ENDPOINT = `${COMPOSIO_BASE}/api/v3/tools/execute`;

export const getAuthorizeUrl = action({
  args: {
    /** The Composio auth_config_id (starts with 'ac_' or 'ck_') */
    authConfigId: v.string(),
    /** Where Composio should send the user after authorization */
    redirectUrl: v.string(),
    /** Optional human-readable label shown in the dashboard */
    alias: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    authUrl: string;
    connectedAccountId: string;
    expiresAt?: string;
  }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) throw new Error("Composio API key is not configured.");

    const res = await fetch(LINK_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_config_id: args.authConfigId,
        user_id: setup.userId,
        callback_url: args.redirectUrl,
        alias: args.alias,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Composio ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      redirect_url?: string;
      connected_account_id?: string;
      expires_at?: string;
    };
    if (!json.redirect_url || !json.connected_account_id) {
      throw new Error("Composio did not return a redirect_url or connected_account_id");
    }
    return {
      authUrl: json.redirect_url,
      connectedAccountId: json.connected_account_id,
      expiresAt: json.expires_at,
    };
  },
});

export const executeAction = internalAction({
  args: {
    connectionId: v.id("composioConnections"),
    /** Composio tool slug, e.g. 'GMAIL_SEND_EMAIL' */
    toolSlug: v.string(),
    input: v.any(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepareExecute, {
      connectionId: args.connectionId,
    });
    if (!setup.apiKey || !setup.connectionRef) {
      return { ok: false, error: "not_configured" };
    }
    const res = await fetch(EXECUTE_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connected_account_id: setup.connectionRef,
        tool_slug: args.toolSlug,
        arguments: args.input,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return { ok: false, error: `Composio ${res.status}: ${body}` };
    }
    return { ok: true, result: await res.json() };
  },
});
