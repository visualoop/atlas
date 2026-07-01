/**
 * Convenience wrapper around `orgIntegrationKeys` that:
 *  1. Locates the row for (org, provider, label='Primary')
 *  2. Decrypts via lib/secrets.ts (Web Crypto AES-GCM)
 *  3. Writes an audit log entry with the caller's reason
 *
 * Called ONLY from server-trusted code (internalQuery / internalAction).
 * Decrypted values must never be returned to a client component or
 * echoed to logs.
 */

import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { decrypt } from "./secrets";

type ProviderLiteral = Doc<"orgIntegrationKeys">["provider"];

interface GetOrgKeyArgs {
  organizationId: Id<"organizations">;
  provider: ProviderLiteral;               // 'resend' | 'paystack' | 'gemini' | …
  label?: string;                          // 'Primary' by default
  reason: string;                          // audit reason, e.g. 'email_send'
  actorId?: Id<"users"> | null;
}

export async function getOrgKey(
  ctx: QueryCtx | MutationCtx,
  args: GetOrgKeyArgs,
): Promise<{ value: string; meta: Record<string, unknown> | null; keyId: Id<"orgIntegrationKeys"> }> {
  const label = args.label ?? "Primary";
  const row = await ctx.db
    .query("orgIntegrationKeys")
    .withIndex("by_org_provider_label", (q) =>
      q
        .eq("organizationId", args.organizationId)
        .eq("provider", args.provider)
        .eq("label", label),
    )
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();

  if (!row) {
    throw new ConvexError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: `${args.provider} is not configured for this organization`,
    });
  }

  const value = await decrypt(row.encryptedValue);

  // Audit the decryption — only when we have a mutation context.
  // In an internalQuery we can't write, so we skip the audit; the
  // action that wraps the mutation should audit at the call boundary
  // instead.
  const isMutation = "insert" in ctx.db && "patch" in ctx.db;
  if (isMutation) {
    await (ctx as MutationCtx).db.insert("auditLog", {
      organizationId: args.organizationId,
      actorId: args.actorId ?? undefined,
      action: "decrypted_secret",
      resourceType: "org_integration_key",
      resourceId: row._id,
      reason: args.reason,
      payload: { provider: args.provider, label },
      occurredAt: Date.now(),
    });
  }

  return {
    value,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    keyId: row._id,
  };
}
