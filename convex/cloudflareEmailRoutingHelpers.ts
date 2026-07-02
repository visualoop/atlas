/**
 * V8-safe helper query for reading the Cloudflare Email Routing token
 * from the org's encrypted secret store. Kept separate from the
 * Node-runtime action file so it can use the standard `internalQuery`.
 */

import { internalQuery } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import { getOrgKey } from "./lib/secretsAccess";

export const getToken = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ value: string } | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return null;

    try {
      const key = await getOrgKey(ctx, {
        organizationId: profile.lastActiveOrgId,
        provider: "cloudflare_email_routing",
        reason: "email_routing",
        actorId: user._id,
      });
      return { value: key.value };
    } catch {
      return null;
    }
  },
});
