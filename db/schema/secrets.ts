import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  customType,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * Encrypted secrets storage — Tier 1 (org integrations) and Tier 2 (user personal).
 *
 * Encryption: AES-256-GCM with ATLAS_MASTER_KEY (Tier 0 env).
 * Storage format: [ 1B version | 12B IV | ciphertext | 16B GCM tag ] in a single bytea column.
 *
 * The decrypted value never leaves the server. After save, the UI shows
 * `last_four` only (e.g. "•••••••••8h2"). Org Owner can rotate but not view.
 */

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// === Tier 1: Org-level integration secrets ===
// Resend, Paystack, Gemini, Groq, Meta WhatsApp, Google Maps, etc.

export const orgIntegrationKeys = pgTable(
  "org_integration_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // 'gemini' | 'groq' | 'openrouter' | 'mistral' | 'cohere' | 'cerebras' | 'github_models' |
    // 'together' | 'openai' | 'anthropic' | 'resend' | 'meta_whatsapp' | 'google_maps_places' |
    // 'paystack' | 'docuseal' | 'cloudflare_email_routing'
    label: text("label").notNull().default("Primary"),
    encryptedValue: bytea("encrypted_value").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    lastFour: text("last_four").notNull(),
    status: text("status").notNull().default("active"), // 'active' | 'rotating' | 'revoked'
    meta: jsonb("meta"), // provider-specific extras: e.g. { waba_id, phone_number_ids }
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    orgProviderLabelUnique: uniqueIndex("idx_oik_org_provider_label").on(
      t.organizationId,
      t.provider,
      t.label,
    ),
  }),
);

// === Tier 2: User personal secrets ===
// Google Calendar OAuth tokens, Microsoft Calendar tokens, personal API tokens

export const userPersonalKeys = pgTable(
  "user_personal_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'google_calendar' | 'microsoft_calendar' | 'personal_api'
    encryptedValue: bytea("encrypted_value").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    lastFour: text("last_four").notNull(),
    status: text("status").notNull().default("active"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProviderUnique: uniqueIndex("idx_upk_user_provider").on(t.userId, t.provider),
  }),
);

export type OrgIntegrationKey = typeof orgIntegrationKeys.$inferSelect;
export type NewOrgIntegrationKey = typeof orgIntegrationKeys.$inferInsert;
export type UserPersonalKey = typeof userPersonalKeys.$inferSelect;
