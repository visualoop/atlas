/**
 * Org-level integration keys — set / list / revoke.
 *
 * Sensitive values are AES-GCM encrypted via `convex/lib/secrets.ts`
 * before insertion. The decrypted key is NEVER returned to the client
 * — only masked (`lastFour`) previews and status.
 *
 * Rotation increments `keyVersion` on the existing row rather than
 * deleting; this lets long-running jobs that hold onto the old key
 * finish gracefully.
 *
 * Access: org Admin or Owner only.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOrgRole } from "./lib/authHelpers";
import { encrypt } from "./lib/secrets";
import type { Doc, Id } from "./_generated/dataModel";

const PROVIDER = v.union(
  v.literal("gemini"),
  v.literal("groq"),
  v.literal("openrouter"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("cerebras"),
  v.literal("github_models"),
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("together"),
  v.literal("resend"),
  v.literal("meta_whatsapp"),
  v.literal("cloudflare_email_routing"),
  v.literal("google_maps_places"),
  v.literal("paystack"),
  v.literal("docuseal"),
);

async function requireActiveOrg(
  ctx: Parameters<typeof requireUser>[0],
): Promise<{ user: Doc<"users">; organizationId: Id<"organizations"> }> {
  const user = await requireUser(ctx);
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first();
  if (!profile?.lastActiveOrgId) {
    throw new ConvexError({ code: "NO_ORG", message: "No active organization." });
  }
  return { user, organizationId: profile.lastActiveOrgId };
}

/**
 * Lists all integration keys for the caller's active organization.
 * Returns only display-safe fields — no decrypted values.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveOrgId) return [];
    // Membership check (must be at least a member of the org to view keys)
    const membership = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", profile.lastActiveOrgId!).eq("userId", user._id),
      )
      .unique();
    if (!membership) return [];

    const rows = await ctx.db
      .query("orgIntegrationKeys")
      .withIndex("by_org", (q) => q.eq("organizationId", profile.lastActiveOrgId!))
      .collect();

    return rows.map((r) => ({
      _id: r._id,
      provider: r.provider,
      label: r.label,
      lastFour: r.lastFour,
      status: r.status,
      keyVersion: r.keyVersion,
      rotatedAt: r.rotatedAt,
      _creationTime: r._creationTime,
    }));
  },
});

/**
 * Create or rotate a key for a provider (label defaults to 'Primary').
 * If a key already exists for (org, provider, label), it's rotated
 * in place — keyVersion++, encryptedValue replaced, rotatedAt set.
 */
export const setKey = mutation({
  args: {
    provider: PROVIDER,
    label: v.optional(v.string()),
    value: v.string(),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { user, organizationId } = await requireActiveOrg(ctx);
    await requireOrgRole(ctx, organizationId, "admin");
    const label = args.label ?? "Primary";
    const trimmed = args.value.trim();
    if (trimmed.length < 8) {
      throw new ConvexError({ code: "INVALID", message: "Key looks too short." });
    }
    const lastFour = trimmed.slice(-4);
    const encryptedValue = await encrypt(trimmed);

    const existing = await ctx.db
      .query("orgIntegrationKeys")
      .withIndex("by_org_provider_label", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("provider", args.provider)
          .eq("label", label),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedValue,
        lastFour,
        keyVersion: existing.keyVersion + 1,
        status: "active",
        meta: args.meta ?? existing.meta,
        rotatedAt: Date.now(),
        revokedAt: undefined,
      });
      await ctx.db.insert("auditLog", {
        organizationId,
        actorId: user._id,
        action: "rotated_secret",
        resourceType: "org_integration_key",
        resourceId: existing._id,
        after: { provider: args.provider, label, lastFour },
        occurredAt: Date.now(),
      });
      return existing._id;
    }

    const id = await ctx.db.insert("orgIntegrationKeys", {
      organizationId,
      provider: args.provider,
      label,
      encryptedValue,
      keyVersion: 1,
      lastFour,
      status: "active",
      meta: args.meta,
      createdBy: user._id,
    });
    await ctx.db.insert("auditLog", {
      organizationId,
      actorId: user._id,
      action: "created_secret",
      resourceType: "org_integration_key",
      resourceId: id,
      after: { provider: args.provider, label, lastFour },
      occurredAt: Date.now(),
    });
    return id;
  },
});

/**
 * Revoke a key — soft delete. Downstream `getOrgKey` skips revoked
 * rows because it filters on `status === 'active'`.
 */
export const revokeKey = mutation({
  args: { id: v.id("orgIntegrationKeys") },
  handler: async (ctx, { id }) => {
    const { user, organizationId } = await requireActiveOrg(ctx);
    await requireOrgRole(ctx, organizationId, "admin");
    const row = await ctx.db.get(id);
    if (!row || row.organizationId !== organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Key not found." });
    }
    await ctx.db.patch(id, { status: "revoked", revokedAt: Date.now() });
    await ctx.db.insert("auditLog", {
      organizationId,
      actorId: user._id,
      action: "revoked_secret",
      resourceType: "org_integration_key",
      resourceId: id,
      occurredAt: Date.now(),
    });
  },
});
