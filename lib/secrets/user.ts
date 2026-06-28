import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userPersonalKeys, auditLog, member } from "@/db/schema";
import { encryptSecret, decryptSecret, lastFour } from "./crypto";
import { logger } from "@/lib/logger";
import { ProviderNotConfiguredError } from "./org";

/**
 * Tier 2 secret management — user personal integration keys.
 *
 * Examples: Google Calendar OAuth, Microsoft Calendar OAuth, personal API tokens.
 *
 * Access matrix:
 *   - The user themselves: get/set/revoke their own
 *   - Atlas server code: getUserKey (e.g., for calendar sync job)
 *   - Org Owner: cannot see another user's keys (this is the point)
 *
 * Audit log writes use the user's primary org (looked up via membership)
 * because audit_log requires an organizationId.
 */

async function getUserPrimaryOrg(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function setUserKey({
  userId,
  provider,
  value,
  meta,
}: {
  userId: string;
  provider: string;
  value: string;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const encrypted = encryptSecret(value);
  const orgId = await getUserPrimaryOrg(userId);

  const existing = await db
    .select()
    .from(userPersonalKeys)
    .where(and(eq(userPersonalKeys.userId, userId), eq(userPersonalKeys.provider, provider)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userPersonalKeys)
      .set({ encryptedValue: encrypted, lastFour: lastFour(value), status: "active", meta: meta ?? existing[0].meta })
      .where(eq(userPersonalKeys.id, existing[0].id));

    if (orgId) {
      await db.insert(auditLog).values({
        organizationId: orgId,
        actorId: userId,
        action: "rotated_secret",
        resourceType: "user_personal_key",
        resourceId: existing[0].id,
        payload: { provider },
      });
    }
    return existing[0].id;
  }

  const [row] = await db
    .insert(userPersonalKeys)
    .values({ userId, provider, encryptedValue: encrypted, lastFour: lastFour(value), meta })
    .returning({ id: userPersonalKeys.id });

  if (orgId) {
    await db.insert(auditLog).values({
      organizationId: orgId,
      actorId: userId,
      action: "created_secret",
      resourceType: "user_personal_key",
      resourceId: row.id,
      payload: { provider },
    });
  }

  logger.info({ userId, provider }, "user_key created");
  return row.id;
}

export async function getUserKey({
  userId,
  provider,
  reason,
}: {
  userId: string;
  provider: string;
  reason: string;
}): Promise<{ value: string; meta: Record<string, unknown> | null }> {
  const [row] = await db
    .select()
    .from(userPersonalKeys)
    .where(
      and(
        eq(userPersonalKeys.userId, userId),
        eq(userPersonalKeys.provider, provider),
        eq(userPersonalKeys.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ProviderNotConfiguredError(provider);
  }

  const value = decryptSecret(row.encryptedValue as Buffer);

  const orgId = await getUserPrimaryOrg(userId);
  if (orgId) {
    await db.insert(auditLog).values({
      organizationId: orgId,
      actorId: userId,
      action: "decrypted_secret",
      resourceType: "user_personal_key",
      resourceId: row.id,
      reason,
      payload: { provider },
    });
  }

  return { value, meta: (row.meta as Record<string, unknown>) ?? null };
}

export async function listUserKeys(userId: string) {
  return db
    .select({
      id: userPersonalKeys.id,
      provider: userPersonalKeys.provider,
      lastFour: userPersonalKeys.lastFour,
      status: userPersonalKeys.status,
      meta: userPersonalKeys.meta,
      createdAt: userPersonalKeys.createdAt,
    })
    .from(userPersonalKeys)
    .where(eq(userPersonalKeys.userId, userId));
}
