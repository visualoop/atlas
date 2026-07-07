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
const CONNECTED_ACCOUNTS_ENDPOINT = `${COMPOSIO_BASE}/api/v3.1/connected_accounts`;
const CONNECTED_ACCOUNT_ENDPOINT = (id: string) =>
  `${COMPOSIO_BASE}/api/v3.1/connected_accounts/${id}`;
const TOOLKIT_ENDPOINT = (slug: string) =>
  `${COMPOSIO_BASE}/api/v3.1/toolkits/${slug}`;

// Social toolkits we expose in the Social page's Connect UI, in
// display order. Even if the user hasn't set up an auth_config for
// one, we still render a card so they know it's available.
const SOCIAL_TOOLKITS_META: Array<{
  slug: string;
  label: string;
  platform: "facebook_page" | "instagram_business" | "linkedin_personal";
}> = [
  { slug: "linkedin", label: "LinkedIn", platform: "linkedin_personal" },
  { slug: "instagram", label: "Instagram", platform: "instagram_business" },
  { slug: "facebook", label: "Facebook", platform: "facebook_page" },
  { slug: "twitter", label: "Twitter", platform: "linkedin_personal" }, // unused but shown
];

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

interface SocialToolkit {
  toolkitSlug: string;
  toolkitLabel: string;
  logo?: string;
  authConfigId: string | null;
  authConfigStatus: "ENABLED" | "DISABLED" | "MISSING";
  connectedAccounts: Array<{
    id: string;
    displayName: string;
    status: string;
  }>;
}

/**
 * List every social toolkit we support. Cards for platforms without
 * an auth_config still render so the user knows they can set one up.
 */
export const listSocialAuthConfigs = action({
  args: {},
  handler: async (ctx): Promise<SocialToolkit[]> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) {
      return SOCIAL_TOOLKITS_META.map((t) => ({
        toolkitSlug: t.slug,
        toolkitLabel: t.label,
        authConfigId: null,
        authConfigStatus: "MISSING" as const,
        connectedAccounts: [],
      }));
    }

    // Fetch auth configs + connected accounts in parallel
    const [configsRes, accountsRes] = await Promise.all([
      fetch(`${AUTH_CONFIGS_ENDPOINT}?limit=100`, {
        headers: { "x-api-key": setup.apiKey },
      }),
      fetch(`${CONNECTED_ACCOUNTS_ENDPOINT}?limit=100`, {
        headers: { "x-api-key": setup.apiKey },
      }),
    ]);

    const configs = configsRes.ok
      ? (
          (await configsRes.json()) as {
            items?: Array<{
              id: string;
              name: string;
              status: string;
              toolkit?: { slug?: string; logo?: string };
            }>;
          }
        ).items ?? []
      : [];
    const accounts = accountsRes.ok
      ? (
          (await accountsRes.json()) as {
            items?: Array<{
              id: string;
              word_id?: string;
              alias?: string | null;
              status: string;
              toolkit?: { slug?: string };
            }>;
          }
        ).items ?? []
      : [];

    return SOCIAL_TOOLKITS_META.map((t) => {
      const cfg = configs.find((c) => c.toolkit?.slug === t.slug);
      const accs = accounts.filter((a) => a.toolkit?.slug === t.slug);
      return {
        toolkitSlug: t.slug,
        toolkitLabel: t.label,
        logo: cfg?.toolkit?.logo,
        authConfigId: cfg?.id ?? null,
        authConfigStatus: !cfg
          ? ("MISSING" as const)
          : cfg.status === "ENABLED"
            ? ("ENABLED" as const)
            : ("DISABLED" as const),
        connectedAccounts: accs.map((a) => ({
          id: a.id,
          displayName: prettifyAccountName(a.word_id, a.alias, t.slug),
          status: a.status,
        })),
      };
    });
  },
});

/**
 * Turn Composio's raw `word_id` (like "instagram_jackal-pants") into
 * something more human — "Jackal Pants (instagram)" — falling back
 * to alias or toolkit slug when word_id isn't present.
 */
function prettifyAccountName(
  wordId: string | undefined,
  alias: string | null | undefined,
  toolkitSlug: string,
): string {
  if (wordId && wordId.includes("_")) {
    const parts = wordId.split("_");
    const rest = parts.slice(1).join(" ").replace(/-/g, " ");
    return rest.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (alias && !alias.match(/^\w+-\d+$/)) return alias;
  return toolkitSlug.charAt(0).toUpperCase() + toolkitSlug.slice(1);
}

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
      word_id?: string;
      alias?: string | null;
      status?: string;
      toolkit?: { slug?: string };
    };

    if (account.status !== "ACTIVE") {
      return { status: "pending" };
    }

    const toolkitSlug = account.toolkit?.slug ?? conn.appSlug;
    const platform = mapToolkitToPlatform(toolkitSlug);
    if (!platform) {
      return { status: "error", error: `unsupported_toolkit_${toolkitSlug}` };
    }

    const displayName = prettifyAccountName(
      account.word_id,
      account.alias,
      toolkitSlug,
    );
    const externalId = account.id ?? conn.composioConnectionId;
    const avatarUrl: string | undefined = undefined;

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


/**
 * Disconnect a social account. Revokes the Composio connected
 * account, marks the local socialConnection as revoked, marks
 * the composioConnection as disconnected. Idempotent.
 */
export const disconnectSocialAccount = action({
  args: {
    /** Either identifier will work — whichever the UI has. */
    socialConnectionId: v.optional(v.id("socialConnections")),
    composioAccountId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; error?: string }> => {
    const setup = await ctx.runQuery(internal.composioHelpers.prepare, {});
    if (!setup.apiKey) return { ok: false, error: "no_composio_key" };

    // Resolve the Composio account id from either input path
    let composioAccountId = args.composioAccountId;
    if (!composioAccountId && args.socialConnectionId) {
      const sc = await ctx.runQuery(
        internal.socialComposioHelpers.getSocialConnection,
        { id: args.socialConnectionId },
      );
      composioAccountId = sc?.externalId;
    }
    if (!composioAccountId) return { ok: false, error: "no_target" };

    // Delete on Composio side — DELETE fully removes the account.
    // If that fails, we still mark our local rows so the user isn't
    // stuck with a stale row.
    let composioOk = true;
    try {
      const res = await fetch(
        `${CONNECTED_ACCOUNT_ENDPOINT(composioAccountId)}`,
        {
          method: "DELETE",
          headers: { "x-api-key": setup.apiKey },
        },
      );
      if (!res.ok && res.status !== 404) {
        composioOk = false;
      }
    } catch {
      composioOk = false;
    }

    await ctx.runMutation(
      internal.socialComposioHelpers.disconnectLocal,
      { composioAccountId },
    );

    return { ok: true, ...(composioOk ? {} : { error: "composio_delete_failed_but_local_cleared" }) };
  },
});
