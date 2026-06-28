import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgIntegrationKeys, auditLog } from "@/db/schema";
import { encryptSecret, decryptSecret, lastFour } from "./crypto";
import { logger } from "@/lib/logger";

/**
 * Tier 1 secret management — organization-level integration keys.
 *
 * Access matrix:
 *   - Org Owner / Admin: setOrgKey, rotateOrgKey, revokeOrgKey
 *   - Atlas server code: getOrgKey (for outbound API calls)
 *   - Org Member: never reads decrypted value; can trigger server actions that use it
 *
 * Every decryption is audit-logged. Every save/rotate/revoke is audit-logged.
 */

export interface SetOrgKeyArgs {
  organizationId: string;
  provider: string;
  label?: string;
  value: string;
  meta?: Record<string, unknown>;
  actorId: string | null;
}

/** Save or replace a provider key. */
export async function setOrgKey({
  organizationId,
  provider,
  label = "Primary",
  value,
  meta,
  actorId,
}: SetOrgKeyArgs) {
  const encrypted = encryptSecret(value);

  // Upsert: if a row with same (org, provider, label) exists, replace it (rotation).
  const existing = await db
    .select()
    .from(orgIntegrationKeys)
    .where(
      and(
        eq(orgIntegrationKeys.organizationId, organizationId),
        eq(orgIntegrationKeys.provider, provider),
        eq(orgIntegrationKeys.label, label),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(orgIntegrationKeys)
      .set({
        encryptedValue: encrypted,
        lastFour: lastFour(value),
        rotatedAt: new Date(),
        status: "active",
        meta: meta ?? existing[0].meta,
      })
      .where(eq(orgIntegrationKeys.id, existing[0].id));

    await db.insert(auditLog).values({
      organizationId,
      actorId,
      action: "rotated_secret",
      resourceType: "org_integration_key",
      resourceId: existing[0].id,
      payload: { provider, label },
    });

    logger.info({ organizationId, provider, label, actorId }, "org_key rotated");
    return existing[0].id;
  }

  const [row] = await db
    .insert(orgIntegrationKeys)
    .values({
      organizationId,
      provider,
      label,
      encryptedValue: encrypted,
      lastFour: lastFour(value),
      meta,
      createdBy: actorId,
    })
    .returning({ id: orgIntegrationKeys.id });

  await db.insert(auditLog).values({
    organizationId,
    actorId,
    action: "created_secret",
    resourceType: "org_integration_key",
    resourceId: row.id,
    payload: { provider, label },
  });

  logger.info({ organizationId, provider, label, actorId }, "org_key created");
  return row.id;
}

export interface GetOrgKeyArgs {
  organizationId: string;
  provider: string;
  label?: string;
  /** Reason for decryption, recorded in audit log. */
  reason: string;
  /** The system/user requesting decryption — null for system. */
  actorId?: string | null;
}

/**
 * Decrypt + return the active key value. Throws if not configured.
 * Records an audit_log row with the reason.
 */
export async function getOrgKey({
  organizationId,
  provider,
  label = "Primary",
  reason,
  actorId = null,
}: GetOrgKeyArgs): Promise<{ value: string; meta: Record<string, unknown> | null }> {
  const [row] = await db
    .select()
    .from(orgIntegrationKeys)
    .where(
      and(
        eq(orgIntegrationKeys.organizationId, organizationId),
        eq(orgIntegrationKeys.provider, provider),
        eq(orgIntegrationKeys.label, label),
        eq(orgIntegrationKeys.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ProviderNotConfiguredError(provider);
  }

  const value = decryptSecret(row.encryptedValue as Buffer);

  await db.insert(auditLog).values({
    organizationId,
    actorId,
    action: "decrypted_secret",
    resourceType: "org_integration_key",
    resourceId: row.id,
    reason,
    payload: { provider, label },
  });

  return { value, meta: (row.meta as Record<string, unknown>) ?? null };
}

/** Mark a key as revoked. Atlas stops using it but the row is kept for audit. */
export async function revokeOrgKey({
  organizationId,
  provider,
  label = "Primary",
  actorId,
}: {
  organizationId: string;
  provider: string;
  label?: string;
  actorId: string | null;
}) {
  const [updated] = await db
    .update(orgIntegrationKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(orgIntegrationKeys.organizationId, organizationId),
        eq(orgIntegrationKeys.provider, provider),
        eq(orgIntegrationKeys.label, label),
      ),
    )
    .returning({ id: orgIntegrationKeys.id });

  if (updated) {
    await db.insert(auditLog).values({
      organizationId,
      actorId,
      action: "revoked_secret",
      resourceType: "org_integration_key",
      resourceId: updated.id,
      payload: { provider, label },
    });
    logger.info({ organizationId, provider, label, actorId }, "org_key revoked");
  }
}

/** List configured providers for an org. Returns metadata only — never decrypted values. */
export async function listOrgKeys(organizationId: string) {
  return db
    .select({
      id: orgIntegrationKeys.id,
      provider: orgIntegrationKeys.provider,
      label: orgIntegrationKeys.label,
      lastFour: orgIntegrationKeys.lastFour,
      status: orgIntegrationKeys.status,
      meta: orgIntegrationKeys.meta,
      createdAt: orgIntegrationKeys.createdAt,
      rotatedAt: orgIntegrationKeys.rotatedAt,
    })
    .from(orgIntegrationKeys)
    .where(eq(orgIntegrationKeys.organizationId, organizationId));
}

export class ProviderNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(`Provider '${provider}' is not configured for this organization`);
    this.name = "ProviderNotConfiguredError";
  }
}
