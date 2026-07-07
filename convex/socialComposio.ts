"use node";

/**
 * Social-platform Composio flow.
 *
 * Composio has separate "toolkits" for each social platform. This
 * module:
 *   1. Fetches the workspace's Composio auth_configs for social
 *      toolkits (linkedin, facebook, instagram, twitter) so the UI
 *      knows what's available to Connect.
 *   2. Starts a Composio "Connect Link" session for a chosen
 *      auth_config, returns the redirect URL + connected_account_id,
 *      persists a pending composioConnection row.
 *   3. Finalizes: polls Composio for the account status, if ACTIVE
 *      creates a socialConnection row in Atlas + activates the
 *      composioConnection.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const COMPOSIO_BASE = "https://backend.composio.dev";
const AUTH_CONFIGS_ENDPOINT = `${COMPOSIO_BASE}/api/v3.1/auth_configs`;
const LINK_ENDPOINT = `${COMPOSIO_BASE}/api/v3.1/connected_accounts/link`;
const CONNECTED_ACCOUNT_ENDPOINT = (id: string) =>
  `${COMPOSIO_BASE}/api/v3.1/connected_accounts/${id}`;

// Social toolkits we expose in the Social page's Connect UI.
const SOCIAL_TOOLKITS = ["linkedin", "facebook", "instagram", "twitter"] as const;

// Map from Composio toolkit slug → Atlas socialConnections.platform enum.
function mapToolkitToPlatform(
  slug: string,
): "facebook_page" | "instagram_business" | "linkedin_personal" | "linkedin_company" | null {
  switch (slug) {
    case "linkedin":
      return "linkedin_personal";
    case "facebook":
      return "facebook_page";
    case "instagram":
      return "instagram_business";
    default:
      return null;
  }
}

interface SocialAuthConfig {
  id: string;
  name: string;
  toolkitSlug: string;
  status: string;
  logo?: string;
  isEnabled: boolean;
}

/**
 * List the social-relevant auth configs from Composio for the current
 * workspace's API key. Powers the Social page's "Connect a platform"
 * chooser.
 */
export const listSocialAuthConfigs = action({
  args: {},
  handler: async (ctx): Promise<SocialAuthConfig[]> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) return [];

    const res = await fetch(`${AUTH_CONFIGS_ENDPOINT}?limit=100`, {
      headers: { "x-api-key": setup.apiKey },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        name: string;
        status: string;
        toolkit?: { slug?: string; logo?: string };
      }>;
    };

    return (json.items ?? [])
      .filter((a) =>
        SOCIAL_TOOLKITS.includes(
          (a.toolkit?.slug ?? "") as (typeof SOCIAL_TOOLKITS)[number],
        ),
      )
      .map((a) => ({
        id: a.id,
        name: a.name,
        toolkitSlug: a.toolkit?.slug ?? "",
        status: a.status,
        logo: a.toolkit?.logo,
        isEnabled: a.status === "ENABLED",
      }));
  },
});

/**
 * Start the Composio Connect Link flow for one auth config. Returns
 * the redirect URL the user should open in a new tab + the
 * connected_account_id we can poll later.
 */
export const startSocialConnect = action({
  args: {
    authConfigId: v.string(),
    toolkitSlug: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    redirectUrl: string;
    connectedAccountId: string;
    composioConnectionId: Id<"composioConnections">;
  }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) throw new Error("Composio API key not configured");

    const res = await fetch(LINK_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_config_id: args.authConfigId,
        user_id: setup.userId,
        alias: `${args.toolkitSlug}-${Date.now()}`,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Composio ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      redirect_url?: string;
      connected_account_id?: string;
    };
    if (!json.redirect_url || !json.connected_account_id) {
      throw new Error("Composio did not return a redirect URL");
    }

    // Persist a pending row so finalize() can find it later
    const composioConnectionId = await ctx.runMutation(
      internal.socialComposioHelpers.recordPending,
      {
        appSlug: args.toolkitSlug,
        composioConnectionId: json.connected_account_id,
        accountLabel: undefined,
      },
    );

    return {
      redirectUrl: json.redirect_url,
      connectedAccountId: json.connected_account_id,
      composioConnectionId,
    };
  },
});

/**
 * Polls Composio for the connected account status. If ACTIVE and we
 * don't yet have a matching socialConnection, creates one.
 * Returns the effective status the UI should reflect.
 */
export const finalizeSocialConnect = action({
  args: { composioConnectionId: v.id("composioConnections") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "pending" | "active" | "error";
    platform?: string;
    displayName?: string;
    socialConnectionId?: Id<"socialConnections">;
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) return { status: "error", error: "no_composio_key" };

    const conn = await ctx.runQuery(
      internal.socialComposioHelpers.getConnection,
      { id: args.composioConnectionId },
    );
    if (!conn) return { status: "error", error: "not_found" };

    const res = await fetch(
      CONNECTED_ACCOUNT_ENDPOINT(conn.composioConnectionId),
      { headers: { "x-api-key": setup.apiKey } },
    );
    if (!res.ok) {
      return { status: "error", error: `composio_${res.status}` };
    }
    const account = (await res.json()) as {
      id?: string;
      status?: string;
      toolkit?: { slug?: string };
      user_id?: string;
      alias?: string;
      account?: {
        id?: string;
        display_name?: string;
        name?: string;
        email?: string;
        picture?: string;
      };
    };

    if (account.status !== "ACTIVE") {
      return { status: "pending" };
    }

    const toolkitSlug = account.toolkit?.slug ?? conn.appSlug;
    const platform = mapToolkitToPlatform(toolkitSlug);
    if (!platform) {
      return { status: "error", error: `unsupported_toolkit_${toolkitSlug}` };
    }

    const displayName =
      account.account?.display_name ??
      account.account?.name ??
      account.account?.email ??
      account.alias ??
      toolkitSlug;
    const externalId = account.account?.id ?? account.id ?? conn.composioConnectionId;
    const avatarUrl = account.account?.picture;

    const socialConnectionId = await ctx.runMutation(
      internal.socialComposioHelpers.activateAndLink,
      {
        composioConnectionId: args.composioConnectionId,
        platform,
        externalId,
        displayName,
        avatarUrl,
      },
    );

    return {
      status: "active",
      platform,
      displayName,
      socialConnectionId,
    };
  },
});
