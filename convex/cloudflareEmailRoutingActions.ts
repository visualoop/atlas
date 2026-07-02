"use node";

/**
 * Cloudflare Email Routing — free inbound mail forwarding.
 *
 * Requires an API token with these scopes (pre-selected via the
 * "Get key" link on the Integrations page):
 *   - Email Routing Addresses: Edit
 *   - Email Routing Rules: Edit
 *   - Zone > DNS: Read
 *   - Zone > Zone: Read
 *
 * Docs: https://developers.cloudflare.com/email-routing/
 *
 * Feature scope (all free tier):
 *   1. List zones the token can see
 *   2. Enable Email Routing on a zone (installs MX + SPF records)
 *   3. List routing rules per zone (which addresses forward where)
 *   4. Add a routing rule (custom_address / matcher / action)
 *   5. Delete a routing rule
 *   6. List destination addresses (verified forwarding targets)
 *   7. Add a destination address (sends verify email from CF)
 *
 * Wrangler-less by design — this runs on Convex, not the user's
 * machine, so we hit the REST API directly with the token.
 */

import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const CF_API = "https://api.cloudflare.com/client/v4";

interface CfResponse<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ message?: string }>;
  result?: T;
  result_info?: { total_count?: number };
}

interface CfZone {
  id: string;
  name: string;
  status: string;
  account?: { id: string; name?: string };
}

interface CfRoutingSettings {
  enabled: boolean;
  name: string;
  status: string;              // "ready" | "unlocked" | ...
  created: string;
  modified: string;
}

interface CfRoutingRule {
  tag: string;
  name?: string;
  enabled: boolean;
  matchers: Array<{
    type: string;              // "literal" | "all"
    field?: string;            // "to"
    value?: string;
  }>;
  actions: Array<{
    type: string;              // "forward" | "worker" | "drop"
    value?: string[];
  }>;
  priority?: number;
}

interface CfDestinationAddress {
  id: string;
  tag: string;
  email: string;
  verified?: string | null;
  created: string;
  modified: string;
}

async function cfFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const j = (await res.json()) as CfResponse<T>;
  if (!j.success) {
    const msg =
      j.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `Cloudflare API returned ${res.status}`;
    throw new ConvexError({ code: "CF_ERROR", message: msg });
  }
  return j.result as T;
}

async function getToken(ctx: ActionCtx): Promise<{
  token: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
}> {
  const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
  if (!setup) {
    throw new ConvexError({ code: "NO_WORKSPACE", message: "Not in a workspace." });
  }
  const tokenResp = await ctx.runQuery(
    internal.cloudflareEmailRoutingHelpers.getToken,
    {},
  );
  if (!tokenResp?.value) {
    throw new ConvexError({
      code: "NO_KEY",
      message:
        "Cloudflare Email Routing token not set. Add it under Settings → Integrations.",
    });
  }
  return {
    token: tokenResp.value,
    organizationId: setup.organizationId,
    workspaceId: setup.workspaceId,
    userId: setup.userId,
  };
}

/**
 * List every zone the token can see, with account context.
 * Use this to populate the zone dropdown.
 */
export const listZones = action({
  args: {},
  handler: async (ctx): Promise<{ zones: CfZone[] }> => {
    const { token } = await getToken(ctx);
    const zones = await cfFetch<CfZone[]>(`/zones?per_page=50`, token);
    return {
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        account: z.account,
      })),
    };
  },
});

/**
 * Get Email Routing enablement + status for a zone.
 * Returns { enabled: false } for zones where it's not yet set up.
 */
export const getZoneRoutingStatus = action({
  args: { zoneId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    enabled: boolean;
    status?: string;
    zoneName?: string;
    mxReady?: boolean;
  }> => {
    const { token } = await getToken(ctx);
    try {
      const settings = await cfFetch<CfRoutingSettings>(
        `/zones/${encodeURIComponent(args.zoneId)}/email/routing`,
        token,
      );
      return {
        enabled: settings.enabled,
        status: settings.status,
        zoneName: settings.name,
        mxReady: settings.status === "ready",
      };
    } catch (err) {
      // Zone doesn't have Email Routing initialized yet — return default
      if (err instanceof ConvexError) {
        return { enabled: false };
      }
      throw err;
    }
  },
});

/**
 * Turn on Email Routing for a zone. This installs the MX and SPF DNS
 * records automatically. User still needs to verify a destination
 * address before mail flows.
 */
export const enableRouting = action({
  args: { zoneId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { token } = await getToken(ctx);
    await cfFetch<CfRoutingSettings>(
      `/zones/${encodeURIComponent(args.zoneId)}/email/routing/enable`,
      token,
      { method: "POST" },
    );
    return { ok: true };
  },
});

/**
 * List routing rules on a zone.
 * Each rule = matcher (which incoming address) + action (where to forward).
 */
export const listRules = action({
  args: { zoneId: v.string() },
  handler: async (ctx, args): Promise<{ rules: CfRoutingRule[] }> => {
    const { token } = await getToken(ctx);
    const rules = await cfFetch<CfRoutingRule[]>(
      `/zones/${encodeURIComponent(args.zoneId)}/email/routing/rules?per_page=50`,
      token,
    );
    return { rules };
  },
});

/**
 * Add a forwarding rule. Matches an incoming `custom_address` on the
 * zone and forwards to one or more verified destination addresses.
 *
 * Example: incoming `hello@blyss.co.ke` → forward to `justinequartz1@gmail.com`
 */
export const addRule = action({
  args: {
    zoneId: v.string(),
    customAddress: v.string(),         // "hello" or "hello@blyss.co.ke"
    forwardTo: v.array(v.string()),    // verified destination emails
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ tag: string }> => {
    const { token } = await getToken(ctx);
    // Normalize: strip @domain if user passed a full address
    const local = args.customAddress.split("@")[0].trim();
    if (!local) {
      throw new ConvexError({ code: "BAD_INPUT", message: "Custom address is empty." });
    }
    if (args.forwardTo.length === 0) {
      throw new ConvexError({ code: "BAD_INPUT", message: "At least one forward-to email required." });
    }

    // Fetch the zone to build the full custom_address
    const zone = await cfFetch<{ name: string }>(
      `/zones/${encodeURIComponent(args.zoneId)}`,
      token,
    );
    const fullAddress = `${local}@${zone.name}`;

    const body = {
      name: args.name ?? `Forward ${fullAddress}`,
      enabled: true,
      matchers: [
        {
          type: "literal",
          field: "to",
          value: fullAddress,
        },
      ],
      actions: [
        {
          type: "forward",
          value: args.forwardTo,
        },
      ],
      priority: 0,
    };

    const rule = await cfFetch<CfRoutingRule>(
      `/zones/${encodeURIComponent(args.zoneId)}/email/routing/rules`,
      token,
      { method: "POST", body: JSON.stringify(body) },
    );
    return { tag: rule.tag };
  },
});

/**
 * Delete a routing rule by tag.
 */
export const deleteRule = action({
  args: { zoneId: v.string(), tag: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { token } = await getToken(ctx);
    await cfFetch<CfRoutingRule>(
      `/zones/${encodeURIComponent(args.zoneId)}/email/routing/rules/${encodeURIComponent(args.tag)}`,
      token,
      { method: "DELETE" },
    );
    return { ok: true };
  },
});

/**
 * List account-level verified destination addresses.
 * A rule can only forward to a verified address.
 */
export const listDestinations = action({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<{ destinations: CfDestinationAddress[] }> => {
    const { token } = await getToken(ctx);
    const dests = await cfFetch<CfDestinationAddress[]>(
      `/accounts/${encodeURIComponent(args.accountId)}/email/routing/addresses?per_page=50`,
      token,
    );
    return { destinations: dests };
  },
});

/**
 * Add a destination address. Cloudflare sends a verification email to
 * that address; user must click the link before it can be used in a rule.
 */
export const addDestination = action({
  args: { accountId: v.string(), email: v.string() },
  handler: async (ctx, args): Promise<{ tag: string; verifyRequired: true }> => {
    const { token } = await getToken(ctx);
    const dest = await cfFetch<CfDestinationAddress>(
      `/accounts/${encodeURIComponent(args.accountId)}/email/routing/addresses`,
      token,
      { method: "POST", body: JSON.stringify({ email: args.email }) },
    );
    return { tag: dest.tag, verifyRequired: true };
  },
});
