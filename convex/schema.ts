/**
 * Atlas Convex schema — Phase 0 foundation.
 *
 * Conventions (per plan/05-data-model.md):
 *   - All money is `v.int64()` cents. Never floats. (KES × 100)
 *   - Timestamps are `v.number()` (epoch ms). `_creationTime` covers
 *     "row appeared"; we only add explicit ts fields when we need a
 *     separate semantic time (e.g. occurredAt for audit_log).
 *   - Every query path needs an index. No `.filter()` in hot paths.
 *   - Tier-1 secrets (`orgIntegrationKeys`) and Tier-2 (`userPersonalKeys`)
 *     store ciphertext as a base64 string, encrypted by lib/secrets.ts
 *     using CONFIG_ENCRYPTION_KEY (the only env-stored secret).
 *   - File storage = Convex's built-in `_storage` (`v.id("_storage")`).
 *     No R2, no MinIO, no S3.
 *   - Soft-delete: rows that need it carry `archivedAt: v.optional(v.number())`.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/* ------------------------------------------------------------------ */
/* Reusable validators                                                 */
/* ------------------------------------------------------------------ */

const orgRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
const workspaceRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);
const invitationStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("revoked"),
  v.literal("expired"),
);
const keyStatus = v.union(
  v.literal("active"),
  v.literal("rotating"),
  v.literal("revoked"),
);

/* ------------------------------------------------------------------ */
/* Tier-1 integration providers — the bindable list                    */
/* ------------------------------------------------------------------ */
const integrationProvider = v.union(
  // AI
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
  // Communications
  v.literal("resend"),
  v.literal("meta_whatsapp"),
  v.literal("cloudflare_email_routing"),
  // Maps + lead gen
  v.literal("google_maps_places"),
  // Payments
  v.literal("paystack"),
  // Documents
  v.literal("docuseal"),
);

/* ------------------------------------------------------------------ */
/* Audit log — every mutation lands here                               */
/* ------------------------------------------------------------------ */
const auditAction = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("deleted"),
  v.literal("archived"),
  v.literal("restored"),
  v.literal("created_secret"),
  v.literal("rotated_secret"),
  v.literal("revoked_secret"),
  v.literal("decrypted_secret"),
  v.literal("invited_member"),
  v.literal("accepted_invitation"),
  v.literal("revoked_invitation"),
  v.literal("changed_role"),
  v.literal("sent_email"),
  v.literal("sent_whatsapp"),
  v.literal("ai_call"),
);

export default defineSchema({
  /* ============================================================ */
  /* Convex Auth tables (users, authSessions, etc.)                */
  /* ============================================================ */
  ...authTables,

  /* ============================================================ */
  /* Atlas user profile — extends `users` with role + onboarding   */
  /* ============================================================ */
  userProfiles: defineTable({
    userId: v.id("users"),
    fullName: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    timezone: v.string(),                    // 'Africa/Nairobi'
    locale: v.string(),                      // 'en'
    onboardedAt: v.optional(v.number()),
    // The org+workspace this user was last in — for fast re-entry.
    lastActiveOrgId: v.optional(v.id("organizations")),
    lastActiveWorkspaceId: v.optional(v.id("workspaces")),
  }).index("by_userId", ["userId"]),

  /* ============================================================ */
  /* Organizations + members + invitations                          */
  /* ============================================================ */
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),                        // 'blyss'
    logoStorageId: v.optional(v.id("_storage")),
    metadata: v.optional(v.any()),
    archivedAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]),

  members: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: orgRole,
    invitedBy: v.optional(v.id("users")),
    joinedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["organizationId", "userId"]),

  invitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),                       // lowercase
    role: orgRole,
    // Optional pre-assigned workspace memberships on accept.
    workspaceAssignments: v.optional(
      v.array(v.object({ workspaceId: v.id("workspaces"), role: workspaceRole })),
    ),
    inviterId: v.id("users"),
    token: v.string(),                       // URL-safe random
    status: invitationStatus,
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_org_email", ["organizationId", "email"])
    .index("by_email_status", ["email", "status"]),

  /* ============================================================ */
  /* Workspaces — one org has many; pre-seeded with Omnix, Marketplace, Studio */
  /* ============================================================ */
  workspaces: defineTable({
    organizationId: v.id("organizations"),
    slug: v.string(),                        // 'omnix' | 'marketplace' | 'studio'
    name: v.string(),
    description: v.optional(v.string()),
    currency: v.string(),                    // 'KES' default
    timezone: v.string(),                    // 'Africa/Nairobi'
    brandColor: v.optional(v.string()),      // override accent (rare)
    archivedAt: v.optional(v.number()),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_slug", ["organizationId", "slug"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: workspaceRole,
    invitedBy: v.optional(v.id("users")),
    joinedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  /* ============================================================ */
  /* Tier-1 secrets — org-level integration keys (encrypted)        */
  /* ============================================================ */
  orgIntegrationKeys: defineTable({
    organizationId: v.id("organizations"),
    provider: integrationProvider,
    label: v.string(),                       // 'Primary'
    encryptedValue: v.string(),              // base64(iv ‖ ct)
    keyVersion: v.number(),
    lastFour: v.string(),                    // for display: '•••8h2'
    status: keyStatus,
    // Provider-specific extras, also encrypted only when sensitive.
    // e.g. meta_whatsapp: { wabaId, phoneNumberIds }, paystack: { mode, publicKey, encryptedSecretKey }
    meta: v.optional(v.any()),
    createdBy: v.optional(v.id("users")),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_provider", ["organizationId", "provider"])
    .index("by_org_provider_label", ["organizationId", "provider", "label"]),

  /* ============================================================ */
  /* Tier-2 secrets — per-user personal integrations                */
  /* ============================================================ */
  userPersonalKeys: defineTable({
    userId: v.id("users"),
    provider: v.union(
      v.literal("google_calendar"),
      v.literal("microsoft_calendar"),
      v.literal("personal_api"),
    ),
    encryptedValue: v.string(),
    keyVersion: v.number(),
    lastFour: v.string(),
    status: keyStatus,
    meta: v.optional(v.any()),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  /* ============================================================ */
  /* Audit log — every mutation                                     */
  /* ============================================================ */
  auditLog: defineTable({
    organizationId: v.id("organizations"),
    workspaceId: v.optional(v.id("workspaces")),
    actorId: v.optional(v.id("users")),      // null = system
    action: auditAction,
    resourceType: v.string(),                // 'organization' | 'workspace' | 'integration_key' | …
    resourceId: v.string(),                  // id of subject (any table)
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    reason: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    requestId: v.optional(v.string()),
    payload: v.optional(v.any()),
    occurredAt: v.number(),
  })
    .index("by_org_time", ["organizationId", "occurredAt"])
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_actor", ["actorId"]),

  /* ============================================================ */
  /* Phase 1 — The graph                                            */
  /* ============================================================ */

  // Companies — businesses/orgs Atlas tracks. Scoped to a workspace.
  companies: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    domain: v.optional(v.string()),           // normalized lowercase, no protocol
    industry: v.optional(v.string()),
    size: v.optional(v.string()),             // '1-10' | '11-50' | …
    country: v.string(),                       // ISO-2, default 'KE'
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),             // E.164
    whatsapp: v.optional(v.string()),          // E.164
    emailPrimary: v.optional(v.string()),
    website: v.optional(v.string()),
    description: v.optional(v.string()),
    googlePlaceId: v.optional(v.string()),     // for Prospector dedup
    enrichedAt: v.optional(v.number()),
    enrichmentData: v.optional(v.any()),       // raw Places + scraped fields
    source: v.string(),                        // 'manual' | 'prospector' | 'inbound_email' | …
    fitScore: v.optional(v.number()),          // AI fit 0-100
    lifecycleStage: v.string(),                // 'cold' | 'warm' | 'qualified' | 'customer' | 'lost' | 'archived'
    ownerId: v.optional(v.id("users")),
    tags: v.array(v.string()),                 // tag names (denormalized for speed)
    customFields: v.optional(v.any()),         // jsonb-shaped
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_lifecycle", ["workspaceId", "lifecycleStage"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"])
    .index("by_workspace_place", ["workspaceId", "googlePlaceId"])
    .index("by_workspace_domain", ["workspaceId", "domain"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["workspaceId", "lifecycleStage", "archivedAt"],
    }),

  // Contacts — people inside companies (or independent freelancers).
  contacts: defineTable({
    workspaceId: v.id("workspaces"),
    companyId: v.optional(v.id("companies")),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),             // normalized lowercase
    phone: v.optional(v.string()),             // E.164
    whatsapp: v.optional(v.string()),          // E.164
    title: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    twitter: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    source: v.string(),
    lifecycleStage: v.string(),
    ownerId: v.optional(v.id("users")),
    tags: v.array(v.string()),
    customFields: v.optional(v.any()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_company", ["workspaceId", "companyId"])
    .index("by_workspace_email", ["workspaceId", "email"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"])
    .searchIndex("search_name", {
      searchField: "firstName",
      filterFields: ["workspaceId", "lifecycleStage", "archivedAt"],
    }),

  // Tags — workspace-scoped, drives the global tag picker.
  // tags array on companies/contacts is denormalized for speed;
  // this table is the canonical name + color registry.
  tags: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),                          // canonical lowercase
    label: v.string(),                         // display case
    color: v.optional(v.string()),             // oklch / hex
    description: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "name"]),

  /* ============================================================ */
  /* Timeline — every action lands here                             */
  /* ============================================================ */
  timelineEvents: defineTable({
    workspaceId: v.id("workspaces"),
    eventType: v.string(),
    // 'contact_created' | 'company_created' | 'note_added' |
    // 'task_created' | 'task_completed' | 'email_sent' | 'email_received' |
    // 'whatsapp_sent' | 'whatsapp_received' | 'deal_stage_changed' |
    // 'document_sent' | 'payment_received' | 'meeting_held' | …
    actorId: v.optional(v.id("users")),         // null = system / inbound
    subjectType: v.string(),                    // 'contact' | 'company' | 'deal' | …
    subjectId: v.string(),                      // PK of subject (any table)
    relatedRefs: v.optional(v.any()),           // { conversationId, messageId, … }
    payload: v.optional(v.any()),               // event-specific data
    occurredAt: v.number(),
  })
    .index("by_workspace_subject", ["workspaceId", "subjectType", "subjectId", "occurredAt"])
    .index("by_workspace_occurred", ["workspaceId", "occurredAt"])
    .index("by_workspace_type", ["workspaceId", "eventType", "occurredAt"]),

  /* ============================================================ */
  /* Notes — rich text via TipTap (stored as JSON)                  */
  /* ============================================================ */
  notes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.optional(v.string()),
    body: v.any(),                              // TipTap JSON
    bodyText: v.string(),                       // plain-text extract for FTS
    relatedToType: v.optional(v.string()),      // 'contact' | 'company' | 'deal' | …
    relatedToId: v.optional(v.string()),
    authorId: v.id("users"),
    pinned: v.boolean(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .index("by_author", ["authorId"])
    .searchIndex("search_body", {
      searchField: "bodyText",
      filterFields: ["workspaceId", "relatedToType", "relatedToId", "archivedAt"],
    }),

  /* ============================================================ */
  /* Tasks — outcome-anchored                                       */
  /* ============================================================ */
  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("doing"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
    dueAt: v.optional(v.number()),
    reminderAt: v.optional(v.number()),
    recurrence: v.optional(v.string()),         // cron-like, future
    assigneeId: v.optional(v.id("users")),
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    aiSuggested: v.boolean(),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_assignee_due", ["workspaceId", "assigneeId", "dueAt"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "status", "archivedAt"],
    }),

  /* ============================================================ */
  /* Files — Convex storage Ids + metadata                          */
  /* ============================================================ */
  files: defineTable({
    workspaceId: v.id("workspaces"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    extractedText: v.optional(v.string()),      // for PDF/image OCR (Phase 2+)
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    uploadedBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .index("by_uploader", ["uploadedBy"]),
});
