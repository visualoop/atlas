import { pgTable, text, uuid, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * Atlas workspaces — a workspace lives inside an organization.
 *
 * One organization can have many workspaces (Omnix · Marketplace · Studio).
 * Each member of the org has a per-workspace role (owner/admin/member/viewer)
 * which lets you have a sales hire who's only on Omnix but not on Studio.
 */

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(), // 'omnix' | 'marketplace' | 'studio'
    name: text("name").notNull(), // display name
    description: text("description"),
    type: text("type").notNull().default("business"),
    currency: text("currency").notNull().default("KES"),
    timezone: text("timezone").notNull().default("Africa/Nairobi"),
    brandColor: text("brand_color"), // override accent for this workspace (rare)
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex("idx_workspaces_org_slug").on(t.organizationId, t.slug),
    orgIdx: index("idx_workspaces_org").on(t.organizationId),
  }),
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'owner' | 'admin' | 'member' | 'viewer'
    invitedBy: text("invited_by").references(() => user.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: index("idx_wm_pk").on(t.workspaceId, t.userId),
    userIdx: index("idx_wm_user").on(t.userId),
  }),
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
