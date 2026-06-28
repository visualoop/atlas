import { pgTable, text, uuid, timestamp, jsonb, inet, index } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { workspaces } from "./workspaces";

/**
 * Audit log — every mutation records here.
 *
 * `before` / `after` capture diffs (PII redacted per workspace AI policy).
 * Decryption events record `action='decrypted_secret'` with reason in payload.
 * Retention: 1 year default, 7 years for financial mutations (KRA via Omnix workspaces).
 */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgTimeIdx: index("idx_audit_org_time").on(t.organizationId, t.occurredAt),
    resourceIdx: index("idx_audit_resource").on(t.resourceType, t.resourceId),
    actorIdx: index("idx_audit_actor").on(t.actorId, t.occurredAt),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
